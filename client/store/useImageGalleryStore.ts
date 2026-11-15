import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

export interface GeneratedImageItem {
  id: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  timestamp: number;
  width: number;
  height: number;
  steps: number;
  seed: number;
  uri: string;
  isPinned?: boolean;
}

export interface SaveImageInput {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  sourceUri: string;
}

export interface ImageGalleryStoreState {
  images: GeneratedImageItem[];
  unlimitedStorage: boolean;
  maxCapacity: number;
  searchQuery: string;
  hasHydrated: boolean;

  setHasHydrated: (hasHydrated: boolean) => void;
  setSearchQuery: (query: string) => void;
  setUnlimitedStorage: (unlimited: boolean) => void;
  setMaxCapacity: (capacity: number) => void;
  saveGeneratedImage: (input: SaveImageInput) => Promise<GeneratedImageItem>;
  deleteImage: (id: string) => Promise<void>;
  togglePinImage: (id: string) => void;
  clearAllImages: () => Promise<void>;
  filteredImages: () => GeneratedImageItem[];
}

export const GALLERY_DIR = `${FileSystem.documentDirectory || 'file:///data/user/0/com.vela.client/files/'}generated-images/`;

export async function ensureGalleryDirectory(): Promise<string> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(GALLERY_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(GALLERY_DIR, { intermediates: true });
    }
  } catch (err) {
    console.warn('[ImageGalleryStore] Error creating gallery directory:', err);
  }
  return GALLERY_DIR;
}

export const useImageGalleryStore = create<ImageGalleryStoreState>()(
  persist(
    (set, get) => ({
      images: [],
      unlimitedStorage: false,
      maxCapacity: 100,
      searchQuery: '',
      hasHydrated: false,

      setHasHydrated: (hasHydrated: boolean) => set({ hasHydrated }),
      setSearchQuery: (searchQuery: string) =>
        set({ searchQuery: (searchQuery || '').slice(0, 200) }),
      setUnlimitedStorage: (unlimitedStorage: boolean) => {
        set({ unlimitedStorage });
        if (!unlimitedStorage) {
          const { images, maxCapacity } = get();
          if (maxCapacity > 0 && images.length > maxCapacity) {
            const excessCount = images.length - maxCapacity;
            const unpinned = images.filter((img) => !img.isPinned);
            if (unpinned.length > 0) {
              const indexMap = new Map(images.map((img, idx) => [img.id, idx]));
              const oldestUnpinned = [...unpinned]
                .sort((a, b) => {
                  if (a.timestamp !== b.timestamp) {
                    return a.timestamp - b.timestamp;
                  }
                  return (indexMap.get(b.id) ?? 0) - (indexMap.get(a.id) ?? 0);
                })
                .slice(0, excessCount);

              const idsToEvict = new Set(oldestUnpinned.map((img) => img.id));
              for (const item of oldestUnpinned) {
                if (item.uri && item.uri.startsWith('file://')) {
                  FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
                }
              }
              set({ images: images.filter((img) => !idsToEvict.has(img.id)) });
            }
          }
        }
      },
      setMaxCapacity: (maxCapacity: number) => set({ maxCapacity: Math.max(10, maxCapacity) }),

      saveGeneratedImage: async (input: SaveImageInput): Promise<GeneratedImageItem> => {
        await ensureGalleryDirectory();
        const id = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const targetUri = `${GALLERY_DIR}${id}.png`;

        let savedUri = input.sourceUri;
        try {
          if (input.sourceUri.startsWith('data:')) {
            const base64Data = input.sourceUri.replace(/^data:[^;]+;base64,/, '');
            await FileSystem.writeAsStringAsync(targetUri, base64Data, {
              encoding: (FileSystem.EncodingType?.Base64 || 'base64') as any,
            });
            savedUri = targetUri;
          } else if (input.sourceUri.includes('<svg')) {
            await FileSystem.writeAsStringAsync(targetUri, input.sourceUri, {
              encoding: (FileSystem.EncodingType?.UTF8 || 'utf8') as any,
            });
            savedUri = targetUri;
          } else if (input.sourceUri.startsWith('file:') && input.sourceUri !== targetUri) {
            if (typeof (FileSystem as any).copyAsync === 'function') {
              await (FileSystem as any).copyAsync({
                from: input.sourceUri,
                to: targetUri,
              });
              savedUri = targetUri;
            } else {
              savedUri = input.sourceUri;
            }
          }
        } catch (fileErr) {
          console.warn('[ImageGalleryStore] Could not copy file to gallery dir, keeping source URI:', fileErr);
          savedUri = input.sourceUri;
        }

        const currentImages = get().images;
        const previousLatest = currentImages.reduce((max, img) => Math.max(max, img.timestamp), 0);
        const timestamp = Math.max(Date.now(), previousLatest + 1);

        const newItem: GeneratedImageItem = {
          id,
          prompt: input.prompt.trim(),
          negativePrompt: input.negativePrompt?.trim(),
          model: input.model || 'Stable Diffusion 1.5 (INT8)',
          timestamp,
          width: input.width || 512,
          height: input.height || 512,
          steps: input.steps || 20,
          seed: input.seed !== undefined ? input.seed : -1,
          uri: savedUri,
          isPinned: false,
        };
        const { unlimitedStorage, maxCapacity } = get();

        // Eviction logic: if capped at maxCapacity, auto-evict oldest unpinned images
        let updatedList = [newItem, ...currentImages];

        if (!unlimitedStorage && maxCapacity > 0 && updatedList.length > maxCapacity) {
          const excessCount = updatedList.length - maxCapacity;
          const unpinned = updatedList.filter((img) => !img.isPinned);
          if (unpinned.length > 0) {
            // Updated list has newest items first; higher index in updatedList was added earlier
            const indexMap = new Map(updatedList.map((img, idx) => [img.id, idx]));
            const oldestUnpinned = [...unpinned]
              .sort((a, b) => {
                if (a.timestamp !== b.timestamp) {
                  return a.timestamp - b.timestamp;
                }
                return (indexMap.get(b.id) ?? 0) - (indexMap.get(a.id) ?? 0);
              })
              .slice(0, excessCount);

            const idsToEvict = new Set(oldestUnpinned.map((img) => img.id));

            // Clean up files asynchronously
            for (const item of oldestUnpinned) {
              if (item.uri && item.uri.startsWith('file://')) {
                FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
              }
            }

            updatedList = updatedList.filter((img) => !idsToEvict.has(img.id));
          }
        }

        set({ images: updatedList });
        return newItem;
      },

      deleteImage: async (id: string): Promise<void> => {
        const item = get().images.find((img) => img.id === id);
        if (item?.uri && item.uri.startsWith('file://')) {
          try {
            await FileSystem.deleteAsync(item.uri, { idempotent: true });
          } catch (err) {
            console.warn('[ImageGalleryStore] Error deleting file:', err);
          }
        }
        set((state) => ({
          images: state.images.filter((img) => img.id !== id),
        }));
      },

      togglePinImage: (id: string) => {
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id ? { ...img, isPinned: !img.isPinned } : img
          ),
        }));
      },

      clearAllImages: async (): Promise<void> => {
        const images = get().images;
        const clearedIds = new Set(images.map((item) => item.id));
        for (const item of images) {
          if (item.uri && item.uri.startsWith('file://')) {
            try {
              await FileSystem.deleteAsync(item.uri, { idempotent: true });
            } catch (err) {
              console.warn('[ImageGalleryStore] Error deleting file during clearAll:', err);
            }
          }
        }
        set((state) => ({
          images: state.images.filter((img) => !clearedIds.has(img.id)),
        }));
      },

      filteredImages: (): GeneratedImageItem[] => {
        const { images, searchQuery } = get();
        const trimmed = searchQuery.trim().toLowerCase();
        if (!trimmed) return images;
        return images.filter(
          (img) =>
            img.prompt.toLowerCase().includes(trimmed) ||
            img.negativePrompt?.toLowerCase().includes(trimmed) ||
            img.model.toLowerCase().includes(trimmed)
        );
      },
    }),
    {
      name: 'vela-image-gallery-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
