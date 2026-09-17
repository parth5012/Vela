import { loadCheckins, saveCheckinLocal, markCheckinSynced } from '../db/checkinRepository';

export interface RemoteCheckin {
  id: string;
  conversation_id: string;
  date: string;
  mood: number;
  energy: number;
  win: string | null;
  carrying: string | null;
  note: string | null;
}

export interface CheckinSummary {
  count: number;
  summary: string;
  avg_mood: number | null;
  avg_energy: number | null;
}

function normalizeBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
  };
}

/**
 * Fetches recent entries from GET /api/checkins. Returns null when the
 * backend is unconfigured or unreachable — callers fall back to the
 * local cache.
 */
export async function fetchRemoteCheckins(
  apiUrl: string,
  apiKey: string,
  conversationId?: string,
  days: number = 14
): Promise<RemoteCheckin[] | null> {
  if (!apiUrl || !apiKey) return null;
  try {
    const params = new URLSearchParams({ days: String(days) });
    if (conversationId) params.set('conversation_id', conversationId);
    const response = await fetch(`${normalizeBaseUrl(apiUrl)}/api/checkins?${params}`, {
      headers: authHeaders(apiKey),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the local cache from the backend, then returns local rows
 * newest-first. Remote rows land as synced so they never re-flush.
 */
export async function refreshJournalFromBackend(
  apiUrl: string,
  apiKey: string,
  conversationId?: string,
  days: number = 14
) {
  const remote = await fetchRemoteCheckins(apiUrl, apiKey, conversationId, days);
  if (remote) {
    for (const entry of remote) {
      try {
        const row = await saveCheckinLocal({
          date: entry.date,
          mood: entry.mood,
          energy: entry.energy,
          win: entry.win,
          carrying: entry.carrying,
          note: entry.note,
        });
        await markCheckinSynced(row.id);
      } catch {
        // Skip malformed rows; keep the rest.
      }
    }
  }
  return loadCheckins(30);
}

/**
 * Fetches the on-demand reflection from GET /api/checkins/summary.
 * Returns null when unavailable — callers hide the pattern cards.
 */
export async function fetchCheckinSummary(
  apiUrl: string,
  apiKey: string,
  conversationId?: string,
  days: number = 14
): Promise<CheckinSummary | null> {
  if (!apiUrl || !apiKey) return null;
  try {
    const params = new URLSearchParams({ days: String(days) });
    if (conversationId) params.set('conversation_id', conversationId);
    const response = await fetch(`${normalizeBaseUrl(apiUrl)}/api/checkins/summary?${params}`, {
      headers: authHeaders(apiKey),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data?.count !== 'number' || typeof data?.summary !== 'string') return null;
    return data as CheckinSummary;
  } catch {
    return null;
  }
}
