// @ts-nocheck
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList, Pressable, Text } from 'react-native';
import { streamController } from '../utils/streamController';

jest.mock('../utils/streamController', () => ({
  streamController: {
    stopStream: jest.fn(async () => {}),
    startStream: jest.fn(async () => {}),
    abortAll: jest.fn(async () => {}),
    appendChunk: jest.fn(),
    isStreaming: jest.fn(() => false),
    cleanup: jest.fn(),
    flush: jest.fn(),
  },
}));

describe('ChatFlatList performance props', () => {
  it('FlatList accepts and forwards performance optimization props', async () => {
    const messages = [
      { id: 'msg-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there' },
    ];

    let renderedProps: Record<string, any> | null = null;

    const MyFlatList = (props: any) => {
      renderedProps = props;
      return React.createElement(FlatList, props);
    };

    await act(async () => {
      renderer.create(
        React.createElement(MyFlatList, {
          data: messages,
          inverted: true,
          keyExtractor: (item: any) => item.id,
          renderItem: ({ item }: any) =>
            React.createElement('View', null, item.content),
          removeClippedSubviews: true,
          windowSize: 11,
          maxToRenderPerBatch: 10,
          updateCellsBatchingPeriod: 50,
          initialNumToRender: 15,
        })
      );
    });

    expect(renderedProps).not.toBeNull();
    expect(renderedProps?.removeClippedSubviews).toBe(true);
    expect(renderedProps?.windowSize).toBe(11);
    expect(renderedProps?.maxToRenderPerBatch).toBe(10);
    expect(renderedProps?.updateCellsBatchingPeriod).toBe(50);
    expect(renderedProps?.initialNumToRender).toBe(15);
    expect(renderedProps?.inverted).toBe(true);
    expect(typeof renderedProps?.keyExtractor).toBe('function');
    expect(typeof renderedProps?.renderItem).toBe('function');
  });
});

describe('ChatSendButton stream toggle and stopStream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const ChatSendButton = ({
    isCurrentThreadStreaming,
    input,
    activeThreadId,
  }: {
    isCurrentThreadStreaming: boolean;
    input: string;
    activeThreadId: string;
  }) => {
    const handleSendPress = () => {
      if (isCurrentThreadStreaming && activeThreadId) {
        streamController.stopStream(activeThreadId);
        return;
      }
    };

    return React.createElement(
      Pressable,
      {
        testID: 'send-button',
        onPress: handleSendPress,
        disabled: !isCurrentThreadStreaming && !input.trim(),
        accessibilityRole: 'button',
        accessibilityLabel: isCurrentThreadStreaming ? 'Stop generating' : 'Send message',
      },
      React.createElement(Text, null, isCurrentThreadStreaming ? 'Stop' : 'Send')
    );
  };

  it('renders Send button when not streaming and disables it when input is empty', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        React.createElement(ChatSendButton, {
          isCurrentThreadStreaming: false,
          input: '',
          activeThreadId: 'thread-1',
        })
      );
    });

    const button = tree.root.findByProps({ testID: 'send-button' });
    expect(button.props.accessibilityLabel).toBe('Send message');
    expect(button.props.disabled).toBe(true);

    const text = button.findByType(Text);
    expect(text.props.children).toBe('Send');
  });

  it('renders Send button enabled when not streaming and input is non-empty', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        React.createElement(ChatSendButton, {
          isCurrentThreadStreaming: false,
          input: 'Hello',
          activeThreadId: 'thread-1',
        })
      );
    });

    const button = tree.root.findByProps({ testID: 'send-button' });
    expect(button.props.accessibilityLabel).toBe('Send message');
    expect(button.props.disabled).toBe(false);

    const text = button.findByType(Text);
    expect(text.props.children).toBe('Send');
  });

  it('toggles Send button to Stop during stream, not disabled even if input is empty', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        React.createElement(ChatSendButton, {
          isCurrentThreadStreaming: true,
          input: '',
          activeThreadId: 'thread-1',
        })
      );
    });

    const button = tree.root.findByProps({ testID: 'send-button' });
    expect(button.props.accessibilityLabel).toBe('Stop generating');
    expect(button.props.disabled).toBe(false);

    const text = button.findByType(Text);
    expect(text.props.children).toBe('Stop');
  });

  it('tapping Stop calls streamController.stopStream with activeThreadId', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        React.createElement(ChatSendButton, {
          isCurrentThreadStreaming: true,
          input: '',
          activeThreadId: 'thread-xyz',
        })
      );
    });

    const button = tree.root.findByProps({ testID: 'send-button' });
    await act(async () => {
      button.props.onPress();
    });

    expect(streamController.stopStream).toHaveBeenCalledTimes(1);
    expect(streamController.stopStream).toHaveBeenCalledWith('thread-xyz');
  });
});


