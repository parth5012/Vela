/**
 * Client notification routing — single source of truth for FCM data → screen routing.
 * Per #133 design: all types currently route to chat home ('/') with selectThread(id) if present.
 * Extensible switch for future /briefing-history and /journal branches.
 */

export interface NotificationData {
  type?: string;
  conversation_id?: string;
  [key: string]: string | undefined;
}

export interface ParsedNotification {
  type: string;
  conversation_id?: string;
  route?: string;
}

/**
 * Normalize raw FCM data (notification.request.content.data) into canonical shape.
 * Handles missing/null input, trims values, and strips deep-link prefixes if the
 * conversation_id field itself contains a path like "conversation/abc" or "chat/abc".
 */
export function parseNotificationData(
  data: Record<string, string> | NotificationData | null | undefined,
): ParsedNotification {
  if (!data) return { type: '' };
  const rawType = (data as Record<string, string>).type ?? '';
  const rawConversationId =
    (data as Record<string, string>).conversation_id ??
    (data as Record<string, string>).conversationId ??
    undefined;

  const type = String(rawType).trim();

  let conversation_id: string | undefined;
  if (rawConversationId != null && String(rawConversationId).trim() !== '') {
    let id = String(rawConversationId).trim();
    // Strip deep-link/path prefixes if present: "conversation/<id>" or "chat/<id>"
    // Also handles full scheme like "vela-client://conversation/<id>"
    if (id.includes('://')) {
      const parsed = parseUrl(id);
      if (parsed?.conversation_id) {
        id = parsed.conversation_id;
      } else {
        // Fallback: take last path segment
        const parts = id.split('/').filter(Boolean);
        id = parts[parts.length - 1] ?? id;
      }
    } else if (id.startsWith('conversation/') || id.startsWith('chat/')) {
      id = id.replace(/^(conversation|chat)\//, '');
    }
    // Remove query/hash if any remains
    id = id.split('?')[0].split('#')[0].trim();
    if (id) conversation_id = id;
  }

  if (conversation_id) return { type, conversation_id };
  return { type };
}

/**
 * Build canonical deep-link for a conversation. Returns null when no id present.
 * Canonical: vela-client://conversation/{id} (chat/{id} is accepted on parse, not produced).
 */
export function buildDeepLink(
  data: Record<string, string> | NotificationData | ParsedNotification | null | undefined,
): string | null {
  if (!data) return null;
  const parsed = parseNotificationData(data as Record<string, string>);
  if (!parsed.conversation_id) return null;
  return `vela-client://conversation/${parsed.conversation_id}`;
}

/**
 * Parse a vela-client:// deep-link URL (accepts both conversation/ and chat/ aliases).
 * Returns parsed conversation_id or null for invalid input.
 * Exported as both parseUrl and parseDeepLinkUrl for completeness.
 */
export function parseUrl(url: string | null | undefined): ParsedNotification | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    // Only handle vela-client:// scheme; otherwise treat as path
    let pathPart: string;
    const schemeMatch = trimmed.match(/^vela-client:\/\//i);
    if (schemeMatch) {
      pathPart = trimmed.slice(schemeMatch[0].length);
    } else if (trimmed.startsWith('vela-client:')) {
      // Handle vela-client:conversation/id without slashes (edge case)
      pathPart = trimmed.replace(/^vela-client:/i, '').replace(/^\/+/, '');
    } else {
      // Not a vela-client URL — try to extract id from generic path
      // e.g. "conversation/abc" or "chat/abc"
      pathPart = trimmed;
    }

    // Strip query/hash
    pathPart = pathPart.split('?')[0].split('#')[0];
    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    // Recognized prefixes: conversation, chat, briefing-history, journal, etc.
    // For notification routing we only care about conversation/chat → conversation_id
    if (segments[0] === 'conversation' || segments[0] === 'chat') {
      const id = segments[1];
      if (!id) return null;
      return { type: '', conversation_id: id };
    }

    if (segments[0] === 'briefing') {
      if (segments[1] === 'settings') {
        return { type: 'briefing', route: '/settings/briefing' };
      }
      return { type: 'briefing', route: '/briefing' };
    }

    if (segments[0] === 'settings' && segments[1] === 'briefing') {
      return { type: 'briefing', route: '/settings/briefing' };
    }

    if (segments[0] === 'checkin') {
      // vela-client://checkin opens chat home so the reply becomes the check-in.
      return { type: 'checkin', route: '/' };
    }

    // If URL is like vela-client://{id} (single segment), treat as conversation_id
    // Do not misinterpret other top-level routes without id
    if (segments.length === 1) {
      // Single word like "oauth" etc — not a conversation link → null
      // Heuristic: assume UUID-like or non-empty single segment could be an id if caller explicitly expects it.
      // For notification deep-links we require conversation/ or chat/ prefix; single segment returns null to avoid false positives.
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Alias for parseUrl — retained for callers expecting parseDeepLinkUrl name. */
export const parseDeepLinkUrl = parseUrl;

/**
 * Route by notification type — single routing table per #133.
 * All known types (task_completion, calendar_reminder, briefing, checkin) currently
 * select the conversation and replace to '/' (chat home). Unknown/missing types
 * also replace to '/' without selecting a thread. Future extensibility: branch
 * briefing → '/briefing-history' and checkin → '/journal' where noted.
 */
export function routeByType(
  data: Record<string, string> | NotificationData | null | undefined,
  router: { replace: (path: string) => void },
  selectThread: (id: string | null) => void,
): void {
  const parsed = parseNotificationData(data as Record<string, string>);
  const { type, conversation_id } = parsed;

  // Normalize type for switch — empty/unknown falls to default
  const normalizedType = (type || '').trim();

  switch (normalizedType) {
    case 'task_completion': {
      if (conversation_id) {
        console.log(`[notifications] routing ${normalizedType} -> conversation/${conversation_id}`);
        selectThread(conversation_id);
      } else {
        console.log(`[notifications] routing ${normalizedType} without conversation_id`);
      }
      router.replace('/');
      break;
    }
    case 'calendar_reminder': {
      if (conversation_id) {
        console.log(`[notifications] routing ${normalizedType} -> conversation/${conversation_id}`);
        selectThread(conversation_id);
      } else {
        console.log(`[notifications] routing ${normalizedType} without conversation_id`);
      }
      router.replace('/');
      break;
    }
    case 'briefing': {
      if (conversation_id) {
        console.log(`[notifications] routing ${normalizedType} -> conversation/${conversation_id}`);
        selectThread(conversation_id);
        router.replace('/');
      } else {
        const targetRoute = parsed.route || '/briefing';
        console.log(`[notifications] routing ${normalizedType} to ${targetRoute}`);
        router.replace(targetRoute);
      }
      break;
    }
    case 'checkin': {
      // Future: router.replace('/journal')
      if (conversation_id) {
        console.log(`[notifications] routing ${normalizedType} -> conversation/${conversation_id}`);
        selectThread(conversation_id);
      } else {
        console.log(`[notifications] routing ${normalizedType} without conversation_id`);
      }
      router.replace('/');
      break;
    }
    default: {
      // generic / unknown / missing type
      if (conversation_id) {
        console.log(`[notifications] routing ${normalizedType || 'unknown'} -> conversation/${conversation_id}`);
        selectThread(conversation_id);
      } else {
        console.log(`[notifications] routing ${normalizedType || 'unknown'} without conversation_id`);
      }
      router.replace('/');
      break;
    }
  }
}
