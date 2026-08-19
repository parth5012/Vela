// Persistent WebView container positioning.
//
// Why a tiny standalone module instead of testing the full layout:
// mounting _layout.tsx in jest pulls the whole Expo Router Drawer graph,
// which react-test-renderer tears down on commit and can't be probed
// reliably (see ticket #145 test notes). This module is the dependency-free
// boundary that BOTH drives the real layout AND carries the regression test.

import { Platform, ViewStyle } from 'react-native';

export const PERSISTENT_WEBVIEW_BASE: ViewStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  // Keep the WebView below the app header + browser URL bar + toolbar
  // when visible (~148px Android / ~190px iOS) - same as the original layout.
  top: Platform.OS === 'ios' ? 190 : 148,
};

export const PERSISTENT_WEBVIEW_HIDDEN: ViewStyle = {
  position: 'absolute',
  top: -9999,
  left: -9999,
  opacity: 0,
  width: 1,
  height: 1,
};

export const PERSISTENT_WEBVIEW_VISIBLE: ViewStyle = {
  left: 0,
  opacity: 1,
  width: '100%',
  height: '100%',
};

export function persistentWebviewContainerStyle(visible: boolean): ViewStyle[] {
  return [PERSISTENT_WEBVIEW_BASE, visible ? PERSISTENT_WEBVIEW_VISIBLE : PERSISTENT_WEBVIEW_HIDDEN];
}

export function persistentWebviewPointerEvents(visible: boolean): 'auto' | 'none' {
  return visible ? 'auto' : 'none';
}