# Vela Design — the scroll-craft taste floor

The design taste floor for the Vela Android client (Expo / React Native,
Material 3 Expressive "Aurora" themes), adapted from the **scroll-craft** skill's
taste reference — `references/taste.md` in the scroll-craft skill
(`D:\work\projects\personal-skills\skills\scroll-craft\references\taste.md` on
the author's machine; it is not part of this repo, and nothing here quotes it).
The React Native adaptations below are the authoritative form for this
codebase: where the source speaks of web idioms (CSS shadows, gradient text,
scroll animation), the adaptation states the token or component that carries
the same intent here.

Two enforcement layers keep this document honest:

- `npm run design:lint` (`scripts/design-lint.mjs`) scans `app/`,
  `components/`, `styles/` and `utils/theme.ts` for the mechanical refuse-list
  patterns below. **Errors fail CI; warnings only print.** Exceptions go in
  `scripts/design-lint-allowlist.json` and every entry must carry a `reason` —
  an entry without one fails the lint.
- `__tests__/motion.test.ts` holds the behavioural and source-audit motion
  invariants (the lint's ease-in checks are belt-and-braces with its audit;
  its one documented exception — `components/ui/m3Expression.tsx` animating SVG
  geometry — is a motion.test.ts concern, not a lint one).

Sister tickets that landed the tokens referenced throughout: #448 (colour),
#449 (typography), #450 (depth), #451 (motion & interactive states).

---

## Colour roles

- **One accent pair per theme.** Accents are curated two-stop pairs of one hue
  family (`ACCENT_COLORS`, `ACCENT_AURORA`, `getAurora` in
  `client/utils/theme.ts`) — never a free gradient of arbitrary stops.
  _RN adaptation:_ the pair drives the send button, active states and selected
  rings; foreground-on-accent always resolves through `getContrastForeground`.
- **Neutrals are tinted, not grey.** Every ground (background, card, bubble,
  border, code surface) derives from the scheme's hue, so dark mode never goes
  muddy-grey and light mode never goes clinical. _RN adaptation:_
  `THEME_COLORS` per scheme; add a scheme there, not ad-hoc hex in screens.
- **No pure black.** The darkest grounds are OLED-tuned warm blacks: noir/oled
  `background: #050505` with `skyTop: #090807`. Pure `#000000` as a ground or
  shadow is refused. _RN adaptation:_ translucent scrims may use
  `rgba(0, 0, 0, α)` — a scrim is a veil, not a ground.
- **Six schemes:** `berry` (default), `citrus`, `aquatic`, `sunset` (light),
  `noir` (AMOLED), `chrome` (cold steel), plus the legacy `oled` alias of noir.
- **Contrast before vibes.** Body text holds AA against its ground in every
  scheme; the accent pair stays legible on both light and dark surfaces.
- Source: scroll-craft `references/taste.md` (colour roles / tinted neutrals).

## Typography

- **Two families max** — display and text (`FONTS` in `utils/theme.ts`; today
  both resolve to the system sans). Role is expressed through weight, size and
  tracking, never a third family.
- **One ramp, three sizes.** `FONT_SIZES` `small/medium/large` scale four roles
  — `sub`, `text`, `title`, `logo` — and screens pick a size, not ad-hoc px.
- **Roomy body.** Line height is ≥ 1.5× the body size; body tracking stays
  slightly positive and tightens as size grows; `title`/`logo` carry negative
  tracking (display sizes read better dense).
- **Dark-mode compensation.** On `noir`/`chrome`/`oled`, `getTypeScale` bumps
  line height +5%, tracking +0.1, and weight one step heavier (400 → 500) so
  light-on-dark text doesn't look thin.
- Source: scroll-craft `references/taste.md` (type scale, tracking, measure).

## Depth

- **Exactly three elevation steps** — `e1/e2/e3` in `client/utils/elevation.ts`
  (offset 2/4/8, radius 4/10/18, Android `elevation` 2/4/8). If everything is
  elevated, nothing is: one hero surface per screen region, everything else
  sits flat.
- **Shadows are tinted, never black.** `tintedShadowColor` scales the canvas
  hue down (~8% brightness, channel floor 12), so shadows read as depth, not
  dirt. `shadowColor: '#000'` is refused.
- **1px edge light.** Raised cards get `edgeLight` — a 1px top border at 8%
  white — so the top edge catches light on dark grounds.
- **4% grain.** `components/ui/Grain.tsx` tiles a 64×64 noise PNG at 4% opacity
  behind content on dark gradient grounds to break gradient banding. It never
  intercepts touches.
- Source: scroll-craft `references/taste.md` (elevation, edge light, grain).

## Motion

- **Ease-out only.** `EASING.out` (`bezier(0.23, 1, 0.32, 1)` in
  `utils/motion.ts`) is the single curve. `Easing.in(...)`, `ease-in` and
  `ease-in-out` are refused — nothing should decelerate then accelerate.
- **Durations are budgeted.** `DURATIONS`: press 150ms, reveal 200ms,
  transition 280ms, stagger 50ms — caps enforced by `motion.test.ts`
  (press 120–180ms, reveal/transition ≤ 300ms, stagger 30–80ms).
- **Native driver, transform/opacity only.** `useNativeDriver: true` on every
  animated surface; the one documented exception (SVG geometry morphs in
  `components/ui/m3Expression.tsx`) lives in `motion.test.ts`.
- **Press feedback.** `components/ui/PressableScale.tsx` scales to 0.97 on
  press-in over the press duration and dissolves to opacity-only under reduced
  motion. Reach for it instead of raw `Pressable` on tappable cards and rows.
- **Reduced motion is a mode, not an afterthought.** `hooks/useReducedMotion.ts`
  mirrors the OS setting; keep opacity/colour cues that carry comprehension,
  drop position and scale changes.
- Source: scroll-craft `references/taste.md` (motion — easing, budgets,
  choreography).

## States

- **Disabled** reads at opacity 0.4 and sets `accessibilityState.disabled`
  (`PressableScale`, `settingsKit` buttons).
- **Busy** keeps layout and reports `accessibilityState.busy`; never a layout
  swap mid-load.
- **Selected** is the accent: border in `aurora.acc1` + 12% accent tint fill +
  `accessibilityState.selected` — not a colour swap the squint test can lose.
- **Every icon-only control carries an `accessibilityLabel`.**
- Source: scroll-craft `references/taste.md` (interactive states), adapted to
  React Native accessibility props.

## Copy

- **Plain, specific verbs.** Filler is refused: *elevate, seamless, unleash,
  next-gen, revolutionize, supercharge* (and their siblings). Say what the
  button does.
- **No em dashes in user-facing copy** — restructure with a period or comma;
  an em dash is a sign the sentence is doing two jobs.
- **No emoji as standalone labels or icon slots.** Emoji inside conversational
  content (chat bubbles, prompts) is fine; a bare emoji standing where an icon
  or button label belongs is not — use a text label or a real icon.
- **Honest states.** Copy states what is true (the engine pill says "Mock
  Fallback" when the model is not running); never dress a fallback as success.
- Source: scroll-craft `references/taste.md` (voice/copy rules).

## Refuse list

Checked mechanically by `npm run design:lint` (`client/scripts/design-lint.mjs`).
Errors fail CI; warnings print and stay visible.

| Pattern | Rule id | Severity |
| --- | --- | --- |
| `background`/`backgroundColor: '#000'`/`'#000000'` | `no-pure-black-background` | error |
| `shadowColor: '#000'`/`'#000000'` | `no-black-shadow` | error |
| `Easing.in(`, `Easing.inOut(` or `ease-in` anywhere | `no-ease-in` | error |
| `transition: 'all'` | `no-transition-all` | error |
| `textShadowRadius` > 0 with a bright saturated `textShadowColor` | `no-neon-glow-text` | error |
| masked `LinearGradient` fill (gradient text recipe) | `no-gradient-text` | error |
| emoji as a standalone label / icon slot | `emoji-standalone-label` | warn |
| filler verbs in string copy | `copy-filler-verb` | warn |
| em dash inside a string literal | `copy-em-dash` | warn |
| `borderLeftWidth` > 1 (left accent bars on cards) | `left-border-overkill` | warn |

Allowlist entries (`scripts/design-lint-allowlist.json`) suppress a rule for one
file and must say why: `{ "file": "app/foo.tsx", "rule": "<id>", "reason": "…" }`.
An entry without a reason fails the lint. The rule set is deliberately
complementary to `__tests__/motion.test.ts`, which owns the behavioural motion
invariants and its SVG-geometry exception.

Source: scroll-craft `references/taste.md` (the refuse list).

## Squint test

Blur your eyes (or step back from the phone). The screen still has to read:

- **One focal point** per screen — the thing you squint at first is the thing
  the screen is for.
- **Hierarchy survives without colour**: elevation groups (flat surface / raised
  card / hero surface) must still separate when hue goes grey.
- **Accent appears once or twice** — if the accent is everywhere, it points
  nowhere; if it never appears, the screen is beige soup.
- **Nothing vibrates** — no two saturated hues of similar area shouting next to
  each other; gradient pairs stay in one hue family.
- **Dark grounds stay smooth** — grain plus tinted shadows keep banding and
  black-hole shadows out of the dark themes.

A screen that fails the squint test usually broke one of the rules above — fix
the rule, not the blur.

Source: scroll-craft `references/taste.md` (the squint test).
