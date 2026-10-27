import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View, Text, Animated } from 'react-native';
import RichText from '../components/chat/RichText';
import LatexRenderer from '../components/chat/LatexRenderer';
import MermaidRenderer from '../components/chat/MermaidRenderer';
import BubbleFooter from '../components/chat/BubbleFooter';
import MessageRow from '../components/chat/MessageRow';
import { THEME_COLORS, FONT_SIZES } from '../utils/theme';

// Mock WebView
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: (props: any) => React.createElement(View, { ...props, testID: 'webview-mock' }),
  };
});

// Mock Clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

// Mock Markdown inside tests to simulate code fence dispatching
jest.mock('react-native-markdown-display', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      const content = props.children || '';
      const rules = props.rules || {};

      if (typeof content === 'string' && content.includes('```mermaid')) {
        const node = {
          key: 'simulated-mermaid',
          content: 'graph TD\nA-->B',
          info: 'mermaid',
        };
        if (rules.fence) {
          return rules.fence(node);
        }
      }
      return React.createElement(View, null, React.createElement(Text, null, content));
    },
  };
});

describe('Deferred Heavy WebViews (LaTeX / Mermaid) & Off-Screen Animations', () => {
  const colors = THEME_COLORS.deep;
  const sizes = FONT_SIZES.medium;
  const aurora = {
    acc1: '#8b7cf6',
    acc2: '#7dd3fc',
    glow: 'rgba(139, 124, 246, 0.45)',
    onAccent: '#0b0b1a',
  };

  describe('RichText deferred math WebViews during active stream', () => {
    it('produces 0 WebView instances when rendering inline and block math with isStreaming=true', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <RichText
            content="Calculate $x^2 + y^2 = z^2$ and formula: $$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$"
            isStreaming={true}
          />
        );
      });

      const webviews = tree.root.findAllByProps({ testID: 'webview-mock' });
      expect(webviews).toHaveLength(0);

      // Verify lightweight monospace math badges are rendered instead
      const inlineMath = tree.root.findByProps({ testID: 'streaming-latex-inline' });
      expect(inlineMath).toBeDefined();

      const blockMath = tree.root.findByProps({ testID: 'streaming-latex-block' });
      expect(blockMath).toBeDefined();
      act(() => {
        tree.unmount();
      });
    });

    it('mounts full interactive WebView renderers when transitioning isStreaming from true to false', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <RichText
            content="Formula: $x^2$ and block: $$\nE = mc^2\n$$"
            isStreaming={true}
          />
        );
      });

      expect(tree.root.findAllByProps({ testID: 'webview-mock' })).toHaveLength(0);

      // Transition to stream settled (isStreaming = false)
      act(() => {
        tree.update(
          <RichText
            content="Formula: $x^2$ and block: $$\nE = mc^2\n$$"
            isStreaming={false}
          />
        );
      });

      const webviews = tree.root.findAllByProps({ testID: 'webview-mock' });
      // Should mount WebViews for inline math and block math
      expect(webviews.length).toBeGreaterThanOrEqual(1);
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('RichText deferred Mermaid WebViews during active stream', () => {
    it('renders lightweight placeholder with 0 WebViews when mermaid fence is streamed with isStreaming=true', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <RichText
            content="```mermaid\ngraph TD\nA-->B\n```"
            isStreaming={true}
          />
        );
      });

      const webviews = tree.root.findAllByProps({ testID: 'webview-mock' });
      expect(webviews).toHaveLength(0);

      const placeholder = tree.root.findByProps({ testID: 'streaming-mermaid-placeholder' });
      expect(placeholder).toBeDefined();
      act(() => {
        tree.unmount();
      });
    });

    it('mounts full MermaidRenderer WebView once streaming settles (isStreaming=false)', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <RichText
            content="```mermaid\ngraph TD\nA-->B\n```"
            isStreaming={true}
          />
        );
      });

      expect(tree.root.findAllByProps({ testID: 'webview-mock' })).toHaveLength(0);

      act(() => {
        tree.update(
          <RichText
            content="```mermaid\ngraph TD\nA-->B\n```"
            isStreaming={false}
          />
        );
      });

      const webviews = tree.root.findAllByProps({ testID: 'webview-mock' });
      expect(webviews.length).toBeGreaterThanOrEqual(1);
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Direct LatexRenderer & MermaidRenderer deferred behavior', () => {
    it('LatexRenderer defers WebView when isStreaming=true', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <LatexRenderer formula="\\alpha + \\beta" isStreaming={true} />
        );
      });

      expect(tree.root.findAllByProps({ testID: 'webview-mock' })).toHaveLength(0);
      const fallback = tree.root.findByProps({ testID: 'latex-deferred-fallback' });
      expect(fallback).toBeDefined();
      act(() => {
        tree.unmount();
      });
    });

    it('MermaidRenderer defers WebView when isStreaming=true', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <MermaidRenderer graph="graph TD\nA-->B" isStreaming={true} />
        );
      });

      expect(tree.root.findAllByProps({ testID: 'webview-mock' })).toHaveLength(0);
      const sourceView = tree.root.findByProps({ testID: 'mermaid-source-view' });
      expect(sourceView).toBeDefined();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Off-screen animation suspension (BubbleFooter inViewport)', () => {
    it('suppresses streaming dot pulse loop when inViewport=false', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <BubbleFooter
            createdAt="2026-09-21T10:42:00.000Z"
            isUser={false}
            isStreaming={true}
            inViewport={false}
            aurora={aurora as any}
            colors={colors as any}
          />
        );
      });

      // No dot rendered when inViewport=false
      expect(tree.root.findAllByProps({ testID: 'bubble-footer-streaming-dot' })).toHaveLength(0);
      act(() => {
        tree.unmount();
      });
    });

    it('resumes streaming dot animation when inViewport transitions to true', () => {
      let tree: any;
      act(() => {
        tree = renderer.create(
          <BubbleFooter
            createdAt="2026-09-21T10:42:00.000Z"
            isUser={false}
            isStreaming={true}
            inViewport={false}
            aurora={aurora as any}
            colors={colors as any}
          />
        );
      });

      expect(tree.root.findAllByProps({ testID: 'bubble-footer-streaming-dot' })).toHaveLength(0);

      act(() => {
        tree.update(
          <BubbleFooter
            createdAt="2026-09-21T10:42:00.000Z"
            isUser={false}
            isStreaming={true}
            inViewport={true}
            aurora={aurora as any}
            colors={colors as any}
          />
        );
      });

      expect(tree.root.findByProps({ testID: 'bubble-footer-streaming-dot' })).toBeDefined();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('MessageRow integration with deferred renderers', () => {
    it('defers WebViews during streaming in MessageRow', () => {
      const item = {
        type: 'message' as const,
        id: 'msg-latex-stream',
        dateKey: '2026-09-21',
        message: {
          id: 'msg-latex-stream',
          role: 'assistant' as const,
          content: 'Here is math: $x^2 + y^2 = z^2$',
          created_at: '2026-09-21T10:42:00.000Z',
        },
      };

      let tree: any;
      act(() => {
        tree = renderer.create(
          <MessageRow
            item={item}
            colors={colors}
            sizes={sizes}
            aurora={aurora as any}
            isStreamingMessage={true}
            inViewport={true}
          />
        );
      });

      // While streaming in MessageRow, 0 WebViews mounted
      expect(tree.root.findAllByProps({ testID: 'webview-mock' })).toHaveLength(0);

      // Once streaming settles
      act(() => {
        tree.update(
          <MessageRow
            item={item}
            colors={colors}
            sizes={sizes}
            aurora={aurora as any}
            isStreamingMessage={false}
            inViewport={true}
          />
        );
      });

      // WebViews mounted
      expect(tree.root.findAllByProps({ testID: 'webview-mock' }).length).toBeGreaterThanOrEqual(1);
      act(() => {
        tree.unmount();
      });
    });
  });
});
