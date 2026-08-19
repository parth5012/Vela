import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useConfigStore, PermissionTier, DeviceAgentPermissions } from '../../store/useConfigStore';
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
  { key: 'set_volume', label: 'Change Volume', description: 'Set media, ring, or alarm volume levels' },
  { key: 'type', label: 'Type Text', description: 'Type non-sensitive text into focused input fields' },
  { key: 'tap', label: 'Tap Screen', description: 'Tap coordinates or perform navigation-style clicks' }
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
      {renderSection('Low Risk Actions', 'Actions allowed to run with minimal intervention by default.', LOW_RISK_ACTIONS)}
      {renderSection('Medium Risk Actions', 'Actions generally requiring confirm prompts by default.', MEDIUM_RISK_ACTIONS)}
      {renderSection('High Risk Actions', 'Actions completely blocked by default for system security.', HIGH_RISK_ACTIONS)}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  styleHelper: {
    display: 'none',
  },
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
});
