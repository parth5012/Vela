import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import RichText from './RichText';
import BubbleFooter from './BubbleFooter';
import SourceCard from './SourceCard';
import type { Message } from '../../store/useChatStore';
import { useActiveStreamStore } from '../../store/useActiveStreamStore';

export interface MessageItemProps {
  message: Message;
  isUser: boolean;
  colors: any;
  sizes: any;
  aurora: any;
  accentHex: string;
  isLocalMode?: boolean;
  agentName?: string;
  showRaw?: boolean;
  isStreaming?: boolean;
  inViewport?: boolean; // When false, unmounts heavy AST representation to bound heap memory (WF-427-05)
  onLongPress?: () => void;
  onCopyText?: (text: string) => void;
  renderSegment?: (segment: any, idx: number) => React.ReactNode;
  headerSegments?: any[];
  bubbleContent?: any[];
  sources?: any[];
  actionBar?: React.ReactNode;
  compilingIndicator?: React.ReactNode;
  testID?: string;
}

/**
 * Recyclable Chat Message Cell component.
 * Implements memory virtualization (WF-427-05): when scrolled outside the active
 * viewport buffer (`inViewport === false`), unmounts expensive RichText AST trees
 * and WebViews, releasing PSS heap allocations.
 */
function MessageItemBase({
  message,
  isUser,
  colors,
  sizes,
  aurora,
  accentHex,
  isLocalMode = false,
  agentName = 'Vela',
  showRaw = false,
  isStreaming = false,
  inViewport = true,
  onLongPress,
  onCopyText,
  renderSegment,
  headerSegments = [],
  bubbleContent = [],
  sources = [],
  actionBar,
  compilingIndicator,
  testID,
}: MessageItemProps) {
  const streamingText = useActiveStreamStore((s) =>
    isStreaming && s.streamingMessageId === message.id ? s.streamingText : ''
  );
  const effectiveContent = isStreaming && streamingText ? streamingText : message.content;

  return (
    <View
      testID={testID || `message-item-${message.id}`}
      style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}
    >
      <View
        style={{
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          width: '100%',
        }}
      >
        {!isUser && inViewport && headerSegments.length > 0 && renderSegment && (
          <View style={styles.thoughtNestingContainer}>
            {headerSegments.map((segment, idx) => renderSegment(segment, idx))}
          </View>
        )}

        <Pressable
          onLongPress={onLongPress}
          style={({ pressed }) => [
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            pressed && { opacity: 0.85 },
            !isUser && { backgroundColor: colors.glass, borderColor: colors.glassBorder },
            isUser && { backgroundColor: aurora.acc1, borderColor: aurora.acc2 },
          ]}
        >
          {!isUser && (
            <Text style={[styles.senderLabel, { color: aurora.acc1 }]}>
              {isLocalMode ? 'Gemma (Local)' : agentName}
            </Text>
          )}

          {isUser ? (
            <Text style={[styles.messageText, { color: aurora.onAccent, fontSize: sizes.text }]}>
              {message.content}
            </Text>
          ) : showRaw ? (
            <Text style={[styles.rawText, { color: colors.text, fontSize: sizes.text }]}>
              {effectiveContent}
            </Text>
          ) : !inViewport ? (
            // Lightweight virtualization: off-screen cell unmounts rich AST parser
            <Text
              testID="message-ast-unmounted"
              numberOfLines={4}
              style={[styles.virtualizedText, { color: colors.textMuted, fontSize: sizes.text }]}
            >
              {effectiveContent}
            </Text>
          ) : bubbleContent.length === 0 ? (
            <RichText
              content={effectiveContent || '…'}
              colors={colors}
              sizes={sizes}
              accentHex={accentHex}
              onCopyText={onCopyText}
              isStreaming={isStreaming}
            />
          ) : (
            <View style={{ gap: 8 }}>
              {bubbleContent.map((segment, idx) => {
                if (segment.type === 'text') {
                  return (
                    <RichText
                      key={idx}
                      content={segment.content || ''}
                      colors={colors}
                      sizes={sizes}
                      accentHex={accentHex}
                      onCopyText={onCopyText}
                      isStreaming={isStreaming}
                    />
                  );
                }
                return renderSegment ? renderSegment(segment, idx) : null;
              })}
            </View>
          )}

          <BubbleFooter
            createdAt={message.created_at}
            isUser={isUser}
            isStreaming={isStreaming}
            inViewport={inViewport}
            aurora={aurora}
            colors={colors}
          />
        </Pressable>

        {!isUser && inViewport && sources.length > 0 && (
          <View style={{ marginTop: 8, width: '100%' }}>
            <Text style={[styles.sourcesTitleLabel, { color: colors.textMuted }]}>
              Reference Sources
            </Text>
            <View style={styles.sourcesContainer}>
              {sources.map((src, srcIdx) => (
                <SourceCard
                  key={srcIdx}
                  src={src}
                  colors={colors}
                  sizes={sizes}
                  accentHex={accentHex}
                />
              ))}
            </View>
          </View>
        )}

        {compilingIndicator}
        {actionBar}
      </View>
    </View>
  );
}

export const MessageItem = memo(MessageItemBase, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.isStreaming === next.isStreaming &&
    prev.inViewport === next.inViewport &&
    prev.showRaw === next.showRaw &&
    prev.accentHex === next.accentHex &&
    prev.isUser === next.isUser
  );
});

export default MessageItem;

const styles = StyleSheet.create({
  messageRow: {
    marginVertical: 4,
    paddingHorizontal: 12,
    width: '100%',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '88%',
  },
  userBubble: {},
  assistantBubble: {},
  senderLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  messageText: {
    lineHeight: 20,
  },
  rawText: {
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  virtualizedText: {
    lineHeight: 20,
  },
  thoughtNestingContainer: {
    width: '100%',
    marginBottom: 6,
  },
  sourcesTitleLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    marginLeft: 4,
    letterSpacing: 0.2,
  },
  sourcesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
