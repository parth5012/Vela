import React, { forwardRef } from 'react';
import {
  StyleProp,
  ViewStyle,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FlashList, ListRenderItem, FlashListRef } from '@shopify/flash-list';
import type { ChatFeedItem } from '../../utils/chatFeed';

export interface MessageListProps<T = ChatFeedItem> {
  data: T[];
  renderItem: ListRenderItem<T>;
  keyExtractor?: (item: T, index: number) => string;
  getItemType?: (item: T, index: number, extraData?: any) => string | number | undefined;
  estimatedItemSize?: number;
  inverted?: boolean;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  extraData?: any;
  testID?: string;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}

/**
 * Returns a stable item type for view recycling in FlashList.
 * Recycles cells based on role: 'user', 'assistant', 'system', or 'date_divider'.
 */
export function getMessageItemType(item: any): string {
  if (!item) return 'default';
  if (item.type === 'date_divider') {
    return 'date_divider';
  }
  if (item.type === 'message' && item.message) {
    return item.message.role || 'user';
  }
  if (item.role) {
    return item.role;
  }
  return 'default';
}

export const DEFAULT_ESTIMATED_ITEM_SIZE = 84;

/**
 * High-performance recycled message feed component powered by Shopify FlashList.
 * Replaces standard FlatList to eliminate blank spaces on fast flings and
 * minimizes memory churn via native view recycling.
 */
export const MessageList = forwardRef<FlashListRef<any>, MessageListProps<any>>(
  function MessageList(
    {
      data,
      renderItem,
      keyExtractor,
      getItemType = getMessageItemType,
      estimatedItemSize = DEFAULT_ESTIMATED_ITEM_SIZE,
      inverted = true,
      onScroll,
      scrollEventThrottle = 16,
      contentContainerStyle,
      ListEmptyComponent,
      extraData,
      testID = 'chat-message-list',
      keyboardShouldPersistTaps = 'handled',
    },
    ref
  ) {
    const defaultKeyExtractor = (item: any, index: number) => {
      if (item?.type === 'date_divider') return item.id;
      if (item?.type === 'message' && item?.message?.id) return item.message.id;
      if (item?.id) return item.id;
      return String(index);
    };

    const flashListProps: any = {
      ref,
      testID,
      data,
      renderItem,
      keyExtractor: keyExtractor || defaultKeyExtractor,
      getItemType,
      estimatedItemSize,
      inverted,
      onScroll,
      scrollEventThrottle,
      contentContainerStyle,
      ListEmptyComponent,
      extraData,
      keyboardShouldPersistTaps,
    };

    return <FlashList {...flashListProps} />;
  }
);

/**
 * Benchmark simulator to calculate scroll blank cell ratio under synthetic fling.
 */
export function calculateBlankCellRatio(
  totalCellsRendered: number,
  unrenderedBlankEvents: number
): { scroll_blank_cell_ratio: number; passesWhatsAppTarget: boolean } {
  if (totalCellsRendered <= 0) {
    return { scroll_blank_cell_ratio: 0, passesWhatsAppTarget: true };
  }
  const ratio = (unrenderedBlankEvents / totalCellsRendered) * 100;
  return {
    scroll_blank_cell_ratio: Number(ratio.toFixed(3)),
    passesWhatsAppTarget: ratio < 0.4,
  };
}
