import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrowserStore } from '../../store/useBrowserStore';
import {
  parseNetscapeCookies,
  parseChromeJson,
  importCookies,
  filterBySelectedDomains,
  type CookieEntry,
} from '../../utils/cookieSync';

export interface CookieSyncCardProps {
  colors: {
    background: string;
    card: string;
    border: string;
    text: string;
    textMuted: string;
    textDark: string;
    glass?: string;
    glassBorder?: string;
    skyTop?: string;
    skyBottom?: string;
  };
  sizes: {
    text: number;
    sub: number;
    title: number;
  };
  accentHex: string;
}

type Preview = {
  domains: string[];
  total: number;
};

export default function CookieSyncCard({ colors, sizes, accentHex }: CookieSyncCardProps) {
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
      // expo-file-system legacy vs new API
      // @ts-ignore - readAsStringAsync exists on older expo-file-system
      if (typeof (FileSystem as unknown as Record<string, unknown>).readAsStringAsync === 'function') {
        // @ts-ignore
        text = await (FileSystem as unknown as { readAsStringAsync: (uri: string) => Promise<string> }).readAsStringAsync(
          asset.uri
        );
      } else {
        // New File API fallback (SDK 57+): File class
        // @ts-ignore
        const FileCls = (FileSystem as unknown as { File?: new (uri: string) => { text: () => Promise<string> } }).File;
        if (FileCls) {
          const file = new FileCls(asset.uri);
          text = await file.text();
        } else {
          // Final fallback: fetch uri (content:// may not be fetchable but try)
          const resp = await fetch(asset.uri);
          text = await resp.text();
        }
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

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text style={[styles.icon, { fontSize: sizes.title }]}>🍪</Text>
          <Text style={[styles.title, { color: colors.text, fontSize: sizes.title }]}>Cookie Sync</Text>
        </View>
        {/* Sync Status Badge */}
        {lastSyncText ? (
          <View style={[styles.badge, { backgroundColor: accentHex + '18', borderColor: accentHex + '40' }]}>
            <View style={[styles.badgeDot, { backgroundColor: cookieSyncStatus === 'error' ? '#ef4444' : '#22c55e' }]} />
            <Text style={[styles.badgeText, { color: colors.textMuted, fontSize: sizes.sub }]}>
              Synced
            </Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.18)', borderColor: colors.border }]}>
            <View style={[styles.badgeDot, { backgroundColor: colors.textDark }]} />
            <Text style={[styles.badgeText, { color: colors.textMuted, fontSize: sizes.sub }]}>Idle</Text>
          </View>
        )}
      </View>

      <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
        Import cookies.txt (Netscape) or Chrome JSON to authenticate the browser. Cookies stay on-device.
      </Text>

      {lastSyncText ? (
        <Text style={[styles.lastSync, { color: colors.textDark, fontSize: sizes.sub }]}>
          Last sync: {lastSyncText}
        </Text>
      ) : null}

      {/* Pick button */}
      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [
          styles.pickButton,
          { backgroundColor: accentHex, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.pickButtonText, { fontSize: sizes.text }]}>Pick cookies file</Text>
      </Pressable>

      {/* Preview */}
      {preview ? (
        <View style={[styles.previewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.previewHeader}>
            <Text style={[styles.previewTotal, { color: colors.text, fontSize: sizes.text }]}>
              {preview.total} cookies • {preview.domains.length} domains
            </Text>
            <View style={styles.selectActions}>
              <Pressable onPress={selectAll} hitSlop={8}>
                <Text style={[styles.linkText, { color: accentHex, fontSize: sizes.sub }]}>All</Text>
              </Pressable>
              <Text style={{ color: colors.textDark }}>•</Text>
              <Pressable onPress={deselectAll} hitSlop={8}>
                <Text style={[styles.linkText, { color: accentHex, fontSize: sizes.sub }]}>None</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.domainList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {preview.domains.map((domain) => {
              const isSelected = selected.has(domain);
              const count = entries.filter((e) => e.domain.replace(/^\./, '').toLowerCase() === domain).length;
              return (
                <View
                  key={domain}
                  style={[styles.domainRow, { borderBottomColor: colors.border }]}
                >
                  <View style={styles.domainInfo}>
                    <Text style={[styles.domainText, { color: colors.text, fontSize: sizes.text }]} numberOfLines={1}>
                      {domain}
                    </Text>
                    <Text style={[styles.domainCount, { color: colors.textMuted, fontSize: sizes.sub }]}>
                      {count} {count === 1 ? 'cookie' : 'cookies'}
                    </Text>
                  </View>
                  <Switch
                    value={isSelected}
                    onValueChange={(v) => toggleDomain(domain, v)}
                    trackColor={{ false: colors.border, true: accentHex + '80' }}
                    thumbColor={isSelected ? accentHex : colors.textMuted}
                  />
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={handleApply}
            disabled={loading || selected.size === 0}
            style={({ pressed }) => [
              styles.applyButton,
              { backgroundColor: accentHex, opacity: loading || selected.size === 0 ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={[styles.applyText, { fontSize: sizes.text }]}>
                Apply ({selected.size} domains)
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {statusMsg ? (
        <Text
          style={[
            styles.statusMsg,
            {
              color: statusMsg.toLowerCase().includes('fail') || statusMsg.toLowerCase().includes('error')
                ? '#f87171'
                : colors.textMuted,
              fontSize: sizes.sub,
            },
          ]}
        >
          {statusMsg}
        </Text>
      ) : null}

      {/* Privacy Warning Dialog */}
      <Modal visible={showPrivacy} transparent animationType="fade" onRequestClose={handlePrivacyCancel}>
        <View style={styles.privacyOverlay}>
          <View style={[styles.privacyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.privacyTitle, { color: colors.text, fontSize: sizes.title }]}>Privacy Notice</Text>
            <Text style={[styles.privacyBody, { color: colors.textMuted, fontSize: sizes.text }]}>
              Vela never transmits cookies to the backend. Cookies are imported only into the on-device WebView via CookieManager and stay on your device.
            </Text>
            <View style={styles.privacyActions}>
              <Pressable
                onPress={handlePrivacyCancel}
                style={[styles.privacyButton, styles.privacyCancel, { borderColor: colors.border }]}
              >
                <Text style={[styles.privacyButtonText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handlePrivacyContinue}
                style={[styles.privacyButton, { backgroundColor: accentHex }]}
              >
                <Text style={[styles.privacyButtonText, { color: '#ffffff' }]}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    lineHeight: 20,
  },
  title: {
    fontWeight: '700',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    fontWeight: '600',
  },
  subtitle: {
    lineHeight: 16,
  },
  lastSync: {
    fontStyle: 'italic',
  },
  pickButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  previewCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewTotal: {
    fontWeight: '600',
  },
  selectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontWeight: '600',
  },
  domainList: {
    maxHeight: 220,
  },
  domainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  domainInfo: {
    flex: 1,
    gap: 2,
  },
  domainText: {
    fontWeight: '500',
  },
  domainCount: {},
  applyButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  applyText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  statusMsg: {
    textAlign: 'center',
    lineHeight: 16,
  },
  privacyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  privacyCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  privacyTitle: {
    fontWeight: '700',
  },
  privacyBody: {
    lineHeight: 20,
  },
  privacyActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  privacyButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  privacyCancel: {
    backgroundColor: 'transparent',
  },
  privacyButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
});
