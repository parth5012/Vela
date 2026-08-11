import { useChatStore, Thread, Message } from '../store/useChatStore';
import { useConfigStore } from '../store/useConfigStore';

const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Synchronizes chat history with the backend.
 * 
 * 1. Performs a GET request to `${apiUrl}/chat/threads` with the `Authorization: Bearer ${apiKey}` header.
 * 2. If successful, parses the JSON list of threads and updates the chat store using `useChatStore.getState().setThreads(threads)`.
 * 3. In the background (using Promise.all or similar), fetches message histories for each thread by calling GET `${apiUrl}/chat/threads/${threadId}` with authorization.
 * 4. For each thread that returns messages successfully, calls `useChatStore.getState().setHistory(threadId, messages)` to cache them locally.
 * 5. If there is no active thread currently selected in the store (`useChatStore.getState().activeThreadId` is null/falsy) and there are threads, selects the first thread as active.
 * 6. Returns a promise resolving to boolean (success state).
 * 
 * Make sure the file compiles and handles errors gracefully without throwing.
 */
export async function syncHistoryWithBackend(apiUrl?: string, apiKey?: string): Promise<boolean> {
  try {
    const config = useConfigStore.getState();
    const effectiveApiUrl = apiUrl || config.apiUrl;
    const effectiveApiKey = apiKey || config.apiKey;

    if (!effectiveApiUrl || !effectiveApiKey) {
      console.warn('[syncHistoryWithBackend] API URL or API Key is not configured.');
      return false;
    }

    // 1. Performs a GET request to `${apiUrl}/chat/threads` with authorization header
    const response = await fetchWithTimeout(`${effectiveApiUrl}/chat/threads`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${effectiveApiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[syncHistoryWithBackend] Failed to fetch threads. Status: ${response.status}`);
      return false;
    }

    // 2. If successful, parses the JSON list of threads and updates the store
    const threads: Thread[] = await response.json();
    useChatStore.getState().setThreads(threads);

    // 3. In the background, fetches message histories for each thread
    if (Array.isArray(threads) && threads.length > 0) {
      // Execute background fetching using Promise.all without awaiting it in the main execution path.
      Promise.all(
        threads.map(async (thread) => {
          try {
            const res = await fetchWithTimeout(`${effectiveApiUrl}/chat/threads/${thread.id}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${effectiveApiKey}`,
                'Accept': 'application/json',
              },
            });
            if (res.ok) {
              const messages: Message[] = await res.json();
              // 4. For each thread that returns messages successfully, cache them locally.
              useChatStore.getState().setHistory(thread.id, messages);
            } else {
              return { threadId: thread.id, reason: `HTTP ${res.status}` };
            }
          } catch (err) {
            return { threadId: thread.id, reason: err instanceof Error ? err.message : String(err) };
          }
          return null;
        })
      ).then((results) => {
        const failures = results.filter((r): r is { threadId: string; reason: string } => r !== null);
        if (failures.length > 0) {
          const reasons = [...new Set(failures.map((f) => f.reason))];
          console.warn(
            `[syncHistoryWithBackend] Could not fetch history for ${failures.length}/${threads.length} thread(s): ${reasons.join('; ')}`
          );
        }
      }).catch((err) => {
        console.error('[syncHistoryWithBackend] Error in background pre-fetching:', err);
      });
    }

    // 5. If there is no active thread currently selected and there are threads, selects the first thread as active.
    const state = useChatStore.getState();
    if (!state.activeThreadId && Array.isArray(threads) && threads.length > 0) {
      state.selectThread(threads[0].id);
    }

    // 6. Returns a promise resolving to boolean (success state).
    return true;
  } catch (error) {
    console.error('[syncHistoryWithBackend] Failed to sync history with backend:', error);
    return false;
  }
}
