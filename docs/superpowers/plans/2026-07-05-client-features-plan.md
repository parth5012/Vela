# Vela Client Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement chat history loading on url/key configuration, smooth inverted scrolling, long-press thread options modal (Share, Pin, Rename, Delete), customization options in Settings, and keyboard/touch usability fixes.

**Architecture:** Extend Zustand state stores (`useConfigStore` and `useChatStore`) to support settings storage and local/remote thread actions (renaming, pinning). Modify UI screens and drawer layouts to use these stores, add a custom `ThreadOptionsModal`, and configure `FlatList` and app settings for native scrolling/soft-keyboard integration.

**Tech Stack:** React Native (Expo), TypeScript, Zustand, Expo Router, `@react-native-async-storage/async-storage`.

---

### Task 1: Keyboard Resizing Configuration
**Files:**
- Modify: `client/app.json`

- [ ] **Step 1: Configure Android Software Keyboard Layout Mode**
  Modify `client/app.json` inside `expo.android` to configure `"softwareKeyboardLayoutMode": "adjustResize"`. This ensures the Android window shifts up when the keyboard is open.
  
  Code changes:
  ```json
      "android": {
        "adaptiveIcon": {
          "backgroundColor": "#E6F4FE",
          "foregroundImage": "./assets/android-icon-foreground.png",
          "backgroundImage": "./assets/android-icon-background.png",
          "monochromeImage": "./assets/android-icon-monochrome.png"
        },
        "predictiveBackGestureEnabled": false,
        "package": "com.parth5012.client",
        "softwareKeyboardLayoutMode": "adjustResize"
      },
  ```

- [ ] **Step 2: Verify app.json is syntactically valid JSON**
  Run: `node -e "JSON.parse(require('fs').readFileSync('client/app.json', 'utf8'))"`
  Expected: Command completes without error.

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/app.json
  git commit -m "chore: configure softwareKeyboardLayoutMode in app.json"
  ```

---

### Task 2: Store Configuration & Settings Extension
**Files:**
- Modify: `client/store/useConfigStore.ts`
- Test: `client/__tests__/useConfigStore.test.ts`

- [ ] **Step 1: Add config states and setters for UI and Agent settings**
  Edit `client/store/useConfigStore.ts` to add the new settings and their setters.
  
  Code changes:
  ```typescript
  // client/store/useConfigStore.ts
  interface ConfigState {
    apiUrl: string;
    apiKey: string;
    isConfigured: boolean;
    hasHydrated: boolean;
    
    // UI Settings
    theme: 'deep' | 'slate' | 'cyberpunk';
    fontSize: 'small' | 'medium' | 'large';
    accentColor: 'indigo' | 'emerald' | 'rose' | 'amber';
    
    // Agent Settings
    systemPrompt: string;
    temperature: number;
    modelName: string;
    
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
  And implement their default states and actions:
  ```typescript
    // In the create store object:
    theme: 'deep',
    fontSize: 'medium',
    accentColor: 'indigo',
    systemPrompt: 'You are an autonomous research agent.',
    temperature: 0.7,
    modelName: 'gemini-1.5-pro',
    setTheme: (theme) => set({ theme }),
    setFontSize: (fontSize) => set({ fontSize }),
    setAccentColor: (accentColor) => set({ accentColor }),
    setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
    setTemperature: (temperature) => set({ temperature }),
    setModelName: (modelName) => set({ modelName }),
  ```

- [ ] **Step 2: Update the unit tests**
  Modify `client/__tests__/useConfigStore.test.ts` to assert that settings default to correct values and can be updated using setters.
  
  Code block:
  ```typescript
  import { useConfigStore } from '../store/useConfigStore';

  describe('useConfigStore Customization Settings', () => {
    it('should initialize with default customization options', () => {
      const state = useConfigStore.getState();
      expect(state.theme).toBe('deep');
      expect(state.fontSize).toBe('medium');
      expect(state.accentColor).toBe('indigo');
      expect(state.temperature).toBe(0.7);
    });

    it('should update customization options correctly', () => {
      const store = useConfigStore.getState();
      store.setTheme('slate');
      store.setFontSize('large');
      store.setAccentColor('emerald');
      store.setTemperature(0.2);

      const updated = useConfigStore.getState();
      expect(updated.theme).toBe('slate');
      expect(updated.fontSize).toBe('large');
      expect(updated.accentColor).toBe('emerald');
      expect(updated.temperature).toBe(0.2);
    });
  });
  ```

- [ ] **Step 3: Run the config store tests**
  Run: `npm --prefix client test __tests__/useConfigStore.test.ts`
  Expected: Tests pass.

- [ ] **Step 4: Commit changes**
  ```bash
  git add client/store/useConfigStore.ts client/__tests__/useConfigStore.test.ts
  git commit -m "feat: add customization settings options to useConfigStore"
  ```

---

### Task 3: Chat Store Pinning & Rename Actions
**Files:**
- Modify: `client/store/useChatStore.ts`
- Test: `client/__tests__/useChatStore.test.ts`

- [ ] **Step 1: Add Pinning & Renaming state and actions**
  Edit `client/store/useChatStore.ts` to extend the `Thread` type and add `renameThread` and `togglePinThread` functions.
  
  Code changes:
  ```typescript
  export interface Thread {
    id: string;
    title: string;
    updated_at: string;
    is_pinned?: boolean;
  }

  interface ChatState {
    // ...existing...
    renameThread: (id: string, newTitle: string) => void;
    togglePinThread: (id: string) => void;
  }
  ```
  Implement the functions in `useChatStore`:
  ```typescript
        renameThread: (id, newTitle) => set((state) => ({
          threads: state.threads.map((t) => (t.id === id ? { ...t, title: newTitle } : t))
        })),
        togglePinThread: (id) => set((state) => ({
          threads: state.threads.map((t) => (t.id === id ? { ...t, is_pinned: !t.is_pinned } : t))
        })),
  ```

- [ ] **Step 2: Update unit tests for renaming and pinning**
  Add unit tests in `client/__tests__/useChatStore.test.ts` to verify pinning and renaming.
  
  Code block:
  ```typescript
  describe('useChatStore Pin & Rename', () => {
    it('should rename a thread correctly', () => {
      const store = useChatStore.getState();
      store.createThread('Original Title', 'test_rename_id');
      store.renameThread('test_rename_id', 'New Title');
      
      const thread = useChatStore.getState().threads.find(t => t.id === 'test_rename_id');
      expect(thread?.title).toBe('New Title');
    });

    it('should toggle pin state correctly', () => {
      const store = useChatStore.getState();
      store.createThread('Title', 'test_pin_id');
      expect(useChatStore.getState().threads.find(t => t.id === 'test_pin_id')?.is_pinned).toBeFalsy();
      
      store.togglePinThread('test_pin_id');
      expect(useChatStore.getState().threads.find(t => t.id === 'test_pin_id')?.is_pinned).toBe(true);
    });
  });
  ```

- [ ] **Step 3: Run the chat store tests**
  Run: `npm --prefix client test __tests__/useChatStore.test.ts`
  Expected: Tests pass.

- [ ] **Step 4: Commit changes**
  ```bash
  git add client/store/useChatStore.ts client/__tests__/useChatStore.test.ts
  git commit -m "feat: implement rename and pin actions in useChatStore"
  ```

---

### Task 4: API Sync Handler & Pre-fetching
**Files:**
- Create: `client/utils/history.ts`

- [ ] **Step 1: Write history fetching and caching logic**
  Implement `client/utils/history.ts` to fetch all threads from `/chat/threads`, load them, and sequentially pre-fetch their histories from `/chat/threads/{id}` into `useChatStore`.
  
  Code changes:
  ```typescript
  import { useChatStore, Thread, Message } from '../store/useChatStore';

  export async function syncHistoryWithBackend(apiUrl: string, apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${apiUrl}/chat/threads`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch threads: ${response.status}`);
      }

      const threads: Thread[] = await response.json();
      useChatStore.getState().setThreads(threads);

      // Pre-fetch thread history in background
      await Promise.all(
        threads.map(async (thread) => {
          try {
            const threadResponse = await fetch(`${apiUrl}/chat/threads/${thread.id}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
              },
            });

            if (threadResponse.ok) {
              const history: Message[] = await threadResponse.json();
              useChatStore.getState().setHistory(thread.id, history);
            }
          } catch (e) {
            console.warn(`Could not sync history for thread ${thread.id}:`, e);
          }
        })
      );

      // Select first thread if none is active
      const state = useChatStore.getState();
      if (threads.length > 0 && !state.activeThreadId) {
        state.selectThread(threads[0].id);
      }

      return true;
    } catch (e) {
      console.error('History sync failed:', e);
      return false;
    }
  }
  ```

- [ ] **Step 2: Verify the syntax is error-free**
  Run: `npx tsc --noEmit --project client/tsconfig.json`
  Expected: Command completes with no compilation errors.

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/utils/history.ts
  git commit -m "feat: add syncHistoryWithBackend api utility"
  ```

---

### Task 5: Integrate Sync into Login & Settings Updates
**Files:**
- Modify: `client/app/setup.tsx`
- Modify: `client/app/settings.tsx`

- [ ] **Step 1: Fetch history on Setup screen configuration**
  Import `syncHistoryWithBackend` and execute it immediately after successful connection validation in `client/app/setup.tsx`.
  
  Code changes (around line 63):
  ```typescript
        if (response.ok) {
          setConfig(formattedUrl, apiKey.trim());
          const { syncHistoryWithBackend } = require('../utils/history');
          await syncHistoryWithBackend(formattedUrl, apiKey.trim());
        }
  ```

- [ ] **Step 2: Fetch history on Settings screen API updates**
  Apply the same pattern in `client/app/settings.tsx` to pull down historical chats when saved.
  
  Code changes (around line 65):
  ```typescript
        if (response.ok) {
          setConfig(formattedUrl, apiKey.trim());
          setSuccess(true);
          const { syncHistoryWithBackend } = require('../utils/history');
          await syncHistoryWithBackend(formattedUrl, apiKey.trim());
        }
  ```

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/app/setup.tsx client/app/settings.tsx
  git commit -m "feat: trigger history pre-fetching on setup and setting updates"
  ```

---

### Task 6: Thread Options Context Modal
**Files:**
- Create: `client/components/ui/ThreadOptionsModal.tsx`

- [ ] **Step 1: Write ThreadOptionsModal component**
  Create `client/components/ui/ThreadOptionsModal.tsx` displaying the Share, Pin/Unpin, Rename, and Delete options.
  
  Code content:
  ```tsx
  import React, { useState } from 'react';
  import {
    Modal,
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    Platform,
    Share,
  } from 'react-native';
  import { useChatStore, Thread } from '../../store/useChatStore';

  interface ThreadOptionsModalProps {
    visible: boolean;
    thread: Thread | null;
    onClose: () => void;
  }

  export default function ThreadOptionsModal({ visible, thread, onClose }: ThreadOptionsModalProps) {
    const { renameThread, togglePinThread, deleteThread } = useChatStore();
    const [isRenaming, setIsRenaming] = useState(false);
    const [newTitle, setNewTitle] = useState('');

    if (!thread) return null;

    const handleShare = async () => {
      try {
        await Share.share({
          message: `Conversation Title: ${thread.title}\nID: ${thread.id}`,
        });
        onClose();
      } catch (error) {
        console.error(error);
      }
    };

    const handlePin = () => {
      togglePinThread(thread.id);
      onClose();
    };

    const handleRenameSave = () => {
      if (newTitle.trim()) {
        renameThread(thread.id, newTitle.trim());
      }
      setIsRenaming(false);
      onClose();
    };

    const handleDelete = () => {
      deleteThread(thread.id);
      onClose();
    };

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{thread.title}</Text>
              <Text style={styles.subtitle}>ID: {thread.id}</Text>
            </View>

            {isRenaming ? (
              <View style={styles.renameContainer}>
                <TextInput
                  style={styles.input}
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Enter new title..."
                  placeholderTextColor="#71717a"
                  autoFocus
                />
                <View style={styles.btnRow}>
                  <Pressable style={[styles.btn, styles.btnCancel]} onPress={() => setIsRenaming(false)}>
                    <Text style={styles.btnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.btnSave]} onPress={handleRenameSave}>
                    <Text style={styles.btnText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable style={styles.actionBtn} onPress={handleShare}>
                  <Text style={styles.actionIcon}>🔗</Text>
                  <View>
                    <Text style={styles.actionLabel}>Share Conversation</Text>
                    <Text style={styles.actionDesc}>Copy details to clipboard</Text>
                  </View>
                </Pressable>

                <Pressable style={styles.actionBtn} onPress={handlePin}>
                  <Text style={styles.actionIcon}>📌</Text>
                  <View>
                    <Text style={styles.actionLabel}>{thread.is_pinned ? 'Unpin Thread' : 'Pin Thread'}</Text>
                    <Text style={styles.actionDesc}>{thread.is_pinned ? 'Remove from top' : 'Keep at the top of list'}</Text>
                  </View>
                </Pressable>

                <Pressable style={styles.actionBtn} onPress={() => { setIsRenaming(true); setNewTitle(thread.title); }}>
                  <Text style={styles.actionIcon}>✏️</Text>
                  <View>
                    <Text style={styles.actionLabel}>Rename Conversation</Text>
                    <Text style={styles.actionDesc}>Change local display name</Text>
                  </View>
                </Pressable>

                <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleDelete}>
                  <Text style={styles.actionIcon}>🗑️</Text>
                  <View>
                    <Text style={[styles.actionLabel, styles.dangerText]}>Delete Conversation</Text>
                    <Text style={styles.actionDesc}>Erase this thread permanently</Text>
                  </View>
                </Pressable>
              </View>
            )}

            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  }

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: '#0b0f19',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255, 255, 255, 0.08)',
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: '#27272a',
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 20,
    },
    header: {
      marginBottom: 20,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255, 255, 255, 0.05)',
      paddingBottom: 12,
    },
    title: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#f8fafc',
    },
    subtitle: {
      fontSize: 11,
      color: '#64748b',
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      marginTop: 4,
    },
    actions: {
      gap: 10,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.05)',
      gap: 14,
    },
    actionBtnDanger: {
      backgroundColor: 'rgba(239, 68, 68, 0.03)',
      borderColor: 'rgba(239, 68, 68, 0.1)',
    },
    actionIcon: {
      fontSize: 20,
    },
    actionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: '#f1f5f9',
    },
    dangerText: {
      color: '#ef4444',
    },
    actionDesc: {
      fontSize: 11,
      color: '#64748b',
      marginTop: 2,
    },
    renameContainer: {
      paddingVertical: 10,
    },
    input: {
      backgroundColor: '#030712',
      borderWidth: 1,
      borderColor: '#1e293b',
      borderRadius: 8,
      padding: 12,
      color: '#f8fafc',
      fontSize: 14,
      marginBottom: 16,
    },
    btnRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
    },
    btn: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    btnCancel: {
      backgroundColor: '#18181b',
    },
    btnSave: {
      backgroundColor: '#6366f1',
    },
    btnText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    closeBtn: {
      marginTop: 16,
      padding: 14,
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: 10,
      alignItems: 'center',
    },
    closeBtnText: {
      color: '#cbd5e1',
      fontSize: 14,
      fontWeight: '600',
    },
  });
  ```

- [ ] **Step 2: Validate typing works**
  Run: `npx tsc --noEmit --project client/tsconfig.json`
  Expected: Pass.

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/components/ui/ThreadOptionsModal.tsx
  git commit -m "feat: implement ThreadOptionsModal for thread actions sheet"
  ```

---

### Task 7: Integrate Long-press Options into Drawer List
**Files:**
- Modify: `client/components/ui/DrawerContent.tsx`

- [ ] **Step 1: Implement Sorting, Long-press triggers and options dialog inside sidebar**
  Update `client/components/ui/DrawerContent.tsx` to import `ThreadOptionsModal` and update thread rendering.
  
  Code changes:
  * Sort threads:
    ```typescript
      const sortedThreads = [...threads].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
    ```
  * Setup state:
    ```typescript
      const [optionsVisible, setOptionsVisible] = React.useState(false);
      const [selectedThread, setSelectedThread] = React.useState<Thread | null>(null);
      
      const handleOpenOptions = (thread: Thread) => {
        setSelectedThread(thread);
        setOptionsVisible(true);
      };
    ```
  * Add the modal at the bottom of the return statement:
    ```tsx
          <ThreadOptionsModal
            visible={optionsVisible}
            thread={selectedThread}
            onClose={() => {
              setOptionsVisible(false);
              setSelectedThread(null);
            }}
          />
    ```
  * Modify `threads.map` (around line 72) to map `sortedThreads` instead, render the pinning pin icon if pinned, and trigger `onLongPress={}`. Also, remove the direct `deleteButton` from the UI since it is now inside the long-press options sheet.
    
    Render item code:
    ```tsx
            sortedThreads.map((thread) => {
              const isActive = thread.id === activeThreadId;
              return (
                <Pressable
                  key={thread.id}
                  style={[styles.threadItem, isActive && styles.activeThreadItem]}
                  onPress={() => handleSelectThread(thread.id)}
                  onLongPress={() => handleOpenOptions(thread)}
                  delayLongPress={450}
                >
                  <Text
                    style={[
                      styles.threadTitle,
                      isActive && styles.activeThreadTitle,
                      thread.is_pinned && { color: '#34d399', fontWeight: 'bold' }
                    ]}
                    numberOfLines={1}
                  >
                    {thread.is_pinned ? '📌 ' : ''}{thread.title}
                  </Text>
                </Pressable>
              );
            })
    ```

- [ ] **Step 2: Verify drawer compiles**
  Run: `npx tsc --noEmit --project client/tsconfig.json`
  Expected: Pass.

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/components/ui/DrawerContent.tsx
  git commit -m "feat: add thread sorting and long-press option modal in DrawerContent"
  ```

---

### Task 8: Customizations Settings Panel UI
**Files:**
- Modify: `client/app/settings.tsx`

- [ ] **Step 1: Implement customization settings inputs & UI styling triggers**
  Modify `client/app/settings.tsx` to add sliders, theme selects, and inputs for the new config states.
  
  Code changes:
  Include new settings states:
  ```typescript
    const { 
      theme, setTheme, 
      fontSize, setFontSize, 
      accentColor, setAccentColor,
      systemPrompt, setSystemPrompt,
      temperature, setTemperature,
      modelName, setModelName
    } = useConfigStore();
  ```
  Add UI layout cards/forms inside the settings scroll view for selecting these options.
  * Theme selectors: Buttons for 'deep', 'slate', 'cyberpunk'.
  * Font Size: 'small', 'medium', 'large' options.
  * Accent Colors: Indigo, Emerald, Rose, Amber choice boxes.
  * Slider for temperature.
  * Inputs for custom system prompt and model name.

- [ ] **Step 2: Commit changes**
  ```bash
  git add client/app/settings.tsx
  git commit -m "feat: complete SettingsScreen with UI and Agent customizations panel"
  ```

---

### Task 9: Inverted Smooth FlatList Chat UI
**Files:**
- Modify: `client/app/index.tsx`

- [ ] **Step 1: Change FlatList configuration to be inverted and resolve click issues**
  Update `client/app/index.tsx` to invert the `FlatList`, reverse the message list rendered, and add tap persistence configurations.
  
  Code changes:
  * Reverse messages:
    ```typescript
      const activeMessages = activeThreadId ? messages[activeThreadId] || [] : [];
      const reversedMessages = [...activeMessages].reverse();
    ```
  * Replace the FlatList code:
    ```tsx
          <FlatList
            ref={flatListRef}
            data={reversedMessages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            inverted={true}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={[styles.emptyChat, { transform: [{ scaleY: -1 }] }]}>
                <Text style={styles.emptyText}>Thread initialized. Say hello to get started.</Text>
              </View>
            }
          />
    ```
  * Note: We must also update `styles.listContent` or verify padding isn't weird when inverted. Also, the active stream auto scrolling is no longer needed since it's inverted (offset 0 stays at bottom)! Remove the `useEffect` hooks that call `scrollToEnd`.
  * Adjust `KeyboardAvoidingView` to:
    ```tsx
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
          style={styles.container}
        >
    ```

- [ ] **Step 2: Run all compilation checks**
  Run: `npx tsc --noEmit --project client/tsconfig.json`
  Expected: Pass.

- [ ] **Step 3: Commit changes**
  ```bash
  git add client/app/index.tsx
  git commit -m "feat: optimize chat list using inverted FlatList and persist taps"
  ```

---

### Task 10: Run and Verify Test Suite
**Files:**
- Test: `client/__tests__/*`

- [ ] **Step 1: Run the full Jest test suite**
  Run: `npm --prefix client run test`
  Expected: All 19+ tests pass successfully.

- [ ] **Step 2: Clean up visual companion files**
  Delete temporary companion HTML files.
  Run: `Remove-Item -Recurse -Force "D:\work\projects\Vela Client\.superpowers\brainstorm\session_1"`
  Expected: Folder deleted.

- [ ] **Step 3: Commit final verification**
  ```bash
  git commit -am "test: verify all unit tests pass"
  ```
