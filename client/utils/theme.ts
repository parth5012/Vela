// ─────────────────────────────────────────────────────────────────────────────
// VELA DESIGN LANGUAGE — "Flair"
// Complete redesign. Replaces the old Aurora glass theme system entirely.
//
// Five schemes built from tonal Material-style palettes:
//   berry · citrus · aquatic · sunset · noir (AMOLED)
// Four light schemes + one true-black dark scheme. Same token API as before
// (skyTop/skyBottom/glass/aurora1/aurora2/bubbles/…) so every screen across the
// app picks up the new look through the existing theme plumbing.
// ─────────────────────────────────────────────────────────────────────────────

export const ACCENT_COLORS = {
  amber: '#f59e0b',
  orange: '#ea580c',
  emerald: '#10b981',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  rose: '#f43f5e',
  pink: '#ec4899',
  blue: '#0284c7',
};

// Accent "energy": two-stop gradient that tints the send button and active
// states. Curated as vivid, saturated pairs that stay legible on light and
// dark surfaces.
export const ACCENT_AURORA: Record<keyof typeof ACCENT_COLORS, [string, string]> = {
  amber: ['#ea8b0d', '#fbd788'],
  orange: ['#e65a1c', '#ffb488'],
  emerald: ['#0c9d6e', '#7ae2bf'],
  indigo: ['#5457ec', '#a4afff'],
  violet: ['#7938ec', '#c0a1fa'],
  rose: ['#e01a4d', '#fb9fb9'],
  pink: ['#d61e7c', '#f899cc'],
  blue: ['#0a70d4', '#7ec8fb'],
};

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getContrastForeground(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1D1B20' : '#ffffff';
}

export type AccentName = keyof typeof ACCENT_COLORS;
export type ThemeName = 'berry' | 'citrus' | 'aquatic' | 'sunset' | 'noir';

// Tone tokens: sky = page gradient, glass = surface, aurora = the scheme's
// signature gradient pair. Bubbles get their own tonal tints.
export interface AuroraTokens {
  skyTop: string;
  skyBottom: string;
  glass: string;
  glassBorder: string;
  aurora1: string;
  aurora2: string;
  glow: string;
  status: string;
  codeBg: string;
  codeFg: string;
}

export interface ThemeColors extends AuroraTokens {
  background: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textDark: string;
  bubbleUser: string;
  bubbleUserBorder: string;
  bubbleAssistant: string;
  bubbleAssistantBorder: string;
  /** Legacy optional field; falls back inside index.tsx when absent. */
  bubbleBack?: string;
}

export const THEME_COLORS: Record<ThemeName, ThemeColors> = {
  // ── Berry · tonal lavender-violet (signature scheme, default) ──
  berry: {
    background: '#FBF7FE',
    card: '#FFFFFF',
    border: '#E8E0F2',
    text: '#1D1B20',
    textMuted: '#4B4654',
    textDark: '#79747E',
    bubbleUser: '#EFE7FF',
    bubbleUserBorder: '#DACCFA',
    bubbleAssistant: '#F3F0F7',
    bubbleAssistantBorder: '#E6E1EC',
    skyTop: '#F2EAFA',
    skyBottom: '#FBF7FE',
    glass: 'rgba(255, 255, 255, 0.92)',
    glassBorder: '#E8E0F2',
    aurora1: '#6D3AE8',
    aurora2: '#B69BF7',
    glow: 'rgba(109, 58, 232, 0.32)',
    status: '#F2A33C',
    codeBg: '#221C2C',
    codeFg: '#EBE6F4',
  },
  // ── Citrus · cream + tangerine ──
  citrus: {
    background: '#FFFBF2',
    card: '#FFFFFF',
    border: '#F2E3CC',
    text: '#292018',
    textMuted: '#5D5345',
    textDark: '#9C8F7E',
    bubbleUser: '#FFEED6',
    bubbleUserBorder: '#F5D8A6',
    bubbleAssistant: '#F7F1E7',
    bubbleAssistantBorder: '#EAE0D2',
    skyTop: '#FFF1DA',
    skyBottom: '#FFFBF2',
    glass: 'rgba(255, 255, 255, 0.92)',
    glassBorder: '#F2E3CC',
    aurora1: '#F0740A',
    aurora2: '#FDBD6D',
    glow: 'rgba(240, 116, 10, 0.3)',
    status: '#F2A33C',
    codeBg: '#2C2317',
    codeFg: '#FFF3DF',
  },
  // ── Aquatic · mint mist + deep teal ──
  aquatic: {
    background: '#F2FAF9',
    card: '#FFFFFF',
    border: '#D5EAE7',
    text: '#112726',
    textMuted: '#4C6866',
    textDark: '#87A8A5',
    bubbleUser: '#D2F7EE',
    bubbleUserBorder: '#ABE7DA',
    bubbleAssistant: '#EEF5F4',
    bubbleAssistantBorder: '#E0EAE8',
    skyTop: '#E5F6F4',
    skyBottom: '#F2FAF9',
    glass: 'rgba(255, 255, 255, 0.92)',
    glassBorder: '#D5EAE7',
    aurora1: '#0A8F7F',
    aurora2: '#5BDEC8',
    glow: 'rgba(10, 143, 127, 0.3)',
    status: '#E6A93C',
    codeBg: '#0F2624',
    codeFg: '#D8F5EF',
  },
  // ── Sunset · blush + coral ember ──
  sunset: {
    background: '#FFF6F4',
    card: '#FFFFFF',
    border: '#F5DCD5',
    text: '#2B1614',
    textMuted: '#6E4C46',
    textDark: '#AC9A94',
    bubbleUser: '#FFE2DA',
    bubbleUserBorder: '#F9C4B8',
    bubbleAssistant: '#F8EFEA',
    bubbleAssistantBorder: '#EBE3DE',
    skyTop: '#FFE6E0',
    skyBottom: '#FFF6F4',
    glass: 'rgba(255, 255, 255, 0.92)',
    glassBorder: '#F5DCD5',
    aurora1: '#D9482B',
    aurora2: '#FFB39F',
    glow: 'rgba(217, 72, 43, 0.3)',
    status: '#F2A33C',
    codeBg: '#301713',
    codeFg: '#FFE6DD',
  },
  // ── Noir · true black + neon lavender (AMOLED) ──
  noir: {
    background: '#000000',
    card: '#141419',
    border: '#26262E',
    text: '#F1EEF7',
    textMuted: '#A8A5B5',
    textDark: '#5E5B6B',
    bubbleUser: '#1D1B26',
    bubbleUserBorder: '#2D2A3A',
    bubbleAssistant: '#17161D',
    bubbleAssistantBorder: '#26262E',
    skyTop: '#000000',
    skyBottom: '#0B0A10',
    glass: 'rgba(255, 255, 255, 0.05)',
    glassBorder: '#26262E',
    aurora1: '#B87BF2',
    aurora2: '#E3CDFA',
    glow: 'rgba(184, 123, 242, 0.34)',
    status: '#E3CDFA',
    codeBg: '#0A090D',
    codeFg: '#E7E2F2',
  },
};

export interface AuroraGradient {
  acc1: string;
  acc2: string;
  glow: string;
  onAccent: string;
}

// Accent = energy override; falls back to the scheme's signature pair.
export function getAurora(
  accentColor?: AccentName,
  theme?: ThemeName
): AuroraGradient {
  if (accentColor && ACCENT_AURORA[accentColor]) {
    const [acc1, acc2] = ACCENT_AURORA[accentColor];
    return { acc1, acc2, glow: hexToRgba(acc1, 0.35), onAccent: getContrastForeground(acc1) };
  }
  const t = (theme && THEME_COLORS[theme]) || undefined;
  const acc1 = t?.aurora1 ?? THEME_COLORS.berry.aurora1;
  const acc2 = t?.aurora2 ?? THEME_COLORS.berry.aurora2;
  return {
    acc1,
    acc2,
    glow: t?.glow ?? THEME_COLORS.berry.glow,
    onAccent: getContrastForeground(acc1),
  };
}

export const FONT_SIZES = {
  small: {
    text: 12,
    sub: 10,
    title: 16,
    logo: 24,
  },
  medium: {
    text: 14,
    sub: 12,
    title: 20,
    logo: 32,
  },
  large: {
    text: 17,
    sub: 14,
    title: 24,
    logo: 38,
  },
};

export type FontSizes = (typeof FONT_SIZES)[keyof typeof FONT_SIZES];
