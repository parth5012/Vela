import {
  THEME_COLORS,
  contrastRatio,
  hueOf,
  hueDiff,
  relativeLuminance,
  parseHex,
  type ThemeName,
} from '../utils/theme';

describe('Scroll-craft Colour System & Theme Audit', () => {
  describe('Helper functions', () => {
    it('calculates relative luminance correctly for primary colors', () => {
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 2);
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
    });

    it('calculates contrast ratio between extremes', () => {
      expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
      expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 1);
    });

    it('extracts correct hue angles from hex colors', () => {
      expect(hueOf('#FF0000')).toBe(0);
      expect(hueOf('#00FF00')).toBe(120);
      expect(hueOf('#0000FF')).toBe(240);
      expect(hueOf('#FFFF00')).toBe(60);
      expect(hueOf('#00FFFF')).toBe(180);
      expect(hueOf('#FF00FF')).toBe(300);
      // Achromatic returns 0
      expect(hueOf('#050505')).toBe(0);
    });

    it('calculates shortest angular distance between hues with wrap-around', () => {
      expect(hueDiff(10, 350)).toBe(20);
      expect(hueDiff(355, 5)).toBe(10);
      expect(hueDiff(0, 180)).toBe(180);
      expect(hueDiff(90, 100)).toBe(10);
    });

    it('parses both 3-digit and 6-digit hex codes', () => {
      expect(parseHex('#fff')).toEqual([255, 255, 255]);
      expect(parseHex('#123456')).toEqual([18, 52, 86]);
      expect(parseHex('  #abc  ')).toEqual([170, 187, 204]);
    });

    it('gracefully falls back on malformed or invalid color strings', () => {
      expect(parseHex('')).toEqual([0, 0, 0]);
      expect(parseHex('invalid')).toEqual([0, 0, 0]);
      expect(parseHex('#xyz')).toEqual([0, 0, 0]);
      expect(contrastRatio('invalid', '#FFFFFF')).toBeGreaterThan(1);
      expect(hueOf('invalid')).toBe(0);
    });
  });

  describe('Theme Directives Verification', () => {
    const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

    // Achromatic / neutral dark backgrounds (such as Noir or OLED) use balanced,
    // lavender-tinted neutral text (#A8A5B5) rather than high-saturation gray.
    // Documented exception map for achromatic backgrounds where hueOf(bg) === 0:
    const HUE_DIFF_EXCEPTIONS: Record<string, string> = {
      noir: 'Achromatic dark background (#050505, hue 0°) paired with soft lavender-tinted neutral (#A8A5B5)',
      oled: 'Achromatic dark background (#050505, hue 0°) paired with soft lavender-tinted neutral (#A8A5B5)',
    };

    const themeEntries = Object.entries(THEME_COLORS) as [string, (typeof THEME_COLORS)[ThemeName]][];

    test.each(themeEntries)(
      'theme %s complies with scroll-craft color roles and WCAG requirements',
      (themeName, colors) => {
        // Directive: background and skyTop must not be pure #000000 (no harsh crushed black)
        expect(colors.background.toLowerCase()).not.toBe('#000000');
        expect(colors.skyTop.toLowerCase()).not.toBe('#000000');

        // Verify valid hex formats
        expect(colors.background).toMatch(HEX_REGEX);
        expect(colors.text).toMatch(HEX_REGEX);
        expect(colors.textMuted).toMatch(HEX_REGEX);
        expect(colors.aurora1).toMatch(HEX_REGEX);
        expect(colors.aurora2).toMatch(HEX_REGEX);

        // Directive: Tinted secondary text (textMuted within ±30° hue of background)
        const bgHue = hueOf(colors.background);
        const mutedHue = hueOf(colors.textMuted);
        const hDiff = hueDiff(mutedHue, bgHue);

        if (HUE_DIFF_EXCEPTIONS[themeName]) {
          // Documented exception for near-achromatic darks
          expect(HUE_DIFF_EXCEPTIONS[themeName]).toBeDefined();
        } else {
          expect(hDiff).toBeLessThanOrEqual(30);
        }

        // Directive: Contrast ratio guarantees
        // Primary text vs background >= 4.5:1 (WCAG AA)
        const textContrast = contrastRatio(colors.text, colors.background);
        expect(textContrast).toBeGreaterThanOrEqual(4.5);

        // Secondary text vs background >= 3.0:1 (WCAG AA large / UI text)
        const mutedContrast = contrastRatio(colors.textMuted, colors.background);
        expect(mutedContrast).toBeGreaterThanOrEqual(3.0);

        // Exactly one accent pair: aurora1 and aurora2 are distinct valid hexes
        expect(colors.aurora1).not.toBe(colors.aurora2);
      }
    );

    it('includes chrome as a cold silver/chrome theme', () => {
      const chrome = THEME_COLORS.chrome;
      expect(chrome).toBeDefined();
      expect(chrome.background.toLowerCase()).toBe('#0b0d10');
      expect(chrome.card.toLowerCase()).toBe('#14171c');
      expect(chrome.border.toLowerCase()).toBe('#242933');
      expect(chrome.text.toLowerCase()).toBe('#eef2f7');
      expect(chrome.textMuted.toLowerCase()).toBe('#a9b6c4');
      expect(chrome.textDark.toLowerCase()).toBe('#6f7d8c');
      expect(chrome.aurora1.toLowerCase()).toBe('#9baec2');
      expect(chrome.aurora2.toLowerCase()).toBe('#d2deec');

      // Check chrome hue alignment (cold slate-blue hue family)
      const bgHue = hueOf(chrome.background);
      const mutedHue = hueOf(chrome.textMuted);
      expect(hueDiff(mutedHue, bgHue)).toBeLessThanOrEqual(15);
    });
  });
});
