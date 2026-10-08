/**
 * Module: client/hooks/useCookieSync
 * Intent: Cookie import/consent logic extracted verbatim from components/ui/CookieSyncCard.tsx —
 *   file pick + parse (Netscape/Chrome JSON), domain selection, import, privacy consent.
 * Public API: useCookieSync() → { cookieSyncStatus, lastSyncText, entries, preview, selected,
 *   loading, statusMsg, showPrivacy, handlePick, handleApply, handlePrivacyContinue,
 *   handlePrivacyCancel, toggleDomain, selectAll, deselectAll }.
 * Invariants: Verbatim move — handlers keep their original useCallback dependency sets; store
 *   selectors (cookieSyncStatus/lastCookieSync/setters) live in the hook.
 * Side Effects: DocumentPicker, expo-file-system reads, AsyncStorage consent flag, WebView cookie import.
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
import { useState, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrowserStore } from '../store/useBrowserStore';
import {
  parseNetscapeCookies,
  parseChromeJson,
  importCookies,
  filterBySelectedDomains,
  type CookieEntry,
} from '../utils/cookieSync';

export type Preview = {
  domains: string[];
  total: number;
};

export function useCookieSync() {
  const cookieSyncStatus = useBrowserStore((s) => s.cookieSyncStatus);
  const lastCookieSync = useBrowserStore((s) => s.lastCookieSync);
  const setCookieSyncStatus = useBrowserStore((s) => s.setCookieSyncStatus);
  const setLastCookieSync = useBrowserStore((s) => s.setLastCookieSync);
  const setCookieSyncDomains = useBrowserStore((s) => s.setCookieSyncDomains);

  const [entries, setEntries] = useState<CookieEntry[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const lastSyncText = lastCookieSync
    ? new Date(lastCookieSync).toLocaleString()
    : null;

  const handlePick = useCallback(async () => {
    setStatusMsg(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const asset = result.assets && result.assets[0];
      if (!asset?.uri) return;

      let text = '';
      // SDK 54+: root-module legacy functions are throwing stubs; use the File class.
      if (typeof FileSystem.File === 'function') {
        text = await new FileSystem.File(asset.uri).text();
      } else {
        const resp = await fetch(asset.uri);
        text = await resp.text();
      }

      const trimmed = text.trim();
      let parsed: CookieEntry[] = [];

      // Heuristic: JSON starts with [ or {, else netscape
      const looksJson = trimmed.startsWith('[') || trimmed.startsWith('{');
      if (looksJson) {
        parsed = parseChromeJson(text);
        if (parsed.length === 0) {
          parsed = parseNetscapeCookies(text);
        }
      } else {
        parsed = parseNetscapeCookies(text);
        if (parsed.length === 0) {
          try {
            const alt = parseChromeJson(text);
            if (alt.length > 0) parsed = alt;
          } catch {
            // ignore
          }
        }
      }

      if (parsed.length === 0) {
        setStatusMsg('No cookies found in file. Expect Netscape cookies.txt or Chrome JSON.');
        setEntries([]);
        setPreview(null);
        setSelected(new Set());
        return;
      }

      const domainSet = new Set<string>();
      for (const e of parsed) {
        const clean = e.domain.replace(/^\./, '').toLowerCase();
        if (clean) domainSet.add(clean);
      }
      const domains = Array.from(domainSet).sort();

      setEntries(parsed);
      setPreview({ domains, total: parsed.length });
      setSelected(new Set(domains));
      setStatusMsg(`Loaded ${parsed.length} cookies across ${domains.length} domains`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMsg(`Failed to read file: ${msg}`);
    }
  }, []);

  const doImport = useCallback(async () => {
    if (entries.length === 0 || selected.size === 0) {
      setStatusMsg('Select at least one domain');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const filtered = filterBySelectedDomains(entries, selected);
      const domainsArray = Array.from(selected);
      const result = await importCookies(filtered, domainsArray);
      if (result.failed > 0 && result.imported === 0) {
        setCookieSyncStatus('error');
        setStatusMsg(`Import failed: ${result.failed} failed`);
      } else {
        setCookieSyncStatus('synced');
        setLastCookieSync(Date.now());
        setCookieSyncDomains(domainsArray);
        const totalFailed = result.failed ? `, ${result.failed} failed` : '';
        setStatusMsg(`Imported ${result.imported} cookies${totalFailed}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCookieSyncStatus('error');
      setStatusMsg(`Import error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [entries, selected, setCookieSyncStatus, setLastCookieSync, setCookieSyncDomains]);

  const handleApply = useCallback(async () => {
    const consented = await AsyncStorage.getItem('cookie_sync_consented');
    if (!consented) {
      setShowPrivacy(true);
      return;
    }
    await doImport();
  }, [doImport]);

  const handlePrivacyContinue = useCallback(async () => {
    await AsyncStorage.setItem('cookie_sync_consented', 'true');
    setShowPrivacy(false);
    await doImport();
  }, [doImport]);

  const handlePrivacyCancel = useCallback(() => {
    setShowPrivacy(false);
  }, []);

  const toggleDomain = useCallback((domain: string, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(domain);
      else next.delete(domain);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!preview) return;
    setSelected(new Set(preview.domains));
  }, [preview]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  return {
    cookieSyncStatus,
    lastSyncText,
    entries,
    preview,
    selected,
    loading,
    statusMsg,
    showPrivacy,
    handlePick,
    handleApply,
    handlePrivacyContinue,
    handlePrivacyCancel,
    toggleDomain,
    selectAll,
    deselectAll,
  };
}

export default useCookieSync;
