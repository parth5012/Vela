import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  StyleSheet,
} from 'react-native';
import type { PickedImageFile } from '../../utils/chatAttachments';
import { isTotalUploadOverWarnThreshold } from '../../utils/imageCompression';
import PressableScale from '../ui/PressableScale';

export interface AttachmentPickerTrayProps {
  attachments: PickedImageFile[];
  onRemove: (index: number) => void;
  onUpdateAltText: (index: number, altText: string) => void;
  maxCount: number;
  colors: {
    card: string;
    border: string;
    text: string;
    textMuted: string;
    glassBorder: string;
  };
  accentColor: string;
}

export function AttachmentPickerTray({
  attachments,
  onRemove,
  onUpdateAltText,
  maxCount,
  colors,
  accentColor,
}: AttachmentPickerTrayProps) {
  const [editingAltIndex, setEditingAltIndex] = useState<number | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const sizes = attachments.map((a) => a.compressed?.size || a.size || 0);
  const isOverWarn = isTotalUploadOverWarnThreshold(sizes);
  const totalKb = Math.round(sizes.reduce((a, b) => a + b, 0) / 1024);

  return (
    <View
      style={[
        styles.trayContainer,
        {
          backgroundColor: colors.card,
          borderColor: isOverWarn ? '#f59e0b' : colors.glassBorder,
        },
      ]}
    >
      <View style={styles.trayHeader}>
        <Text style={[styles.headerText, { color: colors.textMuted }]}>
          Attachments ({attachments.length}/{maxCount}) · {totalKb} KB total
        </Text>
        {isOverWarn && (
          <View style={styles.warnBadge}>
            <Text style={styles.warnText}>⚠️ High payload (&gt; 5 MB)</Text>
          </View>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}
      >
        {attachments.map((item, index) => {
          const isEditingAlt = editingAltIndex === index;
          return (
            <View
              key={item.uri + index}
              style={[
                styles.itemCard,
                { borderColor: colors.border, backgroundColor: 'rgba(0, 0, 0, 0.2)' },
              ]}
            >
              <View style={styles.thumbnailWrapper}>
                <Image source={{ uri: item.compressed?.uri || item.uri }} style={styles.thumbnail} />
                <PressableScale
                  scaleTo={0.9}
                  onPress={() => onRemove(index)}
                  style={styles.removeButton}
                  accessibilityLabel={`Remove image ${index + 1}`}
                >
                  <Text style={styles.removeButtonText}>✕</Text>
                </PressableScale>
              </View>

              <View style={styles.itemFooter}>
                {isEditingAlt ? (
                  <TextInput
                    style={[styles.altInput, { color: colors.text, borderColor: accentColor }]}
                    placeholder="Add alt text..."
                    placeholderTextColor={colors.textMuted}
                    value={item.altText || ''}
                    onChangeText={(txt) => onUpdateAltText(index, txt)}
                    onBlur={() => setEditingAltIndex(null)}
                    autoFocus
                    maxLength={100}
                  />
                ) : (
                  <PressableScale
                    scaleTo={0.96}
                    onPress={() => setEditingAltIndex(index)}
                    style={styles.altButton}
                    accessibilityLabel="Edit alt text"
                  >
                    <Text
                      style={[
                        styles.altButtonText,
                        { color: item.altText ? accentColor : colors.textMuted },
                      ]}
                      numberOfLines={1}
                    >
                      {item.altText ? `ALT: ${item.altText}` : '+ Alt text'}
                    </Text>
                  </PressableScale>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  trayContainer: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
  },
  trayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  warnBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  warnText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  scrollList: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
  },
  itemCard: {
    width: 100,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
  },
  thumbnailWrapper: {
    width: 100,
    height: 75,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 14,
  },
  itemFooter: {
    width: '100%',
    padding: 4,
  },
  altButton: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  altButtonText: {
    fontSize: 10,
    fontWeight: '500',
  },
  altInput: {
    fontSize: 10,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: 4,
  },
});
export default AttachmentPickerTray;
