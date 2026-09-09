import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useConfigStore } from '../store/useConfigStore';
import { AuroraScreen, Card, useAurora } from '../components/ui/settingsKit';

interface BriefingRecord {
  id: string;
  date: string;
  summary_text: string;
  sections_json?: any;
  created_at?: string;
}

export default function BriefingHistoryScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const accentColor = aurora.acc1;
  const { apiUrl, apiKey } = useConfigStore();

  const [briefings, setBriefings] = useState<BriefingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = async () => {
    if (!apiUrl) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/briefings?days=14`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-API-Key': apiKey,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setBriefings(data.briefings || []);
      }
    } catch (e) {
      console.warn('Failed to fetch briefing history:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHistory();
  };

  const renderBriefingCard = ({ item }: { item: BriefingRecord }) => (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={[styles.dateText, { color: accentColor, fontSize: sizes.title }]}>
          📅 {item.date}
        </Text>
        {item.created_at ? (
          <Text style={[styles.timeText, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.summaryText, { color: colors.text, fontSize: sizes.sub }]}>
        {item.summary_text}
      </Text>

      {item.sections_json ? (
        <View style={styles.badgeRow}>
          {item.sections_json.today ? (
            <View style={[styles.badge, { backgroundColor: accentColor + '22', borderColor: accentColor }]}>
              <Text style={{ color: accentColor, fontSize: sizes.sub - 2 }}>Today</Text>
            </View>
          ) : null}
          {item.sections_json.inbox ? (
            <View style={[styles.badge, { backgroundColor: accentColor + '22', borderColor: accentColor }]}>
              <Text style={{ color: accentColor, fontSize: sizes.sub - 2 }}>Inbox</Text>
            </View>
          ) : null}
          {item.sections_json.radar ? (
            <View style={[styles.badge, { backgroundColor: accentColor + '22', borderColor: accentColor }]}>
              <Text style={{ color: accentColor, fontSize: sizes.sub - 2 }}>Radar</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );

  return (
    <AuroraScreen title="Briefing History" onBack={() => router.back()}>
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={accentColor} />
          <Text style={[styles.loadingText, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Loading briefing history...
          </Text>
        </View>
      ) : briefings.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyTitle, { color: colors.text, fontSize: sizes.title }]}>
            No Briefings Found
          </Text>
          <Text style={[styles.emptySub, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Your daily morning briefings will appear here once delivered.
          </Text>
          <Pressable
            onPress={() => router.push('/settings/briefing' as any)}
            style={[styles.settingsBtn, { backgroundColor: accentColor }]}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Briefing Settings</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={briefings}
          keyExtractor={(item) => item.id || item.date}
          renderItem={renderBriefingCard}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={accentColor} />}
        />
      )}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 12,
  },
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateText: {
    fontWeight: '700',
  },
  timeText: {
    fontStyle: 'italic',
  },
  summaryText: {
    lineHeight: 20,
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
  },
  loadingText: {
    marginTop: 12,
  },
  emptyTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    textAlign: 'center',
    marginBottom: 24,
  },
  settingsBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
});
