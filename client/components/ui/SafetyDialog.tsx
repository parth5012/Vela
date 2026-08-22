import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafetyStore } from '../../store/useSafetyStore';
import { useConfigStore } from '../../store/useConfigStore';
import { classifyAction, getCategoryLabel } from '../../utils/safetyManager';
import { useAurora } from '../../hooks/useAurora';
import { Card } from './settingsKit';

export function SafetyDialog() {
  const pendingTask = useSafetyStore((s) => s.pendingTask);
  const resolvePending = useSafetyStore((s) => s.resolvePending);
  const setPermission = useConfigStore((s) => s.setDeviceAgentPermission);
  const { colors, sizes, aurora } = useAurora();

  if (!pendingTask) return null;

  const category = classifyAction(
    pendingTask.toolName,
    pendingTask.target,
    pendingTask.value
  );
  const categoryLabel = getCategoryLabel(category);

  const handleAlwaysAllow = () => {
    setPermission(category, 'auto');
    resolvePending('success', `Always allow safety category: ${category}`);
  };

  const handleAllowOnce = () => {
    resolvePending('success', 'Allowed once by user');
  };

  const handleDenyOnce = () => {
    resolvePending('error', 'Denied once by user');
  };

  const handleAlwaysBlock = () => {
    setPermission(category, 'deny');
    resolvePending('error', `Always block safety category: ${category}`);
  };

  return (
    <Modal
      transparent
      visible={!!pendingTask}
      animationType="fade"
      onRequestClose={handleDenyOnce}
    >
      <View style={styles.overlay}>
        <View style={[styles.dialogContainer, { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder }]}>
          <Text style={[styles.dialogTitle, { color: colors.text, fontSize: sizes.title }]}>
            🛡️ Safety Authorization
          </Text>
          <Text style={[styles.dialogSubtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Vela requests permission to perform a device action.
          </Text>

          <Card style={styles.card}>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Action Category:</Text>
              <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{categoryLabel}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Tool & Action:</Text>
              <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{pendingTask.toolName}</Text>
            </View>
            {pendingTask.target ? (
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Target/Element:</Text>
                <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{pendingTask.target}</Text>
              </View>
            ) : null}
            {pendingTask.value ? (
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Value/Input:</Text>
                <Text style={[styles.metaValue, { color: colors.text, fontSize: sizes.text }]}>{pendingTask.value}</Text>
              </View>
            ) : null}
            {pendingTask.thoughts ? (
              <View style={styles.metaThoughts}>
                <Text style={[styles.metaLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>Context & Rationale:</Text>
                <Text style={[styles.thoughtsText, { color: colors.text, fontSize: sizes.text - 1 }]}>
                  {pendingTask.thoughts}
                </Text>
              </View>
            ) : null}
          </Card>

          <View style={styles.buttonGroup}>
            <Pressable
              onPress={handleAlwaysAllow}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.btnText, { color: colors.text, fontSize: sizes.text }]}>Always Allow</Text>
            </Pressable>

            <Pressable
              onPress={handleAllowOnce}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: aurora.acc1 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.btnText, { color: '#ffffff', fontSize: sizes.text, fontWeight: 'bold' }]}>
                Allow Once
              </Text>
            </Pressable>
          </View>

          <View style={styles.buttonGroup}>
            <Pressable
              onPress={handleAlwaysBlock}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.4)' },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.btnText, { color: (colors as any).rose || '#f43f5e', fontSize: sizes.text }]}>
                Always Block
              </Text>
            </Pressable>

            <Pressable
              onPress={handleDenyOnce}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.btnText, { color: colors.text, fontSize: sizes.text }]}>Deny Once</Text>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dialogTitle: {
    fontWeight: 'bold',
    marginBottom: 6,
  },
  dialogSubtitle: {
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    padding: 12,
    marginBottom: 16,
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
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
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
});
