import React from 'react';
import { Text, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import {
  MessageList,
  getMessageItemType,
  calculateBlankCellRatio,
  DEFAULT_ESTIMATED_ITEM_SIZE,
} from '../components/chat/MessageList';
import type { ChatFeedItem } from '../utils/chatFeed';

describe('MessageList & View Recycling Verification', () => {
  const sampleItems: ChatFeedItem[] = [
    {
      type: 'message',
      id: 'm1',
      message: {
        id: 'm1',
        role: 'user',
        content: 'Hello world',
        created_at: '2026-10-20T10:00:00Z',
      },
    },
    {
      type: 'message',
      id: 'm2',
      message: {
        id: 'm2',
        role: 'assistant',
        content: 'Hi! How can I assist you?',
        created_at: '2026-10-20T10:00:05Z',
      },
    },
    {
      type: 'date_divider',
      id: 'divider-2026-10-20',
      dateKey: '2026-10-20',
      label: 'Today',
    },
  ];

  it('determines stable item types for cell recycling', () => {
    expect(getMessageItemType(sampleItems[0])).toBe('user');
    expect(getMessageItemType(sampleItems[1])).toBe('assistant');
    expect(getMessageItemType(sampleItems[2])).toBe('date_divider');
    expect(getMessageItemType({ role: 'system' })).toBe('system');
    expect(getMessageItemType(null)).toBe('default');
  });

  it('renders MessageList with estimatedItemSize and inverted by default', () => {
    let root: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(
        <MessageList
          data={sampleItems}
          renderItem={({ item }) => (
            <View testID={`item-${item.id}`}>
              <Text>{item.type === 'message' ? item.message.content : item.label}</Text>
            </View>
          )}
        />
      );
    });

    const tree = root!.toJSON();
    expect(tree).toBeDefined();

    // Verify FlashList props through component instance
    const flashListInstance = root!.root.findByProps({ testID: 'chat-message-list' });
    expect(flashListInstance.props.estimatedItemSize).toBe(DEFAULT_ESTIMATED_ITEM_SIZE);
    expect(flashListInstance.props.inverted).toBe(true);
    expect(flashListInstance.props.data.length).toBe(3);
  });

  it('supports custom estimatedItemSize and non-inverted mode if required', () => {
    let root: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(
        <MessageList
          data={sampleItems}
          estimatedItemSize={120}
          inverted={false}
          renderItem={({ item }) => <Text>{item.id}</Text>}
        />
      );
    });

    const flashListInstance = root!.root.findByProps({ testID: 'chat-message-list' });
    expect(flashListInstance.props.estimatedItemSize).toBe(120);
    expect(flashListInstance.props.inverted).toBe(false);
  });

  it('validates synthetic fling benchmark: scroll_blank_cell_ratio < 0.4%', () => {
    // Under 5,000 synthetic rendered cells, test with 12 blank events (< 0.25% blank ratio)
    const result = calculateBlankCellRatio(5000, 12);
    expect(result.scroll_blank_cell_ratio).toBe(0.24);
    expect(result.passesWhatsAppTarget).toBe(true);
    expect(result.scroll_blank_cell_ratio).toBeLessThan(0.4);

    const failingResult = calculateBlankCellRatio(1000, 10); // 1.0%
    expect(failingResult.passesWhatsAppTarget).toBe(false);
  });

  it('matches snapshot', () => {
    let root: renderer.ReactTestRenderer;
    act(() => {
      root = renderer.create(
        <MessageList
          data={sampleItems}
          renderItem={({ item }) => (
            <Text>{item.type === 'message' ? item.message.content : item.label}</Text>
          )}
        />
      );
    });
    expect(root!.toJSON()).toMatchSnapshot();
  });
});
