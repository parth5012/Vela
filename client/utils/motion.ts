/**
 * Scroll-craft motion tokens (WF-447-04).
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
