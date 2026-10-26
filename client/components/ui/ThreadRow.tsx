/**
 * Module: client/components/ui/ThreadRow
 * Intent: Single "Recent Chats" thread row (title + pin prefix + timestamp + streaming indicator),
 *   extracted verbatim from components/ui/DrawerContent.tsx.
 * Public API: ThreadRow props { thread, isActive, streaming, colors, accentHex, onSelect, onOpenOptions }.
 * Invariants: delayLongPress={450} overflow via ThreadOptionsModal; timestamp via utils/timeAgo.
 * Side Effects: none (pure render).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
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

export default function ThreadRow({
  thread,
  isActive,
  streaming,
  colors,
  accentHex,
  onSelect,
  onOpenOptions,
}: ThreadRowProps) {
  const timeAgo = thread.updated_at ? formatDistanceToNow(thread.updated_at) : '';
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!streaming) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, pulse]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.threadItem,
        isActive && styles.activeThreadItem,
        isActive && { backgroundColor: colors.card, borderColor: colors.glassBorder },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.85 },
      ]}
      onPress={() => onSelect(thread.id)}
      onLongPress={() => onOpenOptions(thread)}
      delayLongPress={450}
    >
      <View style={styles.threadTextCol}>
        <View style={styles.threadTitleRow}>
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
          {streaming && (
            <Animated.View
              testID="thread-streaming-indicator"
              accessible={true}
              accessibilityLabel="Streaming in progress"
              style={[
                styles.pulsingDot,
                { backgroundColor: accentHex, opacity: pulse },
              ]}
            />
          )}
        </View>
        {timeAgo ? (
          <Text style={[styles.threadTimestamp, { color: colors.textDark }]} numberOfLines={1}>
            {timeAgo}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
