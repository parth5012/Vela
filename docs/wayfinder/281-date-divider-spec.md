# Wayfinder 281 — [Timestamps] Centered Date Divider Insertion & Inverted FlatList Integration Spec

Map: [#278 Integrate timestamps and day dividers into chat interface](https://github.com/parth5012/Vela/issues/278)  
Ticket: [#281 Centered date divider insertion & inverted FlatList integration spec](https://github.com/parth5012/Vela/issues/281)  
Blocked by: [#279 Audit timestamp data flow, schema guarantees, and missing-timestamp fallbacks](https://github.com/parth5012/Vela/issues/279) (Closed)  
Blocks: [#282 Comprehensive Handoff Spec & ADR synthesis](https://github.com/parth5012/Vela/issues/282)

---

## 1. Executive Summary

This specification defines the architecture, data structures, date boundary computation, and visual styling for calendar day dividers inside the Vela Android chat feed (`client/app/index.tsx`).

---

## 2. Inverted FlatList Architecture & Data Model

### 2.1 Discriminated Union Item Model
The chat feed replaces `reversedMessages: Message[]` with a unified array of items:

```typescript
export type ChatFeedItem =
  | {
      type: 'message';
      id: string;
      message: Message;
    }
  | {
      type: 'date_divider';
      id: string;
      dateKey: string; // e.g. "2026-09-21"
      label: string;   // e.g. "Today"
    };
```

### 2.2 Inverted Ordering Mechanics
`client/app/index.tsx` renders `<FlatList inverted ... />`, where index `0` represents the visual bottom of the feed (newest message).

Chronological visual structure (top to bottom):
```
[Divider: Yesterday]
   Message A (Yesterday 14:10)
   Message B (Yesterday 16:30)
[Divider: Today]
   Message C (Today 09:15)
   Message D (Today 10:42)  <-- Screen Bottom
```

In the inverted list array (`data={reversedChatItems}`), items must appear in reverse visual order:
```
Index 0: Message D (Today 10:42)
Index 1: Message C (Today 09:15)
Index 2: [Divider: Today]
Index 3: Message B (Yesterday 16:30)
Index 4: Message A (Yesterday 14:10)
Index 5: [Divider: Yesterday]
```

Algorithm to construct `reversedChatItems`:
1. Start with `activeMessages` (chronological order: oldest to newest).
2. Group or iterate from oldest to newest, tracking the current calendar day (`dateKey = toLocalDateKey(msgDate)`).
3. If `dateKey` differs from the previous message, insert a `{ type: 'date_divider', ... }` before that message in chronological sequence.
4. If a message has missing or unparseable `created_at`, coalesce it into the active cluster rather than creating spurious date dividers.
5. Reverse the resulting interleaved array to produce `reversedChatItems`.

---

## 3. Date Boundary & Label Formatting Rules

All calendar boundaries are evaluated in the user's device local timezone:

### 3.1 Date Key Extraction
```typescript
function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

### 3.2 Label Rules
Compare the message's local calendar day against `new Date()`:

1. **Same Day as Today** (`dateKey === todayKey`):
   - Label: `"Today"`
2. **One Day Prior** (`dateKey === yesterdayKey`):
   - Label: `"Yesterday"`
3. **Current Calendar Year** (`date.getFullYear() === now.getFullYear()`):
   - Format: Localized weekday and month/day, e.g. `"Mon, Sep 21"`
   - Evaluated via `date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })`
4. **Prior Calendar Years**:
   - Format: Localized month/day/year, e.g. `"Sep 15, 2025"`
   - Evaluated via `date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })`

---

## 4. Visual Styling & Component Specification

### 4.1 Glassmorphism Pill Design
- **Container**: Centered row with vertical spacing:
  ```tsx
  <View style={styles.dateDividerContainer}>
    <View style={[styles.dateDividerPill, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <Text style={[styles.dateDividerText, { color: colors.textMuted }]}>
        {item.label}
      </Text>
    </View>
  </View>
  ```

- **Style Tokens**:
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
    textTransform: 'none',
  },
  ```

### 4.2 Rejection of Sticky Headers
- FlatList `stickyHeaderIndices` with `inverted={true}` has unresolved upstream issues on React Native Android (header inverted upside down, jumpy scroll physics, clipping on dynamic message insertion).
- The centered glassmorphic in-flow pill scrolls naturally with the feed, eliminating performance overhead and native rendering bugs.

---

## 5. Virtualization, Keys & Performance

1. **Key Extraction**:
   - Divider keys: `keyExtractor: (item) => item.type === 'date_divider' ? `divider-${item.dateKey}` : item.id`
   - Stable keys prevent unnecessary unmounts or cell recycling jumps.
2. **Scroll Anchoring**:
   - `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` remains intact because streaming tokens only modify existing message content and do not inject date divider rows.
3. **Cache Isolation**:
   - Dividers bypass `getCachedParse` completely, adding near-zero compute overhead to the render pipeline.
