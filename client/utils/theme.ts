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

// Aurora "energy": each accent carries a two-stop gradient that tints the
// send button, streaming stripe, user bubble, glow, and active states.
// Curated with warm jewel tones and champagne highlights (interior.dev luxury aesthetic).
export const ACCENT_AURORA: Record<keyof typeof ACCENT_COLORS, [string, string]> = {
  amber: ['#d97706', '#fcd34d'],
  orange: ['#ea580c', '#fdba74'],
  emerald: ['#059669', '#6ee7b7'],
  indigo: ['#4f46e5', '#a5b4fc'],
  violet: ['#7c3aed', '#c4b5fd'],
  rose: ['#e11d48', '#fda4af'],
  pink: ['#db2777', '#f9a8d4'],
  blue: ['#0284c7', '#7dd3fc'],
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
  return yiq >= 140 ? '#0e0d0b' : '#ffffff';
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
  // Warm Stone / Amber Aurora (Signature interior.dev warm luxury tech)
  deep: {
    background: '#0e0d0b',
    card: '#1c1917',
    border: '#2c2724',
    text: '#f5f2eb',
    textMuted: '#a8a196',
    textDark: '#6e675e',
    bubbleUser: '#292524',
    bubbleUserBorder: '#3d3835',
    bubbleAssistant: 'rgba(217, 169, 109, 0.05)',
    bubbleAssistantBorder: 'rgba(217, 169, 109, 0.16)',
    skyTop: '#0e0d0b',
    skyBottom: '#171513',
    glass: 'rgba(245, 242, 235, 0.045)',
    glassBorder: 'rgba(245, 242, 235, 0.10)',
    aurora1: '#d97706',
    aurora2: '#fbbf24',
    glow: 'rgba(217, 119, 6, 0.35)',
    status: '#fbbf24',
    codeBg: 'rgba(14, 13, 11, 0.72)',
    codeFg: '#f5f2eb',
  },
  // Mineral Slate / Editorial Charcoal
  slate: {
    background: '#0c0e12',
    card: '#1a202a',
    border: '#2c3545',
    text: '#f3f6fa',
    textMuted: '#9daec2',
    textDark: '#627285',
    bubbleUser: '#1f2733',
    bubbleUserBorder: '#364356',
    bubbleAssistant: 'rgba(125, 178, 235, 0.055)',
    bubbleAssistantBorder: 'rgba(125, 178, 235, 0.18)',
    skyTop: '#0c0e12',
    skyBottom: '#141820',
    glass: 'rgba(200, 220, 245, 0.045)',
    glassBorder: 'rgba(200, 220, 245, 0.11)',
    aurora1: '#60a5fa',
    aurora2: '#93c5fd',
    glow: 'rgba(96, 165, 250, 0.38)',
    status: '#93c5fd',
    codeBg: 'rgba(12, 14, 18, 0.7)',
    codeFg: '#dbeafe',
  },
  // Terracotta Glow / Solar Flare
  cyberpunk: {
    background: '#0c0706',
    card: '#1e110d',
    border: '#3a2018',
    text: '#fdf6f3',
    textMuted: '#bfa79f',
    textDark: '#7e6962',
    bubbleUser: '#22120e',
    bubbleUserBorder: '#43241b',
    bubbleAssistant: 'rgba(224, 90, 54, 0.06)',
    bubbleAssistantBorder: 'rgba(224, 90, 54, 0.22)',
    skyTop: '#0c0706',
    skyBottom: '#180d0a',
    glass: 'rgba(255, 170, 140, 0.045)',
    glassBorder: 'rgba(255, 170, 140, 0.12)',
    aurora1: '#e05a36',
    aurora2: '#f59e0b',
    glow: 'rgba(224, 90, 54, 0.42)',
    status: '#f97316',
    codeBg: 'rgba(12, 7, 6, 0.7)',
    codeFg: '#ffe4db',
  },
  // Espresso Noir / Pure Velvet (True deep luxury dark)
  oled: {
    background: '#000000',
    card: '#0f0e0d',
    border: '#23201d',
    text: '#faf8f5',
    textMuted: '#a39e97',
    textDark: '#6b6660',
    bubbleUser: '#141210',
    bubbleUserBorder: '#262320',
    bubbleAssistant: 'rgba(250, 248, 245, 0.035)',
    bubbleAssistantBorder: 'rgba(250, 248, 245, 0.12)',
    skyTop: '#000000',
    skyBottom: '#090807',
    glass: 'rgba(255, 255, 255, 0.035)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    aurora1: '#e2b170',
    aurora2: '#f6d59b',
    glow: 'rgba(226, 177, 112, 0.3)',
    status: '#f6d59b',
    codeBg: 'rgba(5, 5, 5, 0.75)',
    codeFg: '#f5f0e6',
  },
  // Dusk Plum / Velvet Amethyst
  dracula: {
    background: '#0f0a14',
    card: '#221530',
    border: '#3d2654',
    text: '#faf5ff',
    textMuted: '#bca8cf',
    textDark: '#776388',
    bubbleUser: '#271937',
    bubbleUserBorder: '#4b2f68',
    bubbleAssistant: 'rgba(168, 85, 247, 0.06)',
    bubbleAssistantBorder: 'rgba(168, 85, 247, 0.2)',
    skyTop: '#0f0a14',
    skyBottom: '#1a1024',
    glass: 'rgba(230, 200, 255, 0.045)',
    glassBorder: 'rgba(230, 200, 255, 0.12)',
    aurora1: '#a855f7',
    aurora2: '#f472b6',
    glow: 'rgba(168, 85, 247, 0.4)',
    status: '#c084fc',
    codeBg: 'rgba(15, 10, 20, 0.7)',
    codeFg: '#f3e8ff',
  },
  // Velvet Emerald / Forest Moss
  nordic: {
    background: '#070f0c',
    card: '#13241e',
    border: '#213930',
    text: '#f2faf6',
    textMuted: '#9cbab0',
    textDark: '#628076',
    bubbleUser: '#152922',
    bubbleUserBorder: '#27483c',
    bubbleAssistant: 'rgba(16, 185, 129, 0.06)',
    bubbleAssistantBorder: 'rgba(16, 185, 129, 0.2)',
    skyTop: '#070f0c',
    skyBottom: '#0f1b16',
    glass: 'rgba(160, 240, 210, 0.045)',
    glassBorder: 'rgba(160, 240, 210, 0.11)',
    aurora1: '#10b981',
    aurora2: '#6ee7b7',
    glow: 'rgba(16, 185, 129, 0.38)',
    status: '#34d399',
    codeBg: 'rgba(7, 15, 12, 0.7)',
    codeFg: '#d1fae5',
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
    return { acc1, acc2, glow: hexToRgba(acc1, 0.4), onAccent: getContrastForeground(acc1) };
  }
  const t = theme ? THEME_COLORS[theme] : undefined;
  const acc1 = t?.aurora1 ?? '#d97706';
  const acc2 = t?.aurora2 ?? '#fbbf24';
  return {
    acc1,
    acc2,
    glow: t?.glow ?? 'rgba(217, 119, 6, 0.35)',
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
