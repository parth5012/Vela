import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Field,
  Label,
  PillGroup,
  ChipGroup,
  useAurora,
} from '../../components/ui/settingsKit';

const PRESET_MODELS = ['gemini-1.5-pro', 'gemini-1.5-flash', 'claude-3-5-sonnet', 'gpt-4o'];

const PERSONA_OPTIONS = [
  { value: 'personal assistant' as const, label: 'Assistant' },
  { value: 'teacher' as const, label: 'Teacher' },
  { value: 'analyst' as const, label: 'Analyst' },
  { value: 'prompt builder' as const, label: 'Builder' },
];

export default function AgentScreen() {
  const modelName = useConfigStore((s) => s.modelName);
  const setModelName = useConfigStore((s) => s.setModelName);
  const temperature = useConfigStore((s) => s.temperature);
  const setTemperature = useConfigStore((s) => s.setTemperature);
  const defaultPersona = useConfigStore((s) => s.defaultPersona);
  const setDefaultPersona = useConfigStore((s) => s.setDefaultPersona);
  const userName = useConfigStore((s) => s.userName);
  const setUserName = useConfigStore((s) => s.setUserName);
  const systemPrompt = useConfigStore((s) => s.systemPrompt);
  const setSystemPrompt = useConfigStore((s) => s.setSystemPrompt);
  const { colors, sizes, aurora } = useAurora();

  return (
    <AuroraScreen
      title="Agent"
      subtitle="How Vela behaves: persona, identity, model, and response character."
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
        <Label>Default Persona</Label>
        <PillGroup options={PERSONA_OPTIONS} value={defaultPersona} onChange={setDefaultPersona} />
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
        <Label>System Prompt</Label>
        <Field
          label="System Prompt"
          placeholder="You are an autonomous research agent."
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={styles.multiline}
        />
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
  multiline: {
    minHeight: 100,
    paddingTop: 10,
    paddingBottom: 10,
  },
});
