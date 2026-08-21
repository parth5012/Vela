import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAurora } from '../../hooks/useAurora';
import { openSettings } from '../../utils/permissionManager';

export interface AccessibilityGuideProps {
  visible: boolean;
  onClose: () => void;
}

interface Step {
  index: number;
  title: string;
  description: string;
  icon: string;
}

const STEPS: Step[] = [
  {
    index: 1,
    title: 'Open Settings',
    description: 'Open the system Settings app on your device.',
    icon: '⚙️',
  },
  {
    index: 2,
    title: 'Go to Accessibility',
    description: 'Scroll down and tap Accessibility.',
    icon: '♿',
  },
  {
    index: 3,
    title: 'Find Vela',
    description: 'Under Downloaded apps or Services, find Vela.',
    icon: '🔍',
  },
  {
    index: 4,
    title: 'Enable',
    description: 'Toggle the switch to enable VelaAccessibilityService.',
    icon: '✅',
  },
];

export default function AccessibilityGuide({ visible, onClose }: AccessibilityGuideProps) {
  const { colors, sizes, aurora } = useAurora();

  const handleOpenSettings = async () => {
    await openSettings('accessibility');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.glassBorder }]}>
          <LinearGradient
            colors={[colors.skyTop, colors.skyBottom]}
            style={styles.headerGradient}
          >
            <View style={styles.headerRow}>
              <Text style={[styles.headerTitle, { color: colors.text, fontSize: sizes.title }]}>
                Enable Accessibility
              </Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close guide">
                <Text style={[styles.closeText, { color: colors.textMuted, fontSize: sizes.title }]}>×</Text>
              </Pressable>
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
              Follow these 4 steps to let Vela automate tasks for you.
            </Text>
          </LinearGradient>

          <ScrollView contentContainerStyle={styles.stepsContent} showsVerticalScrollIndicator={false}>
            {STEPS.map((step) => (
              <View
                key={step.index}
                style={[styles.stepCard, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
              >
                <View style={styles.stepLeft}>
                  <View style={[styles.stepNumber, { backgroundColor: aurora.acc1 }]}>
                    <Text style={[styles.stepNumberText, { color: aurora.onAccent }]}>{step.index}</Text>
                  </View>
                  <View style={[styles.illustration, { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                    <Text style={{ fontSize: 28 }}>{step.icon}</Text>
                  </View>
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepTitle, { color: colors.text, fontSize: sizes.text }]}>{step.title}</Text>
                  <Text style={[styles.stepDesc, { color: colors.textMuted, fontSize: sizes.sub }]}>{step.description}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={handleOpenSettings}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: aurora.acc1, opacity: pressed ? 0.8 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open Accessibility settings"
            >
              <Text style={[styles.ctaText, { color: aurora.onAccent, fontSize: sizes.text }]}>Open Settings → Accessibility</Text>
            </Pressable>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.7 }]}>
              <Text style={[styles.dismissText, { color: colors.textMuted, fontSize: sizes.sub }]}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerGradient: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontWeight: '400',
    lineHeight: 22,
  },
  headerSubtitle: {
    lineHeight: 16,
  },
  stepsContent: {
    padding: 16,
    gap: 12,
  },
  stepCard: {
    flexDirection: 'row',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
  },
  stepLeft: {
    alignItems: 'center',
    gap: 8,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '700',
  },
  illustration: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: {
    flex: 1,
    gap: 4,
  },
  stepTitle: {
    fontWeight: '600',
  },
  stepDesc: {
    lineHeight: 16,
  },
  footer: {
    padding: 16,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  cta: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontWeight: '700',
  },
  dismiss: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  dismissText: {
    fontWeight: '600',
  },
});
