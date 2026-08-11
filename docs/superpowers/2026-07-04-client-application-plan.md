# 2026-07-04 Client Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a custom React Native (Expo) mobile client app featuring dynamic server setup, multiple chat threads, local settings persistence, and a hybrid Markdown + LaTeX WebView-KaTeX parser.

**Architecture:** Use Expo Router for navigation drawer layout and Zustand for state storage. The root layout intercepts renders to enforce setup configuration. Messages are tokenized using a regex splitter to isolate mathematical segments, sending math blocks to local KaTeX WebViews and text to a Markdown renderer.

**Tech Stack:** Expo SDK 51, TypeScript, Zustand, React Native Webview, react-native-markdown-display, NativeWind (Tailwind CSS).

---

### Task 1: Scaffolding & Configuration Store

**Files:**
- Create: `store/useConfigStore.ts`
- Create: `app/setup.tsx`
- Modify: `app/_layout.tsx`
- Test: `__tests__/useConfigStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/useConfigStore.test.ts`:

```typescript
import { useConfigStore } from '../store/useConfigStore';

describe('useConfigStore', () => {
  it('should initialize with blank values and allow setting config', () => {
    const state = useConfigStore.getState();
    expect(state.apiUrl).toBe('');
    expect(state.apiKey).toBe('');
    expect(state.isConfigured).toBe(false);

    state.setConfig('https://api.vela.local', 'my-secret-key');

    const updatedState = useConfigStore.getState();
    expect(updatedState.apiUrl).toBe('https://api.vela.local');
    expect(updatedState.apiKey).toBe('my-secret-key');
    expect(updatedState.isConfigured).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test __tests__/useConfigStore.test.ts`
Expected: FAIL (Cannot find module '../store/useConfigStore')

- [ ] **Step 3: Write minimal implementation**

Create `store/useConfigStore.ts`:

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ConfigState {
  apiUrl: string;
  apiKey: string;
  isConfigured: boolean;
  setConfig: (url: string, key: string) => void;
  clearConfig: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      apiUrl: '',
      apiKey: '',
      isConfigured: false,
      setConfig: (url, key) => set({ apiUrl: url, apiKey: key, isConfigured: true }),
      clearConfig: () => set({ apiUrl: '', apiKey: '', isConfigured: false }),
    }),
    {
      name: 'vela-config-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

Implement `/setup` UI and Router Guards inside:
1. `app/setup.tsx` (Renders text boxes for URL & Key, triggers `GET /health` with Bearer auth, calls `setConfig` on success, navigates to `/`).
2. `app/_layout.tsx` (Listens to `isConfigured` and redirects to `/setup` if `false`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test __tests__/useConfigStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add store/useConfigStore.ts app/setup.tsx app/_layout.tsx
git commit -m "feat: implement config store, route guard, and setup screen"
```

---

### Task 2: Multi-Thread State Management

**Files:**
- Create: `store/useChatStore.ts`
- Test: `__tests__/useChatStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/useChatStore.test.ts`:

```typescript
import { useChatStore } from '../store/useChatStore';

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().clearStore();
  });

  it('should handle creating, selecting, and deleting threads', () => {
    const store = useChatStore.getState();
    expect(store.threads.length).toBe(0);

    // 1. Create thread
    store.createThread('Thread 1', 'test-uuid-1');
    expect(useChatStore.getState().threads.length).toBe(1);
    expect(useChatStore.getState().activeThreadId).toBe('test-uuid-1');

    // 2. Add message to thread
    store.addMessage('test-uuid-1', { id: 'msg1', role: 'user', content: 'hello' });
    expect(useChatStore.getState().messages['test-uuid-1'].length).toBe(1);

    // 3. Delete thread
    store.deleteThread('test-uuid-1');
    expect(useChatStore.getState().threads.length).toBe(0);
    expect(useChatStore.getState().activeThreadId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test __tests__/useChatStore.test.ts`
Expected: FAIL (Cannot find module '../store/useChatStore')

- [ ] **Step 3: Write minimal implementation**

Create `store/useChatStore.ts`:

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface Thread {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatState {
  threads: Thread[];
  activeThreadId: string | null;
  messages: Record<string, Message[]>;
  isStreaming: boolean;
  createThread: (title: string, id: string) => void;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  addMessage: (threadId: string, message: Message) => void;
  appendToken: (threadId: string, token: string) => void;
  setThreads: (threads: Thread[]) => void;
  setHistory: (threadId: string, history: Message[]) => void;
  setStreaming: (streaming: boolean) => void;
  clearStore: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      messages: {},
      isStreaming: false,
      createThread: (title, id) => set((state) => ({
        threads: [{ id, title, updated_at: new Date().toISOString() }, ...state.threads],
        activeThreadId: id,
        messages: { ...state.messages, [id]: [] }
      })),
      selectThread: (id) => set({ activeThreadId: id }),
      deleteThread: (id) => set((state) => {
        const nextThreads = state.threads.filter((t) => t.id !== id);
        const nextActive = state.activeThreadId === id
          ? (nextThreads[0]?.id || null)
          : state.activeThreadId;
        const nextMessages = { ...state.messages };
        delete nextMessages[id];
        return { threads: nextThreads, activeThreadId: nextActive, messages: nextMessages };
      }),
      addMessage: (threadId, message) => set((state) => {
        const current = state.messages[threadId] || [];
        return {
          messages: { ...state.messages, [threadId]: [...current, message] }
        };
      }),
      appendToken: (threadId, token) => set((state) => {
        const current = state.messages[threadId] || [];
        if (current.length === 0) return {};
        const last = current[current.length - 1];
        if (last.role !== 'assistant') return {};
        
        const updatedLast = { ...last, content: last.content + token };
        return {
          messages: {
            ...state.messages,
            [threadId]: [...current.slice(0, -1), updatedLast]
          }
        };
      }),
      setThreads: (threads) => set({ threads }),
      setHistory: (threadId, history) => set((state) => ({
        messages: { ...state.messages, [threadId]: history }
      })),
      setStreaming: (isStreaming) => set({ isStreaming }),
      clearStore: () => set({ threads: [], activeThreadId: null, messages: {}, isStreaming: false }),
    }),
    {
      name: 'vela-chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test __tests__/useChatStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add store/useChatStore.ts
git commit -m "feat: implement multi-thread chat store using Zustand"
```

---

### Task 3: Rich Text LaTeX Segment Splitter

**Files:**
- Create: `utils/latexExtractor.ts`
- Create: `components/chat/LatexRenderer.tsx`
- Create: `components/chat/RichText.tsx`
- Test: `__tests__/latexExtractor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/latexExtractor.test.ts`:

```typescript
import { parseContent } from '../utils/latexExtractor';

describe('latexExtractor', () => {
  it('should split math equations from standard markdown text', () => {
    const text = 'Here is inline $x^2 + y^2 = z^2$ and a block: \n$$\\int x dx = \\frac{x^2}{2}$$';
    const segments = parseContent(text);
    
    expect(segments.length).toBe(4);
    expect(segments[0]).toEqual({ type: 'markdown', content: 'Here is inline ' });
    expect(segments[1]).toEqual({ type: 'latex-inline', content: 'x^2 + y^2 = z^2' });
    expect(segments[2]).toEqual({ type: 'markdown', content: ' and a block: \n' });
    expect(segments[3]).toEqual({ type: 'latex-block', content: '\\int x dx = \\frac{x^2}{2}' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test __tests__/latexExtractor.test.ts`
Expected: FAIL (Cannot find module '../utils/latexExtractor')

- [ ] **Step 3: Write minimal implementation**

Create `utils/latexExtractor.ts`:

```typescript
export interface ContentSegment {
  type: 'markdown' | 'latex-inline' | 'latex-block';
  content: string;
}

export function parseContent(text: string): ContentSegment[] {
  const regex = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g;
  const parts = text.split(regex);
  
  return parts.map(part => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return { type: 'latex-block', content: part.slice(2, -2).trim() };
    } else if (part.startsWith('$') && part.endsWith('$')) {
      return { type: 'latex-inline', content: part.slice(1, -1).trim() };
    }
    return { type: 'markdown', content: part };
  }).filter(p => p.content.length > 0);
}
```

Create `components/chat/LatexRenderer.tsx` using `WebView` with injected KaTeX HTML (as outlined in design spec Section 5.3).
Create `components/chat/RichText.tsx` to map array of parsed segments to standard `react-native-markdown-display` layouts or the `LatexRenderer`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test __tests__/latexExtractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/latexExtractor.ts components/chat/LatexRenderer.tsx components/chat/RichText.tsx
git commit -m "feat: implement KaTeX webview renderer and segment splitter"
```

---

### Task 4: Custom SSE Stream Parser

**Files:**
- Create: `utils/sse.ts`
- Test: `__tests__/sse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/sse.test.ts`:

```typescript
import { streamAgentResponse } from '../utils/sse';

describe('streamAgentResponse', () => {
  it('should stream chunks and trigger events', async () => {
    const chunks: string[] = [];
    let completed = false;
    let title = '';

    global.fetch = jest.fn().mockImplementation(() => {
      const mockStream = {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "content", "delta": "Hello"}\n\n'), done: false };
              } else if (count === 1) {
                count++;
                return { value: new TextEncoder().encode('data: {"type": "done", "thread_title": "Greeting"}\n\n'), done: false };
              }
              return { value: undefined, done: true };
            }
          };
        }
      };
      return Promise.resolve({
        ok: true,
        body: mockStream
      });
    });

    await streamAgentResponse(
      'http://localhost',
      'key',
      'thread-1',
      'hi',
      (chunk) => chunks.push(chunk),
      (t) => { completed = true; title = t || ''; },
      () => {}
    );

    expect(chunks).toEqual(['Hello']);
    expect(completed).toBe(true);
    expect(title).toBe('Greeting');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test __tests__/sse.test.ts`
Expected: FAIL (Cannot find module '../utils/sse')

- [ ] **Step 3: Write minimal implementation**

Create `utils/sse.ts` (as detailed in backend specification Section 5.2).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test __tests__/sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/sse.ts
git commit -m "feat: add fetch-based Server-Sent Events parser"
```

---

### Task 5: Main Chat Screen & Drawer Setup

**Files:**
- Create: `components/ui/DrawerContent.tsx`
- Create: `app/index.tsx`
- Create: `app/settings.tsx`

- [ ] **Step 1: Implement custom DrawerContent component**
List threads inside a sliding sidebar, allow selecting active thread, and provide a "Delete" button. Show a "New Conversation" button to generate a new thread.

- [ ] **Step 2: Implement index.tsx (Main Chat Window)**
Draw bubbles list, handle typing messages, calling `streamAgentResponse`, appending text typewriter chunks, and auto-scrolling to the bottom of the list.

- [ ] **Step 3: Implement settings.tsx**
Screen to edit server credentials or reset local stores.

- [ ] **Step 4: Verify complete application compile**
Run: `npx expo start`
Verify mock connection testing and rendering paths.

- [ ] **Step 5: Commit**

```bash
git add components/ui/DrawerContent.tsx app/index.tsx app/settings.tsx
git commit -m "feat: complete active chat UI layout and settings screens"
```
