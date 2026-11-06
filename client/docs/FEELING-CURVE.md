# Vela Feeling Curve — first run and the empty chat (WF-447-06 / #453)

The first-run and empty-chat experience is one feeling curve with a single
engineered peak, not a generic centred placeholder. This document is written
against the built screens so a cold read can verify every beat directly:
`app/setup.tsx` (first run) and `app/index.tsx` (empty chat, first response).
Copy and motion follow the taste floor in `docs/DESIGN.md`; the mechanical
guardrail is `npm run design:lint` and the behavioural pins live in
`__tests__/emptyState.test.tsx`.

## The five beats

| Beat | Emotion | On-screen cause |
| --- | --- | --- |
| Recognition | "This app knows what it is, and there is one decision to make." | Setup fork step (`setup.tsx`): the VELA wordmark, the headline "Get Started with Vela", the subtitle "One decision first: how should Vela run on this device?", two cards arriving as one staggered gesture. |
| Tension | "This takes effort, and I know exactly what effort." | The chosen form step (`setup.tsx` server or standalone): fields for address and key, the subtitle names the effort and promises the verify ("Vela verifies them before opening your chat."), the button says "Connect & Save" / "Test & Start". |
| Turn | "It worked. The effort is over." | The verify success line (`setup.tsx`): "✓ Credentials verified. Opening your chat." (server) / "✓ Cloud connected. Opening your chat." (cloud). No dead end: the line points forward and the config store flips, which routes the app into the chat screen. |
| Substance | "Now I can see what it actually does." | The chat screen's empty state (`index.tsx` `EmptyChatState`): VELA wordmark, one real headline, one real line of subtext, the starter prompts and agent picker as quiet secondaries under one primary action. |
| Commitment | "I am in. Here is my question." | The composer (`index.tsx`): the primary CTA "Ask your first question" focuses the input; the first send creates the thread. |

## The empty chat state (Substance + Commitment surface)

Exactly what is on screen, so a cold read can check it line by line:

- Headline (6 words): **Ask once. It does the thing.**
- Subtext (18 words): **Describe what you need. Vela answers in one composed reply and can run the task on your device.**
- One primary CTA: **Ask your first question** (accent-filled, `PressableScale`, focuses the composer). The starter cards and agent picker stay quiet below it; they are substance, not competing calls to action.
- No scroll or swipe cue appears anywhere in the empty state.
- The block is the state's single animated element: one ease-out entrance
  (opacity + slight rise, `DURATIONS.reveal`, native driver, transform/opacity
  only). Under reduced motion the fade stays and the travel is dropped. No glow
  pulse, no typing dots, no shimmer.

## The peak

> The first assistant answer lands as one composed block, not a spinner then a wall.

**Peak device: bubble entrance.** The assistant answer arrives once with a
single ease-out entrance (opacity + slight rise, `DURATIONS.reveal`, native
driver) and then fills in as one composed block. It plays only when the row
mounts while its message is the one streaming, so history never re-animates;
reduced motion keeps the fade and drops the rise.

The other two peak devices are deliberately static:

- No streaming progress bar exists anywhere in the first response.
- The send button is a plain Send/Stop state swap (`accessibilityState.busy`,
  no animation attached to the state change).

## Authored silence before the peak

> The composer holds a quiet, single-line state while the first token streams.

Mechanically: while the streaming assistant message has no content yet, the row
holds one muted, static line — "Writing your answer." (or "Loading the
on-device model." in local mode, an honest state, not a dressed-up success).
No spinner, no pulse. The line yields to the composed block the moment content
arrives.

## Completed sentence

> It's the app where you ask once and it does the thing.

The empty-state headline is the compressed form of this sentence. If the built
screens make the sentence feel true, the curve works.

## Choreography budget

- Empty-state entrance: one element, `DURATIONS.reveal` (200ms), `EASING.out`,
  native driver, transform/opacity only.
- Setup fork cards: one staggered arrival, `DURATIONS.stagger` (50ms) offsets,
  same floor (`setup.tsx`).
- Everything else in these beats is static.

## Cold-read checklist (reviewer)

1. `/setup`, fork step: two cards arrive as one staggered gesture; the copy says there is one decision.
2. Pick a path: the form copy names the effort and what happens after it.
3. Connect: the success line says "Opening your chat." and the app lands in the chat screen, not a dead end.
4. Empty chat: VELA, headline, subtext, one accent CTA; starters and agents quiet below; nothing pulses; no scroll/swipe cue.
5. Send the first question: a quiet single line while the first tokens stream, then the answer enters once as one composed block.
6. Say the completed sentence out loud at the end. It should feel earned, not claimed.
