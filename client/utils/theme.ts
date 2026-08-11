export const ACCENT_COLORS = {
  indigo: '#6366f1',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316',
  blue: '#3b82f6',
};

// Aurora "energy": each accent carries a two-stop gradient that tints the
// send button, streaming stripe, user bubble, glow, and active states.
export const ACCENT_AURORA: Record<keyof typeof ACCENT_COLORS, [string, string]> = {
  indigo: ['#6366f1', '#a5b4fc'],
  violet: ['#8b5cf6', '#c4b5fd'],
  blue: ['#3b82f6', '#60a5fa'],
  emerald: ['#10b981', '#6ee7b7'],
  rose: ['#f43f5e', '#fda4af'],
  pink: ['#ec4899', '#f9a8d4'],
  amber: ['#f59e0b', '#fcd34d'],
  orange: ['#f97316', '#fdba74'],
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type AccentName = keyof typeof ACCENT_COLORS;
export type ThemeName = 'deep' | 'slate' | 'cyberpunk' | 'oled' | 'dracula' | 'nordic';

// Aurora tokens: sky = background gradient stops, glass = surface color,
// glassBorder = hairline border, aurora = the theme's signature gradient pair.
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
  deep: {
    background: '#0b0b1a',
    card: '#18181b',
    border: '#27272a',
    text: '#e9e7f8',
    textMuted: '#a9a6c8',
    textDark: '#7b7899',
    bubbleUser: '#18181b',
    bubbleUserBorder: '#27272a',
    bubbleAssistant: 'rgba(139, 124, 246, 0.05)',
    bubbleAssistantBorder: 'rgba(139, 124, 246, 0.2)',
    skyTop: '#0b0b1a',
    skyBottom: '#14142c',
    glass: 'rgba(255, 255, 255, 0.055)',
    glassBorder: 'rgba(255, 255, 255, 0.13)',
    aurora1: '#8b7cf6',
    aurora2: '#7dd3fc',
    glow: 'rgba(139, 124, 246, 0.45)',
    status: '#7dd3fc',
    codeBg: 'rgba(6, 6, 18, 0.5)',
    codeFg: '#cfd8ff',
  },
  slate: {
    background: '#0a101c',
    card: '#1e293b',
    border: '#334155',
    text: '#e9f0fb',
    textMuted: '#a5b3c8',
    textDark: '#6f7d92',
    bubbleUser: '#1e293b',
    bubbleUserBorder: '#334155',
    bubbleAssistant: 'rgba(95, 143, 214, 0.05)',
    bubbleAssistantBorder: 'rgba(95, 143, 214, 0.2)',
    skyTop: '#0a101c',
    skyBottom: '#101a2b',
    glass: 'rgba(190, 215, 245, 0.05)',
    glassBorder: 'rgba(190, 215, 245, 0.12)',
    aurora1: '#5f8fd6',
    aurora2: '#9cc7ee',
    glow: 'rgba(95, 143, 214, 0.4)',
    status: '#9cc7ee',
    codeBg: 'rgba(6, 12, 24, 0.5)',
    codeFg: '#c3d4ea',
  },
  cyberpunk: {
    background: '#080010',
    card: '#14002c',
    border: '#f59e0b',
    text: '#f2ecff',
    textMuted: '#c4b3e8',
    textDark: '#8a7bb8',
    bubbleUser: '#14002c',
    bubbleUserBorder: '#ff00ff',
    bubbleAssistant: 'rgba(255, 43, 214, 0.05)',
    bubbleAssistantBorder: 'rgba(255, 43, 214, 0.2)',
    skyTop: '#080010',
    skyBottom: '#19032e',
    glass: 'rgba(255, 120, 255, 0.05)',
    glassBorder: 'rgba(255, 90, 255, 0.15)',
    aurora1: '#ff2bd6',
    aurora2: '#00ffcc',
    glow: 'rgba(255, 43, 214, 0.5)',
    status: '#00ffcc',
    codeBg: 'rgba(10, 0, 24, 0.6)',
    codeFg: '#e8d9ff',
  },
  oled: {
    background: '#000000',
    card: '#09090b',
    border: '#18181b',
    text: '#f4f4f8',
    textMuted: '#b0b0c0',
    textDark: '#7a7a88',
    bubbleUser: '#09090b',
    bubbleUserBorder: '#18181b',
    bubbleAssistant: 'rgba(155, 140, 246, 0.03)',
    bubbleAssistantBorder: 'rgba(155, 140, 246, 0.15)',
    skyTop: '#000000',
    skyBottom: '#060614',
    glass: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
    aurora1: '#9b8cf6',
    aurora2: '#9fd8f0',
    glow: 'rgba(155, 140, 246, 0.35)',
    status: '#9fd8f0',
    codeBg: 'rgba(0, 0, 0, 0.6)',
    codeFg: '#d6dcf2',
  },
  dracula: {
    background: '#100d1d',
    card: '#44475a',
    border: '#6272a4',
    text: '#f3ecf8',
    textMuted: '#c2b0d6',
    textDark: '#8579a8',
    bubbleUser: '#44475a',
    bubbleUserBorder: '#6272a4',
    bubbleAssistant: 'rgba(189, 147, 249, 0.05)',
    bubbleAssistantBorder: 'rgba(189, 147, 249, 0.2)',
    skyTop: '#100d1d',
    skyBottom: '#1c1230',
    glass: 'rgba(240, 220, 255, 0.05)',
    glassBorder: 'rgba(220, 190, 255, 0.13)',
    aurora1: '#bd93f9',
    aurora2: '#ff79c6',
    glow: 'rgba(189, 147, 249, 0.45)',
    status: '#ff79c6',
    codeBg: 'rgba(14, 8, 26, 0.55)',
    codeFg: '#dcc8f2',
  },
  nordic: {
    background: '#0a141c',
    card: '#3b4252',
    border: '#4c566a',
    text: '#e8f4f6',
    textMuted: '#9fc3cc',
    textDark: '#6f8a92',
    bubbleUser: '#3b4252',
    bubbleUserBorder: '#4c566a',
    bubbleAssistant: 'rgba(111, 196, 205, 0.05)',
    bubbleAssistantBorder: 'rgba(111, 196, 205, 0.2)',
    skyTop: '#0a141c',
    skyBottom: '#0e1c28',
    glass: 'rgba(200, 240, 245, 0.05)',
    glassBorder: 'rgba(170, 220, 230, 0.12)',
    aurora1: '#6fc4cd',
    aurora2: '#9fd8f0',
    glow: 'rgba(111, 196, 205, 0.42)',
    status: '#9fd8f0',
    codeBg: 'rgba(6, 16, 24, 0.55)',
    codeFg: '#c0dbe4',
  },
};

export interface AuroraGradient {
  acc1: string;
  acc2: string;
  glow: string;
  onAccent: string;
}

// Theme = atmosphere, accent = energy. Resolve the aurora gradient that the
// accent owns; falls back to the theme's signature pair when accent is absent.
export function getAurora(
  accentColor?: AccentName,
  theme?: ThemeName
): AuroraGradient {
  if (accentColor && ACCENT_AURORA[accentColor]) {
    const [acc1, acc2] = ACCENT_AURORA[accentColor];
    return { acc1, acc2, glow: hexToRgba(acc1, 0.45), onAccent: '#0b0b1a' };
  }
  const t = theme ? THEME_COLORS[theme] : undefined;
  return {
    acc1: t?.aurora1 ?? '#8b7cf6',
    acc2: t?.aurora2 ?? '#7dd3fc',
    glow: t?.glow ?? 'rgba(139, 124, 246, 0.45)',
    onAccent: '#0b0b1a',
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
