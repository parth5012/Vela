import React from 'react';
import { View, Text } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  AccentDots,
  useAurora,
} from '../../components/ui/settingsKit';

const THEME_OPTIONS = [
  { value: 'deep' as const, label: 'Aurora' },
  { value: 'slate' as const, label: 'Slate' },
  { value: 'cyberpunk' as const, label: 'Neon' },
  { value: 'oled' as const, label: 'Void' },
  { value: 'dracula' as const, label: 'Dusk' },
  { value: 'nordic' as const, label: 'Frost' },
];

const FONT_OPTIONS = [
  { value: 'small' as const, label: 'Small' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'large' as const, label: 'Large' },
];

export default function AppearanceScreen() {
  const theme = useConfigStore((s) => s.theme);
  const setTheme = useConfigStore((s) => s.setTheme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const setFontSize = useConfigStore((s) => s.setFontSize);
  const { colors, sizes } = useAurora();

  return (
    <AuroraScreen
      title="Appearance"
      subtitle="Theme sets the atmosphere (sky, glass, text); the accent sets the energy — the aurora that tints actions."
    >
      <Card>
        <Label>Theme</Label>
        <PillGroup options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Six dark atmospheres, one glass language. Current: {THEME_OPTIONS.find((t) => t.value === theme)?.label}.
        </Text>
      </Card>

      <Card>
        <Label>Accent</Label>
        <AccentDots />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Tints the send button, streaming stripe, user bubble, and active states.
        </Text>
      </Card>

      <Card>
        <Label>Font Size</Label>
        <PillGroup options={FONT_OPTIONS} value={fontSize} onChange={setFontSize} />
        <View style={{ marginTop: 4 }}>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '600' }}>
            The quick brown fox
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
            Body · {sizes.text}px — preview text size
          </Text>
        </View>
      </Card>
    </AuroraScreen>
  );
}
