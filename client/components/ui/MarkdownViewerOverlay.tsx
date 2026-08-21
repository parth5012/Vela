import React, { useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAurora } from '../../hooks/useAurora';
import RichText from '../chat/RichText';

interface MarkdownViewerOverlayProps {
  visible: boolean;
  content: string;
  title?: string;
  onClose: () => void;
}

export default function MarkdownViewerOverlay({
  visible,
  content,
  title,
  onClose,
}: MarkdownViewerOverlayProps) {
  const { colors, sizes, aurora } = useAurora();
  const insets = useSafeAreaInsets();

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(content);
      Alert.alert('Success', 'Copied to clipboard');
    } catch {
      Alert.alert('Error', 'Failed to copy');
    }
  }, [content]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: content });
    } catch (err: any) {
      console.error(err);
    }
  }, [content]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <LinearGradient
        colors={[colors.skyTop, colors.skyBottom]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        {/* Subtle aurora glow layer */}
        <View pointerEvents="none" style={styles.auroraGlow}>
          <LinearGradient
            colors={[aurora.glow, 'transparent']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 0.6 }}
          />
        </View>

        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.glassBorder,
              backgroundColor: colors.glass,
              paddingTop: 8,
            },
          ]}
        >
          <View style={styles.headerTopRow}>
            <Text
              style={[styles.headerTitle, { color: colors.text, fontSize: sizes.title - 2 }]}
              numberOfLines={1}
            >
              {title || 'Message'}
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close viewer"
              hitSlop={8}
            >
              <Text style={[styles.closeButtonText, { color: colors.text }]}>✕</Text>
            </Pressable>
          </View>

          {/* Optional actions row */}
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [
                styles.actionPill,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.2)' },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Copy content"
            >
              <Text style={[styles.actionPillText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                📋 Copy
              </Text>
            </Pressable>
            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [
                styles.actionPill,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.2)' },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Share content"
            >
              <Text style={[styles.actionPillText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                📤 Share
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(24, insets.bottom) }]}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.contentWrapper}>
            <RichText
              content={content}
              colors={colors}
              sizes={sizes}
              accentHex={aurora.acc1}
            />
          </View>
        </ScrollView>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  auroraGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    zIndex: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionPill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionPillText: {
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  contentWrapper: {
    maxWidth: '100%',
    width: '100%',
  },
});
