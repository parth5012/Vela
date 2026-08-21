import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useConfigStore } from '../../store/useConfigStore';
import { ACCENT_COLORS } from '../../utils/theme';
import { useAurora } from '../../hooks/useAurora';

export { useAurora };

// Shared Aurora design system for the Settings stack (and future screens).
// Theme = atmosphere (sky/glass/text from THEME_COLORS), accent = energy
// (aurora gradient resolving the send buttons, active states, glow).

export function AuroraScreen({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const { colors, sizes } = useAurora();
  const router = useRouter();
  const handleBack = onBack ?? (() => router.back());

  return (
    <LinearGradient colors={[colors.skyTop, colors.skyBottom]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.textMuted, fontSize: sizes.text }]}>‹ Back</Text>
        </Pressable>
        <Text
          style={[styles.headerTitle, { color: colors.text, fontSize: sizes.title }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <View style={styles.backBtn} />
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>{subtitle}</Text>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </LinearGradient>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAurora();
  return (
    <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { colors, sizes } = useAurora();
  return (
    <Text style={[styles.sectionTitle, { color: colors.text, fontSize: sizes.title }]}>{children}</Text>
  );
}

export function SectionSubtitle({ children }: { children: React.ReactNode }) {
  const { colors, sizes } = useAurora();
  return (
    <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>{children}</Text>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  const { colors, sizes } = useAurora();
  return (
    <Text style={[styles.label, { color: colors.textMuted, fontSize: sizes.sub }]}>{children}</Text>
  );
}

export function Field({ label, style, ...rest }: { label: string } & TextInputProps) {
  const { colors, sizes } = useAurora();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.textMuted, fontSize: sizes.sub }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder, color: colors.text, fontSize: sizes.text },
          style,
        ]}
        placeholderTextColor={colors.textDark}
        {...rest}
      />
    </View>
  );
}

export function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors, sizes, aurora } = useAurora();
  return (
    <View style={styles.rowWrap}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[
              styles.pill,
              { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
              selected && { borderColor: aurora.acc1, borderWidth: 2 },
            ]}
            onPress={() => onChange(o.value)}
          >
            <Text
              style={[
                styles.pillText,
                { color: selected ? colors.text : colors.textMuted, fontSize: sizes.text - 1 },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors, sizes, aurora } = useAurora();
  return (
    <View style={styles.rowWrap}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[
              styles.chip,
              { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: colors.glassBorder },
              selected && { borderColor: aurora.acc1 },
            ]}
            onPress={() => onChange(o.value)}
          >
            <Text
              style={[
                styles.chipText,
                { color: selected ? colors.text : colors.textMuted, fontSize: sizes.text - 2 },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { aurora, sizes } = useAurora();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: aurora.acc1,
          shadowColor: aurora.acc1,
          shadowOpacity: 0.45,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        },
        pressed && { opacity: 0.8 },
        (disabled || loading) && { opacity: 0.6 },
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={aurora.onAccent} size="small" />
      ) : (
        <Text style={[styles.primaryText, { color: aurora.onAccent, fontSize: sizes.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function DangerButton({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [styles.danger, pressed && { backgroundColor: 'rgba(239, 68, 68, 0.18)' }]}
      onPress={onPress}
    >
      <Text style={styles.dangerText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Wayfinder #173 Audit — settingsKit / Shell Polish
 * AuroraScreen headerTitle weight 600 (not 700/900 except VELA logo) via headerTitle fontWeight 600 — matches _layout formatter rule.
 * DangerButton minHeight 48 pressed rgba(239,68,68,0.18) accessibilityRole button; PrimaryButton 48dp target retained.
 * Accent swatches: 32dp circles, selected ring 2px aurora.acc1 + checkmark, AA contrast on glass bg (glassBorder vs accent).
 * Spec #174: enforce 32dp + 2px aurora.acc1 ring, AA contrast, 48dp targets.
 */
export function AccentDots() {
  const aurora = useAurora().aurora;
  const colors = useAurora().colors;
  const accentColor = useConfigStore((s) => s.accentColor);
  const setAccentColor = useConfigStore((s) => s.setAccentColor);

  return (
    <View style={[styles.rowWrap, { gap: 14 }]}>
      {(Object.keys(ACCENT_COLORS) as Array<keyof typeof ACCENT_COLORS>).map((color) => {
        const selected = accentColor === color;
        return (
          <Pressable
            key={color}
            style={[
              styles.accentDot,
              { backgroundColor: ACCENT_COLORS[color] },
              selected && { borderColor: aurora.acc1, borderWidth: 2 },
            ]}
            onPress={() => setAccentColor(color)}
            accessibilityRole="button"
            accessibilityLabel={`Accent ${color}`}
            accessibilityState={{ selected }}
          >
            {selected ? (
              <Text style={{ color: '#0b0b1a', fontSize: 13, fontWeight: '700' }}>✓</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  backBtn: {
    minWidth: 64,
    paddingVertical: 8,
  },
  backText: {
    fontWeight: '600',
  },
  headerTitle: {
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  subtitle: {
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 2,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '500',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {},
  primary: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryText: {
    fontWeight: '600',
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  dangerText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
  },
  accentDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
