import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { ThemeColors } from '../../utils/theme';

interface MessageOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  onDownloadMd: () => void;
  onRegenerate: () => void;
  onToggleRaw: () => void;
  onBranch: () => void;
  onCopyText: () => void;
  onCopyCode: () => void;
  onShare: () => void;
  onShowInfo: () => void;
  onView?: (content: string) => void;
  messageContent?: string;
  themeColors: ThemeColors;
  isRaw: boolean;
  isUser?: boolean;
}

export default function MessageOptionsModal({
  visible,
  onClose,
  onDownloadMd,
  onRegenerate,
  onToggleRaw,
  onBranch,
  onCopyText,
  onCopyCode,
  onShare,
  onShowInfo,
  onView,
  messageContent,
  themeColors,
  isRaw,
  isUser,
}: MessageOptionsModalProps) {
  const optionButtonStyle = ({ pressed }: { pressed: boolean }) => [
    styles.optionButton,
    { backgroundColor: themeColors.card, borderColor: themeColors.border },
    pressed && styles.optionButtonPressed,
  ];

  const options: {
    id: string;
    icon: string;
    label: string;
    onPress: () => void;
    visible?: boolean;
    accessibilityLabel?: string;
  }[] = [
    { id: 'download', icon: '📄', label: 'Download as MD', onPress: onDownloadMd },
    { id: 'regenerate', icon: '🔄', label: 'Regenerate Response', onPress: onRegenerate, visible: !isUser },
    {
      id: 'raw',
      icon: '👁️',
      label: isRaw ? 'Show Rendered Markdown' : 'Show Raw Markdown',
      onPress: onToggleRaw,
      visible: !isUser,
    },
    { id: 'branch', icon: '🌿', label: 'Branch Conversation', onPress: onBranch },
    {
      id: 'view',
      icon: '👁️',
      label: 'View Full',
      onPress: () => onView?.(messageContent ?? ''),
      visible: Boolean(onView && messageContent),
      accessibilityLabel: 'View full message',
    },
    { id: 'copy-text', icon: '📋', label: 'Copy Message', onPress: onCopyText },
    { id: 'copy-code', icon: '💻', label: 'Copy Code Blocks Only', onPress: onCopyCode },
    { id: 'share', icon: '📤', label: 'Share', onPress: onShare, visible: !isUser },
    { id: 'info', icon: 'ℹ️', label: 'Response Info', onPress: onShowInfo, visible: !isUser },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[
            styles.modalContent,
            { backgroundColor: themeColors.background, borderColor: themeColors.border },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.dragHandle, { backgroundColor: themeColors.textDark }]} />
          <Text style={[styles.title, { color: themeColors.text }]}>Message Options</Text>

          {options
            .filter((opt) => opt.visible !== false)
            .map((opt) => (
              <Pressable
                key={opt.id}
                style={optionButtonStyle}
                onPress={() => {
                  opt.onPress();
                  onClose();
                }}
                {...(opt.accessibilityLabel
                  ? { accessibilityRole: 'button' as const, accessibilityLabel: opt.accessibilityLabel }
                  : {})}
              >
                <Text style={styles.optionIcon}>{opt.icon}</Text>
                <Text style={[styles.optionButtonText, { color: themeColors.text }]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}

          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
            onPress={onClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0b1329',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1e294b',
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 20,
    textAlign: 'center',
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
  },
  optionButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  optionIcon: {
    fontSize: 18,
  },
  optionButtonText: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 12,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: 'transparent',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cancelButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cancelButtonText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '600',
  },
});
