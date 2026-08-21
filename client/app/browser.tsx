import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router'; import { webViewRef } from '../store/useBrowserStore';
import { useBrowserStore } from '../store/useBrowserStore';
import { useConfigStore } from '../store/useConfigStore';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS, getAurora } from '../utils/theme';
import CookieSyncCard from '../components/ui/CookieSyncCard';

const QUICK_LINKS: { label: string; url: string; icon: string }[] = [
  { label: 'Google', url: 'https://www.google.com', icon: '🔍' },
  { label: 'GitHub', url: 'https://github.com', icon: '💻' },
  { label: 'Vela Docs', url: 'https://vela.dev', icon: '📄' },
];

export default function BrowserScreen() {
  const router = useRouter();
  const { theme, fontSize, accentColor } = useConfigStore();
  const colors = THEME_COLORS[theme] || THEME_COLORS.deep;
  const sizes = FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const accentHex = ACCENT_COLORS[accentColor] || ACCENT_COLORS.indigo;
  const aurora = getAurora(accentColor, theme);

  const {
    currentUrl,
    canGoBack,
    canGoForward,
    isLoading,
    pageTitle,
    pendingApproval,
    aiStatus,
    lastCookieSync,
    navigate,
    approveAction,
    denyAction,
  } = useBrowserStore();

  const [urlInput, setUrlInput] = useState(currentUrl === 'about:blank' ? '' : currentUrl);
  const [showCookieSync, setShowCookieSync] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  const isEmpty = currentUrl === 'about:blank' && !isLoading && !webError;
  const showError = !!webError;
  const showLoading = isLoading && !showError && !isEmpty;

  // Hide persistent WebView (white about:blank) when native overlay is shown;
  // the offscreen WebView still loads but the dark Aurora overlay avoids the flash.
  const shouldHideWebView = isEmpty || showError || isLoading;
  React.useEffect(() => {
    const store = useBrowserStore.getState();
    if (shouldHideWebView) {
      // keep hidden while overlay visible; WebView remains mounted offscreen and can still load
      store.setVisible(false);
    } else {
      store.setVisible(true);
    }
  }, [shouldHideWebView]);

  // Clear error when navigation changes to a new url
  React.useEffect(() => {
    if (currentUrl && webError) {
      // don't clear immediately if error was for this url; clear when url changes after retry
      setWebError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  const handleGo = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setWebError(null);
    navigate(trimmed);
  }, [urlInput, navigate]);

  const handleQuickNavigate = useCallback((url: string) => {
    setWebError(null);
    setUrlInput(url);
    navigate(url);
  }, [navigate]);

  const handleBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);

  const handleForward = useCallback(() => {
    webViewRef.current?.goForward();
  }, []);

  const handleRefresh = useCallback(() => {
    setWebError(null);
    webViewRef.current?.reload();
  }, []);

  const handleRetry = useCallback(() => {
    setWebError(null);
    webViewRef.current?.reload();
  }, []);

  const handleGoHome = useCallback(() => {
    setWebError(null);
    navigate('about:blank');
    setUrlInput('');
  }, [navigate]);

  const handleClose = useCallback(() => {
    useBrowserStore.getState().setVisible(false);
    router.navigate('/');
  }, [router]);

  // Sync URL bar when navigation changes
  React.useEffect(() => {
    if (currentUrl && currentUrl !== 'about:blank') {
      setUrlInput(currentUrl);
    } else if (currentUrl === 'about:blank') {
      setUrlInput('');
    }
  }, [currentUrl]);

  // Mark visible on mount, hidden on unmount (overridden by overlay effect above)
  React.useEffect(() => {
    if (!shouldHideWebView) {
      useBrowserStore.getState().setVisible(true);
    }
    return () => {
      useBrowserStore.getState().setVisible(false);
    };
  }, [shouldHideWebView]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* AI Status Banner */}
      {aiStatus && (
        <View style={[styles.aiBanner, { backgroundColor: accentHex }]}>
          <Text style={styles.aiBannerText} numberOfLines={1}>
            🤖 Vela is browsing... {aiStatus}
          </Text>
        </View>
      )}

      {/* URL Bar */}
      <View style={[styles.urlBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TextInput
          style={[styles.urlInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
          value={urlInput}
          onChangeText={setUrlInput}
          onSubmitEditing={handleGo}
          placeholder="Enter URL..."
          placeholderTextColor={colors.textDark}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
        <Pressable onPress={handleGo} style={[styles.goButton, { backgroundColor: accentHex }]}>
          <Text style={styles.goButtonText}>Go</Text>
        </Pressable>
      </View>

      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={handleBack}
          disabled={!canGoBack}
          style={[styles.toolbarButton, !canGoBack && styles.toolbarButtonDisabled]}
        >
          <Text style={[styles.toolbarButtonText, { color: canGoBack ? colors.text : colors.textDark }]}>◀</Text>
        </Pressable>

        <Pressable
          onPress={handleForward}
          disabled={!canGoForward}
          style={[styles.toolbarButton, !canGoForward && styles.toolbarButtonDisabled]}
        >
          <Text style={[styles.toolbarButtonText, { color: canGoForward ? colors.text : colors.textDark }]}>▶</Text>
        </Pressable>

        <Pressable onPress={handleRefresh} style={styles.toolbarButton}>
          <Text style={[styles.toolbarButtonText, { color: colors.text }]}>⟳</Text>
        </Pressable>

        {/* Cookie Sync button + Sync Status Badge dot */}
        <Pressable
          onPress={() => setShowCookieSync(true)}
          style={[styles.toolbarButton, styles.cookieSyncButton, { borderColor: colors.border }]}
          accessibilityLabel="Cookie Sync"
          accessibilityRole="button"
        >
          <Text style={[styles.toolbarButtonText, { color: colors.text, fontSize: 16 }]}>🍪</Text>
          {lastCookieSync ? (
            <View style={[styles.syncBadgeDot, { backgroundColor: '#22c55e', borderColor: colors.card }]} />
          ) : null}
        </Pressable>

        {isLoading && <ActivityIndicator size="small" color={aurora.acc1} style={{ marginLeft: 8 }} />}

        <View style={styles.titleContainer}>
          <Text style={[styles.pageTitle, { color: colors.textMuted, fontSize: sizes.sub }]} numberOfLines={1}>
            {pageTitle || 'Browser'}
          </Text>
        </View>

      <Pressable onPress={handleClose} style={[styles.toolbarButton, { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border }]}>
        <Text style={[styles.toolbarButtonText, { color: colors.text, fontSize: sizes.sub, fontWeight: 'bold' }]}>💬 Chat</Text>
      </Pressable>
      </View>

      {/* WebView area — the actual WebView is mounted in _layout.tsx and made visible here */}
      <View style={styles.webviewArea}>
        {isEmpty ? (
          <LinearGradient
            colors={[colors.skyTop, colors.skyBottom]}
            style={styles.emptyOverlay}
          >
            {/* aurora glow */}
            <View style={[styles.auroraGlow, { backgroundColor: aurora.glow, shadowColor: aurora.acc1 }]} />
            <View style={styles.emptyContent}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
                <Text style={styles.emptyIcon}>🌐</Text>
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text, fontSize: sizes.title }]}>Browser</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted, fontSize: sizes.text }]}>
                Enter a URL above or pick a quick link to start browsing. Vela can assist you once a page is loaded.
              </Text>
              <View style={styles.quickRow}>
                {QUICK_LINKS.map((link) => (
                  <Pressable
                    key={link.url}
                    onPress={() => handleQuickNavigate(link.url)}
                    style={({ pressed }) => [
                      styles.quickPill,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${link.label}`}
                  >
                    <Text style={styles.quickIcon}>{link.icon}</Text>
                    <Text style={[styles.quickLabel, { color: colors.text, fontSize: sizes.text }]}>{link.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </LinearGradient>
        ) : showLoading ? (
          <LinearGradient colors={[colors.skyTop, colors.skyBottom]} style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={aurora.acc1} />
            <Text style={[styles.loadingText, { color: colors.textMuted, fontSize: sizes.text }]}>Loading…</Text>
          </LinearGradient>
        ) : showError ? (
          <LinearGradient colors={[colors.skyTop, colors.skyBottom]} style={styles.errorOverlay}>
            <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.errorIcon]}>⚠️</Text>
              <Text style={[styles.errorTitle, { color: colors.text, fontSize: sizes.title }]}>Couldn&apos;t load page</Text>
              <Text style={[styles.errorMessage, { color: colors.textMuted, fontSize: sizes.text }]} numberOfLines={3}>
                {webError || 'The page failed to load. Check the URL or try again.'}
              </Text>
              {(currentUrl && currentUrl !== 'about:blank') ? (
                <Text style={[styles.errorUrl, { color: colors.textDark, fontSize: sizes.sub }]} numberOfLines={1}>
                  {currentUrl}
                </Text>
              ) : null}
              <View style={styles.errorActions}>
                <Pressable
                  onPress={handleRetry}
                  style={({ pressed }) => [
                    styles.errorButton,
                    styles.errorButtonPrimary,
                    { backgroundColor: aurora.acc1, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading page"
                >
                  <Text style={[styles.errorButtonText, { color: aurora.onAccent }]}>Retry</Text>
                </Pressable>
                <Pressable
                  onPress={handleGoHome}
                  style={({ pressed }) => [
                    styles.errorButton,
                    { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Go to browser home"
                >
                  <Text style={[styles.errorButtonText, { color: colors.text }]}>Go Home</Text>
                </Pressable>
              </View>
            </View>
          </LinearGradient>
        ) : null}
      </View>

      {/* Cookie Sync Modal */}
      <Modal visible={showCookieSync} transparent animationType="slide" onRequestClose={() => setShowCookieSync(false)}>
        <View style={styles.cookieModalOverlay}>
          <View style={[styles.cookieModalCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.cookieModalHeader}>
              <Text style={[styles.cookieModalTitle, { color: colors.text }]}>Cookie Sync</Text>
              <Pressable onPress={() => setShowCookieSync(false)} hitSlop={10} style={styles.cookieModalClose}>
                <Text style={[styles.cookieModalCloseText, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <CookieSyncCard colors={colors} sizes={sizes} accentHex={accentHex} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Approval Modal */}
      {pendingApproval && (
        <Modal transparent animationType="fade" visible>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Action Approval</Text>
              <Text style={[styles.modalDescription, { color: colors.textMuted }]}>
                Vela wants to: {pendingApproval.description}
              </Text>
              <View style={styles.modalButtons}>
                <Pressable
                  onPress={denyAction}
                  style={[styles.modalButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>Deny</Text>
                </Pressable>
                <Pressable
                  onPress={approveAction}
                  style={[styles.modalButton, { backgroundColor: accentHex }]}
                >
                  <Text style={[styles.modalButtonText, { color: '#ffffff' }]}>Allow</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  aiBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  aiBannerText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  urlInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  goButton: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 4,
  },
  toolbarButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolbarButtonDisabled: {
    opacity: 0.4,
  },
  toolbarButtonText: {
    fontSize: 18,
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  pageTitle: {
    fontWeight: '500',
  },
  webviewArea: {
    flex: 1,
  },
  emptyOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  auroraGlow: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    height: 220,
    borderRadius: 120,
    opacity: 0.18,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 0,
  },
  emptyContent: {
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
    justifyContent: 'center',
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
  },
  quickIcon: {
    fontSize: 14,
  },
  quickLabel: {
    fontWeight: '600',
  },
  loadingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  loadingText: {
    fontWeight: '600',
  },
  errorOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  errorIcon: {
    fontSize: 32,
  },
  errorTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    textAlign: 'center',
    lineHeight: 20,
  },
  errorUrl: {
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  errorButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  errorButtonPrimary: {},
  errorButtonText: {
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalDescription: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
  cookieSyncButton: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  syncBadgeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  cookieModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cookieModalCard: {
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  cookieModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cookieModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  cookieModalClose: {
    padding: 8,
  },
  cookieModalCloseText: {
    fontSize: 18,
    fontWeight: '700',
  },
});
