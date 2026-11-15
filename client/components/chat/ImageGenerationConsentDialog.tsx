import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useAurora } from '../../hooks/useAurora';
import PressableScale from '../ui/PressableScale';
import {
  SD_CONSENT_DONT_ASK_AGAIN_KEY,
  shouldPromptImageConsent,
  setConsentDontAskAgain,
} from '../../utils/imageGenerationConsent';

export {
  SD_CONSENT_DONT_ASK_AGAIN_KEY,
  shouldPromptImageConsent,
  setConsentDontAskAgain,
};

export interface ImageGenerationConsentDialogProps {
  visible: boolean;
  steps?: number;
  batteryLevel?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImageGenerationConsentDialog({
  visible,
  steps = 20,
  batteryLevel,
  onConfirm,
  onCancel,
}: ImageGenerationConsentDialogProps) {
  const { colors, sizes, aurora } = useAurora();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (visible) {
      setDontAskAgain(false);
    }
  }, [visible]);

  const handleConfirm = async () => {
    if (dontAskAgain) {
      await setConsentDontAskAgain(true);
    }
    onConfirm();
  };

  const isHighCompute = steps > 25;
  const isLowBattery = batteryLevel !== undefined && batteryLevel < 0.2;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.dialogContainer,
            { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.text, fontSize: sizes.title }]}>
            🎨 Generate image on this device?
          </Text>

          <Text style={[styles.dialogSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Vela will run Stable Diffusion locally on your phone — your prompt and the image never leave the device.
            This is compute- and battery-intensive and typically takes 1–3 minutes at default settings (512×512, 20 steps).
          </Text>

          {(isHighCompute || isLowBattery) && (
            <View style={styles.warningCard}>
              <Text style={[styles.warningText, { color: aurora.acc1 }]}>
                {isHighCompute && isLowBattery
                  ? '⚠️ High step count (>25) and low battery detected (<20%). Device may warm up.'
                  : isHighCompute
                  ? '⚠️ High step count (>25 steps requested). Inference will take longer.'
                  : '⚠️ Low battery (<20%). Consider connecting to a charger.'}
              </Text>
            </View>
          )}

          {!isHighCompute && !isLowBattery && (
            <Pressable
              onPress={() => setDontAskAgain((prev) => !prev)}
              style={styles.checkboxRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontAskAgain }}
              accessibilityLabel="Don't ask again for standard generations"
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: colors.textMuted },
                  dontAskAgain && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                ]}
              >
                {dontAskAgain && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.textMuted }]}>
                Don't ask again (except when battery &lt; 20% or steps &gt; 25)
              </Text>
            </Pressable>
          )}

          <View style={styles.actionRow}>
            <PressableScale
              scaleTo={0.96}
              onPress={onCancel}
              style={[styles.button, styles.cancelButton, { borderColor: colors.glassBorder }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel generation"
            >
              <Text style={[styles.cancelButtonText, { color: colors.textMuted }]}>Cancel</Text>
            </PressableScale>

            <PressableScale
              scaleTo={0.96}
              onPress={handleConfirm}
              style={[styles.button, styles.generateButton, { backgroundColor: aurora.acc1 }]}
              accessibilityRole="button"
              accessibilityLabel="Confirm generate image"
            >
              <Text style={styles.generateButtonText}>Generate</Text>
            </PressableScale>
          </View>
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
    padding: 24,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 16,
  },
  dialogTitle: {
    fontWeight: '700',
  },
  dialogSubtitle: {
    lineHeight: 20,
  },
  warningCard: {
    padding: 12,
    borderRadius: 12,
  },
  warningText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  generateButton: {},
  generateButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
