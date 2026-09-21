# Chat Message Timestamps & Centered Date Dividers — Handoff Specification

Map: [#278 Integrate timestamps and day dividers into chat interface](https://github.com/parth5012/Vela/issues/278)  
Tickets Resolved: [#279](https://github.com/parth5012/Vela/issues/279) (Audit), [#280](https://github.com/parth5012/Vela/issues/280) (Bubble Footer), [#281](https://github.com/parth5012/Vela/issues/281) (Date Dividers), [#282](https://github.com/parth5012/Vela/issues/282) (Handoff Spec & ADR)  
ADR: [ADR-0005: Chat Message Timestamps and Centered Date Dividers](../adr/0005-chat-message-timestamps-and-date-dividers.md)

---

## 1. Scope & Objective

Deliver clear temporal context in the Vela Android client chat interface (`client/app/index.tsx`) through:
1. Pinned message bubble timestamp footers with real-time streaming state indicators.
2. Centered glassmorphic calendar day dividers separating multi-day conversations.
3. Resilient client-side date normalization eliminating timezone offset bugs and hydration crash risks.

---

## 2. Technical Architecture & Data Flow

### 2.1 Backend Sync Contract & Timezone Normalization
- **Backend Sync** (`GET /chat/threads/{id}`): Emits naive ISO-8601 strings (`exp.created_at.isoformat()`).
- **Defensive Parsing Requirement**: Standard ECMAScript `Date.parse()` treats date strings lacking `'Z'` or offset as local time. The client MUST normalize strings by appending `'Z'` if no timezone offset is present:
  ```typescript
  // client/utils/date.ts
  export function parseSafeDate(raw: string | number | undefined | null): Date | null {
    if (!raw) return null;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? new Date(raw) : null;
    }
    let str = raw.trim();
    if (!str) return null;
    // If ISO-like string without timezone offset or Z, assume UTC
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
      str += 'Z';
    }
    const timestamp = Date.parse(str);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }
  ```

### 2.2 Local Storage & Hydration Hardening
- In `client/db/chatRepository.ts:55-62` (`fromMessageRow`):
  ```typescript
  function fromMessageRow(row: any): Message {
    const rawMs = Number(row.created_at);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: Number.isFinite(rawMs) && rawMs > 0 ? new Date(rawMs).toISOString() : undefined,
    };
  }
  ```
- In `client/app/index.tsx:958` (`handleRegenerate`): Ensure placeholder assistant message includes `created_at: new Date().toISOString()`.

---

## 3. UI/UX Specification

### 3.1 Message Bubble Footer
- **Container**: Flex row inside `styles.bubble` as the final child element:
  ```tsx
  <View style={styles.bubbleFooterRow}>
    {isStreaming && (
      <PulsingDot color={aurora.acc1} />
    )}
    <Text style={[styles.bubbleTimestamp, timestampStyle]}>
      {formattedTime}
    </Text>
  </View>
  ```
- **Styles**:
  ```typescript
  bubbleFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  bubbleTimestamp: {
    fontSize: 10,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.25,
  },
  ```
- **Tokens**:
  - User bubble: `color: aurora.onAccent`, `opacity: 0.65`.
  - Assistant bubble: `color: colors.textMuted`, `opacity: 1.0`.
- **Streaming Pulse**: 6dp circular dot (`width: 6, height: 6, borderRadius: 3`) running an opacity animation loop (0.4 to 1.0, duration 800ms). Unmounts immediately when `isStreaming` becomes false.

### 3.2 Centered Calendar Day Dividers
- **Container**: Centered, non-interactive glassmorphism badge:
  ```tsx
  <View style={styles.dateDividerContainer}>
    <View style={[styles.dateDividerPill, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <Text style={[styles.dateDividerText, { color: colors.textMuted }]}>
        {item.label}
      </Text>
    </View>
  </View>
  ```
- **Styles**:
  ```typescript
  dateDividerContainer: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
  },
  dateDividerPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateDividerText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  ```
- **Label Formatting Rules** (evaluated in device local timezone):
  - Current day: `"Today"`
  - Previous day: `"Yesterday"`
  - Current calendar year: `"EEE, MMM d"` (e.g. `"Mon, Sep 21"`)
  - Older calendar years: `"MMM d, yyyy"` (e.g. `"Sep 15, 2025"`)

---

## 4. Inverted FlatList Integration

### 4.1 Discriminated Union
```typescript
export type ChatFeedItem =
  | { type: 'message'; id: string; message: Message }
  | { type: 'date_divider'; id: string; dateKey: string; label: string };
```

### 4.2 Reversal Algorithm
```typescript
export function buildChatFeedItems(messages: Message[]): ChatFeedItem[] {
  const result: ChatFeedItem[] = [];
  let lastDateKey: string | null = null;

  // Walk in chronological order (oldest to newest)
  for (const message of messages) {
    const parsedDate = parseSafeDate(message.created_at);
    if (parsedDate) {
      const dateKey = toLocalDateKey(parsedDate);
      if (dateKey !== lastDateKey) {
        result.push({
          type: 'date_divider',
          id: `divider-${dateKey}`,
          dateKey,
          label: formatDateDividerLabel(parsedDate),
        });
        lastDateKey = dateKey;
      }
    }
    result.push({
      type: 'message',
      id: message.id,
      message,
    });
  }

  // Reverse so newest items appear at index 0 for inverted FlatList
  return result.reverse();
}
```

---

## 5. Atomic Implementation Tickets

Ready for dispatch to coding agents:

1. **Ticket A: Date Utilities & Repository Hardening**
   - Create `client/utils/date.ts` implementing `parseSafeDate`, `formatTimestamp`, `toLocalDateKey`, and `formatDateDividerLabel`.
   - Update `client/db/chatRepository.ts` to harden `toMessageRow` and `fromMessageRow` against `NaN` and timezone drift.
   - Patch `handleRegenerate` in `client/app/index.tsx` to set `created_at`.
   - Write Jest unit tests in `client/__tests__/date.test.ts`.

2. **Ticket B: Bubble Footer Component & Streaming Lifecycle**
   - Create `client/components/chat/BubbleFooter.tsx` accepting `created_at`, `isUser`, `isStreaming`, `aurora`, and `colors`.
   - Integrate `BubbleFooter` inside `styles.bubble` in `client/app/index.tsx`.
   - Add pulsating animation during active stream turns.

3. **Ticket C: Inverted FlatList Day Dividers & Feed Transformer**
   - Integrate `buildChatFeedItems` into `client/app/index.tsx` via `useMemo`.
   - Branch `renderItem` on `item.type === 'date_divider'` to render the glassmorphic pill badge.
   - Update `keyExtractor` to support `ChatFeedItem`.

4. **Ticket D: Test Suite & End-to-End Verification**
   - Add snapshot / render tests in `client/__tests__/chatTimestamps.test.ts`.
   - Verify `maintainVisibleContentPosition` scroll stability and talkback accessibility labels (`accessibilityLabel="Sent at 10:42 AM"`).
