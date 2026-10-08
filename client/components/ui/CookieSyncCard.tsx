import React from 'react';
import {
  View,
  Text,
  Pressable,
  Switch,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { useCookieSync } from '../../hooks/useCookieSync';
import { styles } from './cookieSyncCardStyles';

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

export default function CookieSyncCard({ colors, sizes, accentHex }: CookieSyncCardProps) {
  const {
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
  } = useCookieSync();

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
