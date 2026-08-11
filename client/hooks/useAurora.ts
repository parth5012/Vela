import { useConfigStore } from '../store/useConfigStore';
import { THEME_COLORS, FONT_SIZES, getAurora } from '../utils/theme';

// Shared Aurora design system hook. Theme = atmosphere (sky/glass/text from
// THEME_COLORS), accent = energy (aurora gradient resolving the send buttons,
// active states, glow). Used by the home screen and the settings stack.
export function useAurora() {
  const theme = useConfigStore((s) => s.theme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const accentColor = useConfigStore((s) => s.accentColor);
  const colors = THEME_COLORS[theme] || THEME_COLORS.deep;
  const sizes = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const aurora = getAurora(accentColor, theme);
  return { colors, sizes, aurora };
}
