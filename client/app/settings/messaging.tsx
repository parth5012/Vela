import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Field,
  Label,
  PillGroup,
  PrimaryButton,
  useAurora,
} from '../../components/ui/settingsKit';

const PERSONA_OPTIONS = [
  { value: 'personal assistant' as const, label: 'Assistant' },
  { value: 'teacher' as const, label: 'Teacher' },
  { value: 'analyst' as const, label: 'Analyst' },
  { value: 'prompt builder' as const, label: 'Builder' },
];

export default function MessagingScreen() {
  const suggestionStarters = useConfigStore((s) => s.suggestionStarters);
  const setSuggestionStarters = useConfigStore((s) => s.setSuggestionStarters);
  const { colors, sizes, aurora } = useAurora();

  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [persona, setPersona] = useState<string>('personal assistant');

  const handleAdd = () => {
    if (!label.trim() || !text.trim()) {
      Alert.alert('Incomplete', 'Add a label and a prompt for the starter card.');
      return;
    }
    setSuggestionStarters([...suggestionStarters, { label: label.trim(), text: text.trim(), persona }]);
    setLabel('');
    setText('');
    setPersona('personal assistant');
  };

  const handleRemove = (index: number) => {
    Alert.alert('Remove starter', 'Delete this suggestion card?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setSuggestionStarters(suggestionStarters.filter((_, i) => i !== index)),
      },
    ]);
  };

  return (
    <AuroraScreen
      title="Messaging"
      subtitle="The suggestion starter cards shown on the home screen — tap one to jump straight into a task."
    >
      <Card>
        <Label>Current Starters ({suggestionStarters.length})</Label>
        {suggestionStarters.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
            No starter cards. Add one below.
          </Text>
        ) : (
          suggestionStarters.map((starter, index) => (
            <View
              key={`${starter.label}-${index}`}
              style={[styles.starterRow, { borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
                  {starter.label}
                </Text>
                <Text
                  style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 2 }}
                  numberOfLines={2}
                >
                  {starter.text}
                </Text>
                <Text style={{ color: colors.textDark, fontSize: sizes.sub - 1, marginTop: 2 }}>
                  {starter.persona}
                </Text>
              </View>
              <Pressable onPress={() => handleRemove(index)} hitSlop={10}>
                <Text style={{ color: '#f87171', fontSize: sizes.text }}>✕ Remove</Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Label>Add Starter</Label>
        <Field label="Label" placeholder="e.g. Teach Concept" value={label} onChangeText={setLabel} />
        <Field
          label="Prompt"
          placeholder="What should Vela do?"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          style={styles.multiline}
        />
        <Label>Persona</Label>
        <PillGroup
          options={PERSONA_OPTIONS}
          value={persona}
          onChange={(v) => setPersona(v)}
        />
        <PrimaryButton label="Add Starter" onPress={handleAdd} />
      </Card>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  starterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  multiline: {
    minHeight: 80,
    paddingTop: 10,
    paddingBottom: 10,
  },
});
