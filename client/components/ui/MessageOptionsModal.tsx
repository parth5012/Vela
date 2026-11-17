import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { ThemeColors } from '../../utils/theme';
import PressableScale from './PressableScale';
import { DURATIONS, EASING } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { triggerHaptic } from '../../utils/haptics';

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
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(28)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        overlayOpacity.setValue(1);
        sheetTranslateY.setValue(0);
        return;
      }
      overlayOpacity.setValue(0);
      sheetTranslateY.setValue(28);
      const anim = Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: DURATIONS.reveal,
          easing: EASING.out,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return () => anim.stop();
    }
  }, [visible, reducedMotion, overlayOpacity, sheetTranslateY]);

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
      animationType="none"
      transparent={true}
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.backdrop,
            { opacity: overlayOpacity },
          ]}
          pointerEvents="none"
        />
        <Animated.View
          style={[
            styles.modalContent,
            { backgroundColor: themeColors.background, borderColor: themeColors.border },
            { transform: reducedMotion ? [] : [{ translateY: sheetTranslateY }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.dragHandle, { backgroundColor: themeColors.textDark }]} />
          <Text style={[styles.title, { color: themeColors.text }]}>Message Options</Text>

          {options
            .filter((opt) => opt.visible !== false)
            .map((opt) => (
              <PressableScale
                key={opt.id}
                scaleTo={0.97}
                style={optionButtonStyle}
                onPress={() => {
                  if (opt.id.startsWith('copy')) {
                    triggerHaptic('success');
                  }
                  opt.onPress();
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={opt.accessibilityLabel || opt.label}
              >
                <Text style={styles.optionIcon}>{opt.icon}</Text>
                <Text style={[styles.optionButtonText, { color: themeColors.text }]}>
                  {opt.label}
                </Text>
              </PressableScale>
            ))}

          <PressableScale
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
            onPress={onClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </PressableScale>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
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
