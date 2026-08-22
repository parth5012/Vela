import React, { useEffect, useState, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useGoogleAuthStore } from '../store/useGoogleAuthStore';
import { useConfigStore } from '../store/useConfigStore';
import { useAurora } from '../hooks/useAurora';
import OAuthCallbackScreen from '../components/oauth/OAuthCallbackScreen';

export default function OAuthCallbackRoute() {
  const router = useRouter();
  const { status, message } = useLocalSearchParams<{ status?: string; message?: string }>();
  
  const [verdict, setVerdict] = useState<'success' | 'error' | null>(() => {
    if (status === 'error') return 'error';
    return null;
  });
  
  const [errorMessage, setErrorMessage] = useState<string | undefined>(message);
  
  const { colors } = useAurora();
  const accent = colors.aurora1;
  const accentSoft = colors.aurora2;
  
  const user = useGoogleAuthStore((s: any) => s.user);
  const apiUrlRaw = useConfigStore((s: any) => s.apiUrl);
  const apiKey = useConfigStore((s: any) => s.apiKey);

  const checkTokenStatus = useCallback(async () => {
    if (!apiUrlRaw || !apiKey) {
      setVerdict('error');
      setErrorMessage('Server URL or API Key is not configured.');
      return false;
    }
    try {
      const formatted = apiUrlRaw.trim().replace(/\/+$/, '');
      const url = `${formatted}/oauth/token/status`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.connected === true) {
          useGoogleAuthStore.getState().setBackendConnected(true);
          if (data.user) {
            useGoogleAuthStore.getState().setUser({
              name: data.user.name || 'Google User',
              email: data.user.email || '',
              picture: data.user.picture || undefined,
            });
          }
          setVerdict('success');
          return true;
        }
      }
    } catch (err) {
      console.error('[oauth-callback] error checking status:', err);
    }
    return false;
  }, [apiUrlRaw, apiKey]);

  useEffect(() => {
    if (status === 'error') {
      return;
    }

    let isMounted = true;
    let pollCount = 0;
    const maxPolls = 20; // 30 seconds

    const poll = async () => {
      if (!isMounted) return;
      const verified = await checkTokenStatus();
      if (verified) return;
      
      pollCount++;
      if (pollCount >= maxPolls) {
        if (isMounted) {
          setVerdict('error');
          setErrorMessage('Verification timed out. Google Workspace connection could not be verified.');
        }
        return;
      }
      setTimeout(poll, 1500);
    };

    poll();

    return () => {
      isMounted = false;
    };
  }, [status, checkTokenStatus]);

  const handleReturnToChat = () => {
    router.navigate('/');
  };

  const handleClose = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.close();
    }
  };

  const handleTryAgain = () => {
    if (!apiUrlRaw) return;
    const redirectUri = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? `${window.location.origin}/oauth-callback` : '')
      : 'vela-client://oauth/callback';
    const formatted = apiUrlRaw.trim().replace(/\/+$/, '');
    const authUrl = `${formatted}/oauth/google/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&api_key=${encodeURIComponent(apiKey || '')}`;
    
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = authUrl;
    } else {
      Linking.openURL(authUrl);
    }
  };

  const handleTroubleshoot = () => {
    Linking.openURL('https://support.google.com/accounts');
  };

  return (
    <OAuthCallbackScreen
      status={verdict}
      account={user}
      message={errorMessage}
      colors={colors}
      accent={accent}
      accentSoft={accentSoft}
      onReturnToChat={handleReturnToChat}
      onClose={handleClose}
      onTryAgain={handleTryAgain}
      onTroubleshoot={handleTroubleshoot}
    />
  );
}
