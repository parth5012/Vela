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
import {
  cancelDeferredNotifications,
  cancelScheduledNotificationsForChannel,
} from '../../utils/notificationGate';

function padTime(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatTime(hour: number, minute: number): string {
  return `${padTime(hour)}:${padTime(minute)}`;
}

export function TimeStepper({
  label,
  hour,
  minute,
  onChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  const { colors, sizes } = useAurora();

  const handleHourDecrement = () => {
    onChange((hour + 23) % 24, minute);
  };

  const handleHourIncrement = () => {
    onChange((hour + 1) % 24, minute);
  };

  const handleMinuteDecrement = () => {
    if (minute === 0) {
      onChange((hour + 23) % 24, 45);
    } else {
      onChange(hour, minute - 15);
    }
  };

  const handleMinuteIncrement = () => {
    if (minute === 45) {
      onChange((hour + 1) % 24, 0);
    } else {
      onChange(hour, minute + 15);
    }
  };

  return (
    <View
      style={styles.timeStepperContainer}
      accessible={true}
      accessibilityLabel={`${label}: ${padTime(hour)}:${padTime(minute)}`}
    >
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
              onPress={handleHourDecrement}
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
              onPress={handleHourIncrement}
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
              onPress={handleMinuteDecrement}
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
              onPress={handleMinuteIncrement}
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

  const isZeroDuration =
    quietHours.startHour === quietHours.endHour &&
    quietHours.startMinute === quietHours.endMinute;

  const handleToggleQuietHours = (enabled: boolean) => {
    setQuietHours({ enabled });
    if (!enabled) {
      cancelDeferredNotifications().catch(() => {});
    }
  };

  const handleToggleChannel = (key: NotificationChannelKey, val: boolean) => {
    setChannelEnabled(key, val);
    if (!val) {
      cancelScheduledNotificationsForChannel(key).catch(() => {});
    }
  };

  const handleReset = () => {
    cancelDeferredNotifications().catch(() => {});
    resetToDefaults();
  };

  return (
    <AuroraScreen
      title="Notifications"
      subtitle="Configure quiet hours and notification channels"
      onBack={() => router.navigate('/settings')}
    >
      <View style={styles.sectionHeader}>
        <SectionTitle>Quiet Hours</SectionTitle>
        <SectionSubtitle>
          Defer in-app notifications and scheduled reminders during rest hours
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
                ? isZeroDuration
                  ? 'Start and end times are identical (0-duration window: inactive)'
                  : `Active from ${formatTime(quietHours.startHour, quietHours.startMinute)} to ${formatTime(quietHours.endHour, quietHours.endMinute)}`
                : 'Disabled — all allowed notifications deliver immediately'}
            </Text>
          </View>
          <Switch
            value={quietHours.enabled}
            onValueChange={handleToggleQuietHours}
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
              onChange={(startHour, startMinute) =>
                setQuietHours({ startHour, startMinute })
              }
            />

            <TimeStepper
              label="End Time"
              hour={quietHours.endHour}
              minute={quietHours.endMinute}
              onChange={(endHour, endMinute) =>
                setQuietHours({ endHour, endMinute })
              }
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
                {' '}while Vela is active.
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
                onValueChange={(val) => handleToggleChannel(ch.key, val)}
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
          onPress={handleReset}
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
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  switchTextContainer: {
    flex: 1,
    marginRight: 12,
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
    paddingTop: 12,
    paddingBottom: 8,
  },
  timeStepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  timeLabel: {
    fontWeight: '600',
  },
  timeControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitControl: {
    alignItems: 'center',
  },
  unitSub: {
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  unitButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'center',
    marginHorizontal: 6,
  },
  colonSeparator: {
    fontSize: 20,
    fontWeight: '700',
    marginHorizontal: 6,
    marginTop: 16,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  noticeText: {
    lineHeight: 20,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  channelTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  footerContainer: {
    marginTop: 24,
    marginBottom: 32,
  },
});
