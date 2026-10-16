/**
 * Module: client/components/ui/ThreadRow
 * Intent: Single "Recent Chats" thread row (title + pin prefix + timestamp + streaming indicator),
 *   extracted verbatim from components/ui/DrawerContent.tsx.
 * Public API: ThreadRow props { thread, isActive, streaming, colors, accentHex, onSelect, onOpenOptions }.
 * Invariants: delayLongPress={450} overflow via ThreadOptionsModal; timestamp via utils/timeAgo.
 * Side Effects: none (pure render).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Thread } from '../../store/useChatStore';
import { formatDistanceToNow } from '../../utils/timeAgo';
import { styles } from './drawerContentStyles';

type ThreadRowProps = {
  thread: Thread;
  isActive: boolean;
  streaming: boolean;
  colors: any;
  accentHex: string;
  onSelect: (id: string) => void;
  onOpenOptions: (thread: Thread) => void;
};

export default function ThreadRow({ thread, isActive, streaming, colors, accentHex, onSelect, onOpenOptions }: ThreadRowProps) {
  const timeAgo = thread.updated_at ? formatDistanceToNow(thread.updated_at) : '';
  return (
    <Pressable
      style={[
        styles.threadItem,
        isActive && styles.activeThreadItem,
        isActive && { backgroundColor: colors.card }
      ]}
      onPress={() => onSelect(thread.id)}
      onLongPress={() => onOpenOptions(thread)}
      delayLongPress={450}
    >
      <View style={styles.threadTextCol}>
        <Text
          style={[
            styles.threadTitle,
            { color: colors.textMuted },
            thread.is_pinned && styles.pinnedThreadTitle,
            thread.is_pinned && { color: colors.text },
            isActive && styles.activeThreadTitle,
            isActive && { color: colors.text }
          ]}
          numberOfLines={1}
        >
          {thread.is_pinned ? '📌 ' : ''}{thread.title}
        </Text>
        {timeAgo ? (
          <Text style={[styles.threadTimestamp, { color: colors.textDark }]} numberOfLines={1}>
            {timeAgo}
          </Text>
        ) : null}
      </View>
      {streaming && (
        <ActivityIndicator size="small" color={accentHex} style={{ marginLeft: 6 }} />
      )}
    </Pressable>
  );
}
