# Wayfinder 280 — [Timestamps] Message Bubble Footer Layout & Streaming Lifecycle UX Spec

Map: [#278 Integrate timestamps and day dividers into chat interface](https://github.com/parth5012/Vela/issues/278)  
Ticket: [#280 Message bubble footer layout & streaming lifecycle UX spec](https://github.com/parth5012/Vela/issues/280)  
Blocked by: [#279 Audit timestamp data flow, schema guarantees, and missing-timestamp fallbacks](https://github.com/parth5012/Vela/issues/279) (Closed)  
Blocks: [#282 Comprehensive Handoff Spec & ADR synthesis](https://github.com/parth5012/Vela/issues/282)

---

## 1. Executive Summary

This specification locks the visual presentation, typography, theme tokens, and streaming lifecycle states for message timestamps rendered inside chat bubbles on the Vela Android chat screen (`client/app/index.tsx`).

---

## 2. Layout & Positioning Architecture

### 2.1 Bubble Footer Row
- **Placement**: Pinned as the last child element inside the interactive bubble (`Pressable style={styles.bubble}`).
- **Structure**: A dedicated flexbox container row:
  ```tsx
  <View style={styles.bubbleFooterRow}>
    {isStreaming && <StreamingDot color={aurora.acc1} />}
    <Text style={timestampStyle}>{formattedTime}</Text>
  </View>
  ```
- **Alignment**: Pushed to the bottom-right corner of the bubble (`justifyContent: 'flex-end', alignItems: 'center'`).
- **Spacing**:
  - `marginTop: 4` separating content (text/markdown/diagrams) from metadata.
  - `gap: 4` between streaming indicator and time string.
  - No negative margins or overlapping absolute positions, ensuring zero clipping across varying screen densities and font scaling.

### 2.2 Content Interaction & Stacking
1. **Plain Text**: Sits directly beneath `styles.messageText`.
2. **Rich Text / Markdown**: Sits beneath all markdown blocks, preserving margins.
3. **Mermaid / Code Blocks / Collapsible Thought Blocks**: Placed cleanly beneath the rendered diagram or collapsible container.
4. **Reference Sources**: External source preview cards (`sourcesContainer`) remain positioned *outside* and below `styles.bubble`, as currently implemented in `client/app/index.tsx:1506-1528`.

---

## 3. Typography & Token Palette

To ensure WCAG AA contrast compliance across all six themes (`deep`, `slate`, `cyberpunk`, `oled`, `dracula`, `nordic`) and dynamic aurora accent palettes:

| Element | User Bubble | Assistant Bubble |
|---|---|---|
| **Text Color** | `aurora.onAccent` | `colors.textMuted` |
| **Opacity** | `0.65` | `1.0` (native token opacity) |
| **Font Size** | `10sp` | `10sp` |
| **Font Weight** | `'400'` | `'400'` |
| **Numeric Variant** | `fontVariant: ['tabular-nums']` | `fontVariant: ['tabular-nums']` |
| **Letter Spacing** | `0.25` | `0.25` |

---

## 4. Streaming Lifecycle UX

### 4.1 State Machine

```
[Turn Start] -> Bubble created with ISO timestamp (UTC)
   │
   ▼
[Streaming Active] -> Displays formatted timestamp + subtle pulsing accent dot (aurora.acc1)
   │
   ▼
[Stream Terminal / Done] -> Dot gracefully hides; static timestamp persists
   │
   ▼
[Aborted / Backgrounded] -> Status message preserves turn timestamp without dot
```

### 4.2 Eliminating Layout Pop
- Showing the timestamp immediately upon turn start (`nowIso = new Date().toISOString()`) guarantees bubble geometry does not jump or reflow when the terminal `done` event is received.
- The active streaming indicator uses a fixed 6dp pulsing dot (`width: 6, height: 6, borderRadius: 3`) running an animated opacity loop (0.4 <-> 1.0).

---

## 5. Defensive Formatting Contract

1. Timestamps are formatted outside `getCachedParse` using `parseSafeDate(item.created_at)` from `utils/date.ts`.
2. Format uses user device locale via `date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.
3. If `item.created_at` is missing, null, or unparseable (`parseSafeDate` returns `null`), the footer row renders `null` rather than displaying `"Invalid Date"`.
4. The regeneration gap identified in audit #279 (`client/app/index.tsx:958`) is patched so `handleRegenerate` sets `created_at: new Date().toISOString()`.
