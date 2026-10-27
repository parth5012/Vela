import React, { useState } from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

// Mock WebView for headless Jest
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: (props: any) => React.createElement(View, props),
  };
});

import { MessageRow, MessageRowProps } from '../components/chat/MessageRow';
import * as parseCacheModule from '../utils/parseCache';
import type { ChatFeedItem } from '../utils/chatFeed';
import type { ThemeColors, FontSizes } from '../utils/theme';
import type { AuroraTheme } from '../hooks/useAurora';
import type { Message } from '../store/useChatStore';

const dummyColors: ThemeColors = {
  background: '#09090b',
  card: '#1c1917',
  border: '#2c2724',
  text: '#f5f2eb',
  textMuted: '#a8a196',
  textDark: '#6e675e',
  bubbleUser: '#292524',
  bubbleUserBorder: '#3d3835',
  bubbleAssistant: 'rgba(217, 169, 109, 0.05)',
  bubbleAssistantBorder: 'rgba(217, 169, 109, 0.16)',
  skyTop: '#0e0d0b',
  skyBottom: '#171513',
  glass: 'rgba(245, 242, 235, 0.045)',
  glassBorder: 'rgba(245, 242, 235, 0.10)',
  aurora1: '#d97706',
  aurora2: '#fbbf24',
  glow: 'rgba(217, 119, 6, 0.35)',
  status: '#fbbf24',
  codeBg: 'rgba(14, 13, 11, 0.72)',
  codeFg: '#f5f2eb',
};

const dummySizes: FontSizes = {
  text: 14,
  sub: 12,
  title: 20,
  logo: 32,
};

const dummyAurora: AuroraTheme = {
  acc1: '#818cf8',
  acc2: '#c084fc',
  glow: 'rgba(129, 140, 248, 0.4)',
  onAccent: '#ffffff',
};

describe('MessageRow strictly memoized component (WF-455-03)', () => {
  beforeEach(() => {
    parseCacheModule.clearParseCache();
    jest.clearAllMocks();
  });

  it('renders a date divider pill when item is date_divider', () => {
    const dividerItem: ChatFeedItem = {
      type: 'date_divider',
      id: 'divider-2026-10-27',
      dateKey: '2026-10-27',
      label: 'Today',
    };

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageRow
          item={dividerItem}
          colors={dummyColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          isStreamingMessage={false}
        />
      );
    });

    const root = tree!.root;
    expect(root).toBeDefined();
  });

  it('renders historical user and assistant messages properly', () => {
    const userItem: ChatFeedItem = {
      type: 'message',
      id: 'msg-u1',
      message: {
        id: 'msg-u1',
        role: 'user',
        content: 'Hello, this is a test prompt.',
        created_at: new Date().toISOString(),
      },
    };

    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageRow
          item={userItem}
          colors={dummyColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          isStreamingMessage={false}
        />
      );
    });

    expect(tree!.root.findByProps({ testID: 'message-row-msg-u1' })).toBeDefined();
  });

  it('eliminates redundant cell rerenders for historical messages during active streaming', () => {
    const parseSpy = jest.spyOn(parseCacheModule, 'getCachedParse');

    const historicalUser: ChatFeedItem = {
      type: 'message',
      id: 'msg-hist-user',
      message: {
        id: 'msg-hist-user',
        role: 'user',
        content: 'What is the capital of France?',
        created_at: '2026-10-27T10:00:00.000Z',
      },
    };

    const historicalAssistant: ChatFeedItem = {
      type: 'message',
      id: 'msg-hist-ast',
      message: {
        id: 'msg-hist-ast',
        role: 'assistant',
        content: 'The capital of France is Paris.',
        created_at: '2026-10-27T10:00:05.000Z',
      },
    };

    const dateDivider: ChatFeedItem = {
      type: 'date_divider',
      id: 'divider-today',
      dateKey: '2026-10-27',
      label: 'Today',
    };

    // Chat feed parent container simulating streaming chunk updates
    const ChatFeedContainer = ({
      streamingContent,
    }: {
      streamingContent: string;
    }) => {
      const streamingItem: ChatFeedItem = {
        type: 'message',
        id: 'msg-streaming',
        message: {
          id: 'msg-streaming',
          role: 'assistant',
          content: streamingContent,
          created_at: '2026-10-27T10:01:00.000Z',
        },
      };

      return (
        <View>
          <MessageRow
            key={dateDivider.id}
            item={dateDivider}
            colors={dummyColors}
            sizes={dummySizes}
            aurora={dummyAurora}
            isStreamingMessage={false}
          />
          <MessageRow
            key={historicalUser.id}
            item={historicalUser}
            colors={dummyColors}
            sizes={dummySizes}
            aurora={dummyAurora}
            isStreamingMessage={false}
          />
          <MessageRow
            key={historicalAssistant.id}
            item={historicalAssistant}
            colors={dummyColors}
            sizes={dummySizes}
            aurora={dummyAurora}
            isStreamingMessage={false}
          />
          <MessageRow
            key={streamingItem.id}
            item={streamingItem}
            colors={dummyColors}
            sizes={dummySizes}
            aurora={dummyAurora}
            isStreamingMessage={true}
          />
        </View>
      );
    };

    let comp: renderer.ReactTestRenderer;
    act(() => {
      comp = renderer.create(<ChatFeedContainer streamingContent="Initial" />);
    });

    // Count baseline parses for historical messages
    const userParsesAfterMount = parseSpy.mock.calls.filter(
      (c) => c[0] === 'What is the capital of France?'
    ).length;
    const astParsesAfterMount = parseSpy.mock.calls.filter(
      (c) => c[0] === 'The capital of France is Paris.'
    ).length;

    expect(userParsesAfterMount).toBe(1);
    expect(astParsesAfterMount).toBe(1);

    // Simulate 20 streaming token arrivals updating the parent container
    for (let token = 1; token <= 20; token++) {
      act(() => {
        comp.update(
          <ChatFeedContainer
            streamingContent={`Initial token chunk ${token}`}
          />
        );
      });
    }

    // Historical messages must not have re-parsed or re-rendered
    const userParsesAfterStream = parseSpy.mock.calls.filter(
      (c) => c[0] === 'What is the capital of France?'
    ).length;
    const astParsesAfterStream = parseSpy.mock.calls.filter(
      (c) => c[0] === 'The capital of France is Paris.'
    ).length;

    const redundantCellRerenders =
      (userParsesAfterStream - userParsesAfterMount) +
      (astParsesAfterStream - astParsesAfterMount);

    expect(redundantCellRerenders).toBe(0);
    expect(userParsesAfterStream).toBe(1);
    expect(astParsesAfterStream).toBe(1);

    // The streaming message must have parsed for each update
    const streamingParses = parseSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith('Initial token chunk')
    ).length;
    expect(streamingParses).toBe(20);
  });

  it('re-renders when theme props change', () => {
    const parseSpy = jest.spyOn(parseCacheModule, 'getCachedParse');

    const item: ChatFeedItem = {
      type: 'message',
      id: 'msg-theme-test',
      message: {
        id: 'msg-theme-test',
        role: 'assistant',
        content: 'Theme responsive message',
        created_at: '2026-10-27T10:00:00.000Z',
      },
    };

    let comp: renderer.ReactTestRenderer;
    act(() => {
      comp = renderer.create(
        <MessageRow
          item={item}
          colors={dummyColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          isStreamingMessage={false}
        />
      );
    });

    const newColors: ThemeColors = {
      ...dummyColors,
      background: '#ffffff',
    };

    act(() => {
      comp.update(
        <MessageRow
          item={item}
          colors={newColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          isStreamingMessage={false}
        />
      );
    });

    // Re-render occurred on color theme change
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });
});
