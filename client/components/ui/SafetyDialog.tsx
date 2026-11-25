import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafetyStore } from '../../store/useSafetyStore';
import { useConfigStore } from '../../store/useConfigStore';
import { useDeviceSessionStore } from '../../store/useDeviceSessionStore';
import { classifyAction, getCategoryLabel } from '../../utils/safetyManager';
import { useAurora } from '../../hooks/useAurora';
import { Card } from './settingsKit';
import { DEFAULT_ELEVATION } from '../../utils/elevation';

export function SafetyDialog() {
  const pendingTask = useSafetyStore((s) => s.pendingTask);
  const resolvePending = useSafetyStore((s) => s.resolvePending);
  const setPermission = useConfigStore((s) => s.setDeviceAgentPermission);
  const setSessionBypass = useDeviceSessionStore((s) => s.setSessionBypass);
  const { colors, sizes, aurora } = useAurora();
  const [dontAskThisSession, setDontAskThisSession] = useState(false);

  useEffect(() => {
    setDontAskThisSession(false);
  }, [pendingTask]);

  if (!pendingTask) return null;

  const category = classifyAction(
    pendingTask.toolName,
    pendingTask.target,
    pendingTask.value
  );
  const categoryLabel = getCategoryLabel(category);

  const isHighRisk =
    category === 'send_communication' ||
    category === 'calls' ||
    category === 'purchases' ||
    category === 'deletions' ||
    category === 'settings_changes' ||
    category === 'passwords_otps' ||
    category === 'sideloads' ||
    category === 'root_shizuku';

  const riskBadge = isHighRisk ? '⚠️ High Risk' : '⚡ Action Confirmation';
  const riskBadgeColor = isHighRisk ? '#f43f5e' : (aurora.acc1 || '#3b82f6');

  const handleConfirmAction = () => {
    if (dontAskThisSession && !isHighRisk) {
      setSessionBypass(category, true);
    }
    resolvePending('success', dontAskThisSession && !isHighRisk ? 'Confirmed (session bypass enabled)' : 'Confirmed by user');
    setDontAskThisSession(false);
  };

  const handleCancel = () => {
    resolvePending('error', 'Cancelled by user');
    setDontAskThisSession(false);
  };

  const handleAlwaysAllow = () => {
    if (isHighRisk) return;
    setPermission(category, 'auto');
    resolvePending('success', `Always allow safety category: ${category}`);
    setDontAskThisSession(false);
  };

  const handleAlwaysBlock = () => {
    setPermission(category, 'deny');
    resolvePending('error', `Always block safety category: ${category}`);
    setDontAskThisSession(false);
  };

  return (
    <Modal
      transparent
      visible={!!pendingTask}
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={[styles.dialogContainer, { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder }]}>
          {/* Header with Risk Badge */}
          <View style={styles.headerRow}>
            <Text style={[styles.dialogTitle, { color: colors.text, fontSize: sizes.title }]}>
              🛡️ Safety Authorization
            </Text>
            <View style={[styles.badge, { backgroundColor: `${riskBadgeColor}20`, borderColor: riskBadgeColor }]}>
              <Text style={[styles.badgeText, { color: riskBadgeColor }]}>{riskBadge}</Text>
            </View>
          </View>

          <Text style={[styles.dialogSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Confirm Action: {categoryLabel} - Please verify the details below. Vela will only perform this action upon your confirmation.
          </Text>

          {/* Structured Payload Inspector Box */}
          <Card style={styles.card}>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Tool Name:</Text>
              <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{pendingTask.toolName}</Text>
            </View>
            {pendingTask.target ? (
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Target / App:</Text>
                <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{pendingTask.target}</Text>
              </View>
            ) : null}
            {pendingTask.value ? (
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Payload / Input:</Text>
                <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>
                  {category === 'passwords_otps' ? '••••••••' : pendingTask.value}
                </Text>
              </View>
            ) : null}
            {pendingTask.thoughts ? (
              <View style={styles.metaThoughts}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Intent & Context:</Text>
                <Text style={[styles.thoughtsText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                  {pendingTask.thoughts}
                </Text>
              </View>
            ) : null}
          </Card>

          {/* Session Bypass Checkbox — gated for low/medium risk actions only */}
          {!isHighRisk ? (
            <Pressable
              onPress={() => setDontAskThisSession((v) => !v)}
              style={styles.checkboxRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontAskThisSession }}
              accessibilityLabel={`Don't ask again this session for ${categoryLabel}`}
            >
              <View style={[styles.checkbox, { borderColor: colors.glassBorder }, dontAskThisSession && { backgroundColor: aurora.acc1 }]}>
                {dontAskThisSession ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Don't ask again this session for {categoryLabel}
              </Text>
            </Pressable>
          ) : null}

          {/* Primary Action Buttons */}
          <View style={styles.buttonGroup}>
            <Pressable
              onPress={handleCancel}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Deny once or cancel action"
            >
              <Text style={[styles.btnText, { color: colors.text, fontSize: sizes.text }]}>Deny Once</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirmAction}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: aurora.acc1 || '#3b82f6' },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Allow once or confirm action"
            >
              <Text style={[styles.btnText, { color: aurora.onAccent || '#ffffff', fontSize: sizes.text, fontWeight: 'bold' }]}>
                Allow Once
              </Text>
            </Pressable>
          </View>

          {/* Secondary Permanent Policy Options */}
          <View style={styles.permanentOptionsRow}>
            {!isHighRisk ? (
              <Pressable
                onPress={handleAlwaysAllow}
                style={({ pressed }) => [styles.textLink, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Always allow this category"
              >
                <Text style={[styles.linkText, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>Always Allow</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={handleAlwaysBlock}
              style={({ pressed }) => [styles.textLink, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Always block this category"
            >
              <Text style={[styles.linkText, { color: '#f43f5e', fontSize: sizes.sub - 1 }]}>Always Block</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    elevation: 5,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 8,
  },
  dialogTitle: {
    fontWeight: 'bold',
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  dialogSubtitle: {
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    padding: 12,
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  metaLabel: {
    fontWeight: '600',
    marginRight: 8,
  },
  metaValue: {
    flex: 1,
    textAlign: 'right',
  },
  metaThoughts: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  thoughtsText: {
    marginTop: 4,
    lineHeight: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    lineHeight: 16,
  },
  checkboxLabel: {
    flex: 1,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnText: {
    textAlign: 'center',
  },
  permanentOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 4,
  },
  textLink: {
    padding: 4,
  },
  linkText: {
    textDecorationLine: 'underline',
  },
});
