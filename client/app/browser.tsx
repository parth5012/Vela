import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from '../components/ui/PressableScale';
import { useRouter } from 'expo-router'; import { webViewRef } from '../store/useBrowserStore';
import { useBrowserStore } from '../store/useBrowserStore';
import { useConfigStore } from '../store/useConfigStore';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS, getAurora } from '../utils/theme';
import CookieSyncCard from '../components/ui/CookieSyncCard';
import { styles } from '../styles/browserStyles';

const QUICK_LINKS: { label: string; url: string }[] = [
  { label: 'Google', url: 'https://www.google.com' },
  { label: 'GitHub', url: 'https://github.com' },
  { label: 'Vela Docs', url: 'https://vela.dev' },
];

function renderQuickIcon(label: string, color: string) {
  if (label === 'Google') {
    return (
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx="11" cy="11" r="8" />
        <Path d="M21 21l-4.35-4.35" />
      </Svg>
    );
  }
  if (label === 'GitHub') {
    return (
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
      </Svg>
    );
  }
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <Path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </Svg>
  );
}

export default function BrowserScreen() {
  const router = useRouter();
  const { theme, fontSize, accentColor } = useConfigStore();
  const colors = THEME_COLORS[theme] || THEME_COLORS.berry;
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
        <View style={[styles.aiBanner, { backgroundColor: accentHex, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <Circle cx="12" cy="12" r="10" />
            <Path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20" />
          </Svg>
          <Text style={styles.aiBannerText} numberOfLines={1}>
            Vela is browsing... {aiStatus}
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
        <PressableScale
          onPress={handleGo}
          scaleTo={0.95}
          style={({ pressed }) => [
            styles.goButton,
            { backgroundColor: accentHex },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityLabel="Go"
        >
          <Text style={styles.goButtonText}>Go</Text>
        </PressableScale>
      </View>

      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <PressableScale
          onPress={handleBack}
          disabled={!canGoBack}
          scaleTo={0.92}
          style={[
            styles.toolbarButton,
            !canGoBack && styles.toolbarButtonDisabled,
          ]}
          accessibilityLabel="Back"
          accessibilityState={{ disabled: !canGoBack }}
        >
          <Text style={[styles.toolbarButtonText, { color: canGoBack ? colors.text : colors.textDark }]}>◀</Text>
        </PressableScale>

        <PressableScale
          onPress={handleForward}
          disabled={!canGoForward}
          scaleTo={0.92}
          style={[
            styles.toolbarButton,
            !canGoForward && styles.toolbarButtonDisabled,
          ]}
          accessibilityLabel="Forward"
          accessibilityState={{ disabled: !canGoForward }}
        >
          <Text style={[styles.toolbarButtonText, { color: canGoForward ? colors.text : colors.textDark }]}>▶</Text>
        </PressableScale>

        <PressableScale
          onPress={handleRefresh}
          scaleTo={0.92}
          style={styles.toolbarButton}
          accessibilityLabel="Refresh"
        >
          <Text style={[styles.toolbarButtonText, { color: colors.text }]}>⟳</Text>
        </PressableScale>

        {/* Cookie Sync button + Sync Status Badge dot */}
        <PressableScale
          onPress={() => setShowCookieSync(true)}
          scaleTo={0.92}
          style={[styles.toolbarButton, styles.cookieSyncButton, { borderColor: colors.border }]}
          accessibilityLabel="Cookie Sync"
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
              stroke={colors.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          {lastCookieSync ? (
            <View style={[styles.syncBadgeDot, { backgroundColor: '#10B981', borderColor: colors.card }]} />
          ) : null}
        </PressableScale>

        {isLoading && <ActivityIndicator size="small" color={aurora.acc1} style={{ marginLeft: 8 }} />}

        <View style={styles.titleContainer}>
          <Text style={[styles.pageTitle, { color: colors.textMuted, fontSize: sizes.sub }]} numberOfLines={1}>
            {pageTitle || 'Browser'}
          </Text>
        </View>

        <PressableScale
          onPress={handleClose}
          accessibilityLabel="Return to chat"
          style={({ pressed }) => [
            styles.toolbarButton,
            {
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.background,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
            },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}>
            <Path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              stroke={colors.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={[styles.toolbarButtonText, { color: colors.text, fontSize: sizes.sub, fontWeight: '700' }]}>Chat</Text>
        </PressableScale>
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
                <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                  <Circle cx="12" cy="12" r="10" stroke={aurora.acc1} strokeWidth={2} />
                  <Path
                    d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                    stroke={aurora.acc1}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text, fontSize: sizes.title }]}>Browser</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted, fontSize: sizes.text }]}>
                Enter a URL above or pick a quick link to start browsing. Vela can assist you once a page is loaded.
              </Text>
              <View style={styles.quickRow}>
                {QUICK_LINKS.map((link) => (
                  <PressableScale
                    key={link.url}
                    onPress={() => handleQuickNavigate(link.url)}
                    style={({ pressed }) => [
                      styles.quickPill,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                      },
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel={`Open ${link.label}`}
                  >
                    <View style={{ marginRight: 6 }}>
                      {renderQuickIcon(link.label, aurora.acc1)}
                    </View>
                    <Text style={[styles.quickLabel, { color: colors.text, fontSize: sizes.text }]}>{link.label}</Text>
                  </PressableScale>
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
              <Svg width={36} height={36} viewBox="0 0 24 24" fill="none" style={{ marginBottom: 12 }}>
                <Path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path d="M12 9v4m0 4h.01" stroke="#F59E0B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
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
                <PressableScale
                  onPress={handleRetry}
                  style={[
                    styles.errorButton,
                    styles.errorButtonPrimary,
                    { backgroundColor: aurora.acc1 },
                  ]}
                  accessibilityLabel="Retry loading page"
                >
                  <Text style={[styles.errorButtonText, { color: aurora.onAccent }]}>Retry</Text>
                </PressableScale>
                <PressableScale
                  onPress={handleGoHome}
                  style={[
                    styles.errorButton,
                    { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
                  ]}
                  accessibilityLabel="Go to browser home"
                >
                  <Text style={[styles.errorButtonText, { color: colors.text }]}>Go Home</Text>
                </PressableScale>
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
              <PressableScale onPress={() => setShowCookieSync(false)} hitSlop={10} style={styles.cookieModalClose} accessibilityLabel="Close cookie sync">
                <Text style={[styles.cookieModalCloseText, { color: colors.textMuted }]}>✕</Text>
              </PressableScale>
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
                <PressableScale
                  onPress={denyAction}
                  accessibilityLabel="Deny action"
                  style={[styles.modalButton, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>Deny</Text>
                </PressableScale>
                <PressableScale
                  onPress={approveAction}
                  accessibilityLabel="Allow action"
                  style={[styles.modalButton, { backgroundColor: accentHex }]}
                >
                  <Text style={[styles.modalButtonText, { color: '#ffffff' }]}>Allow</Text>
                </PressableScale>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
