// Wayfinder #145: the persistent WebView container is pushed offscreen when hidden
// instead of display: 'none', because Android does not release the WebView's
// hardware-accelerated surface while it is mounted but display:none.
//
// Constraint (documented): mounting the full Expo Router Drawer layout in jest is
// impractical (see persistentWebviewStyle.ts header). This test drives the same
// dependency-free style module that _layout.tsx uses, so it covers the exact style
// boundary this ticket changes.
import {
  PERSISTENT_WEBVIEW_BASE,
  PERSISTENT_WEBVIEW_HIDDEN,
  PERSISTENT_WEBVIEW_VISIBLE,
  persistentWebviewContainerStyle,
  persistentWebviewPointerEvents,
} from '../utils/persistentWebviewStyle';

describe('persistentWebview positioning', () => {
  it('keeps WebView mounted but positions it offscreen when hidden', () => {
    const style = persistentWebviewContainerStyle(false);

    // Base anchor is applied (WebView stays mounted in the tree).
    expect(style).toContainEqual(PERSISTENT_WEBVIEW_BASE);

    // Hidden state: pushed offscreen, transparent, 1x1 - not display:none.
    const hidden = style[1];
    expect(hidden.display).toBeUndefined();
    expect(hidden.position).toBe('absolute');
    expect(hidden.top).toBeLessThan(0);
    expect(hidden.left).toBeLessThan(0);
    expect(hidden.opacity).toBe(0);
    expect(hidden.width).toBe(1);
    expect(hidden.height).toBe(1);

    expect(persistentWebviewPointerEvents(false)).toBe('none');
  });

  it('positions WebView full size and interactive when visible', () => {
    const style = persistentWebviewContainerStyle(true);

    expect(style).toContainEqual(PERSISTENT_WEBVIEW_BASE);

    // Chrome offset (below header + URL bar + toolbar) is carried by the base
    // style so the visible WebView keeps its original position.
    expect(PERSISTENT_WEBVIEW_BASE.top).toBeGreaterThan(0);

    const visible = style[1];
    expect(visible.display).toBeUndefined();
    expect(visible.opacity).toBe(1);
    expect(visible.top).toBeUndefined();
    expect(visible.left).toBe(0);
    expect(visible.width).toBe('100%');
    expect(visible.height).toBe('100%');

    expect(persistentWebviewPointerEvents(true)).toBe('auto');
  });

  it('never applies display:none in either state', () => {
    for (const visible of [false, true]) {
      const style = persistentWebviewContainerStyle(visible);
      for (const entry of style) {
        expect(entry.display).toBeUndefined();
      }
    }
  });
});
