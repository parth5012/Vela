import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AuroraScreen,
  Card,
  SectionTitle,
  SectionSubtitle,
  PrimaryButton,
  useAurora,
} from '../components/ui/settingsKit';
import { useConfigStore } from '../store/useConfigStore';
import { useChatStore } from '../store/useChatStore';
import { loadCheckins } from '../db/checkinRepository';
import {
  refreshJournalFromBackend,
  fetchCheckinSummary,
  type CheckinSummary,
} from '../utils/journal';

interface JournalEntry {
  id: string;
  date: string;
  mood: number;
  energy: number;
  win: string | null;
  carrying: string | null;
  note: string | null;
  synced: boolean;
}

function ScoreDots({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: i <= value ? color : 'rgba(130,130,150,0.25)' },
          ]}
        />
      ))}
    </View>
  );
}

export default function JournalScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const apiUrl = useConfigStore((s) => s.apiUrl);
  const apiKey = useConfigStore((s) => s.apiKey);
  const threads = useChatStore((s) => s.threads);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<CheckinSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const conversationId = threads?.[0]?.id;

  const load = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      try {
        // Local cache first so history renders without a connection.
        const local = (await loadCheckins(30)) as JournalEntry[];
        setEntries(local);
        if (apiUrl && apiKey) {
          const merged = (await refreshJournalFromBackend(
            apiUrl,
            apiKey,
            conversationId
          )) as JournalEntry[];
          setEntries(merged);
          setSummary(await fetchCheckinSummary(apiUrl, apiKey, conversationId));
        }
      } catch {
        // Local-first: keep whatever rendered.
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiUrl, apiKey, conversationId]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <AuroraScreen title="Journal" onBack={() => router.back()}>
        <ActivityIndicator size="large" />
      </AuroraScreen>
    );
  }

  return (
    <AuroraScreen title="Journal" onBack={() => router.back()}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {summary && summary.count > 0 && (
          <>
            <SectionTitle>Patterns</SectionTitle>
            <SectionSubtitle>Honest, evidence-based trends from your recent entries.</SectionSubtitle>
            <View style={styles.patternRow}>
              <Card style={styles.patternCard}>
                <Text style={[styles.patternValue, { color: colors.text }]}>
                  {summary.avg_mood != null ? `${summary.avg_mood}/5` : '—'}
                </Text>
                <Text style={[styles.patternLabel, { color: colors.textMuted }]}>Avg mood</Text>
              </Card>
              <Card style={styles.patternCard}>
                <Text style={[styles.patternValue, { color: colors.text }]}>
                  {summary.avg_energy != null ? `${summary.avg_energy}/5` : '—'}
                </Text>
                <Text style={[styles.patternLabel, { color: colors.textMuted }]}>Avg energy</Text>
              </Card>
              <Card style={styles.patternCard}>
                <Text style={[styles.patternValue, { color: colors.text }]}>{summary.count}</Text>
                <Text style={[styles.patternLabel, { color: colors.textMuted }]}>Entries</Text>
              </Card>
            </View>
            <Card style={styles.card}>
              <Text style={[styles.summaryText, { color: colors.text, fontSize: sizes.text }]}>
                {summary.summary}
              </Text>
            </Card>
          </>
        )}

        <SectionTitle>Recent entries</SectionTitle>
        <SectionSubtitle>From this device, refreshed from the server when online.</SectionSubtitle>
        {entries.length === 0 ? (
          <Card style={styles.card}>
            <Text style={[styles.emptyText, { color: colors.textMuted, fontSize: sizes.text }]}>
              No check-ins yet. Your first entry will appear here. 🌙
            </Text>
          </Card>
        ) : (
          entries.map((entry) => (
            <Card key={entry.id} style={styles.card}>
              <View style={styles.entryHeader}>
                <Text style={[styles.entryDate, { color: colors.text, fontSize: sizes.text }]}>
                  {entry.date}
                </Text>
                {!entry.synced && (
                  <Text style={[styles.pendingBadge, { color: colors.textMuted }]}>• pending sync</Text>
                )}
              </View>
              <View style={styles.scoreRow}>
                <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>Mood</Text>
                <ScoreDots value={entry.mood} color={aurora.acc1} />
              </View>
              <View style={styles.scoreRow}>
                <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>Energy</Text>
                <ScoreDots value={entry.energy} color={aurora.acc2 ?? aurora.acc1} />
              </View>
              {entry.win && (
                <Text style={[styles.entryText, { color: colors.text }]}>
                  <Text style={{ fontWeight: '700' }}>Win: </Text>
                  {entry.win}
                </Text>
              )}
              {entry.carrying && (
                <Text style={[styles.entryText, { color: colors.text }]}>
                  <Text style={{ fontWeight: '700' }}>Carrying: </Text>
                  {entry.carrying}
                </Text>
              )}
              {entry.note && (
                <Text style={[styles.entryText, { color: colors.textMuted }]}>{entry.note}</Text>
              )}
            </Card>
          ))
        )}
        <PrimaryButton label="Refresh" onPress={() => load(true)} loading={refreshing} />
      </ScrollView>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    padding: 14,
    gap: 8,
  },
  patternRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  patternCard: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  patternValue: {
    fontWeight: '800',
    fontSize: 20,
    fontVariant: ['tabular-nums'],
  },
  patternLabel: {
    fontSize: 12,
  },
  summaryText: {
    lineHeight: 20,
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: 20,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryDate: {
    fontWeight: '700',
  },
  pendingBadge: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scoreLabel: {
    width: 56,
    fontSize: 13,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  entryText: {
    fontSize: 14,
    lineHeight: 19,
  },
});
