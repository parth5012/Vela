import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
  type ImageStyle,
} from 'react-native';

//--- Types ---------------------------------------------------------------

export type OAuthCallbackStatus = 'success' | 'error' | null;

export interface OAuthCallbackAccount {
  name?: string;
  email?: string;
  picture?: string;
}

export interface OAuthCallbackColors {
  background: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textDark: string;
}

export interface OAuthCallbackTexts {
  loadingTitle: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
  returnToChat: string;
  closeWindow: string;
  copyToken: string;
  tokenCopied: string;
  tryAgain: string;
  troubleshoot: string;
  securedBy: string;
}

export const defaultTexts: OAuthCallbackTexts = {
  loadingTitle: 'Checking authorization…',
  successTitle: 'Authorized successfully',
  successBody: 'Your Google account is now connected to Vela. You can securely close this window.',
  errorTitle: 'Authorization failed',
  errorBody: 'Your Google account is not connected to Vela.',
  returnToChat: 'Return to chat',
  closeWindow: 'Close window',
  copyToken: 'Copy token',
  tokenCopied: 'Copied',
  tryAgain: 'Try again',
  troubleshoot: 'Troubleshoot',
  securedBy: 'Secured by Google OAuth',
};

export interface OAuthCallbackScreenProps {
  status: OAuthCallbackStatus;
  account?: OAuthCallbackAccount | null;
  message?: string;
  text?: Partial<OAuthCallbackTexts>;
  colors: OAuthCallbackColors;
  accent: string;
  accentSoft: string;
  token?: string;
  showCopyToken?: boolean;
  onReturnToChat?: () => void;
  onClose?: () => void;
  onTryAgain?: () => void;
  onTroubleshoot?: () => void;
  onCopyToken?: (token: string) => void;
}

//--- Component -----------------------------------------------------------

export default function OAuthCallbackScreen({
  status,
  account,
  message,
  text,
  colors,
  accent,
  accentSoft,
  token,
  showCopyToken = false,
  onReturnToChat,
  onClose,
  onTryAgain,
  onTroubleshoot,
  onCopyToken,
}: OAuthCallbackScreenProps) {
  const t = { ...defaultTexts, ...text };
  const headingRef = useRef<Text>(null);
  const [copied, setCopied] = React.useState(false);

  const success = status === 'success';
  const error = status === 'error';
  const loading = status === null;

  // Move keyboard focus to result heading once verdict is known,
  // so screen readers announce outcome without full page refresh.
  useEffect(() => {
    if (!loading) {
      headingRef.current?.focus();
    }
  }, [loading]);

  // aria-live region so assistive tech announces switch verdict.
  const liveRegion = success ? 'polite' : error ? 'assertive' : undefined;

  const cardStyle = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];

  const renderStatusIcon = () => {
    if (loading) {
      return <ActivityIndicator size="large" color={accent} />;
    }
    if (success) {
      return (
        <View style={[styles.iconRing, { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.12)' }]}>
          <Text style={{ color: '#22c55e', fontSize: 56, lineHeight: 64 }}>✓</Text>
        </View>
      );
    }
    return (
      <View style={[styles.iconRing, { borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
        <Text style={{ color: '#ef4444', fontSize: 52, lineHeight: 64 }}>!</Text>
      </View>
    );
  };

  const renderAccount = () => {
    if (!account || (!account.name && !account.email)) return null;
    return (
      <View style={styles.accountRow}>
        {account.picture ? (
          <Image source={{ uri: account.picture }} style={styles.avatar as ImageStyle} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: accentSoft }]}>
            <Text style={{ color: colors.textDark, fontWeight: '600' }}>
              {(account.name || account.email || 'G').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          {account.name ? (
            <Text style={[styles.accountName, { color: colors.text }]}>{account.name}</Text>
          ) : null}
          <Text style={[styles.accountEmail, { color: colors.textMuted }]}>{account.email || ''}</Text>
        </View>
      </View>
    );
  };

  const renderActions = () => {
    if (loading) return null;
    if (success) {
      return (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.returnToChat}
            onPress={onReturnToChat}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: accent, shadowColor: accent },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>{t.returnToChat}</Text>
          </Pressable>
          <View style={styles.secondaryRow}>
            {showCopyToken && token ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.copyToken}
                onPress={() => {
                  onCopyToken?.(token);
                  setCopied(true);
                }}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.ghostBtnText, { color: colors.textMuted }]}>
                  {copied ? t.tokenCopied : t.copyToken}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.closeWindow}
              onPress={onClose}
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.ghostBtnText, { color: colors.textMuted }]}>{t.closeWindow}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.actions}>
        {message ? (
          <Text style={[styles.errorMessage, { color: '#fca5a5', backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
            {message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.tryAgain}
          onPress={onTryAgain}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: accent, shadowColor: accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.primaryBtnText}>{t.tryAgain}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t.troubleshoot}
          onPress={onTroubleshoot}
          style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.linkText, { color: accent }]}>{t.troubleshoot}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} aria-live={liveRegion}>
      <View style={styles.skyGlow} pointerEvents="none">
        <View style={[styles.skyBlob, { backgroundColor: accentSoft }]} />
      </View>

      <View style={cardStyle}>
        <View style={styles.iconWrap}>{renderStatusIcon()}</View>

        <Text
          ref={headingRef}
          accessibilityRole={success ? 'header' : error ? 'alert' : undefined}
          style={[styles.heading, { color: colors.text }]}
        >
          {loading ? t.loadingTitle : success ? t.successTitle : t.errorTitle}
        </Text>

        <Text style={[styles.body, { color: colors.textMuted }]}>
          {loading ? '' : success ? t.successBody : t.errorBody}
        </Text>

        {success ? renderAccount() : null}

        {renderActions()}

        <Text style={[styles.footnote, { color: colors.textMuted }]}>{t.securedBy}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? ('100vh' as unknown as number) : '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  skyGlow: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  skyBlob: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: 210,
    opacity: 0.35,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  iconWrap: {
    marginBottom: 20,
  },
  iconRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.18)',
    marginBottom: 24,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
  },
  accountEmail: {
    fontSize: 13,
  },
  actions: {
    alignSelf: 'stretch',
    gap: 12,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  ghostBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.25)',
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  errorMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  footnote: {
    marginTop: 24,
    fontSize: 12,
  },
});
