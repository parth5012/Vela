import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, AppState, ActivityIndicator } from 'react-native';
import { useDeviceSessionStore } from '../../store/useDeviceSessionStore';
import { checkPermission, openSettings } from '../../utils/permissionManager';
import { useAurora } from '../../hooks/useAurora';
import { Card } from '../ui/settingsKit';
import { DEFAULT_ELEVATION } from '../../utils/elevation';

export function AccessibilityPermissionModal() {
  const visible = useDeviceSessionStore((s) => s.isAccessibilityModalVisible);
  const setVisible = useDeviceSessionStore((s) => s.setAccessibilityModalVisible);
  const { colors, sizes, aurora } = useAurora();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isGranted, setIsGranted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const status = await checkPermission('accessibility');
      if (status === 'granted') {
        setIsGranted(true);
        setStep(3);
      } else {
        setIsGranted(false);
        setStep((currentStep) => (currentStep === 3 ? 1 : currentStep));
      }
    } finally {
      setChecking(false);
    }
  }, []);

  // Listen to AppState resume to auto-detect return from Android Settings
  useEffect(() => {
    if (!visible) return;

    // Check immediately on mount/open
    checkStatus();

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkStatus();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [visible, checkStatus]);

  const handleOpenSettings = async () => {
    setStep(2);
    setLaunchError(null);
    const result = await openSettings('accessibility');
    if (result && (result as any).success === false) {
      setLaunchError((result as any).error || 'Could not launch Android Settings automatically.');
    }
  };

  const handleClose = () => {
    setVisible(false);
    // Reset to step 1 for next time if not granted
    if (!isGranted) {
      setStep(1);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.icon}>♿</Text>
            <View style={styles.titleCol}>
              <Text style={[styles.title, { color: colors.text, fontSize: sizes.title }]}>
                {step === 3 && isGranted ? 'Accessibility Active' : 'Accessibility Service Setup'}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Step {step} of 3 • Device Agent Permission Flow
              </Text>
            </View>
          </View>

          {/* Step 1: Explainer Screen */}
          {step === 1 && (
            <View style={styles.content}>
              <Text style={[styles.bodyText, { color: colors.text, fontSize: sizes.text }]}>
                Vela requires Android's Accessibility Service to view buttons, text, and screen elements so it can safely execute actions on your behalf.
              </Text>

              <Card style={[styles.privacyCard, { borderColor: `${aurora.acc1 || '#3b82f6'}40` }]}>
                <Text style={[styles.privacyTitle, { color: aurora.acc1 || '#3b82f6', fontSize: sizes.sub + 1 }]}>
                  🔒 Strict Privacy Guarantee
                </Text>
                <Text style={[styles.privacyText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  All screen analysis and actions execute strictly on-device. Vela never records, transmits, or uploads your screen content, passwords, or personal credentials.
                </Text>
              </Card>

              <Pressable
                onPress={handleOpenSettings}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: aurora.acc1 || '#3b82f6' },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Open Android Accessibility Settings"
              >
                <Text style={styles.primaryBtnText}>Open Android Settings →</Text>
              </Pressable>
            </View>
          )}

          {/* Step 2: Settings Instruction & Waiting */}
          {step === 2 && (
            <View style={styles.content}>
              <Text style={[styles.bodyText, { color: colors.text, fontSize: sizes.text }]}>
                In your Android Settings:
              </Text>

              <View style={styles.stepsList}>
                <Text style={[styles.stepItem, { color: colors.text, fontSize: sizes.sub }]}>
                  1. Scroll to <Text style={{ fontWeight: 'bold' }}>Installed apps</Text> or <Text style={{ fontWeight: 'bold' }}>Downloaded services</Text>.
                </Text>
                <Text style={[styles.stepItem, { color: colors.text, fontSize: sizes.sub }]}>
                  2. Select <Text style={{ fontWeight: 'bold' }}>Vela</Text> and toggle the switch to <Text style={{ fontWeight: 'bold' }}>ON</Text>.
                </Text>
                <Text style={[styles.stepItem, { color: colors.text, fontSize: sizes.sub }]}>
                  3. Confirm Android's system safety prompt, then switch back to this app.
                </Text>
              </View>

              <Card style={styles.sideloadCard}>
                <Text style={[styles.sideloadTitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  💡 Android 13+ Sideload Notice:
                </Text>
                <Text style={[styles.sideloadText, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
                  If the toggle is greyed out with "Restricted setting", first open App Info → tap the top-right three dots (⋮) → select "Allow restricted settings".
                </Text>
              </Card>

              {launchError ? (
                <Card style={[styles.sideloadCard, { borderColor: 'rgba(244, 63, 94, 0.4)', backgroundColor: 'rgba(244, 63, 94, 0.1)' }]}>
                  <Text style={[styles.sideloadTitle, { color: '#f43f5e', fontSize: sizes.sub }]}>
                    ⚠️ Settings Launch Notice:
                  </Text>
                  <Text style={[styles.sideloadText, { color: colors.text, fontSize: sizes.sub - 1 }]}>
                    {launchError} Please navigate to Settings manually using the steps below.
                  </Text>
                </Card>
              ) : null}

              <View style={styles.autoDetectRow}>
                {checking ? (
                  <ActivityIndicator size="small" color={aurora.acc1} />
                ) : (
                  <Text style={[styles.autoDetectText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                    Auto-detecting activation upon returning...
                  </Text>
                )}
              </View>

              <View style={styles.buttonRow}>
                <Pressable
                  onPress={handleOpenSettings}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Re-open Android Settings"
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.text, fontSize: sizes.text }]}>
                    Re-open Settings
                  </Text>
                </Pressable>

                <Pressable
                  onPress={checkStatus}
                  style={({ pressed }) => [
                    styles.primaryBtnFlex,
                    { backgroundColor: aurora.acc1 || '#3b82f6' },
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Check permission status again"
                >
                  <Text style={styles.primaryBtnText}>Check Again</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Step 3: Success & Verified */}
          {step === 3 && (
            <View style={styles.content}>
              <View style={styles.successBox}>
                <Text style={styles.successIcon}>🎉</Text>
                <Text style={[styles.successTitle, { color: colors.text, fontSize: sizes.title }]}>
                  Accessibility Service Active
                </Text>
                <Text style={[styles.successSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  Vela can now read UI element bounds and safely assist with device navigation under your explicit confirmation.
                </Text>
              </View>

              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: aurora.acc1 || '#3b82f6' },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Complete accessibility setup"
              >
                <Text style={styles.primaryBtnText}>Done</Text>
              </Pressable>
            </View>
          )}

          {/* Dismiss button */}
          {step !== 3 && (
            <Pressable
              onPress={handleClose}
              style={styles.cancelLink}
              accessibilityRole="button"
              accessibilityLabel="Cancel accessibility setup"
            >
              <Text style={[styles.cancelLinkText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Dismiss for now
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    elevation: 5,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  icon: {
    fontSize: 28,
  },
  titleCol: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
  },
  subtitle: {
    marginTop: 2,
  },
  content: {
    marginBottom: 10,
  },
  bodyText: {
    lineHeight: 20,
    marginBottom: 14,
  },
  privacyCard: {
    padding: 12,
    marginBottom: 18,
    borderWidth: 1,
  },
  privacyTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  privacyText: {
    lineHeight: 18,
  },
  stepsList: {
    marginBottom: 14,
    gap: 8,
  },
  stepItem: {
    lineHeight: 18,
  },
  sideloadCard: {
    padding: 10,
    marginBottom: 16,
  },
  sideloadTitle: {
    fontWeight: '600',
    marginBottom: 2,
  },
  sideloadText: {
    lineHeight: 16,
  },
  autoDetectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    height: 24,
  },
  autoDetectText: {
    fontStyle: 'italic',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtn: {
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnFlex: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryBtnText: {
    textAlign: 'center',
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  successIcon: {
    fontSize: 44,
  },
  successTitle: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
  successSubtitle: {
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  cancelLink: {
    marginTop: 8,
    alignSelf: 'center',
    padding: 6,
  },
  cancelLinkText: {
    textDecorationLine: 'underline',
  },
});
