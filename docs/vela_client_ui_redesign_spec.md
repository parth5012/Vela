# Vela Client — Complete UI Redesign Specification

> **Purpose**: This document describes every UI component, screen, interaction pattern, and design system token needed to redesign the Vela Android client from scratch. It is intended to be handed to a designer agent who will produce the complete UI/UX for the app.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Design System & Tokens](#2-design-system--tokens)
3. [App Architecture & Navigation](#3-app-architecture--navigation)
4. [Screen-by-Screen Breakdown](#4-screen-by-screen-breakdown)
5. [Reusable Components Library](#5-reusable-components-library)
6. [Future Features (Wayfinder Maps)](#6-future-features-wayfinder-maps)
7. [Interaction Patterns & Micro-Animations](#7-interaction-patterns--micro-animations)
8. [Responsive & Adaptive Behavior](#8-responsive--adaptive-behavior)

---

## 1. Product Overview

### What is Vela?

Vela is a **single-tenant, self-hosted personal AI assistant** with a custom Android client app. The backend is a FastAPI + LangGraph Supervisor Agent that coordinates tools (web search, code execution, Gmail, Calendar, browser automation) and multi-turn skills (brainstorming, research, coding). The Android app is the Owner's primary interface.

### Key User Persona

- **Single Owner** (personal use, self-hosted)
- Power user who configures their own server URL and API key
- Uses Vela for research, writing, coding help, email/calendar management, and task automation
- Switches between cloud AI and local on-device models

### Current Tech Stack (Client)

| Layer | Technology |
|-------|------------|
| Framework | Expo SDK 57, React Native, TypeScript |
| Navigation | Expo Router (file-based), Drawer layout |
| State Management | Zustand with AsyncStorage persistence |
| Local DB | expo-sqlite + Drizzle ORM |
| Secure Storage | expo-secure-store (API keys) |
| Markdown Renderer | react-native-markdown-display |
| LaTeX Renderer | KaTeX via react-native-webview |
| Mermaid Renderer | Mermaid.js via react-native-webview |
| HTTP/SSE | Custom fetch-based SSE stream parser |

---

## 2. Design System & Tokens

### 2.1. Theme System

The app supports **6 themes** the Owner can switch between in Settings. All themes are dark variants.

| Theme ID | Name | Background | Card/Surface | Border | Text | Muted Text | Dark Text |
|----------|------|------------|--------------|--------|------|-----------|-----------|
| `deep` | Deep Dark (Default) | `#09090b` | `#18181b` | `#27272a` | `#f4f4f5` | `#a1a1aa` | `#71717a` |
| `slate` | Slate Navy | `#0f172a` | `#1e293b` | `#334155` | `#f8fafc` | `#94a3b8` | `#64748b` |
| `cyberpunk` | Cyberpunk | `#080015` | `#14002c` | `#f59e0b` | `#00ffcc` | `#ff00ff` | `#8b5cf6` |
| `oled` | OLED Black | `#000000` | `#09090b` | `#18181b` | `#f4f4f5` | `#a1a1aa` | `#71717a` |
| `dracula` | Dracula | `#282a36` | `#44475a` | `#6272a4` | `#f8f8f2` | `#ff79c6` | `#8be9fd` |
| `nordic` | Nordic Frost | `#2e3440` | `#3b4252` | `#4c566a` | `#d8dee9` | `#88c0d0` | `#81a1c1` |

Each theme also defines **chat bubble colors**:

| Property | Description |
|----------|-------------|
| `bubbleUser` | Background color for user message bubbles |
| `bubbleUserBorder` | Border color for user message bubbles |
| `bubbleAssistant` | Background color for assistant message bubbles (typically semi-transparent accent) |
| `bubbleAssistantBorder` | Border color for assistant message bubbles |

### 2.2. Accent Colors

8 accent colors available for selection. The accent is used for interactive elements, active indicators, buttons, and highlights.

| ID | Name | Hex |
|----|------|-----|
| `indigo` | Indigo (Default) | `#6366f1` |
| `emerald` | Emerald | `#10b981` |
| `rose` | Rose | `#f43f5e` |
| `amber` | Amber | `#f59e0b` |
| `violet` | Violet | `#8b5cf6` |
| `pink` | Pink | `#ec4899` |
| `orange` | Orange | `#f97316` |
| `blue` | Blue | `#3b82f6` |

### 2.3. Typography Scale

3 size presets. All font families use the system default (`-apple-system` / `Roboto`). Code blocks use monospace (`Courier` on iOS, `monospace` on Android).

| Preset | Text | Sub | Title | Logo |
|--------|------|-----|-------|------|
| Small | 12px | 10px | 16px | 24px |
| Medium (Default) | 14px | 12px | 20px | 32px |
| Large | 17px | 14px | 24px | 38px |

### 2.4. Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `space-xs` | 4px | Tight element gaps |
| `space-sm` | 8px | Component internal padding |
| `space-md` | 12px | Card padding, list gaps |
| `space-lg` | 16px | Section spacing |
| `space-xl` | 24px | Screen padding |
| `radius-sm` | 6px | Small buttons, pills |
| `radius-md` | 10px | Cards, modals |
| `radius-lg` | 20px | Bottom sheets, modal headers |

### 2.5. Elevation / Glassmorphism

- Cards use `1px` solid borders with theme border colors
- Modal overlays use `rgba(0, 0, 0, 0.6)` backdrop
- Accent-tinted elements use the accent color at 5–20% opacity for backgrounds, 20–40% for borders
- No drop shadows (dark theme doesn't benefit from shadows)

---

## 3. App Architecture & Navigation

### 3.1. Navigation Structure

```
Root Layout (_layout.tsx)
├── Drawer Navigation (left-side pull)
│   ├── DrawerContent (custom sidebar)
│   └── Persistent WebView Layer (browser, hidden/visible toggle)
│
├── Screens
│   ├── / (index.tsx) — Main Chat Screen
│   ├── /setup (setup.tsx) — First-Launch Setup Wizard
│   ├── /settings (settings.tsx) — Full Settings Panel
│   └── /browser (browser.tsx) — In-App Browser
│
└── Route Guard
    └── If !isConfigured → redirect to /setup
    └── If isConfigured && on /setup → redirect to /
```

### 3.2. State Architecture

4 Zustand stores power the application:

| Store | File | Responsibility |
|-------|------|---------------|
| `useConfigStore` | `store/useConfigStore.ts` | Server connection (URL, API key), UI settings (theme, font, accent), agent config (model, temperature, system prompt, persona), local LLM mode, suggestion starters |
| `useChatStore` | `store/useChatStore.ts` | Threads CRUD, messages per thread, streaming state, thread pinning/renaming, branching, truncation, persona per thread |
| `useBrowserStore` | `store/useBrowserStore.ts` | WebView state (URL, loading, navigation history), AI browser takeover, pending approval actions |
| `useGoogleAuthStore` | `store/useGoogleAuthStore.ts` | Google OAuth state (connected status, email, scopes) |

---

## 4. Screen-by-Screen Breakdown

---

### 4.1. Setup Screen (`/setup`)

**Purpose**: First-launch configuration wizard. Collects server URL and API key, validates connectivity.

**Layout (top to bottom)**:

| Component | Description |
|-----------|-------------|
| **App Logo** | Centered Vela logo at top |
| **Title** | "Welcome to Vela" in title font |
| **Subtitle** | "Connect to your hosted Vela backend" in muted text |
| **Server URL Input** | TextInput with placeholder "https://your-server.com". Auto-prepends `https://` if protocol missing |
| **API Key Input** | TextInput with placeholder "Enter your API key". `secureTextEntry=true` |
| **Connection Status** | Activity indicator during validation, success/error badges after |
| **Connect Button** | Full-width primary button (accent color). Triggers `GET /health` validation |
| **Error Message** | Red text below button on failure |

**Behavior**:
- On successful health check → calls `setConfig()` → runs `syncHistoryWithBackend()` to pre-fetch all existing threads → navigates to `/`
- Validates URL format before submission
- Shows loading spinner during network validation

---

### 4.2. Main Chat Screen (`/` — index.tsx)

**Purpose**: The primary interaction surface. Shows conversation threads, message rendering, and input.

> [!IMPORTANT]
> This is the largest and most complex screen — currently ~1600+ lines. It handles all chat rendering, streaming, browser automation tag parsing, skill/tool/thought/intent block rendering, model switching, and welcome view.

#### 4.2.1. Welcome View (no active thread or empty thread)

Shown when no thread is selected or the selected thread has no messages.

| Component | Description |
|-----------|-------------|
| **Greeting** | "Good [morning/afternoon/evening], [userName]" with dynamic time |
| **Suggestion Starter Cards** | Horizontal/wrap layout of 3+ suggestion cards. Each has: emoji label, prompt text, persona badge. Tapping sends the prompt text and selects the persona. **These are customizable in Settings.** |

#### 4.2.2. Chat Message List

| Component | Description |
|-----------|-------------|
| **FlatList** | `inverted={true}` for natural scroll anchoring to bottom. Uses `keyboardShouldPersistTaps="handled"` |
| **Message Bubble** | Per-message container with role-based styling (user vs assistant). See [Message Bubble](#52-message-bubble) component |
| **Header Segments** | Thought 🧠 and Intent 🎯 blocks render ABOVE the assistant bubble as collapsible cards |
| **Typing Indicator** | Three pulsing dots + "VELA IS COMPILING..." text at bottom of last assistant message during streaming |

#### 4.2.3. Chat Input Area

| Component | Description |
|-----------|-------------|
| **Text Input** | Multi-line text input with placeholder "Ask Vela anything..." |
| **Send Button** | Right-aligned, accent-colored. Disabled during streaming |
| **Model Mode Indicator** | Small pill badge showing "☁️ Cloud" or "📱 Local" mode. Tappable to toggle |
| **Persona Selector** | Small icon/label showing active persona. Tappable to open persona picker (dropdown list of personas: personal assistant, teacher, analyst, prompt builder, researcher, coder, brainstormer) |
| **Stream Stop Button** | Replaces send button during active streaming. Allows canceling the stream |

#### 4.2.4. Keyboard Behavior

- `KeyboardAvoidingView` with `behavior="padding"` (iOS) / `"height"` (Android)
- `softwareKeyboardLayoutMode: "adjustResize"` in Android manifest
- Input area lifts above keyboard smoothly

---

### 4.3. Settings Screen (`/settings`)

**Purpose**: Full configuration panel for connection, UI customization, agent behavior, local LLM, and account management.

**Layout**: ScrollView with sections separated by dividers.

#### Section 1: Connection Settings

| Component | Description |
|-----------|-------------|
| **Server URL Input** | Pre-filled with current URL, editable |
| **API Key Input** | Masked, editable |
| **Health Check Button** | "Test Connection" with status indicator |
| **Save Button** | Re-validates and saves. Triggers history re-sync |

#### Section 2: UI Customization

| Component | Description |
|-----------|-------------|
| **Theme Selector** | 6 selectable theme cards/pills: Deep, Slate, Cyberpunk, Nordic, Dracula, OLED. Active one highlighted with accent border |
| **Accent Color Picker** | 8 colored circles. Active one has checkmark overlay or ring |
| **Font Size Selector** | 3 options (Small, Medium, Large) as segmented control or pills |

#### Section 3: Agent Configuration

| Component | Description |
|-----------|-------------|
| **Default Persona Dropdown** | Selects the default persona for new conversations |
| **User Name Input** | Display name used in greetings |
| **Model Name Input** | Text input for cloud model name (e.g., "gemini-1.5-pro") |
| **Temperature Slider** | 0.0 – 1.0 with current value displayed |
| **System Prompt Input** | Multi-line text area for custom base system prompt |

#### Section 4: Local LLM Settings

| Component | Description |
|-----------|-------------|
| **Local Mode Toggle** | Switch between Cloud and Local mode |
| **Model Selector** | List of downloadable local models (from `LOCAL_MODELS` in `utils/localLlm.ts`) with: model name, parameter count, download size, RAM requirement |
| **Download Progress** | Progress bar during model download |
| **WiFi-Only Download Toggle** | Checkbox/switch to restrict downloads to WiFi |
| **Model Status** | Shows if model is downloaded, downloading, or not available |

#### Section 5: Google Workspace Integration

| Component | Description |
|-----------|-------------|
| **Google Account Card** | Shows connected Google account email, scope badges (Gmail, Calendar), connect/disconnect button |
| **OAuth Status** | Green checkmark if connected, red if expired/disconnected |

#### Section 6: Suggestion Starters Manager

| Component | Description |
|-----------|-------------|
| **Existing Starters List** | Each starter card shows: label, prompt text, persona. Has a delete button |
| **Add New Starter Form** | Label input, prompt text input, persona selector (pill buttons), "Add Suggestion" button |

#### Section 7: Danger Zone

| Component | Description |
|-----------|-------------|
| **Reset Connection** | Button to clear all config and return to setup |
| **Clear Local Data** | Button to wipe local chat cache |
| **App Version** | Display current app version |

---

### 4.4. Browser Screen (`/browser`)

**Purpose**: In-app browser for manual browsing and AI-driven browser automation.

#### Layout (top to bottom):

| Component | Description |
|-----------|-------------|
| **AI Status Banner** | Conditional — visible only when AI is controlling the browser. Accent-colored bar: "Vela is browsing..." + current action description. Disappears when action completes |
| **URL Bar** | TextInput showing current URL (editable). "Go" button or keyboard submit to navigate. Auto-updates via `onNavigationStateChange` |
| **Toolbar Row** | 4 icon buttons: ← Back | → Forward | ↻ Refresh | ✕ Close. Back/Forward disabled when unavailable |
| **WebView Area** | The persistent WebView (mounted at root `_layout.tsx`). Takes remaining flex space. The WebView persists across screen switches — page state, cookies, scroll position survive |
| **Approval Modal** | Conditional overlay when AI requests a sensitive action (password fill, form submit). Card shows: action description, Allow / Deny buttons |

#### Hybrid Mode:

- **Manual**: Owner types URLs, taps links, uses Back/Forward/Refresh
- **AI Takeover**: Backend sends `<call:webview_browser>` tags → app auto-navigates to browser → executes navigate/click/fill/extract_dom actions → shows status banner

#### Sensitive Action Approval:

Actions requiring confirmation:
- `fill` targeting password, email, tel, or payment fields
- Form `submit` actions
- Any data-posting action

Non-sensitive actions execute silently with banner notification only.

---

### 4.5. Drawer Sidebar

**Purpose**: Thread navigation, browser access, settings shortcut.

#### Layout (top to bottom):

| Component | Description |
|-----------|-------------|
| **App Header** | "Vela" logo/title with version |
| **"New Chat" Button** | Creates a new empty thread and selects it |
| **Thread List** | Scrollable list of conversation threads. **Sorted**: Pinned threads first (📌), then by `updated_at` descending. **Active thread** highlighted with accent background/border. Each thread item shows title (1-line truncated) |
| **"Browser" Entry** | Navigation item to `/browser` screen |
| **Separator** | Divider line |
| **"Settings" Footer** | ⚙ icon + "Settings" label at bottom of drawer |

#### Thread Item Interactions:

| Gesture | Action |
|---------|--------|
| **Tap** | Select thread, load its messages |
| **Long-press (450ms)** | Opens ThreadOptionsModal |

---

## 5. Reusable Components Library

---

### 5.1. RichText Renderer

**File**: `components/chat/RichText.tsx`

Renders message content with support for:

| Content Type | Renderer | Notes |
|-------------|----------|-------|
| Standard Markdown | `react-native-markdown-display` | Lists, headers, bold, italic, links |
| Inline LaTeX (`$...$`) | `LatexRenderer` (KaTeX WebView) | Height: 24px |
| Block LaTeX (`$$...$$`) | `LatexRenderer` (KaTeX WebView) | Height: 65px, centered |
| Fenced Code Blocks | Custom rule renderer | Language label + Copy button header, horizontally scrollable monospace text |
| Mermaid Diagrams | `MermaidRenderer` (tabbed WebView) | Auto-detected when fenced block language is "mermaid" |

**RichText uses theme, fontSize, and accentColor props** to dynamically style all rendered content.

---

### 5.2. Message Bubble

**Renders inside the chat FlatList. Structure depends on role.**

#### User Bubble:

| Element | Description |
|---------|-------------|
| **Avatar/Label** | "👤 User" sender label |
| **Content** | Plain text or RichText rendered content |
| **Background** | `bubbleUser` theme color, `bubbleUserBorder` border |
| **Alignment** | Right-aligned (or full-width with user styling) |

#### Assistant Bubble:

| Element | Description |
|---------|-------------|
| **Header Segments (above bubble)** | Thought 🧠 and Intent 🎯 CollapsibleBlocks rendered above the main bubble |
| **Avatar/Label** | "[persona icon] Vela Agent ([Persona Name])" — dynamic based on thread persona |
| **Content Segments** | Parsed via `messageParser` into: text → RichText, tool_call → CollapsibleBlock ⚙️, skill → CollapsibleBlock 🧩 with custom JSON panel |
| **Skill JSON Panel** | Accent-tinted card with "🧩 SKILL: NAME" badge header, Copy button, formatted JSON in monospace ScrollView |
| **Web Search Sources Footer** | If message contains `<call:web_search>` results: divider line → "🌐 Sources Used" header → horizontal wrap of SourceCards |
| **Typing Indicator** | 3 pulsing dots + "VELA IS COMPILING..." during streaming |
| **Background** | `bubbleAssistant` theme color, `bubbleAssistantBorder` border |
| **Newline Separator** | Vertical spacer between skill blocks and following text |

#### Message Options (Long-press):

| Action | Description |
|--------|-------------|
| Copy | Copy message content to clipboard |
| Regenerate | Re-send the preceding user message to get a new response |
| Branch | Create a new thread branching from this point in the conversation |
| Share | Share message content via OS share sheet |

---

### 5.3. CollapsibleBlock

**File**: `components/chat/CollapsibleBlock.tsx`

A generic expandable/collapsible card used for structured response segments.

| Variant | Icon | Title Pattern | Background |
|---------|------|---------------|------------|
| `thought` | 🧠 | "Thought Process" | Semi-transparent (3% white) |
| `intent` | 🎯 | "Intent" | Semi-transparent (3% white) |
| `tool_call` | ⚙️ | "Executed: [tool_name]" | Theme card color |
| `skill` | 🧩 | "Executed Skill: [skill_name]" | Theme card color |

**Structure**:
- **Header**: Icon + Title + Args (truncated, 1 line) + Collapse arrow (▼/▲)
- **Body** (expandable): Children rendered inside. For skills, uses custom JSON panel. For tool_calls, shows result text. Shows "(Executing...)" placeholder while streaming
- Default state: **collapsed** when closed, **expanded** while streaming

---

### 5.4. LatexRenderer

**File**: `components/chat/LatexRenderer.tsx`

Renders LaTeX formulas using KaTeX inside a transparent WebView.

| Prop | Description |
|------|-------------|
| `formula` | The LaTeX string to render |
| `isBlock` | Whether to render as display-mode (centered, larger) or inline |

**Design notes**:
- Transparent background (inherits bubble bg)
- Text color matches theme `text` color (Catppuccin mocha default: `#cdd6f4`)
- No scrolling, fixed height (block: 65px, inline: 24px)

---

### 5.5. MermaidRenderer

**File**: `components/chat/MermaidRenderer.tsx`

Renders Mermaid.js diagrams with a tabbed interface.

| Tab | Content |
|-----|---------|
| **📊 Diagram** | Visual SVG rendering via Mermaid.js in WebView. Auto-adjusts height via `postMessage`. Dark theme for dark themes, default for Slate |
| **📝 Source** | Raw mermaid code in monospace text. Has "Copy" button |

**Design notes**:
- Bordered card with tab bar at top
- Active tab underlined with accent color
- WebView background transparent
- Falls back to source-only view on web platform

---

### 5.6. ThreadOptionsModal

**File**: `components/ui/ThreadOptionsModal.tsx`

Bottom sheet modal triggered by long-pressing a thread in the drawer.

| Action | Icon | Description |
|--------|------|-------------|
| **Share Conversation** | 🔗 | Copies thread title and ID to clipboard via OS share |
| **Pin / Unpin Thread** | 📌 | Toggles pin state. Pinned threads stick to top of drawer list |
| **Rename Conversation** | ✏️ | Shows inline TextInput with Save/Cancel buttons |
| **Delete Conversation** | 🗑️ | Removes thread permanently. Danger-styled (red) |

**Design**:
- Slide-up bottom sheet with dark background (`#0b0f19`)
- Handle bar at top (40px × 4px, rounded)
- Thread title + ID header
- Action rows with icon + label + description
- "Cancel" dismiss button at bottom

---

### 5.7. MessageOptionsModal

**File**: `components/ui/MessageOptionsModal.tsx`

Context menu for individual messages (triggered by long-press on a message).

| Action | Description |
|--------|-------------|
| **Copy** | Copy raw message content |
| **Regenerate** | Re-generate assistant response |
| **Branch** | Create a new thread from this message |
| **Share** | Share via OS share sheet |

---

### 5.8. GoogleWorkspaceCard

**File**: `components/ui/GoogleWorkspaceCard.tsx`

OAuth integration card for Google account management.

| Element | Description |
|---------|-------------|
| **Header** | "Google Workspace" title with Google icon |
| **Account Info** | Connected email address |
| **Scope Badges** | Pill badges showing authorized scopes (Gmail, Calendar) |
| **Connect/Disconnect Button** | Primary action button. Opens OAuth flow or revokes token |
| **Status Indicator** | Green dot = connected, Red dot = disconnected/expired |

---

### 5.9. HealthIndicator

**File**: `components/ui/HealthIndicator.tsx`

Connection health status display.

| State | Visual |
|-------|--------|
| **Connected** | Green pulsing dot + "Connected" |
| **Checking** | Yellow dot + spinner |
| **Disconnected** | Red dot + "Offline" |

---

### 5.10. SourceCard

**Renders inline in assistant bubbles** when web search results are detected.

| Element | Description |
|---------|-------------|
| **Favicon** | 14×14px Google Favicons API image for the domain |
| **Title** | Source title (1 line, truncated) |
| **Domain** | Source domain in smaller muted text |

**Behavior**: Tapping opens the URL in the system browser via `Linking.openURL()`.

**Layout**: Horizontal wrap, multiple cards per row. Cards have border, border-radius 8px, theme card background.

---

## 6. Future Features (Wayfinder Maps)

These are planned features from GitHub Issues that need UI components designed now for future implementation.

---

### 6.1. Local LLM Integration ✅ (Implemented)

**Status**: Implemented (Wayfinder #34 — Closed)

**UI Components Already Built**:
- Cloud/Local mode toggle in Settings
- Model selector with download sizes and RAM requirements
- Download progress bar
- WiFi-only download toggle
- Model switcher indicator in chat input area
- Mock fallback indicator when native inference unavailable

---

### 6.2. On-Device Image Generation (Wayfinder #45)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Image Generation Card** | In-chat card showing: prompt text, generation progress bar/spinner, generated image (full-width, tap-to-expand), "Save" and "Share" buttons |
| **Image Generation Input Mode** | Alternative chat input with image prompt prefix ("🎨 Generate:") or dedicated button |
| **Generation Settings** | Optional: negative prompt, step count, seed number (advanced panel in Settings or inline) |
| **Image Gallery** | Optional: history of generated images, scrollable grid view |

---

### 6.3. Multimodal Chat — Both Directions (Wayfinder #51)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Image Attachment Button** | Camera 📷 and Gallery 🖼️ buttons in chat input bar |
| **Image Preview in Input** | Thumbnail preview of selected image above the text input, with ✕ remove button |
| **Image in User Bubble** | Inline image display with tap-to-zoom. Responsive sizing |
| **Image in Assistant Bubble** | AI-generated or returned images rendered inline |
| **Image Viewer Modal** | Full-screen image viewer with pinch-to-zoom, pan, share, and save actions |
| **Mixed Content Rendering** | Support for text + image interleaved in SSE stream responses |
| **Camera Capture Screen** | In-app camera with capture button (or delegate to OS camera) |

---

### 6.4. Task Management & On-Device Cron (Wayfinder #56)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Tasks Screen** | New dedicated screen (possibly a tab or drawer entry). List of tasks with: title, schedule (cron expression in human-readable form), last run time, status (active/paused/completed), next run |
| **Task Detail View** | Expanded view showing: task description, schedule, execution history/logs, output text, associated thread |
| **Create Task Modal/Screen** | Form with: task name, prompt/instruction, schedule picker (presets: daily, hourly, weekly + custom cron), agent/persona selection |
| **Schedule Picker** | Friendly recurring schedule selector. Presets + custom time picker |
| **Task Status Badges** | Pill badges: 🟢 Active, ⏸️ Paused, ✅ Completed, 🔴 Failed |
| **Task Notification Card** | In-chat notification card when a background task completes |

---

### 6.5. Background Services & FCM Push Notifications (Wayfinder #61)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Notification Permission Prompt** | First-launch card requesting notification permission |
| **Notification Categories** | Android notification channels: Task Completions, Calendar Reminders, Agent Updates |
| **In-App Notification Banner** | Top-of-screen banner for foreground notifications (slide-down, auto-dismiss) |
| **Notification Settings Section** | In Settings: toggles per notification category, quiet hours start/end |
| **Notification Action Buttons** | On push notifications: Reply, Snooze, Dismiss, Open Thread |

---

### 6.6. Smart Auto-Configuration / RAM Detection (Wayfinder #67)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Device Capability Card** | Shows detected RAM, recommended model tier, recommended context window |
| **Recommendation Banner** | On first Settings visit or model change: "Based on your device (X GB RAM), we recommend [Model] with [Context] tokens" |
| **Accept/Override Controls** | "Use Recommended" button + "Customize" to manually override |
| **Device Tier Badge** | In Settings header: e.g., "🟢 High-End Device" / "🟡 Mid-Range" / "🔴 Low-End" |

---

### 6.7. Device Agent (Wayfinder #71)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Device Agent Persona** | New agent type in persona selector: "🤖 Device Agent" with unique icon/color |
| **Accessibility Permission Flow** | Step-by-step guide screen to enable Accessibility Service |
| **Screen Mirror View** | Read-only view showing what the Device Agent "sees" (screen data rendered as image or simplified DOM) |
| **Action Confirmation Dialog** | "Vela wants to [action] on [app/element]" — Approve / Deny |
| **Action Progress Overlay** | Floating banner showing current device automation step: "Opening Settings > WiFi > Connecting to [network]..." |
| **Device Action History** | Log of executed device actions with timestamps and success/failure status |

---

### 6.8. Client UX Enrichments (Wayfinder #72)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Voice Input Button** | Microphone 🎙️ button in chat input area. Replaces or sits alongside send button. Shows recording waveform animation during capture |
| **Voice Recording Indicator** | Pulsing red dot + elapsed time + stop button during voice capture |
| **Floating Overlay (Bubble)** | Persistent floating chat bubble accessible from any app. Tapping opens a mini Vela chat window |
| **Onboarding Flow** | Multi-step guided walkthrough for new users: 1. Welcome, 2. Connect Server, 3. Feature Tour (swipe cards), 4. Done. With skip option |
| **Onboarding Step Indicators** | Dot indicators at bottom of onboarding screens |

---

### 6.9. Offline Resilience (Wayfinder #73)

**Status**: Open / Planned

**New UI Components Needed**:

| Component | Description |
|-----------|-------------|
| **Offline Mode Banner** | Persistent banner at top of chat: "📡 Offline — using local storage" with reconnect button |
| **Sync Status Indicator** | In drawer or header: shows sync state (synced ✅, pending 🔄, conflict ⚠️) |
| **Sync Conflict Resolution** | Modal showing conflicting messages with "Keep Local" / "Keep Server" / "Keep Both" options |
| **Direct API Fallback Config** | In Settings: option to configure a direct OpenAI-compatible API key for fallback when backend is unreachable |
| **Offline Queue Indicator** | Badge on pending messages showing they haven't been synced yet |

---

## 7. Interaction Patterns & Micro-Animations

### 7.1. Streaming Typewriter Effect

- Tokens arrive via SSE and are buffered/flushed every 120ms
- Text appears incrementally in the assistant bubble
- Typing indicator (3 pulsing dots) visible at bubble bottom during streaming

### 7.2. Thread Selection

- Tapping a thread in the drawer: instant highlight with accent background
- Message history loads from local cache first, then fetches from server
- Drawer closes after selection on mobile

### 7.3. Long-Press Haptics

- Thread long-press (450ms delay) → subtle haptic feedback → bottom sheet slides up
- Message long-press → context menu appears

### 7.4. Collapsible Block Toggle

- Tap header to expand/collapse
- Arrow indicator rotates (▼ ↔ ▲)
- Content area smoothly animates open/closed

### 7.5. Tab Switching (Mermaid)

- Active tab underline transitions smoothly to selected tab
- Content cross-fades between Diagram and Source views

### 7.6. Pull-to-Refresh

- On thread list: pulls down to re-sync threads from backend
- Activity indicator at top of list during refresh

### 7.7. Browser AI Takeover

- Auto-navigation from chat to browser screen
- Status banner slides in from top with animation
- Action descriptions update in real-time
- Approval modal fades in with semi-transparent overlay

### 7.8. Model Switching

- Cloud ↔ Local toggle animates icon swap
- Brief loading state while model initializes (local mode)
- Error toast if local model unavailable

---

## 8. Responsive & Adaptive Behavior

### 8.1. Screen Sizes

The app is Android-only and must handle:
- Small phones (320dp width)
- Standard phones (360-412dp width)
- Large phones / phablets (412-480dp width)
- Tablets (600dp+ width) — optional

### 8.2. Keyboard Handling

- `adjustResize` mode on Android
- `KeyboardAvoidingView` wraps the chat area
- `keyboardShouldPersistTaps="handled"` prevents tap-dismiss issues
- Input area smoothly slides above keyboard

### 8.3. Orientation

- Portrait-only for phone form factor (standard chat app UX)
- Consider landscape support for browser screen on tablets

### 8.4. Safe Areas

- `react-native-safe-area-context` for notch/punch-hole camera cutouts
- Status bar area respected on all screens

### 8.5. Accessibility

- All interactive elements should have `accessibilityLabel`
- Contrast ratios should meet WCAG AA for text on theme backgrounds
- Screen reader support for collapsible blocks (announce state changes)

---

## Appendix A: Complete File Map (Current Client)

```
client/
├── app/
│   ├── _layout.tsx          # Root Drawer nav + route guard + persistent WebView
│   ├── index.tsx            # Main Chat Screen (~1600+ lines)
│   ├── setup.tsx            # Setup wizard
│   ├── settings.tsx         # Settings panel (~1200 lines)
│   └── browser.tsx          # In-app browser
├── components/
│   ├── chat/
│   │   ├── CollapsibleBlock.tsx   # Expandable thought/tool/intent/skill block
│   │   ├── LatexRenderer.tsx      # KaTeX WebView for math
│   │   ├── MermaidRenderer.tsx    # Mermaid.js diagram renderer
│   │   └── RichText.tsx           # Markdown + LaTeX + Mermaid hybrid renderer
│   └── ui/
│       ├── DrawerContent.tsx          # Custom sidebar drawer
│       ├── GoogleWorkspaceCard.tsx     # Google OAuth integration card
│       ├── HealthIndicator.tsx        # Connection health status
│       ├── MessageOptionsModal.tsx    # Message long-press context menu
│       └── ThreadOptionsModal.tsx     # Thread long-press options sheet
├── store/
│   ├── useChatStore.ts        # Thread + message state
│   ├── useConfigStore.ts      # App config + settings
│   ├── useBrowserStore.ts     # Browser state + AI actions
│   └── useGoogleAuthStore.ts  # Google OAuth state
├── utils/
│   ├── history.ts             # History sync with backend
│   ├── latexExtractor.ts      # Regex splitter for Markdown vs LaTeX
│   ├── localLlm.ts            # Local LLM model definitions + inference wrapper
│   ├── messageParser.ts       # XML tag parser for thought/intent/tool/skill blocks
│   ├── oauthCallback.ts       # OAuth deep link handler
│   ├── promptCompiler.ts      # Client-side prompt compilation for local mode
│   ├── sourceParser.ts        # Web search result parser
│   ├── sse.ts                 # SSE stream parser
│   ├── syncManager.ts         # Push-pull conversation sync
│   ├── theme.ts               # Theme colors, accent colors, font sizes
│   ├── toolProxy.ts           # Client→backend tool invocation relay
│   └── xmlHealer.ts           # Unclosed XML tag healer for stream recovery
├── db/
│   └── (drizzle schema)       # expo-sqlite + Drizzle ORM for local storage
└── __tests__/                 # Jest test suite
```

## Appendix B: Backend API Endpoints (Client Consumes)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Connection validation (Bearer auth) |
| `/chat/threads` | GET | List all threads |
| `/chat/threads/{id}` | GET | Fetch thread message history |
| `/chat/message` | POST | Send message + stream SSE response |
| `/chat/threads` | POST | Create new thread |
| `/chat/threads/{id}` | DELETE | Delete thread |
| `/chat/threads/branch` | POST | Branch conversation from a message |
| `/chat/threads/{id}/truncate` | POST | Truncate thread history |
| `/chat/webview/response` | POST | Send browser automation results back |
| `/oauth/google/authorize` | GET | Start Google OAuth flow |
| `/oauth/token/status` | GET | Check Google OAuth token status |
| `/oauth/token/revoke` | POST | Revoke Google OAuth token |
| `/api/tools/manifest` | GET | Get tool definitions for local LLM |
| `/api/tools/invoke` | POST | Invoke backend tool from local LLM |
| `/api/sync/pull` | GET | Pull conversation sync data |
| `/api/sync/push` | POST | Push local conversation data |

## Appendix C: Agent Personas

| ID | Name | Icon | Description |
|----|------|------|-------------|
| `personal assistant` | Personal Assistant | 🤖 | General-purpose assistant |
| `teacher` | Teacher | 👩‍🏫 | Explains concepts step-by-step |
| `analyst` | Data Analyst | 📊 | Data analysis and insights |
| `prompt builder` | Prompt Architect | ✍️ | Crafts system prompts and prompt engineering |
| `researcher` | Researcher | 🔬 | Deep research on topics |
| `coder` | Developer | 💻 | Coding assistance and review |
| `brainstormer` | Brainstormer | 💡 | Creative ideation and brainstorming sessions |

## Appendix D: SSE Stream Protocol

Messages are streamed as `text/event-stream`:

```
data: {"type": "content", "delta": "The "}
data: {"type": "content", "delta": "answer is "}
data: {"type": "content", "delta": "$42$"}
data: {"type": "done", "thread_title": "Quick Math"}
```

Content may contain XML-like tags parsed by `messageParser`:
- `<thought>...</thought>` — LLM's internal reasoning (rendered above bubble)
- `<intent>...</intent>` — Classified intent (rendered above bubble)  
- `<call:tool_name input="...">...</call:tool_name>` — Tool call + result
- `<skill:skill_name input="...">...</skill:skill_name>` — Skill execution + output
- `<call:webview_browser input="...">` — Browser automation command

Stream tokens are buffered and flushed every 120ms to prevent UI freezing. Unclosed XML tags are healed automatically on stream completion.
