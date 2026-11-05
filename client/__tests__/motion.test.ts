/**
 * WF-447-04 motion invariants.
 *
 * Source-scan assertions keep the codebase honest about the scroll-craft
 * motion floor: ease-out curves only, transform/opacity on the native driver,
 * duration caps, and reduced-motion awareness wired into the animated
 * surfaces. Behavioural assertions live next to the components they guard
 * (collapsible-block-drivers.test.tsx, interactiveStates.test.tsx).
 */
import fs from 'fs';
import path from 'path';
import { EASING, DURATIONS } from '../utils/motion';

// m3Expression morphs SVG geometry (stroke-dasharray, shape radius); these are
// paint/geometry props react-native-svg cannot run on the native driver. Both
// animations are decorative, already ease-out, and documented as the conscious
// exception to the transform/opacity rule.
const NATIVE_DRIVER_EXCEPTIONS = ['components/ui/m3Expression.tsx'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('motion tokens (WF-447-04)', () => {
  it('EASING.out is a deceleration (ease-out) curve: monotonic and front-loaded', () => {
    const curve = EASING.out as (t: number) => number;
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const y = curve(Math.min(t, 1));
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    // Ease-out front-loads motion: halfway through the clock the animation is
    // already past halfway through its travel. An ease-in curve violates this.
    expect(curve(0.5)).toBeGreaterThan(0.5);
  });

  it('durations respect the caps: press 120–180ms, transitions ≤300ms, stagger 30–80ms', () => {
    expect(DURATIONS.press).toBeGreaterThanOrEqual(120);
    expect(DURATIONS.press).toBeLessThanOrEqual(180);
    expect(DURATIONS.reveal).toBeLessThanOrEqual(300);
    expect(DURATIONS.transition).toBeLessThanOrEqual(300);
    expect(DURATIONS.stagger).toBeGreaterThanOrEqual(30);
    expect(DURATIONS.stagger).toBeLessThanOrEqual(80);
  });
});

describe('motion source audit (WF-447-04)', () => {
  const clientRoot = path.join(__dirname, '..');
  const dirs = ['app', 'components', 'hooks', 'utils', 'styles']
    .map((d) => path.join(clientRoot, d))
    .filter((d) => fs.existsSync(d));
  const files = dirs.flatMap((d) => walk(d));
  const rel = (f: string) => path.relative(clientRoot, f).split(path.sep).join('/');

  it('no ease-in usage anywhere (curves or string literals)', () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /Easing\.in\s*\(/.test(src) || /ease-in/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no JS-driver animations outside the documented SVG-geometry exception', () => {
    const offenders = files.filter((f) => {
      if (NATIVE_DRIVER_EXCEPTIONS.includes(rel(f))) return false;
      const src = fs.readFileSync(f, 'utf8');
      return /useNativeDriver:\s*false/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('reduced-motion awareness is wired into the animated surfaces', () => {
    for (const f of [
      'components/ui/PressableScale.tsx',
      'components/chat/CollapsibleBlock.tsx',
      'app/index.tsx',
    ]) {
      const src = fs.readFileSync(path.join(clientRoot, f), 'utf8');
      expect(src).toMatch(/useReducedMotion/);
    }
  });
});
