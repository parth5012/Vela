# 2026-07-05 Vela Client New Features Design Spec

This design specification details the architecture, state changes, and UI layouts to implement the requested Vela client enhancements.

---

## 1. Objectives & Feature Summary

1. **Load Previous Chats:** 
   * On configuration (valid URL/Key entry) or app startup, fetch the list of threads from `GET /chat/threads` (filtered on the backend to exclude Telegram/Discord).
   * Pre-fetch and cache the message histories for all threads in the background using `GET /chat/threads/{thread_id}` in parallel or sequentially.
2. **Smooth Scrolling:**
   * Invert the chat `FlatList` (`inverted={true}`) to anchor the scroll anchor to the bottom natively.
   * Reverse the messages array during rendering.
   * Remove high-frequency, layout-disrupting manual `.scrollToEnd()` calls during text streaming.
3. **Thread Options Context Menu (Long-press):**
   * Support long-pressing threads in the sidebar drawer.
   * Open a slide-up options sheet containing:
     * **Share Conversation:** Export conversation and copy link.
     * **Pin/Unpin Thread:** Keep pinned chats permanently at the top of the sidebar.
     * **Rename Chat:** Open a text input dialog to modify the thread's title.
     * **Delete Chat:** Cleanly remove the thread locally and on the server.
4. **App Settings Customizations:**
   * **UI Controls:** App Theme (Deep Dark, Slate Navy, Cyberpunk), Accent Color (Indigo, Emerald, Rose, Amber), and Message Font Size (Small, Medium, Large).
   * **Agent Config:** Default Model, Temperature (0.0 - 1.0 slider), and custom Base System Prompt.
5. **Clickability & Keyboard Fixes:**
   * Add `keyboardShouldPersistTaps="handled"` to the message list to prevent keyboard dismissals from swallowing touch inputs.
   * Configure Android `"softwareKeyboardLayoutMode": "adjustResize"` in `app.json` and adjust the layout hierarchy using `KeyboardAvoidingView` to shift inputs above the keyboard smoothly.

---

## 2. State Management & API Integration

### 2.1. Config Store Changes (`store/useConfigStore.ts`)
Add persistent settings for UI customization and Agent parameters:
```typescript
interface ConfigState {
  // Server Config
  apiUrl: string;
  apiKey: string;
  isConfigured: boolean;
  hasHydrated: boolean;
  
  // UI Customizations
  theme: 'deep' | 'slate' | 'cyberpunk';
  fontSize: 'small' | 'medium' | 'large';
  accentColor: 'indigo' | 'emerald' | 'rose' | 'amber';
  
  // Agent Working Configurations
  systemPrompt: string;
  temperature: number;
  modelName: string;

  // Setters
  setConfig: (url: string, key: string) => void;
  clearConfig: () => void;
  setHasHydrated: (val: boolean) => void;
  
  setTheme: (theme: 'deep' | 'slate' | 'cyberpunk') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setAccentColor: (color: 'indigo' | 'emerald' | 'rose' | 'amber') => void;
  setSystemPrompt: (prompt: string) => void;
  setTemperature: (temp: number) => void;
  setModelName: (model: string) => void;
}
```

### 2.2. Chat Store Changes (`store/useChatStore.ts`)
Extend thread management with pinning, renaming, and backend synchronizations:
```typescript
export interface Thread {
  id: string;
  title: string;
  updated_at: string;
  is_pinned?: boolean;
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
  
  // New Actions
  renameThread: (id: string, newTitle: string) => void;
  togglePinThread: (id: string) => void;
  clearStore: () => void;
}
```

### 2.3. History Pre-fetching Workflow
Create a helper function to synchronize the store with the backend:
```typescript
export async function syncHistoryWithBackend(apiUrl: string, apiKey: string) {
  try {
    // 1. Fetch thread list
    const res = await fetch(`${apiUrl}/chat/threads`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) return;
    const backendThreads: Thread[] = await res.json();
    
    // 2. Set threads in store
    useChatStore.getState().setThreads(backendThreads);

    // 3. Pre-fetch message histories in background
    await Promise.all(
      backendThreads.map(async (t) => {
        try {
          const mRes = await fetch(`${apiUrl}/chat/threads/${t.id}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (mRes.ok) {
            const history = await mRes.json();
            useChatStore.getState().setHistory(t.id, history);
          }
        } catch (err) {
          console.error(`Failed to fetch history for thread ${t.id}`, err);
        }
      })
    );
  } catch (err) {
    console.error('History sync failed', err);
  }
}
```

---

## 3. UI and Component Updates

### 3.1. Thread Sorting & Sidebar Options
Modify `components/ui/DrawerContent.tsx` to sort pinned threads to the top and bind long-press gestures to open a custom bottom modal.

```typescript
// Sorting logic: Pinned first, then sorted by updated_at descending
const sortedThreads = [...threads].sort((a, b) => {
  if (a.is_pinned && !b.is_pinned) return -1;
  if (!a.is_pinned && b.is_pinned) return 1;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
});
```

Long-pressing a thread item:
```tsx
<Pressable
  onLongPress={() => handleOpenThreadOptions(thread)}
  delayLongPress={400}
  // ...
>
```

### 3.2. Custom Customization Styles
Apply custom theme colors and font size styles dynamically using styling objects in React Native:
```typescript
const colors = {
  deep: { bg: '#09090b', card: '#18181b', text: '#f4f4f5', border: '#27272a' },
  slate: { bg: '#0b0f19', card: '#1e293b', text: '#f1f5f9', border: '#334155' },
  cyberpunk: { bg: '#020617', card: '#0f172a', text: '#f8fafc', border: '#1e1b4b' },
};
```

---

## 4. Testing & Verification

1. **Unit Tests:**
   * Extend `__tests__/useChatStore.test.ts` to test thread renaming, pinning, and sorting logic.
   * Extend `__tests__/useConfigStore.test.ts` to verify the setting options persistence.
2. **Manual UI Verification:**
   * Verify FlatList scrolling smoothness under synthetic high-speed message streaming.
   * Long-press to trigger options modal on iOS and Android virtual devices, verifying all sub-features (pinning, deletion, renaming, sharing).
   * Open keyboard, check input resizing, and test clicking elements while keyboard is open.
