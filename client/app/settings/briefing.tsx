import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ScrollView } from 'react-native';
import useRouter from 'expo-router';
import useConfigStore from '../../store/useConfigStore';
import AuroraScreen, {
  Card,
  Field,
  Label,
  PillGroup,
  PrimaryButton,
  useAurora,
} from '../../components/ui/settingsKit';

interface WatchItem {
  id: string;
  text: string;
  date_hint?: string;
  created_at?: string;
}

const ALL_WEEKDAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

export default function BriefingSettingsScreen() {
  const router = useRouter();
  const { colors, sizes } = useAurora();
  const { apiUrl, apiKey } = useConfigStore();

  const [enabled, setEnabled] = useState(true);
  const [time, setTime] = useState('07:00');
  const [weekdays, setWeekdays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const [sections, setSections] = useState<{ today: boolean; inbox: boolean; radar: boolean }>({
    today: true,
    inbox: true,
    radar: true,
  });
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  const [newWatchText, setNewWatchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    if (!apiUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/briefing/config`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.enabled !== undefined) setEnabled(data.enabled);
        if (data.time) setTime(data.time);
        if (data.weekdays) setWeekdays(data.weekdays);
        if (data.sections) setSections(data.sections);
        if (data.watch_items) setWatchItems(data.watch_items);
      }
    } catch (e) {
      console.warn('Failed to fetch briefing config:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!apiUrl) {
      Alert.alert('Configuration error', 'API URL is not set.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/briefing/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          enabled,
          time,
          weekdays,
          sections,
        }),
      });
      if (res.ok) {
        Alert.alert('Saved', 'Briefing settings saved successfully.');
      } else {
        Alert.alert('Save Failed', 'Could not update briefing settings.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Network error saving briefing config.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddWatchItem = async () => {
    if (!newWatchText.trim()) return;
    if (!apiUrl) {
      const tempItem: WatchItem = { id: Date.now().toString(), text: newWatchText.trim() };
      setWatchItems([...watchItems, tempItem]);
      setNewWatchText('');
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/briefings/watch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({ text: newWatchText.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setWatchItems([...watchItems, data.item || { id: Date.now().toString(), text: newWatchText.trim() }]);
        setNewWatchText('');
      } else {
        Alert.alert('Error', 'Failed to add watch item.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error adding watch item.');
    }
  };

  const handleDeleteWatchItem = async (id: string) => {
    setWatchItems(watchItems.filter((i) => i.id !== id));
    if (!apiUrl) return;
    try {
      await fetch(`${apiUrl}/api/briefings/watch/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        },
      });
    } catch (e) {
      console.warn('Failed to delete watch item from backend:', e);
    }
  };

  const toggleWeekday = (day: string) => {
    if (weekdays.includes(day)) {
      setWeekdays(weekdays.filter((d) => d !== day));
    } else {
      setWeekdays([...weekdays, day]);
    }
  };

  return (
    <AuroraScreen title="Daily Briefing" onBack={() => router.back()}>
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.header }]}>
          Briefing Preferences
        </Text>
        <Text style={[styles.hint, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Every morning, Vela compiles a brief summary of your day, inbox, and watch items.
        </Text>

        <Field>
          <Label text="Enable Daily Briefing" />
          <PillGroup
            options={[
              { value: 'yes', label: 'Enabled' },
              { value: 'no', label: 'Disabled' },
            ]}
            value={enabled ? 'yes' : 'no'}
            onChange={(val) => setEnabled(val === 'yes')}
          />
        </Field>

        <Field>
          <Label text="Delivery Time (HH:MM)" hint="Default 07:00" />
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.glassBorder,
                backgroundColor: colors.surface,
                fontSize: sizes.sub,
              },
            ]}
            value={time}
            onChangeText={setTime}
            placeholder="07:00"
            placeholderTextColor={colors.textMuted}
          />
        </Field>

        <Field>
          <Label text="Delivery Days" />
          <View style={styles.weekdaysRow}>
            {ALL_WEEKDAYS.map((w) => {
              const active = weekdays.includes(w.value);
              return (
                <Pressable
                  key={w.value}
                  onPress={() => toggleWeekday(w.value)}
                  style={[
                    styles.dayPill,
                    {
                      borderColor: active ? colors.accent : colors.glassBorder,
                      backgroundColor: active ? colors.accent + '33' : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: active ? colors.accent : colors.textMuted, fontSize: sizes.sub }}>
                    {w.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field>
          <Label text="Briefing Sections" />
          <View style={styles.togglesRow}>
            <Pressable
              onPress={() => setSections({ ...sections, today: !sections.today })}
              style={[
                styles.togglePill,
                {
                  borderColor: sections.today ? colors.accent : colors.glassBorder,
                  backgroundColor: sections.today ? colors.accent + '22' : colors.surface,
                },
              ]}
            >
              <Text style={{ color: sections.today ? colors.accent : colors.textMuted, fontSize: sizes.sub }}>
                📅 Today Events ({sections.today ? 'On' : 'Off'})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSections({ ...sections, inbox: !sections.inbox })}
              style={[
                styles.togglePill,
                {
                  borderColor: sections.inbox ? colors.accent : colors.glassBorder,
                  backgroundColor: sections.inbox ? colors.accent + '22' : colors.surface,
                },
              ]}
            >
              <Text style={{ color: sections.inbox ? colors.accent : colors.textMuted, fontSize: sizes.sub }}>
                📬 Inbox Triage ({sections.inbox ? 'On' : 'Off'})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSections({ ...sections, radar: !sections.radar })}
              style={[
                styles.togglePill,
                {
                  borderColor: sections.radar ? colors.accent : colors.glassBorder,
                  backgroundColor: sections.radar ? colors.accent + '22' : colors.surface,
                },
              ]}
            >
              <Text style={{ color: sections.radar ? colors.accent : colors.textMuted, fontSize: sizes.sub }}>
                📡 Radar Watch ({sections.radar ? 'On' : 'Off'})
              </Text>
            </Pressable>
          </View>
        </Field>

        <PrimaryButton
          title={saving ? 'Saving...' : 'Save Settings'}
          onPress={handleSaveConfig}
          disabled={saving}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.header }]}>
          On-Radar Watch Items
        </Text>
        <Text style={[styles.hint, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Track upcoming birthdays, renewals, subscriptions, or important deadlines.
        </Text>

        <View style={styles.addWatchRow}>
          <TextInput
            style={[
              styles.input,
              {
                flex: 1,
                color: colors.text,
                borderColor: colors.glassBorder,
                backgroundColor: colors.surface,
                fontSize: sizes.sub,
              },
            ]}
            value={newWatchText}
            onChangeText={setNewWatchText}
            placeholder="e.g., Mom's birthday on Sept 12"
            placeholderTextColor={colors.textMuted}
          />
          <Pressable
            onPress={handleAddWatchItem}
            style={[styles.addBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Add</Text>
          </Pressable>
        </View>

        {watchItems.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textMuted, fontSize: sizes.sub }]}>
            No watch items saved yet.
          </Text>
        ) : (
          watchItems.map((item) => (
            <View key={item.id} style={[styles.watchRow, { borderColor: colors.glassBorder }]}>
              <Text style={[styles.watchText, { color: colors.text, fontSize: sizes.sub }]}>
                • {item.text}
              </Text>
              <Pressable onPress={() => handleDeleteWatchItem(item.id)}>
                <Text style={{ color: colors.error || '#ef4444', fontSize: sizes.sub }}>Delete</Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.header }]}>
          Briefing History
        </Text>
        <Text style={[styles.hint, { color: colors.textMuted, fontSize: sizes.sub, marginBottom: 12 }]}>
          View your past daily briefings and summaries.
        </Text>
        <Pressable
          onPress={() => router.push('/briefing' as any)}
          style={[styles.historyBtn, { borderColor: colors.glassBorder, backgroundColor: colors.surface }]}
        >
          <Text style={{ color: colors.accent, fontWeight: 'bold', fontSize: sizes.sub }}>
            📜 View Past Briefings
          </Text>
        </Pressable>
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  hint: {
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  weekdaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  dayPill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  togglesRow: {
    gap: 8,
    marginTop: 4,
  },
  togglePill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addWatchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  addBtn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontStyle: 'italic',
    marginTop: 4,
  },
  watchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  watchText: {
    flex: 1,
    marginRight: 8,
  },
  historyBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
