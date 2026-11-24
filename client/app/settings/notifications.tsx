import React from 'react';
import { View, Text, Switch, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AuroraScreen,
  Card,
  SectionTitle,
  SectionSubtitle,
  SecondaryButton,
  useAurora,
} from '../../components/ui/settingsKit';
import {
  useNotificationStore,
  type NotificationChannelKey,
} from '../../store/useNotificationStore';

function padTime(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${padTime(minute)} ${period} (${padTime(hour)}:${padTime(minute)})`;
}

function TimeStepper({
  label,
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  const { colors, sizes } = useAurora();

  return (
    <View style={styles.timeStepperContainer}>
      <Text style={[styles.timeLabel, { color: colors.text, fontSize: sizes.text }]}>
        {label}
      </Text>
      <View style={styles.timeControlsRow}>
        <View style={styles.unitControl}>
          <Text style={[styles.unitSub, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
            HOUR
          </Text>
          <View style={styles.unitButtonsRow}>
            <Pressable
              onPress={() => onHourChange((hour + 23) % 24)}
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${label} hour`}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
            </Pressable>
            <Text style={[styles.unitValue, { color: colors.text, fontSize: sizes.text + 2 }]}>
              {padTime(hour)}
            </Text>
            <Pressable
              onPress={() => onHourChange((hour + 1) % 24)}
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${label} hour`}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.colonSeparator, { color: colors.textMuted }]}>:</Text>

        <View style={styles.unitControl}>
          <Text style={[styles.unitSub, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
            MINUTE
          </Text>
          <View style={styles.unitButtonsRow}>
            <Pressable
              onPress={() => onMinuteChange((minute + 45) % 60)}
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${label} minute`}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
            </Pressable>
            <Text style={[styles.unitValue, { color: colors.text, fontSize: sizes.text + 2 }]}>
              {padTime(minute)}
            </Text>
            <Pressable
              onPress={() => onMinuteChange((minute + 15) % 60)}
              style={({ pressed }) => [
                styles.stepBtn,
                { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${label} minute`}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

interface ChannelItemDef {
  key: NotificationChannelKey;
  icon: string;
  title: string;
  description: string;
}

const CHANNELS: ChannelItemDef[] = [
  {
    key: 'task_completion',
    icon: '⚡',
    title: 'Task Updates',
    description: 'Background agent actions and long-running task completions',
  },
  {
    key: 'calendar_reminder',
    icon: '📅',
    title: 'Calendar Alerts',
    description: 'Upcoming meetings, agenda alerts, and calendar notifications',
  },
  {
    key: 'briefing',
    icon: '🌅',
    title: 'Morning Briefing',
    description: 'Scheduled morning overview and news summaries',
  },
  {
    key: 'checkin',
    icon: '📝',
    title: 'Daily Check-in',
    description: 'Evening reflection prompts and habit tracking reminders',
  },
  {
    key: 'approval',
    icon: '🛡️',
    title: 'Action Approvals',
    description: 'Safety gate alerts requiring your confirmation before executing',
  },
];

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const quietHours = useNotificationStore((s) => s.quietHours);
  const channels = useNotificationStore((s) => s.channels);
  const setQuietHours = useNotificationStore((s) => s.setQuietHours);
  const setChannelEnabled = useNotificationStore((s) => s.setChannelEnabled);
  const resetToDefaults = useNotificationStore((s) => s.resetToDefaults);

  return (
    <AuroraScreen
      title="Notifications"
      subtitle="Manage quiet hours, delivery preferences, and channels"
      onBack={() => router.navigate('/settings')}
    >
      <View style={styles.sectionHeader}>
        <SectionTitle>Quiet Hours</SectionTitle>
        <SectionSubtitle>
          Defer notification alerts during designated rest hours
        </SectionSubtitle>
      </View>

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchTextContainer}>
            <Text style={[styles.rowTitle, { color: colors.text, fontSize: sizes.text }]}>
              Enable Quiet Hours
            </Text>
            <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
              {quietHours.enabled
                ? `Active from ${padTime(quietHours.startHour)}:${padTime(quietHours.startMinute)} to ${padTime(quietHours.endHour)}:${padTime(quietHours.endMinute)}`
                : 'Disabled — all allowed notifications deliver immediately'}
            </Text>
          </View>
          <Switch
            value={quietHours.enabled}
            onValueChange={(enabled) => setQuietHours({ enabled })}
            trackColor={{ false: colors.card, true: aurora.acc1 }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Toggle quiet hours"
          />
        </View>

        {quietHours.enabled && (
          <View style={[styles.expandedContent, { borderTopColor: colors.glassBorder }]}>
            <TimeStepper
              label="Start Time"
              hour={quietHours.startHour}
              minute={quietHours.startMinute}
              onHourChange={(startHour) => setQuietHours({ startHour })}
              onMinuteChange={(startMinute) => setQuietHours({ startMinute })}
            />

            <TimeStepper
              label="End Time"
              hour={quietHours.endHour}
              minute={quietHours.endMinute}
              onHourChange={(endHour) => setQuietHours({ endHour })}
              onMinuteChange={(endMinute) => setQuietHours({ endMinute })}
            />

            <View
              style={[
                styles.noticeBox,
                {
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Text style={[styles.noticeText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                🌙 During quiet hours, notifications are held silently and delivered at{' '}
                <Text style={{ color: aurora.acc1, fontWeight: '700' }}>
                  {formatTime(quietHours.endHour, quietHours.endMinute)}
                </Text>
                .
              </Text>
            </View>
          </View>
        )}
      </Card>

      <View style={styles.sectionHeader}>
        <SectionTitle>Notification Channels</SectionTitle>
        <SectionSubtitle>
          Select which notification types can trigger alerts
        </SectionSubtitle>
      </View>

      <Card style={styles.card}>
        {CHANNELS.map((ch, index) => {
          const isEnabled = channels[ch.key] !== false;
          return (
            <View
              key={ch.key}
              style={[
                styles.channelRow,
                index > 0 && { borderTopWidth: 1, borderTopColor: colors.glassBorder },
              ]}
            >
              <View style={[styles.iconContainer, { borderColor: colors.glassBorder }]}>
                <Text style={{ fontSize: sizes.sub + 4 }}>{ch.icon}</Text>
              </View>
              <View style={styles.channelTextContainer}>
                <Text style={[styles.rowTitle, { color: colors.text, fontSize: sizes.text }]}>
                  {ch.title}
                </Text>
                <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  {ch.description}
                </Text>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={(val) => setChannelEnabled(ch.key, val)}
                trackColor={{ false: colors.card, true: aurora.acc1 }}
                thumbColor="#FFFFFF"
                accessibilityLabel={`Toggle ${ch.title}`}
              />
            </View>
          );
        })}
      </Card>

      <View style={styles.footerContainer}>
        <SecondaryButton
          label="Reset to Defaults"
          onPress={resetToDefaults}
          accessibilityLabel="Reset notification settings to defaults"
        />
      </View>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    padding: 12,
    borderRadius: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  switchTextContainer: {
    flex: 1,
    paddingRight: 16,
  },
  rowTitle: {
    fontWeight: '600',
    marginBottom: 2,
  },
  rowHint: {
    lineHeight: 18,
  },
  expandedContent: {
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 14,
    gap: 16,
  },
  timeStepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  timeLabel: {
    fontWeight: '600',
  },
  timeControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unitControl: {
    alignItems: 'center',
  },
  unitSub: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  unitButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
  unitValue: {
    minWidth: 26,
    textAlign: 'center',
    fontWeight: '700',
  },
  colonSeparator: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 14,
  },
  noticeBox: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  noticeText: {
    lineHeight: 18,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  channelTextContainer: {
    flex: 1,
    paddingRight: 8,
  },
  footerContainer: {
    marginTop: 20,
    marginBottom: 32,
    alignItems: 'center',
  },
});
