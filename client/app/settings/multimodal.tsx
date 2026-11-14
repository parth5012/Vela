import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  useAurora,
} from '../../components/ui/settingsKit';
import PressableScale from '../../components/ui/PressableScale';

const IMAGE_LIMIT_OPTIONS = [
  { value: '1', label: '1 image' },
  { value: '2', label: '2 (Default)' },
  { value: '3', label: '3 images' },
  { value: '5', label: '5 images' },
  { value: '10', label: '10 images' },
];

export default function MultimodalSettingsScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();

  const maxImagesPerMessage = useConfigStore((s) => s.maxImagesPerMessage);
  const setMaxImagesPerMessage = useConfigStore((s) => s.setMaxImagesPerMessage);
  const cloudPrivacyConsent = useConfigStore((s) => s.cloudPrivacyConsent);
  const setCloudPrivacyConsent = useConfigStore((s) => s.setCloudPrivacyConsent);

  return (
    <AuroraScreen
      title="Multimodal Chat"
      subtitle="Configure image attachments, on-device compression, and cloud privacy consent."
      onBack={() => router.back()}
    >
      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabelContainer}>
            <Text style={[styles.toggleTitle, { color: colors.text, fontSize: sizes.text }]}>
              Cloud Privacy Consent
            </Text>
            <Text style={[styles.toggleSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
              Allow image attachments to be sent to cloud-hosted vision models (e.g. Gemini, OpenAI, Claude).
              When disabled, images are never sent to cloud providers.
            </Text>
          </View>
          <Switch
            value={cloudPrivacyConsent}
            onValueChange={setCloudPrivacyConsent}
            trackColor={{ false: colors.border, true: aurora.acc1 }}
            thumbColor="#ffffff"
            accessibilityLabel="Cloud Privacy Consent Toggle"
          />
        </View>
      </Card>

      <Card>
        <Label>Max Images Per Message</Label>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Limit how many images can be attached to a single chat message (1–10).
        </Text>
        <PillGroup
          options={IMAGE_LIMIT_OPTIONS}
          value={String(maxImagesPerMessage)}
          onChange={(val) => setMaxImagesPerMessage(parseInt(val, 10))}
        />
        <View style={styles.stepperRow}>
          <PressableScale
            scaleTo={0.94}
            style={[
              styles.stepperButton,
              { backgroundColor: colors.bubbleAssistant, borderColor: colors.border },
              maxImagesPerMessage <= 1 && styles.buttonDisabled,
            ]}
            onPress={() => setMaxImagesPerMessage(maxImagesPerMessage - 1)}
            disabled={maxImagesPerMessage <= 1}
            accessibilityLabel="Decrease max images"
          >
            <Text style={[styles.stepperButtonText, { color: colors.text }]}>-</Text>
          </PressableScale>
          <Text style={[styles.stepperValueText, { color: aurora.acc1, fontSize: sizes.text + 2 }]}>
            {maxImagesPerMessage} {maxImagesPerMessage === 1 ? 'image' : 'images'}
          </Text>
          <PressableScale
            scaleTo={0.94}
            style={[
              styles.stepperButton,
              { backgroundColor: colors.bubbleAssistant, borderColor: colors.border },
              maxImagesPerMessage >= 10 && styles.buttonDisabled,
            ]}
            onPress={() => setMaxImagesPerMessage(maxImagesPerMessage + 1)}
            disabled={maxImagesPerMessage >= 10}
            accessibilityLabel="Increase max images"
          >
            <Text style={[styles.stepperButtonText, { color: colors.text }]}>+</Text>
          </PressableScale>
        </View>
      </Card>

      <Card>
        <Label>Compression & Storage Specs</Label>
        <View style={styles.specsContainer}>
          <Text style={[styles.specItem, { color: colors.textMuted, fontSize: sizes.sub }]}>
            • <Text style={{ color: colors.text, fontWeight: '600' }}>Client Compression:</Text> Automatically downscales images so the maximum dimension is 1920px (JPEG 80% quality).
          </Text>
          <Text style={[styles.specItem, { color: colors.textMuted, fontSize: sizes.sub }]}>
            • <Text style={{ color: colors.text, fontWeight: '600' }}>EXIF Stripping:</Text> All camera metadata and GPS location tags are stripped before upload.
          </Text>
          <Text style={[styles.specItem, { color: colors.textMuted, fontSize: sizes.sub }]}>
            • <Text style={{ color: colors.text, fontWeight: '600' }}>File Formats:</Text> JPEG, PNG, and WebP (up to 10 MB per image).
          </Text>
          <Text style={[styles.specItem, { color: colors.textMuted, fontSize: sizes.sub }]}>
            • <Text style={{ color: colors.text, fontWeight: '600' }}>Payload Warning:</Text> Alerts before sending if total upload exceeds 5 MB.
          </Text>
        </View>
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabelContainer: {
    flex: 1,
    paddingRight: 16,
  },
  toggleTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  toggleSubtitle: {
    lineHeight: 18,
  },
  sectionSubtitle: {
    marginBottom: 12,
    lineHeight: 18,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  stepperButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    lineHeight: 22,
  },
  stepperValueText: {
    fontWeight: '700',
    minWidth: 80,
    textAlign: 'center',
  },
  specsContainer: {
    gap: 8,
    marginTop: 8,
  },
  specItem: {
    lineHeight: 19,
  },
});
