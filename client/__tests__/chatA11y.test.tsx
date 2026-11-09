// @ts-nocheck
/**
 * Wayfinder #551 — chat UI accessibility contract.
 *
 * Exhaustive a11y assertions for: BubbleFooter, DateDividerPill,
 * CollapsibleBlock, MessageItem, MessageList (chat-scroll),
 * ThreadOptionsModal, emptyState, RichText code actions, MermaidRenderer.
 *
 * Every assertion targets a real accessibilityLabel/role/state on the
 * production render — removing any of those props turns the suite red
 * (see mutation proof in the task summary).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View, TextInput } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../db/client', () => ({
  db: null,
  expoDb: null,
  initializeDatabase: jest.fn(async () => {}),
  default: null,
}));

jest.mock('../db/chatRepository', () => ({
  saveThread: jest.fn(async () => {}),
  saveThreads: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {}),
  saveMessages: jest.fn(async () => {}),
  deleteThreadLocal: jest.fn(async () => {}),
  deleteMessageLocal: jest.fn(async () => {}),
  replaceThreadMessages: jest.fn(async () => {}),
  hydrateChatFromLocalDb: jest.fn(async () => {}),
  clearChatLocal: jest.fn(async () => {}),
  queueMessageForSync: jest.fn(async () => {}),
  isLocalDbAvailable: jest.fn(() => false),
}));

jest.mock('../utils/localLlm', () => ({
  initializeLocalModel: jest.fn(async () => {}),
  streamLocalLlmResponse: jest.fn(),
  isLocalLlmDown: jest.fn(() => false),
  isStoredModelUsable: jest.fn(async () => true),
  localModelStorageKey: jest.fn(),
  LOCAL_MODELS: {},
}));

jest.mock('../utils/toolProxy', () => ({
  parseAndExecuteTools: jest.fn(),
}));

jest.mock('../utils/providers', () => ({
  streamCloudResponse: jest.fn(),
}));

jest.mock('../utils/cloudTools', () => ({
  buildVercelCloudTools: jest.fn(),
}));

jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: (props: any) => React.createElement(View, { ...props, testID: 'webview-mock' }),
  };
});

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-native-markdown-display', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      const content = props.children || '';
      const rules = props.rules || {};
      if (typeof content === 'string') {
        if (content.includes('```mermaid')) {
          const node = { key: 'simulated-mermaid', content: 'graph TD\nA-->B', info: 'mermaid' };
          if (rules.fence) return rules.fence(node);
        } else if (content.includes('```typescript')) {
          const node = { key: 'simulated-typescript', content: 'const x = 1;', info: 'typescript' };
          if (rules.fence) return rules.fence(node);
        }
      }
      return React.createElement(View, null, React.createElement(Text, null, content));
    },
  };
});

import BubbleFooter from '../components/chat/BubbleFooter';
import DateDividerPill from '../components/chat/DateDividerPill';
import CollapsibleBlock from '../components/chat/CollapsibleBlock';
import MessageItem from '../components/chat/MessageItem';
import { MessageList } from '../components/chat/MessageList';
import ThreadOptionsModal from '../components/ui/ThreadOptionsModal';
import RichText from '../components/chat/RichText';
import MermaidRenderer from '../components/chat/MermaidRenderer';
import PressableScale from '../components/ui/PressableScale';
import { formatTimestamp } from '../utils/date';
import { EmptyChatState, EMPTY_CTA_LABEL } from '../app/index';
import { useChatStore } from '../store/useChatStore';

/* ---------------- helpers ---------------- */

const dummyColors: any = {
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
  codeBg: 'rgba(14, 13, 11, 0.72)',
  codeFg: '#f5f2eb',
  glass: 'rgba(245, 242, 235, 0.045)',
  glassBorder: 'rgba(245, 242, 235, 0.1)',
};

const dummySizes: any = {
  text: 14,
  sub: 12,
  title: 20,
  lineHeight: 21,
  letterSpacing: 0.1,
  titleLetterSpacing: -0.2,
  logo: 32,
  subLineHeight: 18,
  logoLetterSpacing: -0.4,
  fontWeight: '400',
};

const dummyAurora: any = {
  acc1: '#818cf8',
  acc2: '#c084fc',
  glow: 'rgba(129, 140, 248, 0.4)',
  onAccent: '#ffffff',
};

const findByLabel = (root: any, label: string) =>
  root.findAll((n: any) => n.props?.accessibilityLabel === label);

/** First host node (string type) carrying the label, or the first match. */
const hostByLabel = (root: any, label: string) => {
  const all = findByLabel(root, label);
  expect(all.length).toBeGreaterThan(0);
  return all.find((n: any) => typeof n.type === 'string') ?? all[0];
};

const expectButton = (root: any, label: string) => {
  const nodes = findByLabel(root, label);
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.some((n: any) => n.props.accessibilityRole === 'button')).toBe(true);
  return nodes;
};

function render(element: React.ReactElement) {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree!;
}

/* ---------------- BubbleFooter ---------------- */

describe('chatA11y: BubbleFooter', () => {
  const CREATED_AT = '2026-09-21T10:42:00.000Z';

  it('exposes a TalkBack label "Sent at <time>" on the timestamp', () => {
    const tree = render(
      <BubbleFooter createdAt={CREATED_AT} isUser={false} aurora={dummyAurora} colors={dummyColors} />
    );
    const formatted = formatTimestamp(CREATED_AT);
    expect(formatted).not.toBeNull();
    const node = hostByLabel(tree.root, `Sent at ${formatted}`);
    expect(node.type).toBe('Text');
    expect(node.props.children).toBe(formatted);
    act(() => tree.unmount());
  });

  it('keeps the timestamp label for user bubbles too', () => {
    const tree = render(
      <BubbleFooter createdAt={CREATED_AT} isUser={true} aurora={dummyAurora} colors={dummyColors} />
    );
    const formatted = formatTimestamp(CREATED_AT);
    expect(tree.root.findByProps({ accessibilityLabel: `Sent at ${formatted}` })).toBeDefined();
    act(() => tree.unmount());
  });
});

/* ---------------- DateDividerPill ---------------- */

describe('chatA11y: DateDividerPill', () => {
  it('is a header with a "Date divider:" label', () => {
    const tree = render(<DateDividerPill label="Today" colors={dummyColors} />);
    const node = hostByLabel(tree.root, 'Date divider: Today');
    expect(node.props.accessibilityRole).toBe('header');
    act(() => tree.unmount());
  });

  it('reflects the label text in the a11y label (not just the visible text)', () => {
    const tree = render(<DateDividerPill label="Wed, Jun 10" colors={dummyColors} />);
    expect(tree.root.findByProps({ accessibilityLabel: 'Date divider: Wed, Jun 10' })).toBeDefined();
    act(() => tree.unmount());
  });
});

/* ---------------- CollapsibleBlock (chat-scroll) ---------------- */

describe('chatA11y: CollapsibleBlock', () => {
  it('expanded header: role button, label "Collapse …", expanded state true', () => {
    const tree = render(
      <CollapsibleBlock
        type="thought"
        isClosed={false}
        themeColors={dummyColors}
        themeSizes={dummySizes}
        accentHex="#6366f1"
      >
        <View />
      </CollapsibleBlock>
    );
    const node = hostByLabel(tree.root, 'Collapse Thought Process');
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true })
    );
    act(() => tree.unmount());
  });

  it('collapsed header: label "Expand …", expanded state false', () => {
    const tree = render(
      <CollapsibleBlock
        type="tool_call"
        name="search_files"
        isClosed={true}
        themeColors={dummyColors}
        themeSizes={dummySizes}
        accentHex="#6366f1"
      >
        <View />
      </CollapsibleBlock>
    );
    const node = hostByLabel(tree.root, 'Expand Executed: search_files');
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: false })
    );
    act(() => tree.unmount());
  });

  it('focus survives toggling: after collapse the header is still a labelled button', () => {
    jest.useFakeTimers();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <CollapsibleBlock
          type="thought"
          isClosed={false}
          themeColors={dummyColors}
          themeSizes={dummySizes}
          accentHex="#6366f1"
        >
          <View />
        </CollapsibleBlock>
      );
    });
    const header = hostByLabel(tree!.root, 'Collapse Thought Process');
    // PressableScale forwards onPress to host; climb to the pressable node.
    let pressable = header;
    while (pressable && typeof pressable.props?.onPress !== 'function') {
      pressable = pressable.parent;
    }
    // The PressableScale composite itself carries onPress.
    if (!pressable || typeof pressable.props?.onPress !== 'function') {
      pressable = tree!.root.findAll((n: any) => typeof n.props?.onPress === 'function')[0];
    }
    act(() => {
      pressable.props.onPress();
    });
    act(() => {
      jest.advanceTimersByTime(300);
      jest.runAllTimers();
    });
    const after = hostByLabel(tree!.root, 'Expand Thought Process');
    expect(after.props.accessibilityRole).toBe('button');
    expect(after.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    jest.useRealTimers();
    act(() => tree!.unmount());
  });
});

/* ---------------- MessageItem ---------------- */

describe('chatA11y: MessageItem', () => {
  const baseMessage = (role: 'user' | 'assistant') => ({
    id: `msg-${role}-a11y`,
    conversation_id: 'conv-1',
    role,
    content: role === 'user' ? 'Hello Vela' : 'Hello! How can I help?',
    created_at: '2026-09-21T10:42:00.000Z',
  });

  it('user bubble: role button with label "Your message" and long-press hint', () => {
    const tree = render(
      <MessageItem
        message={baseMessage('user') as any}
        isUser
        colors={dummyColors}
        sizes={dummySizes}
        aurora={dummyAurora}
        accentHex="#818cf8"
        onLongPress={() => {}}
      />
    );
    const node = expectButton(tree.root, 'Your message');
    expect(node.some((n: any) => n.props.accessibilityHint === 'Long press for options')).toBe(true);
    expect(tree.root.findByProps({ testID: 'message-item-msg-user-a11y' })).toBeDefined();
    act(() => tree.unmount());
  });

  it('assistant bubble: label names the agent', () => {
    const tree = render(
      <MessageItem
        message={baseMessage('assistant') as any}
        isUser={false}
        colors={dummyColors}
        sizes={dummySizes}
        aurora={dummyAurora}
        accentHex="#818cf8"
        agentName="Vela"
      />
    );
    expectButton(tree.root, 'Vela message');
    act(() => tree.unmount());
  });

  it('local-mode assistant bubble names Gemma (Local)', () => {
    const tree = render(
      <MessageItem
        message={baseMessage('assistant') as any}
        isUser={false}
        colors={dummyColors}
        sizes={dummySizes}
        aurora={dummyAurora}
        accentHex="#818cf8"
        isLocalMode
        agentName="Vela"
      />
    );
    expectButton(tree.root, 'Gemma (Local) message');
    act(() => tree.unmount());
  });

  it('bubble still contains the BubbleFooter TalkBack label inside MessageItem', () => {
    const tree = render(
      <MessageItem
        message={baseMessage('assistant') as any}
        isUser={false}
        colors={dummyColors}
        sizes={dummySizes}
        aurora={dummyAurora}
        accentHex="#818cf8"
      />
    );
    const formatted = formatTimestamp('2026-09-21T10:42:00.000Z');
    expect(tree.root.findByProps({ accessibilityLabel: `Sent at ${formatted}` })).toBeDefined();
    act(() => tree.unmount());
  });
});

/* ---------------- MessageList / chat-scroll ---------------- */

describe('chatA11y: MessageList (chat-scroll)', () => {
  const items: any[] = [
    {
      type: 'message',
      id: 'm1',
      message: { id: 'm1', role: 'user', content: 'Hi', created_at: '2026-10-20T10:00:00Z' },
    },
  ];

  it('list surface has a screen-reader label "Chat messages"', () => {
    const tree = render(
      <MessageList
        data={items}
        renderItem={({ item }: any) => (
          <View testID={`item-${item.id}`}>
            <Text>{item.message.content}</Text>
          </View>
        )}
      />
    );
    const list = tree.root.findByProps({ testID: 'chat-message-list' });
    expect(list.props.accessibilityLabel).toBe('Chat messages');
    act(() => tree.unmount());
  });

  it('scroll contract stays focusable: inverted + taps persist on scroll', () => {
    const tree = render(
      <MessageList
        data={items}
        renderItem={() => (
          <View>
            <Text>Hi</Text>
          </View>
        )}
      />
    );
    const list = tree.root.findByProps({ testID: 'chat-message-list' });
    expect(list.props.inverted).toBe(true);
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
    act(() => tree.unmount());
  });
});

/* ---------------- ThreadOptionsModal ---------------- */

describe('chatA11y: ThreadOptionsModal', () => {
  const thread: any = { id: 'thread-1', title: 'Test Thread', updated_at: new Date().toISOString(), is_pinned: false };
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useChatStore.getState().clearStore();
      useChatStore.getState().createThread('Test Thread', 'thread-1');
    });
  });

  it('every option is a labelled button', () => {
    const tree = render(<ThreadOptionsModal visible thread={thread} onClose={onClose} />);
    for (const label of [
      'Share Conversation',
      'Export as Markdown',
      'Export as JSON',
      'Pin Thread',
      'Rename Thread',
      'Delete Thread',
      'Cancel',
    ]) {
      expectButton(tree.root, label);
    }
    act(() => tree.unmount());
  });

  it('overlay dismiss is a labelled button ("Close thread options")', () => {
    const tree = render(<ThreadOptionsModal visible thread={thread} onClose={onClose} />);
    expectButton(tree.root, 'Close thread options');
    act(() => tree.unmount());
  });

  it('exhaustive sweep: every pressable inside the modal has a label and a button role', () => {
    const tree = render(<ThreadOptionsModal visible thread={thread} onClose={onClose} />);
    const pressables = tree.root
      .findAll((n: any) => typeof n.props?.onPress === 'function' && n.props.accessible !== false);
    expect(pressables.length).toBeGreaterThanOrEqual(8);
    for (const p of pressables) {
      expect(typeof p.props.accessibilityLabel).toBe('string');
      expect(p.props.accessibilityLabel.length).toBeGreaterThan(0);
      expect(p.props.accessibilityRole).toBe('button');
    }
    act(() => tree.unmount());
  });

  it('pin label follows state: "Unpin Thread" when pinned', () => {
    const pinned = { ...thread, is_pinned: true };
    const tree = render(<ThreadOptionsModal visible thread={pinned} onClose={onClose} />);
    expectButton(tree.root, 'Unpin Thread');
    expect(findByLabel(tree.root, 'Pin Thread')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('rename focus: input is labelled, autofocused, and Save reports disabled state', () => {
    const tree = render(<ThreadOptionsModal visible thread={thread} onClose={onClose} />);
    const rename = findByLabel(tree.root, 'Rename Thread')[0];
    act(() => rename.props.onPress());

    const input = tree.root.findByType(TextInput);
    expect(input.props.accessibilityLabel).toBe('New thread title');
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.selectTextOnFocus).toBe(true);

    const save = expectButton(tree.root, 'Save');
    expectButton(tree.root, 'Cancel');
    // Title starts non-empty -> enabled.
    expect(save.some((n: any) => n.props.accessibilityState?.disabled === false)).toBe(true);
    expect(save.some((n: any) => n.props.disabled === false)).toBe(true);

    act(() => input.props.onChangeText('   '));
    const saveBlank = findByLabel(tree.root, 'Save');
    expect(saveBlank.some((n: any) => n.props.accessibilityState?.disabled === true)).toBe(true);
    expect(saveBlank.some((n: any) => n.props.disabled === true)).toBe(true);

    act(() => tree.unmount());
  });
});

/* ---------------- emptyState ---------------- */

describe('chatA11y: emptyState (EmptyChatState)', () => {
  const colors: any = dummyColors;
  const sizes: any = dummySizes;
  const aurora: any = dummyAurora;

  it('primary CTA: labelled button, activatable', () => {
    const tree = render(<EmptyChatState colors={colors} sizes={sizes} aurora={aurora} onPressAsk={() => {}} />);
    const ctas = tree.root.findAll(
      (n: any) => n.type === PressableScale && n.props.testID === 'empty-cta'
    );
    expect(ctas).toHaveLength(1);
    expect(ctas[0].props.accessibilityLabel).toBe(EMPTY_CTA_LABEL);
    expect(ctas[0].props.accessibilityRole).toBe('button');
    expect(typeof ctas[0].props.onPress).toBe('function');
    const host = hostByLabel(tree.root, EMPTY_CTA_LABEL);
    expect(host.props.accessibilityRole).toBe('button');
    expect(host.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    act(() => tree.unmount());
  });

  it('welcome variant: starters and agent pills are labelled buttons with selection state', () => {
    const tree = render(
      <EmptyChatState
        colors={colors}
        sizes={sizes}
        aurora={aurora}
        onPressAsk={() => {}}
        starters={[{ label: 'Research', text: 'Find papers', agent: 'personal assistant' }]}
        onSelectStarter={() => {}}
        agents={[
          { id: 'a1', name: 'Personal Assistant', icon: 'X' },
          { id: 'a2', name: 'Coder', icon: 'Y' },
        ]}
        currentAgentId="a1"
        onSelectAgent={() => {}}
      />
    );
    expectButton(tree.root, 'Suggestion: Research');
    const selected = hostByLabel(tree.root, 'Personal Assistant agent');
    expect(selected.props.accessibilityRole).toBe('button');
    expect(selected.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    const unselected = hostByLabel(tree.root, 'Coder agent');
    expect(unselected.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    // Headline / subtext stay readable plain text for screen readers.
    expect(tree.root.find((n: any) => n.props?.testID === 'empty-headline')).toBeDefined();
    expect(tree.root.find((n: any) => n.props?.testID === 'empty-subtext')).toBeDefined();
    act(() => tree.unmount());
  });
});

/* ---------------- RichText ---------------- */

describe('chatA11y: RichText', () => {
  it('code block copy action is a labelled button', () => {
    const tree = render(<RichText content={'```typescript\nconst x = 1;\n```'} />);
    const copy = expectButton(tree.root, 'Copy code block');
    expect(copy.some((n: any) => typeof n.props.onPress === 'function')).toBe(true);
    act(() => tree.unmount());
  });
});

/* ---------------- MermaidRenderer ---------------- */

describe('chatA11y: MermaidRenderer', () => {
  it('tabs: "Diagram tab" selected, "Source tab" not, both labelled buttons', () => {
    const tree = render(<MermaidRenderer graph="graph TD\nA-->B" />);
    const diagram = hostByLabel(tree.root, 'Diagram tab');
    expect(diagram.props.accessibilityRole).toBe('button');
    expect(diagram.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    const source = hostByLabel(tree.root, 'Source tab');
    expect(source.props.accessibilityRole).toBe('button');
    expect(source.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    act(() => tree.unmount());
  });

  it('after switching, selection flips and source view + copy are labelled', () => {
    const tree = render(<MermaidRenderer graph="graph TD\nA-->B" />);
    const sourceTab = findByLabel(tree.root, 'Source tab')[0];
    act(() => sourceTab.props.onPress());

    expect(hostByLabel(tree.root, 'Source tab').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(hostByLabel(tree.root, 'Diagram tab').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(tree.root.findByProps({ testID: 'mermaid-source-view' }).props.accessibilityLabel).toBe(
      'Mermaid source code'
    );
    expectButton(tree.root, 'Copy mermaid source');
    act(() => tree.unmount());
  });

  it('streaming fallback source view keeps the source label', () => {
    const tree = render(<MermaidRenderer graph="graph TD\nA-->B" isStreaming />);
    expect(tree.root.findByProps({ testID: 'mermaid-source-view' }).props.accessibilityLabel).toBe(
      'Mermaid source code'
    );
    act(() => tree.unmount());
  });

  it('render failure is an alert with a spoken label', () => {
    const tree = render(<MermaidRenderer graph="graph TD\nA-->B" />);
    const webview = tree.root.findByProps({ testID: 'webview-mock' });
    act(() => {
      webview.props.onMessage({ nativeEvent: { data: JSON.stringify({ error: true }) } });
    });
    const banner = tree.root.findByProps({ accessibilityLabel: 'Mermaid render failed. Showing source view.' });
    expect(banner.props.accessibilityRole).toBe('alert');
    act(() => tree.unmount());
  });
});
