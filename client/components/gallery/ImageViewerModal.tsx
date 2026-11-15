import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { GeneratedImageItem, useImageGalleryStore } from '../../store/useImageGalleryStore';
import { useChatStore } from '../../store/useChatStore';
import { useAurora } from '../../hooks/useAurora';
import ImagePreview from '../media/ImagePreview';
import PressableScale from '../ui/PressableScale';

export interface ImageViewerModalProps {
  image: GeneratedImageItem | null;
  visible: boolean;
  onClose: () => void;
}

export function ImageViewerModal({ image, visible, onClose }: ImageViewerModalProps) {
  const router = useRouter();
  const { colors, aurora } = useAurora();
  const [copied, setCopied] = useState(false);
  const deleteImage = useImageGalleryStore((state) => state.deleteImage);
  const togglePin = useImageGalleryStore((state) => state.togglePinImage);
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);

  if (!image) return null;

  const screenDimensions = Dimensions.get('window');
  const imageSize = Math.min(screenDimensions.width - 32, 480);
  const accent = aurora.acc1 || '#818cf8';

  const handleCopyPrompt = async () => {
    try {
      await Clipboard.setStringAsync(image.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[ImageViewerModal] Failed to copy prompt:', err);
    }
  };

  const handleShare = async () => {
    if (!image.uri) return;
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(image.uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share Generated Image',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err) {
      console.warn('[ImageViewerModal] Share error:', err);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Image',
      'Are you sure you want to delete this generated image? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteImage(image.id);
            onClose();
          },
        },
      ]
    );
  };

  const handleRegenerate = () => {
    setPendingPrompt(image.prompt);
    onClose();
    router.navigate('/');
  };

  const formattedDate = new Date(image.timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="image-viewer-modal"
    >
      <SafeAreaView style={styles.modalBackdrop}>
        {/* Top Header Actions */}
        <View style={styles.modalHeader}>
          <PressableScale
            scaleTo={0.92}
            onPress={onClose}
            style={styles.iconButton}
            accessibilityLabel="Close viewer"
          >
            <Text style={styles.iconButtonText}>✕</Text>
          </PressableScale>

          <View style={styles.headerRightGroup}>
            <PressableScale
              scaleTo={0.92}
              onPress={() => togglePin(image.id)}
              style={[
                styles.iconButton,
                image.isPinned ? { backgroundColor: 'rgba(129, 140, 248, 0.25)', borderColor: accent } : undefined,
              ]}
              accessibilityLabel={image.isPinned ? 'Unpin image' : 'Pin image'}
            >
              <Text style={[styles.iconButtonText, image.isPinned ? { color: accent } : undefined]}>
                {image.isPinned ? '📌' : '📍'}
              </Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.92}
              onPress={handleShare}
              style={styles.iconButton}
              accessibilityLabel="Share image"
            >
              <Text style={styles.iconButtonText}>📤</Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.92}
              onPress={handleDelete}
              style={[styles.iconButton, styles.deleteIconButton]}
              accessibilityLabel="Delete image"
            >
              <Text style={[styles.iconButtonText, { color: '#f87171' }]}>🗑️</Text>
            </PressableScale>
          </View>
        </View>

        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Main Image Display */}
          <View style={[styles.imageWrapper, { width: imageSize, height: imageSize }]}>
            <ImagePreview
              uri={image.uri}
              thumbnailUri={image.uri}
              width={imageSize}
              height={imageSize}
              alt={image.prompt}
              containerStyle={styles.previewContainer}
            />
          </View>

          {/* Details Card */}
          <View
            style={[
              styles.detailsCard,
              {
                backgroundColor: colors.bubbleAssistant || 'rgba(30, 41, 59, 0.75)',
                borderColor: colors.bubbleAssistantBorder || 'rgba(255, 255, 255, 0.12)',
              },
            ]}
          >
            {/* Prompt Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text || '#f8fafc' }]}>
                Prompt
              </Text>
              <Pressable
                onPress={handleCopyPrompt}
                hitSlop={8}
                style={styles.copyButton}
                accessibilityLabel="Copy prompt text"
              >
                <Text style={[styles.copyButtonText, { color: accent }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.promptBody, { color: colors.text || '#f8fafc' }]}>
              {`"${image.prompt}"`}
            </Text>

            {image.negativePrompt ? (
              <View style={styles.negativeSection}>
                <Text style={styles.metaLabel}>Negative Prompt:</Text>
                <Text style={[styles.negativePromptText, { color: colors.textMuted || '#94a3b8' }]}>
                  {image.negativePrompt}
                </Text>
              </View>
            ) : null}

            {/* Chips Grid */}
            <View style={styles.chipsContainer}>
              <View style={[styles.chip, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={styles.chipText}>{image.model}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={styles.chipText}>{`${image.width}×${image.height}`}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={styles.chipText}>{`${image.steps} steps`}</Text>
              </View>
              {image.seed >= 0 ? (
                <View style={[styles.chip, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
                  <Text style={styles.chipText}>Seed #{image.seed}</Text>
                </View>
              ) : null}
              <View style={[styles.chip, { backgroundColor: 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={styles.chipText}>{formattedDate}</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.cardActions}>
              <PressableScale
                scaleTo={0.96}
                onPress={handleRegenerate}
                style={[styles.primaryActionButton, { backgroundColor: accent }]}
                accessibilityLabel="Regenerate prompt in chat"
              >
                <Text style={styles.primaryActionText}>Regenerate in Chat</Text>
              </PressableScale>

              <PressableScale
                scaleTo={0.96}
                onPress={handleShare}
                style={[
                  styles.secondaryActionButton,
                  { borderColor: colors.glassBorder || 'rgba(255, 255, 255, 0.15)' },
                ]}
                accessibilityLabel="Share generated image"
              >
                <Text style={[styles.secondaryActionText, { color: colors.text || '#f8fafc' }]}>
                  Share
                </Text>
              </PressableScale>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerRightGroup: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteIconButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  iconButtonText: {
    fontSize: 16,
    color: '#ffffff',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  imageWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    marginVertical: 12,
  },
  previewContainer: {
    borderRadius: 20,
  },
  detailsCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 12,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  promptBody: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  negativeSection: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  negativePromptText: {
    fontSize: 12,
    lineHeight: 16,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chipText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  primaryActionButton: {
    flex: 2,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
