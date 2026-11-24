import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { useDeviceSessionStore, type SessionActionItem } from '../../store/useDeviceSessionStore';
import { useAurora } from '../../hooks/useAurora';
import { Card } from '../ui/settingsKit';
import { DEFAULT_ELEVATION } from '../../utils/elevation';

export function SessionHistorySheet() {
  const visible = useDeviceSessionStore((s) => s.isHistoryVisible);
  const setVisible = useDeviceSessionStore((s) => s.setHistoryVisible);
  const history = useDeviceSessionStore((s) => s.actionHistory);
  const clearHistory = useDeviceSessionStore((s) => s.clearSessionHistory);
  const { colors, sizes, aurora } = useAurora();

  if (!visible) return null;

  const getOutcomeColor = (outcome: SessionActionItem['outcome']) => {
    switch (outcome) {
      case 'executed':
        return '#10b981';
      case 'simulated':
        return aurora.acc1 || '#3b82f6';
      case 'aborted':
        return '#f59e0b';
      case 'unavailable':
        return '#64748b';
      case 'failed':
      case 'indeterminate':
      default:
        return '#f43f5e';
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheetContainer, { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleCol}>
              <Text style={[styles.title, { color: colors.text, fontSize: sizes.title }]}>
                📜 Session Action History
              </Text>
              <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Ephemeral timeline of actions in the current active session ({history.length} events)
              </Text>
            </View>

            <Pressable
              onPress={() => setVisible(false)}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close session action history"
            >
              <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>

          {/* Privacy Footnote Banner */}
          <View style={[styles.privacyBanner, { backgroundColor: `${aurora.acc1 || '#3b82f6'}15`, borderColor: colors.glassBorder }]}>
            <Text style={[styles.privacyBannerText, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
              🔒 Zero Disk Persistence: This history is stored strictly in memory for this session and purged upon app restart or manual clearing.
            </Text>
          </View>

          {/* Timeline List */}
          <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent}>
            {history.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  No actions executed in this session yet.
                </Text>
              </View>
            ) : (
              history.map((item) => {
                const outcomeColor = getOutcomeColor(item.outcome);
                const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <Card key={item.id} style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <Text style={[styles.itemTime, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
                        {timeStr}
                      </Text>
                      <View style={[styles.outcomeBadge, { backgroundColor: `${outcomeColor}20`, borderColor: outcomeColor }]}>
                        <Text style={[styles.outcomeText, { color: outcomeColor }]}>
                          {item.outcome}
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.toolName, { color: colors.text, fontSize: sizes.text }]}>
                      {item.toolName}
                    </Text>

                    {item.target ? (
                      <Text style={[styles.itemDetail, { color: colors.textMuted, fontSize: sizes.sub }]}>
                        Target: <Text style={{ color: colors.text }}>{item.target}</Text>
                      </Text>
                    ) : null}

                    {item.value ? (
                      <Text style={[styles.itemDetail, { color: colors.textMuted, fontSize: sizes.sub }]}>
                        Value: <Text style={{ color: colors.text }}>{item.value}</Text>
                      </Text>
                    ) : null}

                    <Text style={[styles.itemSummary, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
                      {item.summary}
                    </Text>
                  </Card>
                );
              })
            )}
          </ScrollView>

          {/* Footer Controls */}
          <View style={styles.footerRow}>
            {history.length > 0 ? (
              <Pressable
                onPress={clearHistory}
                style={({ pressed }) => [
                  styles.clearBtn,
                  { backgroundColor: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.3)' },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Clear session action history"
              >
                <Text style={styles.clearBtnText}>Clear History</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setVisible(false)}
              style={({ pressed }) => [
                styles.doneBtn,
                { backgroundColor: aurora.acc1 || '#3b82f6' },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Done viewing history"
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    elevation: 5,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleCol: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
  },
  subtitle: {
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    marginLeft: 8,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  privacyBanner: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  privacyBannerText: {
    textAlign: 'center',
    lineHeight: 15,
  },
  scrollList: {
    maxHeight: 380,
  },
  scrollContent: {
    paddingVertical: 4,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  itemCard: {
    padding: 10,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemTime: {
    fontVariant: ['tabular-nums'],
  },
  outcomeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  outcomeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  toolName: {
    fontWeight: '600',
    marginBottom: 2,
  },
  itemDetail: {
    lineHeight: 16,
  },
  itemSummary: {
    marginTop: 4,
    fontStyle: 'italic',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  clearBtn: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  clearBtnText: {
    color: '#f43f5e',
    fontWeight: '600',
    fontSize: 13,
  },
  doneBtn: {
    paddingHorizontal: 24,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
