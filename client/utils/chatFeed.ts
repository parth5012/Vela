import { formatDateDividerLabel, parseSafeDate, toLocalDateKey } from './date';
import type { Message } from '../store/useChatStore';

/**
 * Discriminated union feed items for the inverted chat FlatList.
 *
 * Governed by ADR-0005 and docs/wayfinder/281-date-divider-spec.md.
 * Items are built chronologically (divider prepended per day cluster),
 * then reversed so index 0 is the newest row for `<FlatList inverted />`.
 */
export type ChatFeedItem =
  | {
      type: 'message';
      id: string;
      message: Message;
    }
  | {
      type: 'date_divider';
      id: string;
      dateKey: string;
      label: string;
    };

export function buildChatFeedItems(messages: Message[]): ChatFeedItem[] {
  const result: ChatFeedItem[] = [];
  let lastDateKey: string | null = null;

  // Walk in chronological order (oldest to newest).
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
    // Missing/invalid timestamps coalesce into the neighboring cluster:
    // no divider is inserted, the message is simply appended.
    result.push({
      type: 'message',
      id: message.id,
      message,
    });
  }

  // Reverse so newest items appear at index 0 for inverted FlatList.
  return result.reverse();
}
