// Persistent WebView offscreen positioning (ticket #145).
//
// Constraint documented per the ticket: mounting the full _layout.tsx (Expo
// Router Drawer + expo-router + store hydration graph) in jest is impractical —
// react-test-renderer tears the heavy context tree down on commit and the
// persistent WebView container cannot be probed reliably. Instead we test the
// dependency-free module that drives the container style in _layout.tsx.
// This module is imported by the real layout, so the assertion covers the
// exact styles applied to the persistent WebView container in production.

import {
  persistentWebviewContainerStyle,
  persistentWebviewPointerEvents,
  PERSISTENT_WEBVIEW_HIDDEN,
  PERSISTENT_WEBVIEW_VISIBLE,
} from '../app/persistentWebviewStyle';

describe('persistentWebview positioning', () => {
  it('pulls the container offscreen (no display:none) when hidden', () => {
    const style = persistentWebviewContainerStyle(false);

    // Sanity: array of two style objects (base + visibility)
    expect(Array.isArray(style)).toBe(true);
    expect(style).toHaveLength(2);

    // Base positioning is preserved
    expect(style[0]).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    });

    // Hidden visibility object exists
    expect(style[1]).toBe(PERSISTENT_WEBVIEW_HIDDEN);

    // Offscreen geometry: negative top/left, zero opacity, 1x1 footprint
    expect(style[1].top).toBeLessThan(0);
    expect(style[1].left).toBeLessThan(0);
    expect(style[1].opacity).toBe(0);
    expect(style[1].width).toBe(1);
    expect(style[1].height).toBe(1);

    // Assert explicitly: no display:none anywhere in the applied styles
    const hasDisplayNone = style.some((s) => s && (s as any).display === 'none');
    expect(hasDisplayNone).toBe(false);
  });

  it('places the WebView container visible when shown', () => {
    const style = persistentWebviewContainerStyle(true);

    expect(Array.isArray(style)).toBe(true);
    expect(style[0]).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    });

    expect(style[1]).toBe(PERSISTENT_WEBVIEW_VISIBLE);

    // Full usable area when visible
    expect(style[1].top).toBe(0);
    expect(style[1].left).toBe(0);
    expect(style[1].opacity).toBe(1);
    expect(style[1].width).toBe('100%');
    expect(style[1].height).toBe('100%');

    const hasDisplayNone = style.some((s) => s && (s as any).display === 'none');
    expect(hasDisplayNone).toBe(false);
  });

  it('keeps pointerEvents auto when visible and none when hidden', () => {
    expect(persistentWebviewPointerEvents(true)).toBe('auto');
    expect(persistentWebviewPointerEvents(false)).toBe('none');
  });
});