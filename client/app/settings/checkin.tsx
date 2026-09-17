import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AuroraScreen,
  Card,
  SectionTitle,
  SectionSubtitle,
  PrimaryButton,
  useAurora,
} from '../../components/ui/settingsKit';
import {
  loadCheckinSettings,
  applyCheckinSettings,
  DEFAULT_CHECKIN_SETTINGS,
  type CheckinSettings,
} from '../../utils/checkIn';

const WEEKDAYS = [
  { value: 1, label: 'S' },
  { value: 2, label: 'M' },
  { value: 3, label: 'T' },
  { value: 4, label: 'W' },
  { value: 5, label: 'T' },
  { value: 6, label: 'F' },
  { value: 7, label: 'S' },
];

function Stepper({
  label,
  value,
  display,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  display: string;
  onChange: (next: number) => void;
  min: number;
  max: number;
}) {
  const { colors, sizes } = useAurora();
  return (
    <View style={styles.stepper}>
      <Text style={[styles.stepperLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => onChange(value <= min ? max : value - 1)}
          style={({ pressed }) => [styles.stepBtn, { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
        </Pressable>
        <Text style={[styles.stepperValue, { color: colors.text, fontSize: sizes.text + 6 }]}>{display}</Text>
        <Pressable
          onPress={() => onChange(value >= max ? min : value + 1)}
          style={({ pressed }) => [styles.stepBtn, { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function CheckinSettingsScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const [settings, setSettings] = useState<CheckinSettings>({ ...DEFAULT_CHECKIN_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCheckinSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleWeekday = useCallback((day: number) => {
    setSettings((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter((d) => d !== day)
        : [...prev.weekdays, day].sort(),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await applyCheckinSettings(settings);
      Alert.alert('Saved', 'Your daily check-in reminder is scheduled.');
    } catch {
      Alert.alert('Error', 'Could not schedule the reminder. Is notifications permission granted?');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (loading) {
    return (
      <AuroraScreen title="Daily Check-in" onBack={() => router.back()}>
        <ActivityIndicator size="large" />
      </AuroraScreen>
    );
  }

  const timeLabel = `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`;

  return (
    <AuroraScreen title="Daily Check-in" onBack={() => router.back()}>
      <SectionTitle>Reminder time</SectionTitle>
      <SectionSubtitle>A gentle local notification invites the check-in at your chosen time.</SectionSubtitle>
      <Card style={styles.card}>
        <Text style={[styles.timePreview, { color: colors.text, fontSize: sizes.text + 10 }]}>{timeLabel}</Text>
        <View style={styles.stepperGroup}>
          <Stepper label="Hour" value={settings.hour} display={String(settings.hour).padStart(2, '0')} min={0} max={23} onChange={(hour) => setSettings((p) => ({ ...p, hour }))} />
          <Stepper label="Minute" value={settings.minute} display={String(settings.minute).padStart(2, '0')} min={0} max={59} onChange={(minute) => setSettings((p) => ({ ...p, minute }))} />
        </View>
      </Card>

      <SectionTitle>Days</SectionTitle>
      <SectionSubtitle>No days selected means every day.</SectionSubtitle>
      <Card style={styles.card}>
        <View style={styles.weekRow}>
          {WEEKDAYS.map((day) => {
            const active = settings.weekdays.includes(day.value);
            return (
              <Pressable
                key={day.value}
                onPress={() => toggleWeekday(day.value)}
                style={[
                  styles.weekChip,
                  {
                    borderColor: colors.glassBorder,
                    backgroundColor: active ? aurora.acc1 : 'transparent',
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={{ color: active ? aurora.onAccent : colors.textMuted, fontWeight: '700' }}>
                  {day.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card style={styles.card}>
        <View style={styles.muteRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: colors.text, fontSize: sizes.text }]}>Mute reminders</Text>
            <Text style={[styles.rowHint, { color: colors.textMuted, fontSize: sizes.sub }]}>
              Keeps the schedule but silences the channel.
            </Text>
          </View>
          <Switch
            value={settings.muted}
            onValueChange={(muted) => setSettings((p) => ({ ...p, muted }))}
            accessibilityLabel="Mute check-in reminders"
          />
        </View>
      </Card>

      <PrimaryButton label={saving ? 'Saving…' : 'Save schedule'} onPress={handleSave} loading={saving} />
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    padding: 14,
    gap: 12,
  },
  timePreview: {
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stepperGroup: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stepper: {
    alignItems: 'center',
    gap: 8,
  },
  stepperLabel: {
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stepperValue: {
    fontWeight: '800',
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 22,
    fontWeight: '700',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    fontWeight: '600',
  },
  rowHint: {
    marginTop: 2,
  },
});
