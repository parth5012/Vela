/**
 * Scroll-craft motion tokens (WF-447-04 / WF-576).
 *
 * Motion is intentional: transform/opacity only, ease-out curves exclusively
 * (decelerate-then-accelerate curves are banned), UI transitions under 300ms.
 * Press feedback lands in 120–180ms; group staggers sit in the 30–80ms window
 * so elements arrive as one gesture.
 */
import { Easing } from 'react-native';

/** Only ease-out curves — nothing should ever decelerate then accelerate. */
export const EASING = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
} as const;

/**
 * Durations in ms. Invariants enforced by motion.test.ts:
 * - press:     120–180
 * - reveal:    ≤ 300 (content expand/collapse)
 * - transition:≤ 300 (screen/surface transitions)
 * - stagger:   30–80 (grouped arrivals)
 */
export const DURATIONS = {
  press: 150,
  reveal: 200,
  transition: 280,
  stagger: 50,
} as const;

/**
 * Codified press scale ladder across all UI components:
 * - badge / icon: 0.94 (small targets need slightly clearer travel)
 * - button: 0.95 (standard button compression)
 * - card / chip: 0.96 (mid-sized surfaces)
 * - row: 0.98 (full-width rows — subtle to avoid text subpixel shimmering)
 */
export const PRESS_SCALE = {
  badge: 0.94,
  button: 0.95,
  card: 0.96,
  row: 0.98,
} as const;

/**
 * Standardized native-driver spring configs with derived damping ratios (ζ = friction / 2√(tension · mass), mass = 1):
 * - snappy: tension 260, friction 26 (ζ ≈ 0.81, crisp mechanical bite, eliminating subpixel text shimmer)
 * - gentle: tension 140, friction 24 (ζ ≈ 1.01, critically damped settle, zero wobble)
 * - pop:    tension 240, friction 16 (ζ ≈ 0.52, celebratory ~15% overshoot for badges and checkmarks)
 */
export const SPRINGS = {
  snappy: { tension: 260, friction: 26, useNativeDriver: true },
  gentle: { tension: 140, friction: 24, useNativeDriver: true },
  pop: { tension: 240, friction: 16, useNativeDriver: true },
} as const;
