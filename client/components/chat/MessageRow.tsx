import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ChatFeedItem } from '../chat/chatFeedTypes';
import { ThemeColors, FontSizes } from '../../utils/theme';
import { AuroraTheme } from '../../hooks/useAurora';
import { Message } from '../../store/useChatStore';
import DateDividerPill from './DateDividerPill';
import RichText from './RichText';
import BubbleFooter from './BubbleFooter';
import MessageItem from './MessageItem';
import { getCachedParse } from '../../utils/parseCache';

export interface MessageRowProps {
  item: ChatFeedItem;
  colors: ThemeColors;
  sizes: FontSizes;
  aurora: AuroraTheme;
  isStreamingMessage: boolean;
  onLongPress?: (msg: Message) => void;
  onCopyText?: (text: string) => void;
  accentHex?: string;
  isLocalMode?: boolean;
  agentName?: string;
  showRaw?: boolean;
  inViewport?: boolean;
  renderSegment?: (segment: any, idx: number) => React.ReactNode;
  actionBar?: React.ReactNode;
  compilingIndicator?: React.ReactNode;
  testID?: string;
}

export const MessageRow = React.memo(
  function MessageRow(props: MessageRowProps) {
    const {
      item,
      colors,
      sizes,
      aurora,
      isStreamingMessage,
      onLongPress,
      onCopyText,
      accentHex,
      isLocalMode,
      agentName,
      showRaw,
      inViewport,
      renderSegment,
      actionBar,
      compilingIndicator,
      testID,
    } = props;

    if (item.type === 'date_divider') {
      return <DateDividerPill label={item.label} colors={colors} />;
    }

    const message = item.message;
    const isUser = message.role === 'user';
    const { headerSegments, bubbleContent, sources } = getCachedParse(
      message.content,
      isUser,
      isStreamingMessage
    );

    return (
      <View
        testID={testID || `message-row-${message.id}`}
        style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}
      >
        <MessageItem
          message={message}
          isUser={isUser}
          colors={colors}
          sizes={sizes}
          aurora={aurora}
          accentHex={accentHex || aurora.acc1}
          isLocalMode={isLocalMode}
          agentName={agentName}
          showRaw={showRaw}
          isStreaming={isStreamingMessage}
          inViewport={inViewport ?? true}
          onLongPress={onLongPress ? () => onLongPress(message) : undefined}
          onCopyText={onCopyText}
          renderSegment={renderSegment}
          headerSegments={headerSegments}
          bubbleContent={bubbleContent}
          sources={sources}
          actionBar={actionBar}
          compilingIndicator={compilingIndicator}
        />
      </View>
    );
  },
  (prev, next) => {
    if (prev.item.type !== next.item.type) return false;
    if (prev.item.type === 'date_divider' && next.item.type === 'date_divider') {
      return prev.item.label === next.item.label;
    }
    const prevMsg = (prev.item as any).message;
    const nextMsg = (next.item as any).message;
    return (
      prevMsg?.id === nextMsg?.id &&
      prevMsg?.content === nextMsg?.content &&
      prev.isStreamingMessage === next.isStreamingMessage &&
      prev.colors === next.colors &&
      prev.sizes === next.sizes &&
      prev.showRaw === next.showRaw &&
      prev.inViewport === next.inViewport &&
      prev.actionBar === next.actionBar &&
      prev.isLocalMode === next.isLocalMode &&
      prev.accentHex === next.accentHex
    );
  }
);

export default MessageRow;

const styles = StyleSheet.create({
  row: {
    width: '100%',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
});
