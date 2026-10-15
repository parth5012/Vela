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
    background: '#09090b',
    card: '#121215',
    border: '#27272a',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    textDark: '#71717a',
    bubbleUser: '#18181b',
    bubbleUserBorder: '#27272a',
    bubbleAssistant: 'rgba(255, 255, 255, 0.03)',
    bubbleAssistantBorder: 'rgba(255, 255, 255, 0.08)',
    skyTop: '#09090b',
    skyBottom: '#0e0e12',
    glass: 'rgba(255, 255, 255, 0.035)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    aurora1: '#6366f1',
    aurora2: '#818cf8',
    glow: 'rgba(99, 102, 241, 0.25)',
    status: '#818cf8',
    codeBg: '#0d0d11',
    codeFg: '#e4e4e7',
  },
  slate: {
    background: '#070b12',
    card: '#0f172a',
    border: '#1e293b',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    textDark: '#64748b',
    bubbleUser: '#0f172a',
    bubbleUserBorder: '#1e293b',
    bubbleAssistant: 'rgba(56, 189, 248, 0.03)',
    bubbleAssistantBorder: 'rgba(56, 189, 248, 0.12)',
    skyTop: '#070b12',
    skyBottom: '#0c1322',
    glass: 'rgba(148, 163, 184, 0.04)',
    glassBorder: 'rgba(148, 163, 184, 0.10)',
    aurora1: '#38bdf8',
    aurora2: '#7dd3fc',
    glow: 'rgba(56, 189, 248, 0.25)',
    status: '#38bdf8',
    codeBg: '#090e17',
    codeFg: '#e2e8f0',
  },
  cyberpunk: {
    background: '#050508',
    card: '#0e0d16',
    border: '#262238',
    text: '#f5f3ff',
    textMuted: '#a78bfa',
    textDark: '#6d5d9a',
    bubbleUser: '#0e0d16',
    bubbleUserBorder: '#3b2d54',
    bubbleAssistant: 'rgba(217, 70, 239, 0.03)',
    bubbleAssistantBorder: 'rgba(217, 70, 239, 0.15)',
    skyTop: '#050508',
    skyBottom: '#0f0a1c',
    glass: 'rgba(217, 70, 239, 0.035)',
    glassBorder: 'rgba(217, 70, 239, 0.12)',
    aurora1: '#d946ef',
    aurora2: '#06b6d4',
    glow: 'rgba(217, 70, 239, 0.28)',
    status: '#06b6d4',
    codeBg: '#090712',
    codeFg: '#e9d5ff',
  },
  oled: {
    background: '#000000',
    card: '#09090b',
    border: '#18181b',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    textDark: '#52525b',
    bubbleUser: '#09090b',
    bubbleUserBorder: '#27272a',
    bubbleAssistant: 'rgba(255, 255, 255, 0.02)',
    bubbleAssistantBorder: 'rgba(255, 255, 255, 0.07)',
    skyTop: '#000000',
    skyBottom: '#040405',
    glass: 'rgba(255, 255, 255, 0.03)',
    glassBorder: 'rgba(255, 255, 255, 0.07)',
    aurora1: '#f4f4f5',
    aurora2: '#a1a1aa',
    glow: 'rgba(255, 255, 255, 0.15)',
    status: '#e4e4e7',
    codeBg: '#050507',
    codeFg: '#f4f4f5',
  },
  dracula: {
    background: '#0b0a12',
    card: '#161424',
    border: '#28243d',
    text: '#f8f8f2',
    textMuted: '#b8b5d1',
    textDark: '#6272a4',
    bubbleUser: '#161424',
    bubbleUserBorder: '#28243d',
    bubbleAssistant: 'rgba(189, 147, 249, 0.03)',
    bubbleAssistantBorder: 'rgba(189, 147, 249, 0.14)',
    skyTop: '#0b0a12',
    skyBottom: '#141220',
    glass: 'rgba(189, 147, 249, 0.035)',
    glassBorder: 'rgba(189, 147, 249, 0.12)',
    aurora1: '#bd93f9',
    aurora2: '#ff79c6',
    glow: 'rgba(189, 147, 249, 0.28)',
    status: '#ff79c6',
    codeBg: '#0f0d1a',
    codeFg: '#f8f8f2',
  },
  nordic: {
    background: '#060b10',
    card: '#0e1722',
    border: '#1c2b3c',
    text: '#eceff4',
    textMuted: '#88c0d0',
    textDark: '#4c566a',
    bubbleUser: '#0e1722',
    bubbleUserBorder: '#1c2b3c',
    bubbleAssistant: 'rgba(136, 192, 208, 0.03)',
    bubbleAssistantBorder: 'rgba(136, 192, 208, 0.14)',
    skyTop: '#060b10',
    skyBottom: '#0c1520',
    glass: 'rgba(136, 192, 208, 0.035)',
    glassBorder: 'rgba(136, 192, 208, 0.12)',
    aurora1: '#88c0d0',
    aurora2: '#81a1c1',
    glow: 'rgba(136, 192, 208, 0.28)',
    status: '#88c0d0',
    codeBg: '#091018',
    codeFg: '#e5e9f0',
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
