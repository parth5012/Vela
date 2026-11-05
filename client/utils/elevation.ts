/**
 * Scroll-craft depth system (WF-447-03).
 *
 * Three elevation steps and no more — if everything is elevated, nothing is.
 * Every shadow is tinted to the canvas hue, never pure `#000000`, so shadows
 * read as depth rather than dirt on dark grounds.
 */
import { parseHex } from './theme';

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ElevationLevels {
  e1: ShadowStyle;
  e2: ShadowStyle;
  e3: ShadowStyle;
}

/** Fallback canvas for static stylesheets that have no runtime theme access. */
export const DEFAULT_CANVAS = '#15121C';

/**
 * Shadow tint: same hue family as the canvas, scaled down to a very dark
 * value. Channels are clamped above zero so a black canvas still yields a
 * faintly warm shadow, never pure `#000000`.
 */
export function tintedShadowColor(canvasHex: string): string {
  const [r, g, b] = parseHex(canvasHex);
  // ~8% of canvas brightness, floor 12 per channel.
  const scale = (v: number) => Math.max(12, Math.round(v * 0.08));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(scale(r))}${toHex(scale(g))}${toHex(scale(b))}`;
}

const LEVELS = [
  { key: 'e1', offsetY: 2, opacity: 0.18, radius: 4, elevation: 2 },
  { key: 'e2', offsetY: 4, opacity: 0.24, radius: 10, elevation: 4 },
  { key: 'e3', offsetY: 8, opacity: 0.32, radius: 18, elevation: 8 },
] as const;

/**
 * The three elevation steps, shadows tinted to the given canvas.
 * `theme` is part of the API for orientation (future per-theme tuning) but the
 * directive fixes identical offset/opacity/radius values for all themes.
 */
export function getElevation(theme: string | undefined, canvasHex: string): ElevationLevels {
  const tint = tintedShadowColor(canvasHex);
  const build = (lvl: (typeof LEVELS)[number]): ShadowStyle => ({
    shadowColor: tint,
    shadowOffset: { width: 0, height: lvl.offsetY },
    shadowOpacity: lvl.opacity,
    shadowRadius: lvl.radius,
    elevation: lvl.elevation,
  });
  return { e1: build(LEVELS[0]), e2: build(LEVELS[1]), e3: build(LEVELS[2]) };
}

/** Static default elevation for stylesheets without theme access. */
export const DEFAULT_ELEVATION: ElevationLevels = getElevation(undefined, DEFAULT_CANVAS);

/**
 * 1px top edge highlight for raised cards — reads as a bevel catching light
 * at 8% alpha, subtle enough to disappear on light grounds.
 */
export const edgeLight: { borderTopWidth: number; borderTopColor: string } = {
  borderTopWidth: 1,
  borderTopColor: 'rgba(255, 255, 255, 0.08)',
};
