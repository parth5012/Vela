import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Mock WebView for LatexRenderer in headless Jest
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: (props: any) => React.createElement(View, props),
  };
});

import MessageItem from '../components/chat/MessageItem';
import { ImagePreview, pruneImageCache, getImageCacheSize, clearImageCache } from '../components/media/ImagePreview';
import { blockAstCache, pruneBlockAstCache, getBlockAstCacheSize } from '../utils/latexExtractor';

describe('MessageItem & Memory Virtualization (WF-427-05)', () => {
  const dummyColors = {
    background: '#09090b',
    text: '#f4f4f5',
    textMuted: '#71717a',
    glass: 'rgba(255,255,255,0.05)',
    glassBorder: 'rgba(255,255,255,0.1)',
  };
  const dummySizes = {
    text: 15,
    title: 18,
    sub: 12,
  };
  const dummyAurora = {
    acc1: '#818cf8',
    acc2: '#c084fc',
    onAccent: '#ffffff',
  };

  const sampleAssistantMsg = {
    id: 'msg-ast-1',
    conversation_id: 'conv-1',
    role: 'assistant' as const,
    content: 'Here is **rich markdown** and a formula: $$E = mc^2$$',
    created_at: new Date().toISOString(),
  };

  it('renders rich text when inViewport is true', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageItem
          message={sampleAssistantMsg}
          isUser={false}
          colors={dummyColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          accentHex="#818cf8"
          inViewport={true}
        />
      );
    });

    const root = tree!.root;
    // When in viewport, rich text is mounted and virtualization placeholder is NOT present
    const placeholders = root.findAllByProps({ testID: 'message-ast-unmounted' });
    expect(placeholders.length).toBe(0);
  });

  it('unmounts heavy AST representation when inViewport is false', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageItem
          message={sampleAssistantMsg}
          isUser={false}
          colors={dummyColors}
          sizes={dummySizes}
          aurora={dummyAurora}
          accentHex="#818cf8"
          inViewport={false}
        />
      );
    });

    const root = tree!.root;
    const placeholder = root.findByProps({ testID: 'message-ast-unmounted' });
    expect(placeholder).toBeDefined();
    expect(placeholder.props.children).toBe(sampleAssistantMsg.content);
  });
});

describe('ImagePreview & Cache Virtualization (WF-427-05)', () => {
  beforeEach(() => {
    clearImageCache();
  });

  it('mounts Image bitmap when inViewport is true', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ImagePreview
          uri="https://example.com/photo.jpg"
          inViewport={true}
        />
      );
    });

    const root = tree!.root;
    const image = root.findByProps({ testID: 'image-preview-bitmap' });
    expect(image).toBeDefined();
    expect(image.props.source).toEqual({ uri: 'https://example.com/photo.jpg' });
  });

  it('releases Image bitmap and mounts placeholder when inViewport is false', () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ImagePreview
          uri="https://example.com/photo.jpg"
          inViewport={false}
        />
      );
    });

    const root = tree!.root;
    const placeholder = root.findByProps({ testID: 'image-preview-placeholder' });
    expect(placeholder).toBeDefined();

    const images = root.findAllByProps({ testID: 'image-preview-bitmap' });
    expect(images.length).toBe(0);
  });

  it('bounds image memory cache size via pruneImageCache', () => {
    for (let i = 0; i < 70; i++) {
      act(() => {
        renderer.create(
          <ImagePreview
            uri={`https://example.com/photo-${i}.jpg`}
            inViewport={true}
          />
        );
      });
    }

    expect(getImageCacheSize()).toBeLessThanOrEqual(50);
    const evicted = pruneImageCache(10);
    expect(getImageCacheSize()).toBeLessThanOrEqual(10);
    expect(evicted).toBeGreaterThan(0);
  });
});

describe('Incremental Block AST Cache Pruning (WF-427-05)', () => {
  it('bounds blockAstCache entries via pruneBlockAstCache', () => {
    for (let i = 0; i < 50; i++) {
      blockAstCache.set(`block-${i}`, [{ type: 'markdown', content: `Paragraph ${i}` }]);
    }
    expect(getBlockAstCacheSize()).toBe(50);

    const pruned = pruneBlockAstCache(20);
    expect(pruned).toBe(30);
    expect(getBlockAstCacheSize()).toBe(20);
  });
});
