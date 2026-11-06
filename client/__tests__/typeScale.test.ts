import {
  FONT_SIZES,
  FONTS,
  getTypeScale,
  isDarkTheme,
  type FontSizes,
  type ThemeName,
} from '../utils/theme';

const TYPE_KEYS = Object.keys(FONT_SIZES) as (keyof typeof FONT_SIZES)[];

const LIGHT_THEMES: ThemeName[] = ['berry', 'citrus', 'aquatic', 'sunset'];
const DARK_THEMES: ThemeName[] = ['noir', 'chrome'];

describe('Scroll-craft type scale (WF-447-02)', () => {
  describe('FONT_SIZES entries', () => {
    it('every size tier carries lineHeight, subLineHeight and tracking tokens', () => {
      for (const key of TYPE_KEYS) {
        const entry = FONT_SIZES[key] as Partial<FontSizes>;
        expect(entry.lineHeight).toBeDefined();
        expect(entry.subLineHeight).toBeDefined();
        expect(entry.letterSpacing).toBeDefined();
        expect(entry.titleLetterSpacing).toBeDefined();
        expect(entry.logoLetterSpacing).toBeDefined();
      }
    });

    it('matches the directive values for body sizes and tracking ramp', () => {
      expect(FONT_SIZES.small.text).toBe(12);
      expect(FONT_SIZES.small.lineHeight).toBe(18);
      expect(FONT_SIZES.small.letterSpacing).toBe(0.1);

      expect(FONT_SIZES.medium.text).toBe(14);
      expect(FONT_SIZES.medium.lineHeight).toBe(21);
      expect(FONT_SIZES.medium.letterSpacing).toBe(0.1);

      expect(FONT_SIZES.large.text).toBe(17);
      expect(FONT_SIZES.large.lineHeight).toBe(26);
      expect(FONT_SIZES.large.letterSpacing).toBe(0);
    });

    it('body line-height ratio is ≥ 1.5 for text and sub at every size', () => {
      for (const key of TYPE_KEYS) {
        const entry = FONT_SIZES[key] as Required<FontSizes>;
        expect(entry.lineHeight / entry.text).toBeGreaterThanOrEqual(1.5);
        expect(entry.subLineHeight / entry.sub).toBeGreaterThanOrEqual(1.5);
      }
    });

    it('display tracking tightens monotonically as size grows', () => {
      for (const key of TYPE_KEYS) {
        const entry = FONT_SIZES[key] as Required<FontSizes>;
        expect(entry.titleLetterSpacing).toBeLessThan(0);
        expect(entry.logoLetterSpacing).toBeLessThanOrEqual(entry.titleLetterSpacing);
      }
      expect(FONT_SIZES.small.titleLetterSpacing).toBeGreaterThanOrEqual(
        FONT_SIZES.medium.titleLetterSpacing
      );
      expect(FONT_SIZES.medium.titleLetterSpacing).toBeGreaterThanOrEqual(
        FONT_SIZES.large.titleLetterSpacing
      );
      expect(FONT_SIZES.small.logoLetterSpacing).toBeGreaterThanOrEqual(
        FONT_SIZES.medium.logoLetterSpacing
      );
      expect(FONT_SIZES.medium.logoLetterSpacing).toBeGreaterThanOrEqual(
        FONT_SIZES.large.logoLetterSpacing
      );
    });
  });

  describe('getTypeScale', () => {
    it('dark themes compensate: +5% line-height, +0.1 tracking, one weight step heavier', () => {
      for (const theme of DARK_THEMES) {
        const dark = getTypeScale(theme, 'medium') as Required<FontSizes>;
        expect(dark.lineHeight).toBe(22.1);
        expect(dark.lineHeight).toBeGreaterThan(FONT_SIZES.medium.lineHeight);
        expect(dark.subLineHeight).toBeGreaterThan(FONT_SIZES.medium.subLineHeight);
        expect(dark.letterSpacing).toBeCloseTo(0.2, 1);
        expect(dark.letterSpacing).toBeGreaterThan(FONT_SIZES.medium.letterSpacing);
        expect(dark.fontWeight).toBe('500');
      }
    });

    it('light themes return the base values untouched', () => {
      for (const theme of LIGHT_THEMES) {
        const scale = getTypeScale(theme, 'medium') as Required<FontSizes>;
        expect(scale.lineHeight).toBe(FONT_SIZES.medium.lineHeight);
        expect(scale.subLineHeight).toBe(FONT_SIZES.medium.subLineHeight);
        expect(scale.letterSpacing).toBe(FONT_SIZES.medium.letterSpacing);
        expect(scale.titleLetterSpacing).toBe(FONT_SIZES.medium.titleLetterSpacing);
        expect(scale.logoLetterSpacing).toBe(FONT_SIZES.medium.logoLetterSpacing);
        expect(scale.text).toBe(FONT_SIZES.medium.text);
        expect(scale.sub).toBe(FONT_SIZES.medium.sub);
        expect(scale.title).toBe(FONT_SIZES.medium.title);
        expect(scale.logo).toBe(FONT_SIZES.medium.logo);
        expect(scale.fontWeight).toBe('400');
      }
    });

    it('chat body text at medium renders at ≥ 21px line-height for every theme', () => {
      for (const theme of [...LIGHT_THEMES, ...DARK_THEMES]) {
        const scale = getTypeScale(theme, 'medium');
        expect(scale.lineHeight).toBeGreaterThanOrEqual(21);
      }
    });

    it('dark-body ratio stays ≥ 1.5 after compensation', () => {
      for (const theme of DARK_THEMES) {
        for (const key of TYPE_KEYS) {
          const scale = getTypeScale(theme, key) as Required<FontSizes>;
          expect(scale.lineHeight / scale.text).toBeGreaterThanOrEqual(1.5);
          expect(scale.subLineHeight / scale.sub).toBeGreaterThanOrEqual(1.5);
        }
      }
    });

    it('isDarkTheme flags only the dark atmospheres', () => {
      for (const theme of DARK_THEMES) {
        expect(isDarkTheme(theme)).toBe(true);
      }
      for (const theme of LIGHT_THEMES) {
        expect(isDarkTheme(theme)).toBe(false);
      }
      // Legacy alias behaves like noir.
      expect(isDarkTheme('oled' as ThemeName | 'oled')).toBe(true);
    });

    it('returns cached entries with stable identity per (theme, size)', () => {
      for (const theme of [...LIGHT_THEMES, ...DARK_THEMES]) {
        for (const key of TYPE_KEYS) {
          const a = getTypeScale(theme, key);
          const b = getTypeScale(theme, key);
          expect(b).toBe(a); // same reference — memo comparators can rely on identity
        }
      }
      expect(getTypeScale('noir', 'medium')).not.toBe(getTypeScale('berry', 'medium'));
    });
  });

  describe('font families', () => {
    it('references exactly two families: display and text', () => {
      expect(Object.keys(FONTS).sort()).toEqual(['display', 'text']);
      expect(FONTS.display).toBeTruthy();
      expect(FONTS.text).toBeTruthy();
    });
  });
});
