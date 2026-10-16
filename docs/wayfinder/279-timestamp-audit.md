# Wayfinder 279 — [Timestamps] Audit Timestamp Data Flow, Schema Guarantees, and Missing-Timestamp Fallbacks

Map: [#278 Integrate timestamps and day dividers into chat interface](https://github.com/parth5012/Vela/issues/278)  
Ticket: [#279 Audit timestamp data flow, schema guarantees, and missing-timestamp fallbacks](https://github.com/parth5012/Vela/issues/279)  
Dependencies: Blocks [#280](https://github.com/parth5012/Vela/issues/280) (Bubble footer spec) and [#281](https://github.com/parth5012/Vela/issues/281) (Day dividers spec).

---

## 1. Executive Summary

This audit establishes the technical foundation for chat timestamp presentation (message bubble footers and centered calendar day dividers) across the Vela stack. We investigated primary sources across the backend (`backend/agent/main.py`, `backend/db/models.py`, `backend/db/client.py`), state management (`client/store/useChatStore.ts`), local SQLite storage (`client/db/schema.ts`, `client/db/chatRepository.ts`), network streaming (`client/utils/sse.ts`, `client/utils/history.ts`), and the chat UI (`client/app/index.tsx`).

### Core Findings Matrix

| Dimension | Current Implementation | Verdict / Risk | Required Action for #280 / #281 |
|---|---|---|---|
| **Backend `GET /chat/threads/{id}`** | Returns `exp.created_at.isoformat()` from naive UTC `DateTime`. | ⚠️ **Timezone Offset Bug**: Lacks trailing `Z`. JS engines parse timezone-less ISO as local device time, distorting time by device UTC offset. | Client parser must append `Z` to naive ISO strings; backend should standardize on ISO-8601 UTC. |
| **Backend Schema Guarantees** | `Experience.created_at` defaults to `utcnow_naive` but lacks `nullable=False`. | ⚠️ **Crash Risk**: If `created_at` is ever `None`, `.isoformat()` throws `AttributeError` -> 500 error on sync. | Ensure backend defensive check or DB migration; client handles missing sync gracefully. |
| **SSE Real-time Streaming** | SSE events (`content`, `auth_required`, `done`) omit timestamps entirely. | ℹ️ **Client-Driven**: Assistant message timestamp is established locally when the turn begins. | Client remains authoritative for live streaming timestamps. |
| **Client Live Creation** | `handleSend` and `handleSendWelcome` assign `new Date().toISOString()` to both user & assistant messages. | ✅ **Consistent**: Both user and assistant bubbles get ISO strings with `Z`. | Retain timestamp creation at turn initialization. |
| **Regenerate Turn Gap** | `handleRegenerate` (`client/app/index.tsx:958`) omits `created_at` on the placeholder assistant message. | 🚨 **Undefined Timestamp**: In-memory message has `created_at: undefined` until app reload. | Patch `handleRegenerate` to assign `created_at: new Date().toISOString()`. |
| **Token Streaming / Renaming** | `appendToken` uses immutable spread (`{ ...last, content }`); `renameThread` only mutates `threads`. | ✅ **Safe**: Timestamps are fully preserved during token delivery and thread renaming. | No changes needed. |
| **SQLite Schema & Drizzle** | `messages.created_at: integer('created_at').notNull()` (epoch ms). | ✅ **Correct Data Type**: Integer millisecond storage preserves Unix epoch. | Retain schema. |
| **SQLite Inbound (`toMessageRow`)** | `message.created_at ? Date.parse(message.created_at) \|\| Date.now() : Date.now()` | ⚠️ **Timezone Skew**: `Date.parse()` on naive backend string parses in local timezone. | Normalize naive ISO string before parsing. |
| **SQLite Outbound (`fromMessageRow`)** | `row.created_at ? new Date(Number(row.created_at)).toISOString() : undefined` | 🚨 **Crash Risk**: `new Date(NaN).toISOString()` throws `RangeError: Invalid time value` if row is corrupt, breaking hydration. | Harden with `Number.isFinite(ms) && ms > 0`. |
| **UI Parser (`getCachedParse`)** | Caches AST by message `content`: `key = (isUser ? 'u:' : 'a:') + content`. | ⚠️ **Architectural Boundary**: Timestamps MUST NOT enter `getCachedParse` (would cause identical text collisions). | Parse and format timestamps in dedicated helper/component, outside `getCachedParse`. |

---

## 2. Backend Sync Audit (`GET /chat/threads/{id}`)

### 2.1 Endpoint Implementation
Located in `backend/agent/main.py:361-391`:

```python
@app.get("/chat/threads/{thread_id}", dependencies=[Depends(verify_api_key)])
def get_thread_history(thread_id: str):
    normalized_id = normalize_thread_id(thread_id)
    try:
        with get_db_session() as session:
            conv = session.query(Conversation).filter_by(id=normalized_id).first()
            if not conv:
                raise HTTPException(status_code=404, detail="Thread not found")

            client = DBClient(session)
            experiences = client.get_conversation_history(normalized_id)
            messages = []
            for exp in experiences:
                messages.append({
                    "id": f"usr-{exp.id}",
                    "role": "user",
                    "content": exp.user_query,
                    "created_at": exp.created_at.isoformat()
                })
                messages.append({
                    "id": f"ast-{exp.id}",
                    "role": "assistant",
                    "content": exp.agent_response,
                    "created_at": exp.created_at.isoformat()
                })
            return messages
```

`client.get_conversation_history(normalized_id)` (`backend/db/client.py:246-250`) executes:
```python
return self.session.query(Experience).filter_by(
    conversation_id=conversation_id
).order_by(Experience.created_at.asc()).all()
```

### 2.2 Schema & Timezone Guarantees
In `backend/db/models.py:76-86`:
```python
class Experience(Base):
    __tablename__ = "experiences"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_query = Column(String, nullable=False)
    agent_response = Column(String, nullable=False)
    eval_score = Column(Float, nullable=True)
    eval_reason = Column(String, nullable=True)
    consolidated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow_naive)
```

`utcnow_naive()` is defined in `backend/db/models.py:11-20`:
```python
def utcnow_naive() -> datetime:
    """Single datetime rule (wayfinder T3, issue #251): naive UTC everywhere.

    All ``DateTime`` columns stay timezone-naive (SQLite-friendly) and every
    default/``onupdate`` plus every ``DBClient``/endpoint timestamp assignment
    uses this helper — never the deprecated ``utcnow`` constructor and never an
    aware ``datetime.now(timezone.utc)``, so naive/aware values can never mix
    in comparisons.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
```

### 2.3 Findings & Vulnerabilities
1. **ISO-8601 Format Missing UTC Designator ('Z')**:
   - Python's `datetime.isoformat()` on a timezone-naive `datetime` produces strings like:
     `"2026-09-21T14:30:00.123456"` or `"2026-09-21T14:30:00"`.
   - It contains NO timezone offset (`+00:00`) and NO trailing `'Z'`.
2. **The JavaScript Parsing Pitfall**:
   - Per ECMAScript specification (ECMA-262), parsing an ISO date-time string without a timezone specifier (`YYYY-MM-DDTHH:mm:ss`) treats the date as **LOCAL TIME** in the host environment (Hermes, V8, JavaScriptCore).
   - **Concrete Error Scenario**:
     - Turn occurs at 14:00:00 UTC. Backend stores naive `2026-09-21 14:00:00`.
     - Backend returns `"created_at": "2026-09-21T14:00:00"`.
     - Client in New York (EDT, UTC-4) parses `new Date("2026-09-21T14:00:00")`.
     - Hermes parses this as 14:00:00 EDT (18:00:00 UTC).
     - When formatted for the user, it displays as `2:00 PM` instead of the correct `10:00 AM EDT`!
     - In live chat, the message was created with `new Date().toISOString()` (which included `'Z'`) and displayed as `10:00 AM`. After sync or restart, the time jumps 4 hours ahead.
3. **Nullability Crash Risk**:
   - `Experience.created_at` lacks `nullable=False` in `backend/db/models.py:85`.
   - If an `Experience` row ever has `created_at IS NULL`, calling `exp.created_at.isoformat()` raises `AttributeError: 'NoneType' object has no attribute 'isoformat'`.
   - The outer `except Exception as e` in `get_thread_history` catches this and converts it to `HTTPException(status_code=500)`, failing thread fetch for that entire conversation.
4. **Turn-Level Identical Timestamps**:
   - Both `usr-{exp.id}` and `ast-{exp.id}` receive the exact same `exp.created_at.isoformat()`.
   - User query and assistant response timestamps are identical at the second/millisecond level on historical sync.

---

## 3. Real-Time Streaming & Client Lifecycle (SSE & Local LLM)

### 3.1 SSE Protocol (`/chat/message`)
The SSE generator in `backend/agent/main.py:549-813` streams chunks via `StreamingResponse(media_type="text/event-stream")`.

Emitted events:
1. `: keep-alive\n\n` (periodic ping, lines 688)
2. `data: {"type": "content", "delta": "..."}` (tokens from chatbot node, lines 726, 744, 758)
3. `data: {"type": "auth_required", "provider": "google"}` (line 755)
4. `data: {"type": "error", "message": "..."}` (line 695)
5. `data: {"type": "done", "thread_title": "...", "agent": "..."}` (line 790)

**Finding**: The backend SSE stream transmits **zero timestamp metadata**. Timestamps for live turns are 100% created and governed by the client.

### 3.2 Client Message Creation (`client/app/index.tsx`)
In `client/app/index.tsx`, messages are added to `useChatStore` in three primary workflows:

#### 1. Regular Send (`handleSend`, lines 805-824)
```typescript
const userMsgId = generateId('msg_user');
const assistantMsgId = generateId('msg_assistant');
const nowIso = new Date().toISOString();

addMessage(activeThreadId, {
  id: userMsgId,
  role: 'user',
  content: userText,
  created_at: nowIso,
});

addMessage(activeThreadId, {
  id: assistantMsgId,
  role: 'assistant',
  content: '',
  created_at: nowIso,
});
```
Both user message and empty assistant placeholder receive `nowIso` (`new Date().toISOString()`, formatted as UTC with `Z`, e.g., `"2026-09-21T14:30:00.123Z"`).

#### 2. Welcome Message Send (`handleSendWelcome`, lines 1099-1115)
Mirrors `handleSend`: generates `nowIso = new Date().toISOString()` and attaches it to both user and empty assistant messages.

#### 3. Message Regeneration (`handleRegenerate`, lines 956-963) — **DEFECT FOUND**
```typescript
// Add empty message for streaming
const assistantMsgId = generateId('msg_assistant');
addMessage(activeThreadId, {
  id: assistantMsgId,
  role: 'assistant',
  content: '',
  // BUG: created_at is omitted!
});
```
**Impact**:
- When regenerating an assistant response, `message.created_at` is `undefined` in memory.
- In `toMessageRow` (`client/db/chatRepository.ts:39`):
  `message.created_at ? Date.parse(message.created_at) || Date.now() : Date.now()`
  SQLite receives `Date.now()`, but in Zustand state (`messages[threadId]`), `created_at` remains `undefined` until the app restarts or rehydrates from SQLite.
- Any UI rendering `new Date(message.created_at).toLocaleTimeString()` immediately evaluates `new Date(undefined)` to `Invalid Date`.

#### 4. Background / Aborted Placeholder Healing (`client/app/index.tsx:407-417, 780-789`)
When an in-flight stream is aborted (manual Stop or app backgrounding), empty assistant placeholders are replaced with a stopped notice:
```typescript
addMessage(id, {
  id: generateId('msg_assistant'),
  role: 'assistant',
  content: '⏹️ Stopped — ...',
  created_at: new Date().toISOString(),
});
```
Properly includes `new Date().toISOString()`.

### 3.3 Token Streaming & State Updates (`useChatStore.ts`)
When tokens arrive via SSE or Local LLM, `appendToken` is invoked (`client/store/useChatStore.ts:205-221`):
```typescript
appendToken: (threadId, token) => {
  set((state) => {
    const current = state.messages[threadId] || [];
    if (current.length === 0) return {};
    const last = current[current.length - 1];
    if (last.role !== 'assistant') return {};
    
    const updatedLast = { ...last, content: last.content + token };
    return {
      messages: {
        ...state.messages,
        [threadId]: [...current.slice(0, -1), updatedLast]
      }
    };
  });
  scheduleMessagePersist(threadId);
}
```
**Finding**:
- `{ ...last, content: last.content + token }` performs an immutable shallow copy of `last`.
- `last.created_at` is fully preserved in memory during high-frequency token updates.
- `scheduleMessagePersist(threadId)` runs a trailing debounce of 800ms (`PERSIST_DEBOUNCE_MS`), invoking `saveMessage(threadId, last)`.
- `toMessageRow` converts `last.created_at` to an integer; because `last.created_at` is preserved, the original creation timestamp is written to SQLite.

### 3.4 Thread Title Renaming
When the backend yields `type: "done"` with `thread_title` (or the user renames the thread), `renameThread` is called (`client/store/useChatStore.ts:285-290`):
```typescript
set((state) => ({
  threads: state.threads.map((t) => t.id === id ? { ...t, title: newTitle } : t)
}));
```
**Finding**: `renameThread` mutates only the `threads` array. `state.messages` is untouched; message timestamps are 100% preserved.

### 3.5 Local LLM Streaming (`streamLocalResponse`)
In `client/app/index.tsx:632-762`:
- Tokens are streamed via `streamLocalLlmResponse` and queued into `pendingTokensMapRef`, flushed via `appendToken` on a 100ms interval.
- When tool executions occur, `client/app/index.tsx:729-730` executes:
  ```typescript
  const updatedHistory = [...currentMessagesSnapshot.slice(0, -1), { ...lastMessageSnapshot, content: updatedContent }];
  setHistory(threadId, updatedHistory);
  ```
  `{ ...lastMessageSnapshot, content: updatedContent }` preserves `lastMessageSnapshot.created_at`.

---

## 4. SQLite / Drizzle Storage Tier

### 4.1 Schema Definition
Defined in `client/db/schema.ts:11-22`:
```typescript
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversation_id: text('conversation_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  provider: text('provider').notNull(),
  created_at: integer('created_at').notNull(),
  pending: integer('pending', { mode: 'boolean' }).default(false).notNull(),
  server_id: text('server_id'),
});
```
`created_at` is an SQLite `integer NOT NULL`, storing Unix epoch milliseconds (e.g., `1758465000000`).

### 4.2 Inbound Serialization (`toMessageRow`)
Defined in `client/db/chatRepository.ts:32-43`:
```typescript
function toMessageRow(conversationId: string, message: Message) {
  return {
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    provider: 'local',
    created_at: message.created_at ? Date.parse(message.created_at) || Date.now() : Date.now(),
    pending: false,
    server_id: null as string | null,
  };
}
```

**Evaluation of Fallbacks**:
1. `message.created_at` present and parseable: Uses parsed milliseconds.
2. `message.created_at` is invalid string (e.g. `'corrupted'`): `Date.parse()` returns `NaN`. `NaN || Date.now()` evaluates to `Date.now()`.
3. `message.created_at` is `undefined`: Evaluates ternary false branch to `Date.now()`.
4. **Timezone flaw**: If `message.created_at` is a naive backend ISO string (`"2026-09-21T14:30:00"`), `Date.parse()` parses it as local device time, permanently storing a skewed epoch millisecond value into SQLite.

### 4.3 Outbound Deserialization (`fromMessageRow`)
Defined in `client/db/chatRepository.ts:55-62`:
```typescript
function fromMessageRow(row: any): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at ? new Date(Number(row.created_at)).toISOString() : undefined,
  };
}
```

**Critical Vulnerability (Uncaught Exception)**:
- If `row.created_at` is non-numeric (e.g., an unmigrated string, `'NaN'`, or text), `Number(row.created_at)` produces `NaN`.
- Calling `new Date(NaN).toISOString()` throws:
  `RangeError: Invalid time value`!
- `fromMessageRow` is executed in `loadMessages` (`client/db/chatRepository.ts:222`), which is called by `hydrateChatFromLocalDb` at startup (`useChatStore.ts:462`).
- A single corrupted row causes local database hydration to fail entirely, leaving the user with an empty chat screen.
- If `row.created_at` is `null` or `0`, `fromMessageRow` returns `created_at: undefined`.

### 4.4 Message Ordering in Queries
In `loadMessages` (`client/db/chatRepository.ts:215-223`):
```typescript
const rows = await db
  .select()
  .from(messages)
  .where(eq(messages.conversation_id, conversationId))
  .orderBy(asc(messages.created_at));
return rows.map(fromMessageRow);
```
**Ordering Collision Hazard**:
- Because user and assistant messages for a turn are generated at the exact same millisecond (`nowIso` in `handleSend`, or `exp.created_at` from backend sync), they share identical `created_at` integer values.
- In SQLite, ordering only by `asc(messages.created_at)` does not guarantee deterministic order when timestamps match.
- To guarantee that the user prompt is always ordered before the assistant response, the query must provide a tie-breaker, such as SQLite insertion order (`rowid`) or message role/id.

---

## 5. Client-Side Defensive Blueprint for Tickets #280 & #281

### 5.1 Architectural Boundary: Isolating `getCachedParse`
In `client/app/index.tsx:156-185`:
```typescript
const parseCache = new Map<string, ParsedMessageEntry>();

function getCachedParse(content: string, isUser: boolean): ParsedMessageEntry {
  const key = (isUser ? 'u:' : 'a:') + content;
  let entry = parseCache.get(key);
  if (!entry) {
    // parses Markdown, CollapsibleBlock, thought/intent tags, tool calls...
    ...
  }
  return entry;
}
```
**Mandate**:
- `getCachedParse` is keyed solely by `(isUser ? 'u:' : 'a:') + content`.
- **Do NOT pass timestamps to or cache timestamps within `getCachedParse`**.
- If timestamps were passed into the cache key, every token append during streaming would invalidate the AST cache, defeating the memoization optimization.
- If timestamps were stored inside the parsed entry without altering the key, duplicate messages (e.g. two separate `"Yes"` answers) would display the timestamp of the first message.
- **Rule**: Timestamp parsing and formatting must remain decoupled from message content parsing.

### 5.2 Resilient Timestamp Parser Specification (`parseSafeDate`)
For bubble footers (#280) and calendar day dividers (#281), implement a unified parsing function:

```typescript
/**
 * Safely parses any timestamp representation into a valid Date object.
 * Handles:
 * 1. ISO strings with timezone ('2026-09-21T14:30:00.000Z')
 * 2. Naive ISO strings from backend ('2026-09-21T14:30:00') -> forced to UTC ('Z')
 * 3. Unix epoch milliseconds (number or numeric string)
 * 4. Falsy, null, undefined, or unparseable input -> returns null (never throws, never Invalid Date)
 */
export function parseSafeDate(timestamp?: string | number | null): Date | null {
  if (!timestamp && timestamp !== 0) return null;

  try {
    if (typeof timestamp === 'number') {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
      const d = new Date(timestamp);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof timestamp === 'string') {
      const trimmed = timestamp.trim();
      if (!trimmed) return null;

      // Handle pure numeric string (epoch ms)
      if (/^\d{10,15}$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num <= 0) return null;
        const d = new Date(num);
        return isNaN(d.getTime()) ? null : d;
      }

      // Backend naive UTC ISO fix: YYYY-MM-DDTHH:mm:ss(.sss)? without Z or offset
      let normalized = trimmed;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
        normalized = trimmed + 'Z';
      }

      const d = new Date(normalized);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  } catch {
    return null;
  }
}
```

### 5.3 Bubble Footer Timestamp Formatting (#280 Requirements)
- Formats `parseSafeDate(message.created_at)` to localized absolute time:
  ```typescript
  export function formatMessageTime(timestamp?: string | number | null): string {
    const date = parseSafeDate(timestamp);
    if (!date) return '';
    try {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }
  ```
- **Display Rules**:
  - Rendered inside bubble footer, right-aligned.
  - If `formatMessageTime` returns `""` (missing or unparseable timestamp):
    - Omit the timestamp text element. Do not render `"Invalid Date"` or whitespace.
  - Static display: no `setInterval` re-render timers.

### 5.4 Centered Calendar Day Divider Insertion (#281 Requirements)
- Dividers group messages into calendar days: `"Today"`, `"Yesterday"`, or formatted date (e.g. `"September 20, 2026"`).
- In `client/app/index.tsx`:
  - `FlatList` has `inverted={true}` and consumes `reversedMessages = [...activeMessages].reverse()`.
  - In `reversedMessages`, index `0` is the newest message (rendered at bottom), and index `N-1` is the oldest message (rendered at top).
  - Visually, a day divider belongs **above** the first chronological message of each day.
  - In the inverted array, the day divider must appear **immediately after** the oldest message of that calendar day.
- **Handling Missing Timestamps in Day Dividers**:
  - If a message yields `parseSafeDate(m.created_at) === null`:
    - Do NOT generate an `"Invalid Date"` divider.
    - Coalesce the message into the same calendar day as its nearest neighbor (the message immediately preceding it chronologically).

### 5.5 Immediate Codebase Remediations

#### Remediation 1: Patch `handleRegenerate` in `client/app/index.tsx`
Line 958 currently omits `created_at`. Update to:
```typescript
    const assistantMsgId = generateId('msg_assistant');
    addMessage(activeThreadId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    });
```

#### Remediation 2: Harden `fromMessageRow` in `client/db/chatRepository.ts`
Lines 55-62 currently risk throwing `RangeError`. Update to:
```typescript
function fromMessageRow(row: any): Message {
  const ms = Number(row.created_at);
  const isValid = Number.isFinite(ms) && ms > 0;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: isValid ? new Date(ms).toISOString() : undefined,
  };
}
```

#### Remediation 3: Server-side UTC Timezone Indicator in `backend/agent/main.py`
In `get_thread_history` (`backend/agent/main.py:378, 384`), append `'Z'` or use safe string formatting:
```python
iso_ts = f"{exp.created_at.isoformat()}Z" if exp.created_at else utcnow_naive().isoformat() + "Z"
```

---

## 6. Citation & Reference Index

| File Path | Lines | Subject / Functionality |
|---|---|---|
| `backend/db/models.py` | 11-20 | `utcnow_naive()` definition (naive UTC rule) |
| `backend/db/models.py` | 76-86 | `Experience` model declaration (`created_at = Column(DateTime, default=utcnow_naive)`) |
| `backend/db/models.py` | 138-147 | `SyncMessage` model declaration (`created_at = Column(BigInteger, nullable=False)`) |
| `backend/agent/main.py` | 361-391 | `get_thread_history` (`GET /chat/threads/{thread_id}`) returning `exp.created_at.isoformat()` |
| `backend/agent/main.py` | 501-547 | `_persist_sse_turn_sync` persisting `Experience` and `SyncMessage` rows |
| `backend/agent/main.py` | 549-813 | `chat_message` (`POST /chat/message`) SSE stream yielding `content` and `done` |
| `client/db/schema.ts` | 11-22 | Drizzle SQLite `messages` table schema (`created_at: integer('created_at').notNull()`) |
| `client/db/chatRepository.ts` | 32-43 | `toMessageRow` conversion and fallback to `Date.now()` |
| `client/db/chatRepository.ts` | 55-62 | `fromMessageRow` conversion and `toISOString()` vulnerability |
| `client/db/chatRepository.ts` | 215-223 | `loadMessages` ordering by `asc(messages.created_at)` |
| `client/store/useChatStore.ts` | 77-82 | `Message` interface definition (`created_at?: string`) |
| `client/store/useChatStore.ts` | 177-204 | `addMessage` state update and updated_at bump |
| `client/store/useChatStore.ts` | 205-221 | `appendToken` immutable message spread and `scheduleMessagePersist` |
| `client/store/useChatStore.ts` | 285-290 | `renameThread` thread-only state update |
| `client/utils/history.ts` | 60-85 | `syncHistoryWithBackend` fetching thread messages and calling `setHistory` |
| `client/utils/sse.ts` | 120-170 | `streamAgentResponse` processing raw SSE lines |
| `client/app/index.tsx` | 156-185 | `getCachedParse` AST caching mechanism |
| `client/app/index.tsx` | 805-824 | `handleSend` creating user and assistant messages with `nowIso` |
| `client/app/index.tsx` | 956-963 | `handleRegenerate` adding assistant message without `created_at` |
| `client/app/index.tsx` | 1099-1115 | `handleSendWelcome` creating messages with `nowIso` |
| `client/app/index.tsx` | 1421-1436 | `FlatList` with `inverted` rendering `reversedMessages` |
