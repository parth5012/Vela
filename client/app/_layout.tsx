import { useEffect } from 'react';
import { useRouter, useSegments, useRootNavigationState, Slot } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { ActivityIndicator, View, StyleSheet, Pressable, Text, AppState } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import { checkPermission } from '../utils/permissionManager';
import { useChatStore } from '../store/useChatStore';
import DrawerContent from '../components/ui/DrawerContent';
import HealthIndicator from '../components/ui/HealthIndicator';
import WebView from 'react-native-webview';
import {
  useBrowserStore,
  webViewRef,
  handleWebViewLoadEnd,
  handleWebViewMessage,
} from '../store/useBrowserStore';
import { hydrateGoogleTokens } from '../store/useGoogleAuthStore';
import { registerVelaBackgroundTask } from '../utils/backgroundTasks';
import * as Notifications from 'expo-notifications';
import { SafetyDialog } from '../components/ui/SafetyDialog';
import { persistentWebviewContainerStyle, persistentWebviewPointerEvents } from '../utils/persistentWebviewStyle';
import { registerAndPostToken, setupTokenRefreshListener } from '../utils/pushRegistration';
import { routeByType } from '../utils/notificationRouting';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});


import { initializeDatabase } from '../db/client';
import { wireOfflineSync, flushPendingMessages } from '../utils/offlineSync';

function HeaderRightActions() {
  const router = useRouter();
  const segments = useSegments();
  const isBrowserRoute = segments[0] === 'browser';

  const handleToggle = () => {
    if (isBrowserRoute) {
      router.navigate('/');
    } else {
      router.navigate('/browser');
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      <Pressable
        onPress={handleToggle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: isBrowserRoute ? '#312e81' : '#1e1b4b',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
          marginRight: 8,
          borderWidth: 1,
          borderColor: isBrowserRoute ? '#818cf8' : '#4f46e5',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: '#e0e7ff', fontSize: 12, fontWeight: 'bold' }}>
          {isBrowserRoute ? '💬 Chat' : '🌐 Webview'}
        </Text>
      </Pressable>
      <HealthIndicator />
    </View>
  );
}

export default function RootLayout() {
  const isConfigured = useConfigStore((state) => state.isConfigured);
  const hasHydrated = useConfigStore((state) => state.hasHydrated);
  const chatHasHydrated = useChatStore((state) => state.hasHydrated);

  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const isRouterReady = navigationState?.key !== undefined;

  // NOTE: all hooks must run unconditionally on every render, before any
  // early return below. Moving these under a conditional return breaks the
  // Rules of Hooks and crashes ContextNavigator on remount.
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const isBrowserVisible = useBrowserStore((s) => s.isVisible);

  useEffect(() => {
    if (hasHydrated && chatHasHydrated) {
      // Preserve active thread if already selected, otherwise default to welcome/new screen
      if (!useChatStore.getState().activeThreadId) {
        useChatStore.getState().selectThread(null);
      }
      // Local-first offline sync: flush any pending offline messages once the
      // store is hydrated, and listen for app foreground to flush again.
      wireOfflineSync();
      flushPendingMessages();
    }
  }, [hasHydrated, chatHasHydrated]);

useEffect(() => {
if (hasHydrated) {
// Hydrate Google OAuth tokens SecureStore
hydrateGoogleTokens();
registerVelaBackgroundTask();
}
}, [hasHydrated]);

  // FCM push registration — triggers on setup completion (hasHydrated && isConfigured)
  // per #132. Extracted to utils/pushRegistration.ts; reads apiUrl/apiKey via
  // useConfigStore.getState() at call time (same pattern as backgroundTasks).
  useEffect(() => {
    if (!hasHydrated || !isConfigured) return;
    let refreshSub: Notifications.Subscription | null = null;
    let cancelled = false;
    // Fire registration; on success register refresh listener. Failures are silent+logged inside util.
    registerAndPostToken().then((token) => {
      if (cancelled) return;
      // Only listen for refresh if permission was granted (token obtained).
      // If denied, listener is skipped; next app launch after grant will register.
      if (!token) return;
      try {
        refreshSub = setupTokenRefreshListener();
      } catch {
        // silent
      }
    });
    return () => {
      cancelled = true;
      try {
        refreshSub?.remove();
      } catch {
        // ignore cleanup errors
      }
    };
  }, [hasHydrated, isConfigured]);

  // Notification listeners: foreground banner (system), background tap, cold-start — per #136/#133
  // Trio: foreground addNotificationReceivedListener (log only, banner via setNotificationHandler),
  // background addNotificationResponseReceivedListener, killed getLastNotificationResponseAsync.
  // Hook-safe: placed before early return with hasHydrated && isRouterReady guard.
  useEffect(() => {
    if (!hasHydrated || !isRouterReady) return;
    let foregroundSub: Notifications.Subscription | null = null;
    let responseSub: Notifications.Subscription | null = null;
    let cancelled = false;

    const selectThread = (id: string | null) => useChatStore.getState().selectThread(id);

    // Cold-start: app launched from killed state via notification tap
    Notifications.getLastNotificationResponseAsync()
      .then((response: unknown) => {
        if (cancelled) return;
        const data = (response as { notification?: { request?: { content?: { data?: Record<string, string> } } } })
          ?.notification?.request?.content?.data;
        if (data) {
          routeByType(data, router, selectThread);
        }
      })
      .catch(() => {
        // silent
      });

    // Foreground: system banner via setNotificationHandler; listener only for logging
    foregroundSub = Notifications.addNotificationReceivedListener((notification: unknown) => {
      const data = (notification as { request?: { content?: { data?: unknown } } })?.request?.content?.data;
      console.log('[notifications] foreground received', data);
    });

    // Background: user tapped banner while app in background
    responseSub = Notifications.addNotificationResponseReceivedListener((response: unknown) => {
      const data = (response as { notification?: { request?: { content?: { data?: Record<string, string> } } } })
        ?.notification?.request?.content?.data;
      if (data) {
        routeByType(data, router, selectThread);
      } else {
        console.log('[notifications] response without data');
        router.replace('/');
      }
    });

    return () => {
      cancelled = true;
      try {
        foregroundSub?.remove();
      } catch {
        // ignore cleanup errors
      }
      try {
        responseSub?.remove();
      } catch {
        // ignore cleanup errors
      }
    };
  }, [hasHydrated, isRouterReady, router]);

  useEffect(() => {
    if (!hasHydrated) return;
    const checkPermissionsAndUpdateStore = async () => {
      const perms: Array<'notifications' | 'camera' | 'microphone' | 'storage' | 'accessibility' | 'background'> = [
        'notifications',
        'camera',
        'microphone',
        'storage',
        'accessibility',
        'background',
      ];
      for (const perm of perms) {
        try {
          const status = await checkPermission(perm);
          useConfigStore.getState().setOSPermission(perm, status);
        } catch {
          // ignore per-permission failures
        }
      }
    };
    // Initial check
    checkPermissionsAndUpdateStore();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkPermissionsAndUpdateStore();
      }
    });
    return () => sub.remove();
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !isRouterReady) return;

    const inSetupGroup = segments[0] === 'setup';
    const isOAuthCallback = segments[0] === 'oauth-callback';

    if (!isConfigured && !inSetupGroup && !isOAuthCallback) {
      // User not configured and not in setup/oauth-callback, redirect to /setup
      router.replace('/setup');
    } else if (isConfigured && inSetupGroup) {
      // User configured and in setup, redirect back home /
      router.replace('/');
    }
  }, [isConfigured, hasHydrated, isRouterReady, segments]);

  const inSetupGroup = segments[0] === 'setup';
  const isOAuthCallback = segments[0] === 'oauth-callback';

  if (!hasHydrated || !chatHasHydrated || !isRouterReady || (!isConfigured && !inSetupGroup && !isOAuthCallback) || (isConfigured && inSetupGroup)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#818cf8" />
      </View>
    );
  }

  // If we are in the setup screen, render it directly without the Drawer UI
  if (inSetupGroup || isOAuthCallback) {
    return <Slot />;
  }

  const isBrowserRoute = segments[0] === 'browser';
  const shouldShowWebview = isBrowserVisible && isBrowserRoute;

  return (
    <View style={{ flex: 1 }}>
      <Drawer
        drawerContent={() => <DrawerContent />}
        screenOptions={{
          drawerType: 'front',
          headerStyle: {
            backgroundColor: '#09090b',
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTitleStyle: {
            fontWeight: '900',
            color: '#818cf8',
            fontSize: 16,
          },
        headerTintColor: '#e4e4e7',
        headerRight: () => <HeaderRightActions />,
        drawerStyle: {
            backgroundColor: '#09090b',
            width: 280,
          },
        }}
      >
        {/* Wayfinder #173 Audit — Header Casing Source
           Titles via Drawer.Screen options.headerTitle (not filename): index:'VELA' 900 letterSpacing 3 #818cf8,
           settings:'Settings' 600 #e4e4e7, browser:'Browser' 600, tasks:'Tasks' 600.
           task-progress uses AuroraScreen internal header (title='Task Progress' Title Case) not Drawer.Screen.
           Spec #174: formatter rule — display titles are explicit Title Case headerTitle strings, weight 600 except VELA logo (900). */}
        <Drawer.Screen
          name="index"
          options={{
            headerTitle: 'VELA',
            headerTitleStyle: {
              fontWeight: '900',
              letterSpacing: 3,
              color: '#818cf8',
              fontSize: 16,
            },
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            headerTitle: 'Settings',
            headerTitleStyle: {
              fontWeight: '600',
              color: '#e4e4e7',
              fontSize: 16,
            },
          }}
        />
<Drawer.Screen
name="browser"
options={{
headerTitle: 'Browser',
headerTitleStyle: {
fontWeight: '600',
color: '#e4e4e7',
fontSize: 16,
}
}}
/>
<Drawer.Screen
name="tasks"
options={{
headerTitle: 'Tasks',
headerTitleStyle: {
fontWeight: '600',
color: '#e4e4e7',
fontSize: 16,
}
}}
/>
<Drawer.Screen
name="journal"
options={{
headerTitle: 'Journal',
headerTitleStyle: {
fontWeight: '600',
color: '#e4e4e7',
fontSize: 16,
}
}}
/>
      </Drawer>

      {/* Persistent WebView — always mounted, visibility toggled by offscreen positioning */}
      <View
        style={persistentWebviewContainerStyle(shouldShowWebview)}
        pointerEvents={persistentWebviewPointerEvents(shouldShowWebview)}
      >
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={{ flex: 1 }}
          onLoadEnd={handleWebViewLoadEnd}
          onMessage={handleWebViewMessage}
          onNavigationStateChange={(navState) => {
            useBrowserStore.getState().setNavState(
              navState.canGoBack,
              navState.canGoForward,
              navState.url,
              navState.title || ''
            );
          }}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
        />
      </View>
      <SafetyDialog />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  persistentWebview: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
