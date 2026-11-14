import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  Pressable,
} from 'react-native';
import ImagePreview from '../media/ImagePreview';
import type { ChatAttachment } from '../../store/useChatStore';
import PressableScale from '../ui/PressableScale';

export interface ImageAttachmentViewProps {
  attachment: ChatAttachment;
  inViewport?: boolean;
  accentColor?: string;
  isUser?: boolean;
}

export function ImageAttachmentView({
  attachment,
  inViewport = true,
  accentColor = '#818cf8',
  isUser = false,
}: ImageAttachmentViewProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const screenDimensions = Dimensions.get('window');

  const imageUri = attachment.url || attachment.storage_path;
  const altText = attachment.alt_text || 'Image attachment';

  // Aspect ratio calculation bounded by 240 max width in chat bubble
  const originalWidth = attachment.width || 800;
  const originalHeight = attachment.height || 600;
  const aspectRatio = originalWidth / originalHeight;
  const bubbleWidth = Math.min(240, screenDimensions.width * 0.65);
  const bubbleHeight = Math.max(100, Math.min(220, Math.round(bubbleWidth / aspectRatio)));

  return (
    <View style={styles.container}>
      <PressableScale
        scaleTo={0.97}
        onPress={() => setModalVisible(true)}
        accessibilityLabel={`View image attachment: ${altText}`}
        accessibilityRole="button"
        accessibilityHint="Tap to zoom image full screen"
        style={styles.thumbnailWrapper}
      >
        <ImagePreview
          uri={imageUri}
          thumbnailUri={imageUri}
          inViewport={inViewport}
          width={bubbleWidth}
          height={bubbleHeight}
          alt={altText}
          containerStyle={styles.imageContainer}
        />
        {attachment.alt_text ? (
          <View style={styles.altBadge}>
            <Text style={styles.altBadgeText} numberOfLines={1}>
              ALT: {attachment.alt_text}
            </Text>
          </View>
        ) : null}
      </PressableScale>

      {/* Tap-to-zoom Fullscreen Modal (Decision 7) */}
      <Modal
        visible={modalVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.modalBackground}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {altText}
            </Text>
            <PressableScale
              scaleTo={0.92}
              onPress={() => setModalVisible(false)}
              accessibilityLabel="Close full screen image"
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </PressableScale>
          </View>

          <View style={styles.modalBody}>
            <ImagePreview
              uri={imageUri}
              inViewport={true}
              width={screenDimensions.width}
              height={screenDimensions.height * 0.75}
              alt={altText}
              style={styles.fullImage}
              containerStyle={styles.fullImageContainer}
            />
          </View>

          {attachment.alt_text ? (
            <View style={styles.modalCaptionContainer}>
              <Text style={styles.modalCaptionText}>{attachment.alt_text}</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  thumbnailWrapper: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  imageContainer: {
    borderRadius: 14,
  },
  altBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  altBadgeText: {
    color: '#e4e4e7',
    fontSize: 10,
    fontWeight: '500',
  },
  modalBackground: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    color: '#f4f4f5',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 16,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageContainer: {
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  fullImage: {
    resizeMode: 'contain',
  },
  modalCaptionContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(24, 24, 27, 0.8)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalCaptionText: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 18,
  },
});
export default ImageAttachmentView;
