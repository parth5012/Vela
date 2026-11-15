import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import ImagePreview from '../media/ImagePreview';
import PressableScale from '../ui/PressableScale';
import { useAurora } from '../../hooks/useAurora';

export interface ImageGenerationCardProps {
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  seed?: number;
  status: 'idle' | 'generating' | 'completed' | 'cancelled' | 'error';
  currentStep?: number;
  totalSteps?: number;
  imageUri?: string;
  errorMessage?: string;
  durationMs?: number;
  onCancel?: () => void;
  onRetry?: () => void;
  onOpenGallery?: () => void;
  accentColor?: string;
}

export function ImageGenerationCard({
  prompt,
  negativePrompt,
  steps = 20,
  seed,
  status,
  currentStep = 0,
  totalSteps = 20,
  imageUri,
  errorMessage,
  durationMs,
  onCancel,
  onRetry,
  onOpenGallery,
  accentColor,
}: ImageGenerationCardProps) {
  const { colors, aurora } = useAurora();
  const [modalVisible, setModalVisible] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const errorTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const screenDimensions = Dimensions.get('window');
  const accent = accentColor || aurora.acc1 || '#818cf8';

  const progressPercent =
    totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;

  const cardWidth = Math.min(320, screenDimensions.width * 0.85);

  const showActionError = (msg: string) => {
    setActionError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setActionError(null), 3000);
  };

  const handleCopyPrompt = async () => {
    try {
      await Clipboard.setStringAsync(prompt);
      setCopiedPrompt(true);
      setActionError(null);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err: any) {
      console.warn('[ImageGenerationCard] Failed to copy prompt to clipboard:', err);
      showActionError('Failed to copy prompt');
    }
  };

  const handleShare = async () => {
    if (!imageUri) return;
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(imageUri, {
          mimeType: 'image/png',
          dialogTitle: 'Share Generated Image',
        });
        setActionError(null);
      } else {
        showActionError('Sharing is not available on this device');
      }
    } catch (err: any) {
      console.warn('[ImageGenerationCard] Failed to share image:', err);
      showActionError('Failed to share image');
    }
  };

  const handleSaveToPhotos = async () => {
    if (!imageUri) return;
    try {
      // In mobile environments without explicit Photos permissions,
      // expo-sharing offers system "Save Image" / save to files directly.
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(imageUri, {
          mimeType: 'image/png',
          dialogTitle: 'Save Image',
        });
        setSavedSuccess(true);
        setActionError(null);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setSavedSuccess(false), 2000);
      } else {
        showActionError('Saving is not available on this device');
      }
    } catch (err: any) {
      console.warn('[ImageGenerationCard] Failed to save image:', err);
      showActionError('Failed to save image');
    }
  };

  const handleOpenGallery = () => {
    if (onOpenGallery) {
      onOpenGallery();
      return;
    }
    try {
      const { router } = require('expo-router');
      router?.navigate?.('/gallery');
    } catch {
      // safe fallback in test environments
    }
  };

  return (
    <View
      testID="image-generation-card"
      style={[
        styles.cardContainer,
        {
          width: cardWidth,
          backgroundColor: colors.bubbleAssistant || 'rgba(30, 41, 59, 0.7)',
          borderColor: colors.bubbleAssistantBorder || 'rgba(255, 255, 255, 0.1)',
        },
      ]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.headerIcon}>🎨</Text>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {status === 'generating'
            ? 'Generating on-device…'
            : status === 'completed'
            ? 'Generated Image'
            : status === 'cancelled'
            ? 'Generation Cancelled'
            : status === 'error'
            ? 'Generation Failed'
            : 'Image Generator'}
        </Text>
        {status === 'generating' && (
          <View style={[styles.statusBadge, { backgroundColor: `${accent}25` }]}>
            <Text style={[styles.statusBadgeText, { color: accent }]}>
              {progressPercent}%
            </Text>
          </View>
        )}
      </View>

      {/* Prompt preview */}
      <Text
        style={[styles.promptText, { color: colors.textMuted }]}
        numberOfLines={status === 'completed' ? 2 : 4}
      >
        "{prompt}"
      </Text>

      {/* Generating state: progress bar & cancel button */}
      {status === 'generating' && (
        <View style={styles.generatingSection}>
          <View style={styles.progressTrack}>
            <View
              testID="generation-progress-bar"
              style={[
                styles.progressBar,
                { width: `${progressPercent}%`, backgroundColor: accent },
              ]}
            />
          </View>

          <View style={styles.stepCountRow}>
            <Text style={[styles.stepCountText, { color: colors.textMuted }]}>
              {`Step ${currentStep} of ${totalSteps}`}
            </Text>
            {onCancel && (
              <PressableScale
                scaleTo={0.95}
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel image generation"
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </PressableScale>
            )}
          </View>
        </View>
      )}

      {/* Completed state: image preview & action buttons */}
      {status === 'completed' && imageUri && (
        <View style={styles.completedSection}>
          <PressableScale
            scaleTo={0.98}
            onPress={() => setModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="View generated image fullscreen"
            accessibilityHint="Double tap to open image modal"
            style={styles.imagePreviewWrapper}
          >
            <ImagePreview
              uri={imageUri}
              thumbnailUri={imageUri}
              width={cardWidth - 24}
              height={cardWidth - 24}
              alt={prompt}
              containerStyle={styles.imageContainer}
            />
          </PressableScale>

          {/* Metadata chips */}
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: colors.skyBottom || 'rgba(0,0,0,0.2)' }]}>
              <Text style={[styles.chipText, { color: colors.textMuted }]}>512×512</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: colors.skyBottom || 'rgba(0,0,0,0.2)' }]}>
              <Text style={[styles.chipText, { color: colors.textMuted }]}>{steps} steps</Text>
            </View>
            {seed !== undefined && seed >= 0 && (
              <View style={[styles.chip, { backgroundColor: colors.skyBottom || 'rgba(0,0,0,0.2)' }]}>
                <Text style={[styles.chipText, { color: colors.textMuted }]}>seed #{seed}</Text>
              </View>
            )}
            {durationMs !== undefined && durationMs > 0 && (
              <View style={[styles.chip, { backgroundColor: colors.skyBottom || 'rgba(0,0,0,0.2)' }]}>
                <Text style={[styles.chipText, { color: colors.textMuted }]}>
                  {(durationMs / 1000).toFixed(1)}s
                </Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            <PressableScale
              scaleTo={0.95}
              onPress={handleSaveToPhotos}
              accessibilityRole="button"
              accessibilityLabel="Save image"
              style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.actionBtnText, { color: colors.text }]}>
                {savedSuccess ? '✓ Saved' : '💾 Save'}
              </Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.95}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share image"
              style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.actionBtnText, { color: colors.text }]}>
                ↗ Share
              </Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.95}
              onPress={handleCopyPrompt}
              accessibilityRole="button"
              accessibilityLabel="Copy prompt"
              style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.actionBtnText, { color: colors.text }]}>
                {copiedPrompt ? '✓ Copied' : '📋 Prompt'}
              </Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.95}
              onPress={handleOpenGallery}
              accessibilityRole="button"
              accessibilityLabel="View in gallery"
              accessibilityHint="Navigates to the generated image gallery"
              style={[styles.actionBtn, { borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.actionBtnText, { color: colors.text }]}>
                🎨 Gallery
              </Text>
            </PressableScale>
          </View>

          {actionError && (
            <Text style={[styles.actionErrorText, { color: aurora.acc1 || '#ef4444' }]}>
              {actionError}
            </Text>
          )}
        </View>
      )}

      {/* Cancelled or Error state */}
      {(status === 'cancelled' || status === 'error') && (
        <View style={styles.errorSection}>
          <Text style={[styles.errorDescription, { color: colors.textMuted }]}>
            {errorMessage || (status === 'cancelled' ? 'Inference was stopped.' : 'An error occurred during generation.')}
          </Text>
          {onRetry && (
            <PressableScale
              scaleTo={0.95}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry image generation"
              style={[styles.retryBtn, { backgroundColor: accent }]}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </PressableScale>
          )}
        </View>
      )}

      {/* Fullscreen modal on tap */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.fullscreenModal}>
          <Pressable
            style={styles.modalCloseOverlay}
            onPress={() => setModalVisible(false)}
          >
            <View style={styles.fullscreenContent}>
              {imageUri && (
                <ImagePreview
                  uri={imageUri}
                  thumbnailUri={imageUri}
                  width={screenDimensions.width - 32}
                  height={screenDimensions.width - 32}
                  alt={prompt}
                  containerStyle={styles.fullscreenImage}
                />
              )}
              <Text style={[styles.fullscreenPrompt, { color: '#ffffff' }]}>
                {prompt}
              </Text>
              <PressableScale
                scaleTo={0.95}
                onPress={() => setModalVisible(false)}
                style={styles.closeModalButton}
              >
                <Text style={styles.closeModalText}>Close</Text>
              </PressableScale>
            </View>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginVertical: 4,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 18,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  promptText: {
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  generatingSection: {
    gap: 8,
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  stepCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepCountText: {
    fontSize: 12,
    fontWeight: '500',
  },
  cancelButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  cancelButtonText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
  completedSection: {
    gap: 8,
    marginTop: 4,
  },
  imagePreviewWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageContainer: {
    borderRadius: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorSection: {
    gap: 8,
    marginTop: 4,
  },
  errorDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  actionErrorText: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  fullscreenModal: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  fullscreenContent: {
    alignItems: 'center',
    gap: 16,
  },
  fullscreenImage: {
    borderRadius: 16,
  },
  fullscreenPrompt: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
  },
  closeModalButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  closeModalText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
