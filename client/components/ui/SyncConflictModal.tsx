import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable } from 'react-native';
import { useSyncConflictStore, type SyncConflict } from '../../store/useSyncConflictStore';
import { useAurora } from '../../hooks/useAurora';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { DEFAULT_ELEVATION } from '../../utils/elevation';

export function SyncConflictModal() {
  const conflicts = useSyncConflictStore((s) => s.conflicts);
  const resolvingIds = useSyncConflictStore((s) => s.resolvingIds);
  const resolveConflict = useSyncConflictStore((s) => s.resolveConflict);
  const { colors, sizes, aurora } = useAurora();
  const reducedMotion = useReducedMotion();

  if (!conflicts || conflicts.length === 0) {
    return null;
  }

  return (
    <Modal
      transparent
      visible={conflicts.length > 0}
      animationType="fade"
      onRequestClose={() => {
        // Blocking modal: cannot be dismissed via back button until all conflicts are resolved
      }}
      testID="sync-conflict-modal"
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.dialogContainer,
            {
              backgroundColor: colors.skyBottom,
              borderColor: colors.glassBorder,
              shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.dialogTitle, { color: colors.text, fontSize: sizes.title }]}>
              ⚠️ Sync Conflict Resolution
            </Text>
            <Text style={[styles.dialogSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
              {conflicts.length === 1
                ? 'A local message conflicts with a remote update pulled from the server. Choose which version to retain.'
                : `${conflicts.length} local messages conflict with updates pulled from the server. Choose which version to retain for each.`}
            </Text>
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {conflicts.map((conflict: SyncConflict, index: number) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                index={index}
                total={conflicts.length}
                colors={colors}
                sizes={sizes}
                aurora={aurora}
                reducedMotion={reducedMotion}
                isResolving={resolvingIds.includes(conflict.id)}
                onResolve={(resolution) => resolveConflict(conflict.id, resolution)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface ConflictCardProps {
  conflict: SyncConflict;
  index: number;
  total: number;
  colors: ReturnType<typeof useAurora>['colors'];
  sizes: ReturnType<typeof useAurora>['sizes'];
  aurora: ReturnType<typeof useAurora>['aurora'];
  reducedMotion: boolean;
  isResolving: boolean;
  onResolve: (resolution: 'local' | 'server' | 'both') => void;
}

function ConflictCard({
  conflict,
  index,
  total,
  colors,
  sizes,
  aurora,
  reducedMotion,
  isResolving,
  onResolve,
}: ConflictCardProps) {
  return (
    <View testID={`conflict-card-${conflict.id}`} style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <View style={styles.conflictMetaRow}>
        <Text style={[styles.badgeText, { color: colors.textMuted, fontSize: sizes.sub }]}>
          Conflict {index + 1} of {total}
        </Text>
      </View>

      <View style={styles.versionsContainer}>
        {/* Local Version Box */}
        <View
          style={[
            styles.versionBox,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <View style={styles.versionHeader}>
            <Text style={[styles.versionLabel, { color: colors.text, fontSize: sizes.sub }]}>
              📱 Local Version
            </Text>
            <Text style={[styles.statusBadge, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
              (role: {conflict.localMessage.role}, pending)
            </Text>
          </View>
          <Text
            style={[styles.contentPreview, { color: colors.text, fontSize: sizes.text }]}
          >
            {conflict.localMessage.content}
          </Text>
        </View>

        {/* Server Version Box */}
        <View
          style={[
            styles.versionBox,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <View style={styles.versionHeader}>
            <Text style={[styles.versionLabel, { color: colors.text, fontSize: sizes.sub }]}>
              ☁️ Server Version
            </Text>
            <Text style={[styles.statusBadge, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
              (role: {conflict.serverMessage.role}, remote)
            </Text>
          </View>
          <Text
            style={[styles.contentPreview, { color: colors.text, fontSize: sizes.text }]}
          >
            {conflict.serverMessage.content}
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        <Pressable
          testID={`conflict-keep-local-${conflict.id}`}
          disabled={isResolving}
          onPress={() => onResolve('local')}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
            pressed && !isResolving && { opacity: 0.7 },
            isResolving && { opacity: 0.5 },
          ]}
        >
          <Text style={[styles.actionBtnText, { color: colors.text, fontSize: sizes.sub }]}>
            Keep Local
          </Text>
        </Pressable>

        <Pressable
          testID={`conflict-keep-server-${conflict.id}`}
          disabled={isResolving}
          onPress={() => onResolve('server')}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
            pressed && !isResolving && { opacity: 0.7 },
            isResolving && { opacity: 0.5 },
          ]}
        >
          <Text style={[styles.actionBtnText, { color: colors.text, fontSize: sizes.sub }]}>
            Keep Server
          </Text>
        </Pressable>

        <Pressable
          testID={`conflict-keep-both-${conflict.id}`}
          disabled={isResolving}
          onPress={() => onResolve('both')}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: aurora.acc1 },
            pressed && !isResolving && { opacity: 0.7 },
            isResolving && { opacity: 0.5 },
          ]}
        >
          <Text
            style={[
              styles.actionBtnText,
              { color: aurora.onAccent, fontSize: sizes.sub, fontWeight: 'bold' },
            ]}
          >
            Keep Both
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    elevation: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  header: {
    marginBottom: 14,
  },
  dialogTitle: {
    fontWeight: 'bold',
    marginBottom: 6,
  },
  dialogSubtitle: {
    lineHeight: 18,
  },
  scrollView: {
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 8,
  },
  card: {
    padding: 14,
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  conflictMetaRow: {
    marginBottom: 10,
  },
  badgeText: {
    fontWeight: '600',
  },
  versionsContainer: {
    gap: 8,
    marginBottom: 12,
  },
  versionBox: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  versionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  versionLabel: {
    fontWeight: '700',
  },
  statusBadge: {
    fontStyle: 'italic',
  },
  contentPreview: {
    lineHeight: 19,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    textAlign: 'center',
  },
});
