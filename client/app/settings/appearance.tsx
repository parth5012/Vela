import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Label,
  PillGroup,
  AccentDots,
  useAurora,
} from '../../components/ui/settingsKit';
import {
  Odometer,
  WavyRing,
  WeeklyChart,
  ShapeBadge,
  BouncyPressable,
} from '../../components/ui/m3Expression';

// Appearance — the showcase screen of the VELA "Flair" design language.
// 6 schemes (berry · citrus · aquatic · sunset · noir · chrome), accent energy,
// font scale, and a live gallery of the expressive widget kit.

const THEME_OPTIONS = [
  { value: 'berry' as const, label: 'Berry' },
  { value: 'citrus' as const, label: 'Citrus' },
  { value: 'aquatic' as const, label: 'Aquatic' },
  { value: 'sunset' as const, label: 'Sunset' },
  { value: 'noir' as const, label: 'Noir' },
  { value: 'chrome' as const, label: 'Chrome' },
];

const FONT_OPTIONS = [
  { value: 'small' as const, label: 'Compact' },
  { value: 'medium' as const, label: 'Regular' },
  { value: 'large' as const, label: 'Large' },
];

const DEMO_DAYS = [4200, 5800, 3100, 7200, 6400, 8100, 5300];
const DEMO_GOAL = 8000;

export default function AppearanceScreen() {
  const theme = useConfigStore((s) => s.theme);
  const setTheme = useConfigStore((s) => s.setTheme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const setFontSize = useConfigStore((s) => s.setFontSize);
  const { colors, sizes, aurora } = useAurora();
  const [steps, setSteps] = useState(5782);
  const [ringProgress, setRingProgress] = useState(0.72);

  // Odometer demo: keep the digits rolling so the springs stay alive.
  useEffect(() => {
    const interval = setInterval(() => {
      setSteps((s) => s + Math.floor(Math.random() * 90) + 10);
    }, 1600);
    return () => clearInterval(interval);
  }, []);

  // Wavy ring demo: pulse between progress points.
  useEffect(() => {
    const pulse = setInterval(() => {
      setRingProgress((p) => (p >= 0.9 ? 0.35 : p + 0.18));
    }, 2400);
    return () => clearInterval(pulse);
  }, []);

  return (
    <AuroraScreen
      title="Appearance"
      subtitle="Six tonal schemes, one expressive language. Tap a scheme — the whole app recolors instantly."
    >
      <Card>
        <Label>Color Scheme</Label>
        <PillGroup options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Berry is the signature. Noir and Chrome are dark atmospheres. Current:{' '}
          <Text style={{ color: aurora.acc1, fontWeight: '800' }}>
            {THEME_OPTIONS.find((t) => t.value === theme)?.label}
          </Text>
          .
        </Text>
      </Card>

      <Card>
        <Label>Accent Energy</Label>
        <AccentDots />
        <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16 }}>
          Tints the send button, active pills, and highlights — overrides the scheme's own pair.
        </Text>
      </Card>

      <Card>
        <Label>Font Scale</Label>
        <PillGroup options={FONT_OPTIONS} value={fontSize} onChange={setFontSize} />
        <View style={{ marginTop: 4 }}>
          <Text style={{ color: colors.text, fontSize: sizes.text, fontWeight: '800' }}>
            The quick brown fox jumps
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: sizes.sub }}>
            Body · {sizes.text}px — preview text size
          </Text>
        </View>
      </Card>

      <Card>
        <Label>Expressive Widgets</Label>
        <Text
          style={{ color: colors.textMuted, fontSize: sizes.sub - 1, lineHeight: 16, marginBottom: 12 }}
        >
          Rolling odometer digits, wavy progress ring, staggered weekly bars, morphing shape
          badges. Tap the badges to morph them.
        </Text>

        <View style={m3styles.demoRow}>
          <WavyRing
            progress={ringProgress}
            acc1={aurora.acc1}
            acc2={aurora.acc2}
            trackColor={colors.border}
            captionColor={colors.text}
            caption="progress"
          />
          <View style={m3styles.demoCounter}>
            <Odometer value={steps} color={colors.text} />
            <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, marginTop: 6 }}>
              steps today
            </Text>
            <View style={[m3styles.demoDot, { backgroundColor: aurora.acc2 }]} />
          </View>
        </View>

        <WeeklyChart
          data={DEMO_DAYS}
          goal={DEMO_GOAL}
          barColor={aurora.acc1}
          metColor={aurora.acc1}
          idleColor={colors.border}
          labelColor={colors.textMuted}
        />

        <View style={m3styles.badgeRow}>
          <ShapeBadge emoji="🏆" label="First Steps" tintColor={hexWithAlpha(aurora.acc1, 0.13)} />
          <ShapeBadge emoji="🔥" label="Walker" tintColor={hexWithAlpha(aurora.acc1, 0.13)} />
          <ShapeBadge emoji="⭐" label="Streak 5" tintColor={hexWithAlpha(aurora.acc1, 0.13)} />
        </View>

        <BouncyPressable onPress={() => setRingProgress((p) => (p >= 0.9 ? 0.35 : p + 0.18))}>
          <View
            style={[
              m3styles.celebrateButton,
              {
                backgroundColor: aurora.acc1,
                shadowColor: aurora.acc1,
                shadowOpacity: 0.4,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              },
            ]}
          >
            <Text style={{ color: aurora.onAccent, fontWeight: '800', fontSize: sizes.text }}>
              Celebrate progress
            </Text>
          </View>
        </BouncyPressable>
      </Card>
    </AuroraScreen>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const m3styles = StyleSheet.create({
  demoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    rowGap: 14,
    marginBottom: 14,
  },
  demoCounter: { alignItems: 'flex-start' },
  demoDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 14,
  },
  celebrateButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
  },
});
