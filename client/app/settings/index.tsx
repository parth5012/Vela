import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AuroraScreen, Card, useAurora } from '../../components/ui/settingsKit';

type CategoryGroup = {
  title: string;
  rows: { icon: string; label: string; hint: string; route: string }[];
};

const GROUPS: CategoryGroup[] = [
  {
    title: 'Connection & Accounts',
    rows: [
      { icon: '⚡', label: 'Server & API Key', hint: 'URL, key, test connection', route: '/settings/connection' },
      { icon: '🔑', label: 'Google Workspace', hint: 'Gmail · Calendar · Drive', route: '/settings/connection' },
    ],
  },
  {
    title: 'Permissions',
    rows: [
      { icon: '🛡️', label: 'Permissions', hint: 'App & agent permissions', route: '/settings/permissions' },
    ],
  },
  {
    title: 'Appearance',
    rows: [
      { icon: '🎨', label: 'Theme', hint: '6 aurora atmospheres', route: '/settings/appearance' },
      { icon: '✨', label: 'Accent & Font', hint: '8 energies · 3 sizes', route: '/settings/appearance' },
    ],
  },
  {
    title: 'Agent',
    rows: [
      { icon: '🤖', label: 'Persona Prompt', hint: 'Persona, model, temperature, system prompt', route: '/settings/agent' },
      { icon: '🛡️', label: 'Device Agent Permissions', hint: 'Auto/Ask/Block safety settings', route: '/settings/device-agent' }
    ]
  },
  {
    title: 'Local AI',
    rows: [
      { icon: '📱', label: 'Local Mode & Models', hint: 'On-device inference, downloads', route: '/settings/local-ai' },
    ],
  },
  {
    title: 'Messaging',
    rows: [
      { icon: '💬', label: 'Suggestion Starters', hint: 'Welcome-view starter cards', route: '/settings/messaging' },
    ],
  },
  {
    title: 'About & Danger',
    rows: [
      { icon: 'ℹ️', label: 'About', hint: 'App info', route: '/settings/about' },
      { icon: '⚠️', label: 'Danger Zone', hint: 'Reset server connection', route: '/settings/about' },
    ],
  },
];

export default function SettingsIndexScreen() {
  const router = useRouter();
  const { colors, sizes } = useAurora();

  return (
    <AuroraScreen title="Settings" onBack={() => router.navigate('/')}>
      {GROUPS.map((group) => (
        <View key={group.title}>
          <Text style={[styles.groupTitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {group.title.toUpperCase()}
          </Text>
          <Card style={styles.groupCard}>
            {group.rows.map((row, i) => (
              <Pressable
                key={row.label}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.glassBorder },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => router.push(row.route as never)}
              >
                <View style={[styles.rowIcon, { borderColor: colors.glassBorder }]}>
                  <Text style={{ fontSize: sizes.sub + 4 }}>{row.icon}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowLabel, { color: colors.text, fontSize: sizes.text }]}>
                    {row.label}
                  </Text>
                  <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
                    {row.hint}
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: colors.textDark, fontSize: sizes.text }]}>›</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  groupTitle: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  groupCard: {
    padding: 4,
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowLabel: {
    fontWeight: '600',
  },
  rowHint: {
    marginTop: 1,
  },
  chevron: {
    opacity: 0.7,
  },
});
