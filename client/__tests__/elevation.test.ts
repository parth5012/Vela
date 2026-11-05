import {
  DEFAULT_ELEVATION,
  DEFAULT_CANVAS,
  edgeLight,
  getElevation,
  tintedShadowColor,
} from '../utils/elevation';

const LEVELS = ['e1', 'e2', 'e3'] as const;

describe('Scroll-craft depth system (WF-447-03)', () => {
  it('exports exactly three elevation tokens', () => {
    expect(Object.keys(DEFAULT_ELEVATION).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it.each([...LEVELS])('%s shadowColor is tinted to the canvas hue, never pure black', (key) => {
    const lvl = DEFAULT_ELEVATION[key];
    expect(lvl.shadowColor.toLowerCase()).not.toBe('#000000');
    expect(lvl.shadowColor.toLowerCase()).not.toBe('#000');
    // Tint of the default canvas is a very dark, non-black gray.
    expect(tintedShadowColor(DEFAULT_CANVAS).startsWith('#0c')).toBe(true);
  });

  it('never returns pure black even for a black canvas', () => {
    const tint = tintedShadowColor('#000000');
    expect(tint.toLowerCase()).not.toBe('#000000');
    expect(tint.toLowerCase()).not.toBe('#000');
    expect(tint.startsWith('#0c0c0c')).toBe(true);
  });

  it('offset, opacity, radius and elevation increase monotonically e1 → e3', () => {
    for (let i = 0; i < LEVELS.length - 1; i++) {
      const cur = DEFAULT_ELEVATION[LEVELS[i]];
      const next = DEFAULT_ELEVATION[LEVELS[i + 1]];
      expect(next.shadowOffset.height).toBeGreaterThan(cur.shadowOffset.height);
      expect(next.shadowOpacity).toBeGreaterThan(cur.shadowOpacity);
      expect(next.shadowRadius).toBeGreaterThan(cur.shadowRadius);
      expect(next.elevation).toBeGreaterThan(cur.elevation);
    }
  });

  it('matches the directive values exactly', () => {
    expect(DEFAULT_ELEVATION.e1).toMatchObject({
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 4,
      elevation: 2,
    });
    expect(DEFAULT_ELEVATION.e2).toMatchObject({
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.24,
      shadowRadius: 10,
      elevation: 4,
    });
    expect(DEFAULT_ELEVATION.e3).toMatchObject({
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.32,
      shadowRadius: 18,
      elevation: 8,
    });
  });

  it('shadows are tinted to the canvas, not fixed gray', () => {
    const warm = getElevation('sunset', '#FFF6F4');
    const cool = getElevation('chrome', '#0B0D10');
    expect(warm.e2.shadowColor).not.toBe(cool.e2.shadowColor);
    // Same shadow geometry regardless of canvas — only the tint varies (plus
    // identical across levels by construction).
    expect(warm.e2.shadowOpacity).toBe(cool.e2.shadowOpacity);
  });

  it('edgeLight is a 1px top border at 8% white', () => {
    expect(edgeLight).toEqual({
      borderTopWidth: 1,
      borderTopColor: 'rgba(255, 255, 255, 0.08)',
    });
  });
});
