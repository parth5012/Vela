# ADR-0005: Chat Message Timestamps and Centered Date Dividers

## Status
Accepted

## Date
2026-09-21

## Context
In the Vela Android client (`client/app/index.tsx`), conversation feeds lacked visual time affordances:
1. Message bubbles displayed no timestamps, leaving the Owner unable to discern when an interaction took place.
2. Long-running, multi-day threads had no visual boundaries separating days.
3. Backend history sync (`GET /chat/threads/{id}`) emitted naive ISO strings (`exp.created_at.isoformat()`) without trailing `'Z'`, which caused JavaScript `Date.parse()` to interpret UTC timestamps as local device time, shifting displayed message times by the Owner's UTC offset.
4. Active streaming responses require clear turn start visibility without layout pop when tokens finish arriving.

## Decision

We establish the architecture and presentation standards for chat timestamps and date dividers:

1. **Message Bubble Footer**:
   - Every message displays its creation time inside the message bubble (`styles.bubble`) in a dedicated bottom-right row (`flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4, gap: 4`).
   - User messages use `aurora.onAccent` at 0.65 opacity; Assistant messages use `colors.textMuted` at full opacity.
   - Numerals are styled at 10sp with tabular numbers (`fontVariant: ['tabular-nums']`).
   - Timestamps sit below all bubble content (text, Markdown, Mermaid diagrams, code blocks, collapsible tool blocks) but above external reference sources.

2. **Streaming Lifecycle UX**:
   - Assistant bubbles render the turn timestamp immediately upon turn start (`new Date().toISOString()`), avoiding layout pops on completion.
   - While streaming is active (`isStreaming = true`), a subtle 6dp pulsing dot (`aurora.acc1`) pulses beside the timestamp. Once streaming ends, the dot cleanly unmounts, leaving the static timestamp.

3. **Inverted FlatList Discriminated Union**:
   - The message feed consumes a discriminated union `ChatFeedItem = { type: 'message', id, message } | { type: 'date_divider', id, dateKey, label }`.
   - Items are grouped into Day Clusters in chronological order with Date Dividers prepended, then reversed to feed the inverted `FlatList`. This guarantees dividers render physically above their day clusters.
   - Sticky headers are rejected in favor of centered, in-flow glassmorphic pills (`colors.glass`, `colors.glassBorder`, `borderRadius: 12`, 11sp semibold `colors.textMuted`, `marginVertical: 12`) to eliminate React Native Android inverted scroll bugs.

4. **Defensive Date Normalization Contract**:
   - All timestamp parsing routes through `parseSafeDate()`, which appends `'Z'` to timezone-naive backend strings, guards against `NaN` epoch values, and returns `null` on failure.
   - If a timestamp is missing or unparseable, the footer is omitted and the message coalesces into its neighbor's day cluster without throwing or displaying `"Invalid Date"`.
   - Content-keyed AST memoization (`parseCache` / `getCachedParse`) remains strictly decoupled from timestamps.

## Consequences

- **Positive**:
  - Delivers intuitive temporal orientation across single-day and multi-day conversations.
  - Zero layout shift during and after streaming.
  - Bulletproof against timezone-naive backend drift and corrupt database records.
  - Preserves 60fps scrolling and inverted FlatList scroll anchoring (`maintainVisibleContentPosition`).
- **Negative**:
  - Marginally increases vertical height of short (single-word) message bubbles due to dedicated footer row.
