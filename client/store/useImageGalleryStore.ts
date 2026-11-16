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

export function filterGalleryImages(
  images: GeneratedImageItem[],
  query: string
): GeneratedImageItem[] {
  const trimmed = (query || '').trim().toLowerCase();
  if (!trimmed) return images;
  return images.filter(
    (img) =>
      img.prompt.toLowerCase().includes(trimmed) ||
      img.negativePrompt?.toLowerCase().includes(trimmed) ||
      img.model.toLowerCase().includes(trimmed)
  );
}

export function selectEvictions(
  images: GeneratedImageItem[],
  maxCapacity: number,
  protectId?: string
): { kept: GeneratedImageItem[]; evicted: GeneratedImageItem[] } {
  if (maxCapacity <= 0 || images.length <= maxCapacity) {
    return { kept: images, evicted: [] };
  }
  const excessCount = images.length - maxCapacity;
  // Never evict pinned images or protected items (e.g. freshly added image)
  const unpinned = images.filter((img) => !img.isPinned && img.id !== protectId);
  if (unpinned.length === 0) {
    return { kept: images, evicted: [] };
  }

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
  return {
    kept: images.filter((img) => !idsToEvict.has(img.id)),
    evicted: oldestUnpinned,
  };
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
          const { kept, evicted } = selectEvictions(images, maxCapacity);
          for (const item of evicted) {
            if (item.uri && item.uri.startsWith('file://')) {
              FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
            }
          }
          set({ images: kept });
        }
      },
      setMaxCapacity: (maxCapacity: number) => {
        const capacity = Math.max(1, maxCapacity);
        set({ maxCapacity: capacity });
        if (!get().unlimitedStorage) {
          const { images } = get();
          const { kept, evicted } = selectEvictions(images, capacity);
          for (const item of evicted) {
            if (item.uri && item.uri.startsWith('file://')) {
              FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
            }
          }
          set({ images: kept });
        }
      },

      saveGeneratedImage: async (input: SaveImageInput): Promise<GeneratedImageItem> => {
        await ensureGalleryDirectory();
        const id = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const targetUri = `${GALLERY_DIR}${id}.png`;

        let savedUri = input.sourceUri;
        try {
          if (input.sourceUri.startsWith(GALLERY_DIR)) {
            // Already in gallery directory (single owner, avoids duplicate disk usage)
            savedUri = input.sourceUri;
          } else if (input.sourceUri.startsWith('data:image/svg') || input.sourceUri.includes('<svg')) {
            let svgContent = input.sourceUri;
            if (/^data:[^;]+;base64,/.test(input.sourceUri)) {
              const base64Data = input.sourceUri.replace(/^data:[^;]+;base64,/, '');
              await FileSystem.writeAsStringAsync(targetUri, base64Data, {
                encoding: (FileSystem.EncodingType?.Base64 || 'base64') as any,
              });
            } else {
              if (svgContent.startsWith('data:')) {
                svgContent = decodeURIComponent(svgContent.replace(/^data:[^,]+,/, ''));
              }
              await FileSystem.writeAsStringAsync(targetUri, svgContent, {
                encoding: (FileSystem.EncodingType?.UTF8 || 'utf8') as any,
              });
            }
            savedUri = targetUri;
          } else if (/^data:[^;]+;base64,/.test(input.sourceUri)) {
            const base64Data = input.sourceUri.replace(/^data:[^;]+;base64,/, '');
            await FileSystem.writeAsStringAsync(targetUri, base64Data, {
              encoding: (FileSystem.EncodingType?.Base64 || 'base64') as any,
            });
            savedUri = targetUri;
          } else if (input.sourceUri.startsWith('file:') && input.sourceUri !== targetUri) {
            await FileSystem.copyAsync({
              from: input.sourceUri,
              to: targetUri,
            });
            savedUri = targetUri;
          }
        } catch (fileErr) {
          console.warn('[ImageGalleryStore] Could not persist file to gallery dir, keeping source URI:', fileErr);
          savedUri = input.sourceUri;
        }

        const currentImages = get().images;
        const previousLatest = currentImages.reduce((max, img) => Math.max(max, img.timestamp), 0);
        const timestamp = Math.max(Date.now(), previousLatest + 1);

        const newItem: GeneratedImageItem = {
          id,
          prompt: input.prompt.trim(),
          negativePrompt: input.negativePrompt?.trim(),
          model: input.model || 'SD 1.5 LCM Q4_0',
          timestamp,
          width: input.width || 512,
          height: input.height || 512,
          steps: input.steps || 20,
          seed: input.seed !== undefined ? input.seed : -1,
          uri: savedUri,
          isPinned: false,
        };
        const { unlimitedStorage, maxCapacity } = get();

        // Eviction logic: if capped at maxCapacity, auto-evict oldest unpinned images, protecting newItem
        const listWithNew = [newItem, ...currentImages];
        let updatedList = listWithNew;

        if (!unlimitedStorage && maxCapacity > 0) {
          const { kept, evicted } = selectEvictions(listWithNew, maxCapacity, newItem.id);
          for (const item of evicted) {
            if (item.uri && item.uri.startsWith('file://')) {
              FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
            }
          }
          updatedList = kept;
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
        await Promise.allSettled(
          images
            .filter((item) => item.uri && item.uri.startsWith('file://'))
            .map((item) =>
              FileSystem.deleteAsync(item.uri, { idempotent: true }).catch((err) => {
                console.warn('[ImageGalleryStore] Error deleting file during clearAll:', err);
              })
            )
        );
        set((state) => ({
          images: state.images.filter((img) => !clearedIds.has(img.id)),
        }));
      },

      filteredImages: (): GeneratedImageItem[] => {
        const { images, searchQuery } = get();
        return filterGalleryImages(images, searchQuery);
      },
    }),
    {
      name: 'vela-image-gallery-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        images: state.images,
        unlimitedStorage: state.unlimitedStorage,
        maxCapacity: state.maxCapacity,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
