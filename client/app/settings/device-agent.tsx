import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useConfigStore, PermissionTier, DeviceAgentPermissions } from '../../store/useConfigStore';
import { openSettings, canOpenSettingsAction } from '../../utils/permissionManager';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  useAurora,
} from '../../components/ui/settingsKit';

interface PermissionItem {
  key: keyof DeviceAgentPermissions;
  label: string;
  description: string;
}

const LOW_RISK_ACTIONS: PermissionItem[] = [
  { key: 'screen_read', label: 'Read Screen Content', description: 'Read text and hierarchy elements visible on the screen' },
  { key: 'info', label: 'Device Information', description: 'Access RAM, battery, model, and OS version info' },
  { key: 'screenshot', label: 'Take Screenshots', description: 'Capture image representation of the current screen' },
  { key: 'open_app', label: 'Open Applications', description: 'Launch other apps installed on the device' },
  { key: 'scroll', label: 'Scroll Page', description: 'Scroll up, down, left, or right' },
  { key: 'swipe', label: 'Swipe Gestures', description: 'Perform generic swipe gestures' },
  { key: 'press_key', label: 'Hardware Key Injection', description: 'Simulate Home, Back, Volume, Power presses' },
  { key: 'set_volume', label: 'Change Volume', description: 'Set media volume level (0-100)' },
  { key: 'type', label: 'Type Text', description: 'Type non-sensitive text into focused input fields' },
  { key: 'tap', label: 'Tap Screen', description: 'Tap coordinates or perform navigation-style clicks' },
  { key: 'contacts', label: 'Search Contacts', description: 'Search and read contacts on the device' },
];

const MEDIUM_RISK_ACTIONS: PermissionItem[] = [
  { key: 'send_communication', label: 'Send Communications', description: 'Send SMS texts, WhatsApp messages, or emails' },
  { key: 'calls', label: 'Make Phone Calls', description: 'Dial or initiate phone calls' },
  { key: 'purchases', label: 'Perform Purchases', description: 'Execute transactions or make digital purchases' },
  { key: 'deletions', label: 'Perform Deletions', description: 'Delete contacts, calendar events, or local files' },
  { key: 'settings_changes', label: 'Modify System Settings', description: 'Change device options, settings, or configs' },
  { key: 'play_installs', label: 'Install from Play Store', description: 'Search and trigger app installs via Google Play' }
];

const HIGH_RISK_ACTIONS: PermissionItem[] = [
  { key: 'passwords_otps', label: 'Passwords & OTPs', description: 'Access or write passwords, credentials, and OTPs' },
  { key: 'sideloads', label: 'Sideload Applications', description: 'Download or install third-party APKs' },
  { key: 'permission_toggles', label: 'Permission Settings', description: 'Toggle permissions or Accessibility permissions' },
  { key: 'root_shizuku', label: 'Root & Shizuku Operations', description: 'Execute privileged commands requiring root/Shizuku access' }
];

const OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'confirm', label: 'Ask' },
  { value: 'deny', label: 'Blocked' },
];

export default function DeviceAgentPermissionsScreen() {
  const permissions = useConfigStore((s) => s.deviceAgentPermissions);
  const setPermission = useConfigStore((s) => s.setDeviceAgentPermission);
  const { colors, sizes } = useAurora();
  const router = useRouter();
  const hasOverlayNativeAction = canOpenSettingsAction();

  const renderSection = (title: string, subtitle: string, items: PermissionItem[]) => {
    return (
      <View key={title} style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
          {title}
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          {subtitle}
        </Text>
        {items.map((item) => {
          const value = permissions[item.key] || 'auto';
          return (
            <Card key={item.key} style={styles.card}>
              <Label>{item.label}</Label>
              <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
                {item.description}
              </Text>
              <View style={styles.pillContainer}>
                <PillGroup
                  options={OPTIONS}
                  value={value}
                  onChange={(val: any) => setPermission(item.key, val)}
                />
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  return (
    <AuroraScreen
      title="Device Agent Permissions"
      subtitle="Configure how Vela acts on your phone automatically, prompts for authorization, or stands blocked."
    >
      <Card style={styles.card}>
        <Pressable
          onPress={() => router.push('/settings/shizuku')}
          accessibilityRole="button"
          accessibilityLabel="Open Shizuku setup guide"
        >
          <Label>Shizuku Setup →</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Grant/revoke permissions, write settings, force-stop, enable/disable, clear data,
            install/uninstall — connect Shizuku first.
          </Text>
        </Pressable>
      </Card>
      {renderSection('Low Risk Actions', 'Actions allowed to run with minimal intervention by default.', LOW_RISK_ACTIONS)}
      {renderSection('Medium Risk Actions', 'Actions generally requiring confirm prompts by default.', MEDIUM_RISK_ACTIONS)}
      {renderSection('High Risk Actions', 'Actions completely blocked by default for system security.', HIGH_RISK_ACTIONS)}

      {/* Sideload & Restricted Settings Guidance */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.sub + 2 }]}>
          Sideload & Restricted Settings
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          Guidance for sideloading Vela APKs and unlocking Android security gates.
        </Text>

        <Card style={styles.card}>
          <Label>Allow Restricted Settings (Android 13+)</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            On Android 13+ (API 33+), sideloaded apps cannot be granted sensitive permissions (such as Accessibility or Notification Listener) until restricted settings are unlocked.{'\n\n'}
            To enable: Tap below to open App Info, tap the three-dot menu (⋮) in the top-right corner, and select "Allow restricted settings". Then authenticate with your PIN or fingerprint before returning to toggle Accessibility.
          </Text>
          <Pressable
            onPress={() => openSettings('restricted_settings')}
            style={({ pressed }) => [
              styles.actionBtn,
              { borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open app settings — then tap ⋮ → Allow restricted settings"
          >
            <Text style={[styles.actionBtnText, { color: colors.text, fontSize: sizes.sub }]}>
              Open App Settings — then tap ⋮ → Allow restricted settings →
            </Text>
          </Pressable>
        </Card>

        <Card style={styles.card}>
          <Label>Overlay Permission (Draw Over Other Apps)</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Enables floating indicators or overlay automation (Settings.ACTION_MANAGE_OVERLAY_PERMISSION). Required if you use floating overlay features.
          </Text>
          {hasOverlayNativeAction ? (
            <Pressable
              onPress={() => openSettings('overlay')}
              style={({ pressed }) => [
                styles.actionBtn,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Manage Overlay Permission"
            >
              <Text style={[styles.actionBtnText, { color: colors.text, fontSize: sizes.sub }]}>
                Manage Overlay Permission →
              </Text>
            </Pressable>
          ) : (
            <View
              style={[
                styles.guidanceBox,
                { borderColor: colors.glassBorder, backgroundColor: colors.glass },
              ]}
            >
              <Text style={[styles.guidanceText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Manual setup required (native shortcut unavailable in this build):{'\n'}
                Settings → Apps → Vela → Special access → Display over other apps
              </Text>
            </View>
          )}
        </Card>

        <Card style={styles.card}>
          <Label>APK Variant Selection: universal vs arm64-v8a</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            • <Text style={{ fontWeight: '700', color: colors.text }}>arm64-v8a</Text>: Recommended for modern physical Android devices. Smaller download size because it includes only 64-bit ARM native binaries.{'\n'}
            • <Text style={{ fontWeight: '700', color: colors.text }}>universal</Text>: Contains native libraries for all architectures (arm64-v8a, x86_64). Roughly 2x larger file size, but installs on any compatible device architecture.{'\n'}
            • <Text style={{ fontWeight: '700', color: colors.text }}>x86_64</Text>: Used exclusively for development emulators on desktop PCs.
          </Text>
        </Card>

        <Card style={styles.card}>
          <Label>16 KB Page-Size Alignment</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Android 15 introduces optional support for 16 KB memory page sizes. While standard Android builds traditionally use 4 KB pages, devices configured or booting with 16 KB page size mode require shared native libraries (.so) to be aligned to 16 KB boundaries. If you sideload on a device running 16 KB mode, ensure the native libraries have 16 KB alignment or the app will fail to load native modules.
          </Text>
        </Card>

        <Card style={styles.card}>
          <Label>SMS Communication Guard</Label>
          <Text style={[styles.description, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Notice: Vela does NOT request or use the dangerous runtime permission SEND_SMS. SMS actions dispatch via Intent.ACTION_SENDTO to open the system SMS composer safely. The guard for SMS is the in-app safety tier ("Send Communications" in Medium Risk Actions above), which asks for your confirmation before opening the composer.
          </Text>
        </Card>
      </View>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionSubtitle: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  card: {
    marginBottom: 12,
    padding: 12,
  },
  description: {
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 16,
  },
  pillContainer: {
    marginTop: 4,
  },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  actionBtnText: {
    fontWeight: '600',
  },
  guidanceBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  guidanceText: {
    lineHeight: 18,
  },
});
