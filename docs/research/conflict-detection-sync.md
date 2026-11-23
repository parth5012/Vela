# Research: Conflict Detection & Resolution in Local-First Expo / SQLite Sync

## Context & Objectives

In local-first mobile architectures such as Vela (built with Expo, React Native, and SQLite via Drizzle ORM), clients may modify or create messages offline. When network connectivity resumes, local updates must reconcile with changes pulled from the server.

Without conflict resolution, standard sync mechanisms either:
1. **Last-Write-Wins (LWW)** blindly overwrites local or remote changes, causing silent data loss.
2. Incur database integrity errors or out-of-order stream corruptions.

This research document defines best practices for conflict detection and interactive resolution in Vela's sync pipeline.

---

## 1. Conflict Detection in Local-First Sync

### 1.1 Trigger Conditions
A sync conflict occurs during the **pull phase** (receiving remote operations from `/api/sync/pull`) under the following condition:
- The pulled remote operation targets a message whose ID matches an existing local message (`messages.id` or `messages.server_id`).
- The local message is **pending** (`messages.pending === true` or exists in `operation_log` awaiting push).
- The remote payload content or role differs from the local message state (`existingMessage.content !== msgPayload.content || existingMessage.role !== msgPayload.role`).

If a message is already synced (`pending === false` and not in `operation_log`), remote updates are safely treated as authoritative updates and do not require user-facing conflict resolution.

### 1.2 Data Structures
A conflict item encapsulates both sides of the divergent state:

```typescript
export interface SyncConflict {
  id: string; // Message ID in conflict
  threadId: string;
  localMessage: {
    id: string;
    role: string;
    content: string;
    createdAt: number;
    provider?: string;
  };
  serverMessage: {
    id: string;
    role: string;
    content: string;
    createdAt: number;
    provider?: string;
  };
}
```

---

## 2. Resolution Strategies

When a conflict is detected, the sync pipeline suspends applying that specific message update and registers the conflict in a conflict store. The UI renders a blocking modal presenting the user with three explicit actions:

| Action | Local Message (`messages`) | Operation Log (`operation_log`) | Server Impact |
| :--- | :--- | :--- | :--- |
| **Keep Local** | Retains local content, keeps `pending = true`. | Preserves push operation in `operation_log` to overwrite or reconcile on server on next sync. | Server will receive local version during subsequent push. |
| **Keep Server** | Overwritten with `serverMessage` values. `pending` set to `false`. | Any pending operation for this ID is purged from `operation_log`. | Local matches remote exactly. |
| **Keep Both** | Server message accepted for original ID (`pending = false`). A duplicate message is created with a new UUID and timestamp, preserving local content with a duplicate indicator (`*`). | Duplicate message queued in `operation_log` for push as a new distinct message. Conflicted op removed. | Both versions exist in thread history. |

### 2.1 Duplicate Marking ("Keep Both")
- Original message ID is assigned to the server's version.
- The local version is cloned into a new message:
  - New UUID (e.g. `crypto.randomUUID()`).
  - Preserved local content.
  - Suffix or indicator marking: e.g. `content` or visual indicator badge (`*`).
  - `pending = true` so it syncs up to the server as a new message.

---

## 3. Modal UX Design Patterns

1. **Blocking & Non-Dismissible**:
   - The user cannot dismiss the modal by tapping the backdrop or navigating away until all queued conflicts are resolved. This prevents partial sync states and data divergence.
2. **Side-by-Side / Diff Comparison**:
   - Clear visual cards showing **Your Local Version** (with offline timestamp) vs **Server Version** (with server timestamp).
   - Monospace or highlighted preview of differing text.
3. **Queue / Batch Handling**:
   - Renders a scrollable list of conflict items with individual resolution buttons per item.
   - When all conflicts are resolved, the modal automatically closes and the sync resumes / finalizes.

---

## 4. Performance & Reliability Considerations

1. **Atomic Transactions**:
   - Resolution actions must update both SQLite `messages` and `operation_log` within a database transaction or sequential batch to avoid orphaned queue entries.
2. **Idempotent Reconciliation**:
   - Pulling operations multiple times while conflicts are active should not create duplicate conflict entries. The conflict store must key entries by message ID.
3. **Store Integration**:
   - A dedicated `useSyncConflictStore` (Zustand) tracks active conflicts, exposing `conflicts`, `resolveConflict(id, resolution)`, and `clearConflicts()`.
