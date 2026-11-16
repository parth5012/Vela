import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  TextInput,
  Pressable,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAurora } from '../hooks/useAurora';
import {
  useImageGalleryStore,
  GeneratedImageItem,
  filterGalleryImages,
} from '../store/useImageGalleryStore';
import { ImageViewerModal } from '../components/gallery/ImageViewerModal';
import ImagePreview from '../components/media/ImagePreview';
import PressableScale from '../components/ui/PressableScale';

export default function ImageGalleryScreen() {
  const router = useRouter();
  const { colors, aurora } = useAurora();
  const images = useImageGalleryStore((state) => state.images);
  const searchQuery = useImageGalleryStore((state) => state.searchQuery);
  const setSearchQuery = useImageGalleryStore((state) => state.setSearchQuery);
  const unlimitedStorage = useImageGalleryStore((state) => state.unlimitedStorage);
  const setUnlimitedStorage = useImageGalleryStore((state) => state.setUnlimitedStorage);
  const clearAllImages = useImageGalleryStore((state) => state.clearAllImages);
  const hasHydrated = useImageGalleryStore((state) => state.hasHydrated);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const selectedImage = useMemo(
    () => images.find((img) => img.id === selectedImageId) || null,
    [images, selectedImageId]
  );

  const { width: screenWidth } = useWindowDimensions();
  const padding = 16;
  const gap = 8;
  const numColumns = 3;
  const itemSize = Math.floor((screenWidth - padding * 2 - gap * (numColumns - 1)) / numColumns);
  const accent = aurora.acc1 || '#818cf8';

  const filteredList = useMemo(() => {
    return filterGalleryImages(images, searchQuery);
  }, [images, searchQuery]);

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Images',
      'Are you sure you want to delete all generated images from disk and history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearAllImages();
            setShowSettingsModal(false);
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: GeneratedImageItem }) => {
    return (
      <PressableScale
        scaleTo={0.95}
        onPress={() => setSelectedImageId(item.id)}
        accessibilityRole="button"
        style={[
          styles.gridCell,
          {
            width: itemSize,
            height: itemSize,
            backgroundColor: colors.bubbleAssistant || 'rgba(30, 41, 59, 0.6)',
            borderColor: colors.bubbleAssistantBorder || 'rgba(255, 255, 255, 0.08)',
          },
        ]}
        accessibilityLabel={`View image for ${item.prompt}`}
      >
        <ImagePreview
          uri={item.uri}
          thumbnailUri={item.uri}
          width={itemSize}
          height={itemSize}
          alt={item.prompt}
          containerStyle={styles.thumbnailContainer}
        />
        {item.isPinned ? (
          <View style={styles.pinBadge}>
            <Text style={styles.pinBadgeText}>📌</Text>
          </View>
        ) : null}
      </PressableScale>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background || '#0f172a' }]}>
      {/* Top Header */}
      <View style={[styles.headerRow, { borderBottomColor: colors.glassBorder || 'rgba(255, 255, 255, 0.08)' }]}>
        <View style={styles.headerLeft}>
          <PressableScale
            scaleTo={0.92}
            onPress={() => router.navigate('/')}
            style={styles.headerButton}
            accessibilityLabel="Back to chat"
          >
            <Text style={[styles.headerButtonText, { color: colors.text || '#f8fafc' }]}>←</Text>
          </PressableScale>
          <Text style={[styles.headerTitle, { color: colors.text || '#f8fafc' }]}>
            Image Gallery
          </Text>
        </View>

        <View style={styles.headerRight}>
          <PressableScale
            scaleTo={0.92}
            onPress={() => {
              if (showSearch) {
                setSearchQuery('');
              }
              setShowSearch(!showSearch);
            }}
            style={[styles.headerButton, showSearch ? { backgroundColor: 'rgba(129, 140, 248, 0.2)' } : undefined]}
            accessibilityLabel="Toggle search"
          >
            <Text style={[styles.headerButtonText, { color: showSearch ? accent : (colors.text || '#f8fafc') }]}>
              🔍
            </Text>
          </PressableScale>

          <PressableScale
            scaleTo={0.92}
            onPress={() => setShowSettingsModal(true)}
            style={styles.headerButton}
            accessibilityLabel="Gallery settings"
          >
            <Text style={[styles.headerButtonText, { color: colors.text || '#f8fafc' }]}>⚙️</Text>
          </PressableScale>
        </View>
      </View>

      {/* Expandable Search Input */}
      {showSearch ? (
        <View style={styles.searchBarContainer}>
          <TextInput
            style={[
              styles.searchInput,
              {
                color: colors.text || '#f8fafc',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderColor: colors.glassBorder || 'rgba(255, 255, 255, 0.15)',
              },
            ]}
            placeholder="Search prompt, model, or tags..."
            placeholderTextColor={colors.textMuted || '#94a3b8'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              style={styles.clearSearchBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search input"
            >
              <Text style={styles.clearSearchText}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Info Status Bar */}
      <View style={styles.statusBarRow}>
        <Text style={[styles.statusText, { color: colors.textMuted || '#94a3b8' }]}>
          {filteredList.length} {filteredList.length === 1 ? 'image' : 'images'}
        </Text>
        <Text style={[styles.statusBadge, { color: accent }]}>
          {unlimitedStorage ? 'Unlimited Storage' : 'Cap: 100 (LRU Eviction)'}
        </Text>
      </View>

      {/* Main Grid View */}
      {!hasHydrated ? (
        <View style={styles.emptyContainer} />
      ) : filteredList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎨</Text>
          <Text style={[styles.emptyTitle, { color: colors.text || '#f8fafc' }]}>
            {searchQuery ? 'No matching images' : 'No generated images yet'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted || '#94a3b8' }]}>
            {searchQuery
              ? 'Try searching for a different keyword or prompt phrase.'
              : 'Ask Vela in chat to generate an image using on-device Stable Diffusion.'}
          </Text>
          <PressableScale
            scaleTo={0.95}
            onPress={() => {
              if (searchQuery) {
                setSearchQuery('');
              } else {
                router.navigate('/');
              }
            }}
            style={[styles.emptyButton, { backgroundColor: accent }]}
            accessibilityLabel={searchQuery ? 'Clear search filter' : 'Go to chat to generate images'}
          >
            <Text style={[styles.emptyButtonText, { color: aurora.onAccent || '#ffffff' }]}>
              {searchQuery ? 'Clear Search' : 'Open Chat'}
            </Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          testID="gallery-flat-list"
          data={filteredList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={numColumns}
          contentContainerStyle={[styles.gridListContent, { padding }]}
          columnWrapperStyle={{ gap }}
          ItemSeparatorComponent={() => <View style={{ height: gap }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Fullscreen Image Detail Modal */}
      <ImageViewerModal
        image={selectedImage}
        visible={Boolean(selectedImage)}
        onClose={() => setSelectedImageId(null)}
      />

      {/* Gallery Storage Settings Modal */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <SafeAreaView style={styles.settingsModalBackdrop}>
          <View
            style={[
              styles.settingsModalCard,
              {
                backgroundColor: colors.bubbleAssistant || 'rgba(30, 41, 59, 0.95)',
                borderColor: colors.bubbleAssistantBorder || 'rgba(255, 255, 255, 0.15)',
              },
            ]}
          >
            <View style={styles.settingsHeader}>
              <Text style={[styles.settingsTitle, { color: colors.text || '#f8fafc' }]}>
                Storage & Retention
              </Text>
              <Pressable
                onPress={() => setShowSettingsModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close storage settings"
              >
                <Text style={[styles.settingsCloseBtn, { color: colors.textMuted || '#94a3b8' }]}>✕</Text>
              </Pressable>
            </View>

            <Text style={[styles.settingsDescription, { color: colors.textMuted || '#94a3b8' }]}>
              Choose how local generated images are preserved on your device.
            </Text>

            {/* Retention Toggle Options */}
            <PressableScale
              scaleTo={0.98}
              onPress={() => setUnlimitedStorage(false)}
              style={[
                styles.optionRow,
                !unlimitedStorage
                  ? { borderColor: accent, backgroundColor: 'rgba(129, 140, 248, 0.12)' }
                  : { borderColor: 'rgba(255, 255, 255, 0.1)' },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: !unlimitedStorage }}
              accessibilityLabel="Select 100 image capacity with LRU auto eviction"
            >
              <View style={styles.optionRadio}>
                {!unlimitedStorage ? <View style={[styles.optionRadioDot, { backgroundColor: accent }]} /> : null}
              </View>
              <View style={styles.optionTextCol}>
                <Text style={[styles.optionLabel, { color: colors.text || '#f8fafc' }]}>
                  Cap at 100 images (Recommended)
                </Text>
                <Text style={[styles.optionSub, { color: colors.textMuted || '#94a3b8' }]}>
                  Automatically evicts oldest unpinned images when storage reaches 100 items.
                </Text>
              </View>
            </PressableScale>

            <PressableScale
              scaleTo={0.98}
              onPress={() => setUnlimitedStorage(true)}
              style={[
                styles.optionRow,
                unlimitedStorage
                  ? { borderColor: accent, backgroundColor: 'rgba(129, 140, 248, 0.12)' }
                  : { borderColor: 'rgba(255, 255, 255, 0.1)' },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: unlimitedStorage }}
              accessibilityLabel="Select unlimited local storage"
            >
              <View style={styles.optionRadio}>
                {unlimitedStorage ? <View style={[styles.optionRadioDot, { backgroundColor: accent }]} /> : null}
              </View>
              <View style={styles.optionTextCol}>
                <Text style={[styles.optionLabel, { color: colors.text || '#f8fafc' }]}>
                  Unlimited local history
                </Text>
                <Text style={[styles.optionSub, { color: colors.textMuted || '#94a3b8' }]}>
                  Keeps all generated images until you manually delete them.
                </Text>
              </View>
            </PressableScale>

            {/* Clear All Danger Action */}
            <PressableScale
              scaleTo={0.96}
              onPress={handleClearAll}
              style={styles.clearAllButton}
              accessibilityLabel="Delete all generated images"
            >
              <Text style={styles.clearAllText}>Clear All Generated Images</Text>
            </PressableScale>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 26,
    padding: 6,
  },
  clearSearchText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  statusBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  gridListContent: {
    paddingBottom: 24,
  },
  gridCell: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  thumbnailContainer: {
    borderRadius: 12,
    width: '100%',
    height: '100%',
  },
  pinBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  pinBadgeText: {
    fontSize: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  emptyButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  settingsModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  settingsModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  settingsCloseBtn: {
    fontSize: 16,
    padding: 4,
  },
  settingsDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#94a3b8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionTextCol: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  optionSub: {
    fontSize: 11,
    lineHeight: 15,
  },
  clearAllButton: {
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
  },
  clearAllText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
  },
});
