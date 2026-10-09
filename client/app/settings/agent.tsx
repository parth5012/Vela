import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, TextInput } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Field,
  Label,
  PillGroup,
  ChipGroup,
  SecondaryButton,
  DangerButton,
  useAurora,
} from '../../components/ui/settingsKit';
import { useAgents } from '../../hooks/useAgents';
import {
  deleteAgent,
  duplicateAgent,
  insertAgent,
  updateAgent,
} from '../../db/agentRepository';
import type { Agent } from '../../utils/agents';

const PRESET_MODELS = ['gemini-1.5-pro', 'gemini-1.5-flash', 'claude-3-5-sonnet', 'gpt-4o'];

type FormState = {
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  model: string;
};

const EMPTY_FORM: FormState = { name: '', description: '', icon: '', system_prompt: '', model: '' };

function agentToForm(agent: Agent): FormState {
  return {
    name: agent.name,
    description: agent.description ?? '',
    icon: agent.icon,
    system_prompt: agent.system_prompt ?? '',
    model: agent.model ?? '',
  };
}

function AgentForm({
  initial,
  title,
  submitLabel,
  connectionMode,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  title: string;
  submitLabel: string;
  connectionMode: string;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const { colors, sizes } = useAurora();
  const cloud = connectionMode === 'cloud';

  return (
    <View style={{ gap: 10 }}>
      <Label>{title}</Label>
      <Field
        label="Name"
        placeholder="Agent name"
        value={form.name}
        onChangeText={(v) => setForm({ ...form, name: v })}
        autoCorrect={false}
      />
      <Field
        label="Description"
        placeholder="One-line description"
        value={form.description}
        onChangeText={(v) => setForm({ ...form, description: v })}
        autoCorrect={false}
      />
      <Field
        label="Icon"
        placeholder="🤖"
        value={form.icon}
        onChangeText={(v) => setForm({ ...form, icon: v })}
        autoCorrect={false}
      />
      <View>
        <Text style={[styles.formLabel, { color: colors.textMuted, fontSize: sizes.sub }]}>System Prompt</Text>
        <TextInput
          style={[
            styles.promptInput,
            { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder, color: colors.text, fontSize: sizes.text },
          ]}
          placeholder="You are..."
          placeholderTextColor={colors.textDark}
          value={form.system_prompt}
          onChangeText={(v) => setForm({ ...form, system_prompt: v })}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          autoCorrect={false}
        />
      </View>
      <View>
        <Field
          label="Model"
          placeholder={cloud ? 'Leave empty to inherit provider default' : 'Model is managed by connection mode'}
          value={form.model}
          onChangeText={(v) => setForm({ ...form, model: v })}
          autoCapitalize="none"
          autoCorrect={false}
          editable={cloud}
        />
        {!cloud ? (
          <Text style={[styles.helper, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
            {connectionMode === 'local'
              ? 'Local mode: the model is chosen globally (the downloaded local model).'
              : 'Server mode: the server chooses the model.'}
          </Text>
        ) : (
          <Text style={[styles.helper, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
            Leave empty to inherit the cloud provider's default model.
          </Text>
        )}
      </View>
      <View style={styles.formActions}>
        <SecondaryButton label={submitLabel} onPress={() => onSubmit(form)} accessibilityLabel={submitLabel} />
        <SecondaryButton label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

export default function AgentScreen() {
  const modelName = useConfigStore((s) => s.modelName);
  const setModelName = useConfigStore((s) => s.setModelName);
  const temperature = useConfigStore((s) => s.temperature);
  const setTemperature = useConfigStore((s) => s.setTemperature);
  const defaultAgent = useConfigStore((s) => s.defaultAgent);
  const setDefaultAgent = useConfigStore((s) => s.setDefaultAgent);
  const userName = useConfigStore((s) => s.userName);
  const setUserName = useConfigStore((s) => s.setUserName);
  const connectionMode = useConfigStore((s) => s.connectionMode);
  const maxSteps = useConfigStore((s) => s.maxSteps);
  const setMaxSteps = useConfigStore((s) => s.setMaxSteps);
  const maxStepsEnabled = useConfigStore((s) => s.maxStepsEnabled);
  const setMaxStepsEnabled = useConfigStore((s) => s.setMaxStepsEnabled);
  const { colors, sizes, aurora } = useAurora();

  const agents = useAgents();
  const agentOptions = agents.map((agent) => ({ value: agent.id, label: agent.name }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);


  const handleDuplicate = (agent: Agent) => {
    duplicateAgent(agent.id).catch((err) =>
      Alert.alert('Could not duplicate agent', err?.message ?? 'Unknown error'),
    );
  };

  const handleDelete = (agent: Agent) => {
    Alert.alert('Delete agent?', `"${agent.name}" will be removed. Threads using it move to the default agent.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setSelectedId(null);
          deleteAgent(agent.id).catch((err) =>
            Alert.alert('Could not delete agent', err?.message ?? 'Unknown error'),
          );
        },
      },
    ]);
  };

  const handleEditSubmit = (agent: Agent, form: FormState) => {
    updateAgent(agent.id, {
      name: form.name.trim() || agent.name,
      description: form.description,
      icon: form.icon || agent.icon,
      system_prompt: form.system_prompt,
      model: form.model.trim() ? form.model.trim() : null,
    }).catch((err) => Alert.alert('Could not save agent', err?.message ?? 'Unknown error'));
    setEditingId(null);
  };

  const handleCreateSubmit = (form: FormState) => {
    insertAgent({
      name: form.name.trim() || 'Untitled agent',
      description: form.description || undefined,
      icon: form.icon || undefined,
      system_prompt: form.system_prompt,
      model: form.model.trim() ? form.model.trim() : null,
      is_preset: false,
    }).catch((err) => Alert.alert('Could not create agent', err?.message ?? 'Unknown error'));
    setCreating(false);
  };

  return (
    <AuroraScreen
      title="Agent"
      subtitle="How Vela behaves: identity, model, and response character."
    >
      <Card>
        <Label>User Name</Label>
        <Field
          label="User Name"
          placeholder="Enter your name"
          value={userName}
          onChangeText={setUserName}
          autoCorrect={false}
        />
        <Label>Default Agent</Label>
        <PillGroup options={agentOptions} value={defaultAgent} onChange={setDefaultAgent} />
      </Card>

      <Card>
        <Label>Agents</Label>
        {agents.map((agent) => {
          const isSelected = selectedId === agent.id;
          const isEditing = editingId === agent.id;
          return (
            <View key={agent.id} style={{ gap: 8 }}>
              <Pressable
                testID={`agent-row-${agent.id}`}
                style={[
                  styles.row,
                  {
                    borderColor: isSelected ? aurora.acc1 : colors.glassBorder,
                    backgroundColor: 'rgba(0,0,0,0.25)',
                  },
                ]}
                onPress={() => {
                  setSelectedId(isSelected ? null : agent.id);
                  setEditingId(null);
                }}
              >
                <Text style={{ fontSize: sizes.text + 10 }}>{agent.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                    {agent.name}
                  </Text>
                  {agent.description ? (
                    <Text style={{ color: colors.textMuted, fontSize: sizes.sub }} numberOfLines={2}>
                      {agent.description}
                    </Text>
                  ) : null}
                </View>
                {agent.is_preset ? (
                  <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1 }}>Preset</Text>
                ) : null}
              </Pressable>

              {isSelected && !isEditing ? (
                <View style={{ gap: 10 }}>
                  <Label>System Prompt</Label>
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: sizes.sub,
                      backgroundColor: 'rgba(0,0,0,0.25)',
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    {agent.system_prompt?.trim() ? agent.system_prompt : 'No system prompt set.'}
                  </Text>
                  <View style={styles.rowActions}>
                    <SecondaryButton
                      label="Duplicate"
                      onPress={() => handleDuplicate(agent)}
                      accessibilityLabel={`Duplicate ${agent.name}`}
                    />
                    {!agent.is_preset ? (
                      <>
                        <SecondaryButton
                          label="Edit"
                          onPress={() => setEditingId(agent.id)}
                          accessibilityLabel={`Edit ${agent.name}`}
                        />
                        <DangerButton
                          label="Delete"
                          onPress={() => handleDelete(agent)}
                          accessibilityLabel={`Delete ${agent.name}`}
                        />
                      </>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {isEditing && !agent.is_preset ? (
                <AgentForm
                  initial={agentToForm(agent)}
                  title={`Edit ${agent.name}`}
                  submitLabel="Save"
                  connectionMode={connectionMode}
                  onSubmit={(form) => handleEditSubmit(agent, form)}
                  onCancel={() => setEditingId(null)}
                />
              ) : null}
            </View>
          );
        })}

        {creating ? (
          <AgentForm
            initial={EMPTY_FORM}
            title="New Agent"
            submitLabel="Create"
            connectionMode={connectionMode}
            onSubmit={handleCreateSubmit}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <SecondaryButton label="+ New agent" onPress={() => setCreating(true)} />
        )}
      </Card>

      <Card>
        <Label>Model</Label>
        <Field
          label="Model"
          placeholder="Enter model name (e.g. gemini-1.5-pro)"
          value={modelName}
          onChangeText={setModelName}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ChipGroup
          options={PRESET_MODELS.map((m) => ({ value: m, label: m }))}
          value={modelName}
          onChange={setModelName}
        />
      </Card>

      <Card>
        <Label>Temperature ({temperature.toFixed(1)})</Label>
        <View style={styles.tempRow}>
          <Pressable
            style={({ pressed }) => [
              styles.tempStep,
              { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
              pressed && { opacity: 0.7 },
              temperature <= 0 && { opacity: 0.4 },
            ]}
            onPress={() => setTemperature(Math.max(0, Math.round((temperature - 0.1) * 10) / 10))}
            disabled={temperature <= 0}
          >
            <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>−</Text>
          </Pressable>
          <View
            style={[
              styles.tempTrack,
              { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
            ]}
          >
            <View
              style={[
                styles.tempFill,
                {
                  width: `${temperature * 100}%`,
                  backgroundColor: aurora.acc1,
                },
              ]}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.tempStep,
              { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
              pressed && { opacity: 0.7 },
              temperature >= 1.0 && { opacity: 0.4 },
            ]}
            onPress={() => setTemperature(Math.min(1.0, Math.round((temperature + 0.1) * 10) / 10))}
            disabled={temperature >= 1.0}
          >
            <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>+</Text>
          </Pressable>
        </View>
      </Card>

      <Card>
        <Label>
          Max Steps Budget ({maxStepsEnabled ? `${maxSteps} steps` : 'Unlimited'})
        </Label>
        <Text style={[styles.helper, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
          Caps tool iteration loops per turn. Disabling the step cap permits unlimited reasoning/tool steps until completion or refusal.
        </Text>
        <View style={{ marginTop: 10 }}>
          <PillGroup
            options={[
              { value: 'enabled', label: 'Cap Enabled' },
              { value: 'unlimited', label: 'Unlimited (Disabled)' },
            ]}
            value={maxStepsEnabled ? 'enabled' : 'unlimited'}
            onChange={(val) => setMaxStepsEnabled(val === 'enabled')}
          />
        </View>
        {maxStepsEnabled ? (
          <View style={[styles.stepBudgetRow, { marginTop: 12 }]}>
            <Pressable
              style={({ pressed }) => [
                styles.tempStep,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                maxSteps <= 1 && { opacity: 0.4 },
              ]}
              onPress={() => setMaxSteps(Math.max(1, maxSteps - 1))}
              disabled={maxSteps <= 1}
              accessibilityLabel="Decrease max steps"
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>−</Text>
            </Pressable>
            <TextInput
              style={[
                styles.stepInput,
                {
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  borderColor: colors.glassBorder,
                  color: colors.text,
                  fontSize: sizes.text,
                },
              ]}
              value={String(maxSteps)}
              onChangeText={(txt) => {
                const parsed = parseInt(txt.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(parsed)) {
                  setMaxSteps(Math.max(1, parsed));
                } else if (txt === '') {
                  setMaxSteps(1);
                }
              }}
              keyboardType="numeric"
              accessibilityLabel="Max steps numeric input"
            />
            <Pressable
              style={({ pressed }) => [
                styles.tempStep,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' },
                pressed && { opacity: 0.7 },
                maxSteps >= 100 && { opacity: 0.4 },
              ]}
              onPress={() => setMaxSteps(Math.min(100, maxSteps + 1))}
              disabled={maxSteps >= 100}
              accessibilityLabel="Increase max steps"
            >
              <Text style={{ color: colors.text, fontSize: sizes.text + 4 }}>+</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.resetBtn,
                { borderColor: colors.glassBorder, backgroundColor: 'rgba(255,255,255,0.08)' },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setMaxSteps(15)}
              accessibilityLabel="Reset to default 15"
            >
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>Default (15)</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tempStep: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tempTrack: {
    flex: 1,
    height: 8,
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tempFill: {
    height: '100%',
    borderRadius: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
  },
  formLabel: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  promptInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 100,
    paddingTop: 10,
    paddingBottom: 10,
  },
  helper: {
    marginTop: 6,
    lineHeight: 16,
  },
  stepBudgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepInput: {
    width: 60,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    textAlign: 'center',
    fontWeight: '600',
  },
  resetBtn: {
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
