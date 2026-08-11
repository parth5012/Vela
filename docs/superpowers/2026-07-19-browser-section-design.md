# Browser Section Design

## Summary

Add a user-facing browser section to the Vela Client app. The browser is accessible via a drawer menu item, opens as a dedicated screen (`app/browser.tsx`), and supports hybrid mode: the user can browse manually (URL bar, back/forward/refresh) and the AI agent can take over to automate actions (navigate, click, fill, extract_dom) via chat commands.

The WebView persists across screen switches by mounting it at the root layout level (`app/_layout.tsx`) and toggling visibility, so loaded pages, scroll position, cookies, and DOM state survive navigation between chat and browser.

## Current State

Browser automation exists but is invisible to the user:
- Backend sends `<call:webview_browser input="{...}">` tags in assistant responses
- `app/index.tsx` parses these tags and opens a split-screen WebView panel (~350px height)
- Supports `navigate`, `click`, `fill`, `extract_dom` actions
- WebView results are sent back to backend via `POST /chat/webview/response`
- User has no manual control: no URL bar, no way to open the browser themselves
- All webview state and ~200 lines of handler code live inline in `index.tsx` (1676 lines total)

## Architecture

### New Files

- **`app/browser.tsx`** — Browser screen with URL bar, toolbar, AI status banner, approval modal
- **`store/useBrowserStore.ts`** — Zustand store for browser state and webview action handlers

### Modified Files

- **`app/_layout.tsx`** — Mount persistent WebView at root level, show/hide via store's `isVisible`
- **`components/ui/DrawerContent.tsx`** — Add "Browser" drawer entry navigating to `/browser`
- **`app/index.tsx`** — Remove inline WebView code; keep `<call:webview_browser>` tag parser but simplify to dispatch to `useBrowserStore` actions and `router.push('/browser')`

## Navigation & Entry Point

- New Expo Router route: `app/browser.tsx`
- Drawer menu gets "Browser" item in `DrawerContent.tsx`, navigates to `/browser`
- Tapping "Browser" in drawer navigates to the browser screen
- User returns to chat via drawer or close button on browser toolbar
- When AI sends `<call:webview_browser>`, app auto-navigates to `/browser` and AI takes control

## WebView State Persistence

**Problem:** Switching between browser and chat screens would unmount the WebView, losing the loaded page, scroll position, cookies, and DOM state.

**Solution:** Mount the WebView once in `app/_layout.tsx` at the root layout level. It lives as a persistent layer that is always mounted but conditionally visible.

- `app/browser.tsx` does not contain a WebView itself — it renders the URL bar, toolbar, and controls around a "portal target" area
- Root layout positions the persistent WebView over the browser screen's area when the browser route is active
- When user is on chat screen, WebView is hidden via `display: 'none'` (preferred over off-screen positioning to avoid touch event leaking)
- When user navigates to `/browser`, WebView becomes visible over the browser screen's content area

**Zustand store (`store/useBrowserStore.ts`) state:**

| Field | Type | Purpose |
|---|---|---|
| `currentUrl` | `string` | Currently loaded URL |
| `isVisible` | `boolean` | Whether browser screen is active |
| `canGoBack` | `boolean` | WebView can go back |
| `canGoForward` | `boolean` | WebView can go forward |
| `isLoading` | `boolean` | Page is loading |
| `pageTitle` | `string` | Current page title |
| `pendingApproval` | `object \| null` | Sensitive action awaiting user confirmation |

**Persists across screen switches:** loaded page, scroll position, cookies/session, DOM state, injected `data-vela-id` attributes.

**Does not persist (acceptable):** WebView memory reclaimed by Android when app is backgrounded for extended periods. This is standard native behavior.

## Hybrid Mode: Manual Browse + AI Takeover

### Manual Browsing (User-Driven)

- URL bar at top of browser screen — user types URL, taps Go or keyboard submit
- Back / Forward / Refresh buttons in toolbar work as standard browser controls
- Tapping links in the WebView works normally
- No AI involvement required

### AI Takeover (Chat-Driven)

When backend sends `<call:webview_browser>` tag in a chat response:

1. App auto-navigates to browser screen (if not already there)
2. Shows status banner at top: "Vela is browsing..." with current action description
3. Executes action using existing logic (navigate / click / fill / extract_dom)
4. Banner remains visible while AI is acting, disappears when action completes

### Sensitive Action Approval Gate

Certain actions require explicit user confirmation before executing:

**Sensitive actions (require approval):**
- `fill` targeting `input[type="password"]`, `input[type="email"]`, `input[type="tel"]`, payment fields
- Form `submit` actions
- Any action that posts data

**Detection method:**
- Check target element's `type` attribute: `password`, `submit`, `tel`, `email` are sensitive
- Check target element's `tag`: `form` submit actions are sensitive
- Check action type: `submit_form` is sensitive

**Approval UX:**
- Semi-transparent overlay with a card: "Vela wants to [action] — [target description]"
- Two buttons: **Allow** / **Deny**
- Allow: executes action, sends result to backend
- Deny: sends `denied_by_user` status to backend, AI is informed

**Non-sensitive actions** (navigate, click links, extract_dom, fill regular text fields): execute silently with notification banner only.

## Browser Screen Layout

`app/browser.tsx` renders top to bottom:

1. **AI Status Banner** (conditional — visible only when AI is acting)
   - Accent-colored bar with: "Vela is browsing..." + current action text
   - Disappears when action completes

2. **URL Bar**
   - TextInput showing current URL (editable)
   - "Go" button / keyboard submit to navigate
   - Updates automatically via `onNavigationStateChange`

3. **Toolbar Row**
   - Back | Forward | Refresh | Close
   - Back/Forward disabled states tied to `canGoBack`/`canGoForward` from store

4. **WebView Area**
   - The persistent WebView from `_layout.tsx` made visible here
   - Takes remaining flex space

5. **Approval Modal** (conditional — visible only when AI requests a sensitive action)
   - Semi-transparent overlay
   - Card with action description and Allow / Deny buttons

No chat input on the browser screen. User switches back to chat via drawer or close button. Clean separation: browse here, chat there.

## Migration from index.tsx

**Moves out of `app/index.tsx`:**
- WebView-related state: `webviewUrl`, `showWebview`, `isWebviewLoading`, `pendingAction`, `lastExecutedId`, `webViewRef`
- Handler functions: `executeScriptForAction`, `handleWebViewMessage`, `handleWebviewAction`, `sendWebviewResponseToBackend`, `handleWebViewLoadEnd`
- WebView JSX block and webview styles
- Approximately 200 lines removed from `index.tsx`

**Stays in `app/index.tsx`:**
- `<call:webview_browser>` tag regex parser (lines 469-493), simplified to:
  1. Parse the tag
  2. Call `useBrowserStore.getState().handleWebviewAction(parsedInput)`
  3. Call `router.push('/browser')` to switch to browser screen

This is a net improvement: `index.tsx` drops from 1676 to ~1476 lines, with webview concerns properly separated.

## Exit Criteria

- [ ] Drawer has "Browser" entry that navigates to `/browser`
- [ ] Browser screen shows URL bar, toolbar (back/forward/refresh/close), WebView area
- [ ] User can type a URL and browse manually
- [ ] WebView state persists when switching between chat and browser (no reload)
- [ ] AI `<call:webview_browser>` tags auto-navigate to browser screen and execute actions
- [ ] Status banner visible during AI actions
- [ ] Sensitive actions (password fill, form submit) show approval prompt
- [ ] Non-sensitive actions execute silently with banner
- [ ] All webview code removed from `index.tsx`, living in `useBrowserStore` and `browser.tsx`
- [ ] Existing `navigate`, `click`, `fill`, `extract_dom` actions continue to work
- [ ] Backend communication via `/chat/webview/response` unchanged
