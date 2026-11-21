import '@stardazed/streams-text-encoding';
import { useEffect, useRef } from 'react';
import { useRouter, useSegments, useRootNavigationState, Slot } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { ActivityIndicator, View, StyleSheet, Pressable, Text, AppState, InteractionManager, Animated } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
import { checkPermission, type OSPermission } from '../utils/permissionManager';
import { useChatStore } from '../store/useChatStore';
import DrawerContent from '../components/ui/DrawerContent';
import OfflineBanner from '../components/ui/OfflineBanner';
import SyncStatusIndicator from '../components/ui/SyncStatusIndicator';
import QueueBadge from '../components/ui/QueueBadge';
import { startHealthProbeService } from '../utils/healthProbe';
import WebView from 'react-native-webview';
import {
  useBrowserStore,
  webViewRef,
  handleWebViewLoadEnd,
  handleWebViewMessage,
} from '../store/useBrowserStore';
import { registerVelaBackgroundTask } from '../utils/backgroundTasks';

// Dev-only Playwright control channel (#495). `EXPO_PUBLIC_E2E` is inlined at
// build time, so in a normal build this branch is dead code and the loader is
// never installed (no `globalThis.__VELA_E2E__`, no extra runtime work).
if (process.env.EXPO_PUBLIC_E2E === '1') {
  require('../e2e/loader').installE2ELoader();
}
import * as Notifications from 'expo-notifications';
import { SafetyDialog } from '../components/ui/SafetyDialog';
import { persistentWebviewContainerStyle, persistentWebviewPointerEvents } from '../utils/persistentWebviewStyle';
import { registerAndPostToken } from '../utils/pushRegistration';
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
import { wireOfflineSync, flushPendingMessages, refreshPendingQueueCount } from '../utils/offlineSync';
import { runAgentDataBootstrap } from '../utils/seedAgents';
import { THEME_COLORS, getAurora, hexToRgba } from '../utils/theme';
import { DURATIONS, EASING } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function HeaderRightActions() {
  const router = useRouter();
  const segments = useSegments();
  const theme = useConfigStore((state) => state.theme);
  const accentColor = useConfigStore((state) => state.accentColor);
  const colors = THEME_COLORS[theme] || THEME_COLORS.berry;
  const aurora = getAurora(accentColor, theme);
  const isBrowserRoute = segments[0] === 'browser';
  const reducedMotion = useReducedMotion();

  const scale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (!reducedMotion) {
      Animated.timing(scale, {
        toValue: 0.94,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(pressOpacity, {
        toValue: 0.75,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      Animated.timing(scale, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(pressOpacity, {
        toValue: 1,
        duration: DURATIONS.press,
        easing: EASING.out,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleToggle = () => {
    if (isBrowserRoute) {
      router.navigate('/');
    } else {
      router.navigate('/browser');
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8, gap: 6 }}>
      <AnimatedPressable
        onPress={handleToggle}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[
          styles.headerRouteBtn,
          {
            backgroundColor: isBrowserRoute ? hexToRgba(aurora.acc1, 0.14) : colors.glass,
            borderColor: isBrowserRoute ? aurora.acc1 : colors.glassBorder,
            transform: [{ scale }],
            opacity: pressOpacity,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={isBrowserRoute ? 'Switch to Chat view' : 'Switch to Webview'}
        testID="header-route-toggle"
      >
        <Text style={{ color: isBrowserRoute ? aurora.acc1 : colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 }}>
          {isBrowserRoute ? '💬 Chat' : '🌐 Browser'}
        </Text>
      </AnimatedPressable>
      <QueueBadge />
      <SyncStatusIndicator />
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
  const currentTheme = useConfigStore((state) => state.theme);
  const currentAccent = useConfigStore((state) => state.accentColor);

  useEffect(() => {
    if (hasHydrated && chatHasHydrated) {
      // Preserve active thread if already selected, otherwise default to welcome/new screen
      if (!useChatStore.getState().activeThreadId) {
        useChatStore.getState().selectThread(null);
      }
      // Cold startup optimization (WF-427-04): defer background data bootstrap & offline sync.
      // Migrations must finish before anything touches the DB, otherwise a cold
      // start queries tables that do not exist yet.
      const task = InteractionManager.runAfterInteractions(async () => {
        try {
          await initializeDatabase();
        } catch (e) {
          console.warn('[Layout] Database initialization error:', e);
        }
        runAgentDataBootstrap();
        // Local-first offline sync: flush any pending offline messages once the
        // store is hydrated, and listen for app foreground to flush again.
        wireOfflineSync();
        flushPendingMessages();
        refreshPendingQueueCount();
      });
      const cleanupProbe = startHealthProbeService();
      return () => {
        cleanupProbe();
        task.cancel();
      };
    }
  }, [hasHydrated, chatHasHydrated]);

  useEffect(() => {
    if (hasHydrated) {
      // Cold startup optimization (WF-427-04): defer background task registration
      const task = InteractionManager.runAfterInteractions(() => {
        registerVelaBackgroundTask();
      });
      return () => {
        task.cancel();
      };
    }
  }, [hasHydrated]);

  // FCM push registration — triggers on setup completion (hasHydrated && isConfigured)
  // per #132. Extracted to utils/pushRegistration.ts; reads apiUrl/apiKey via
  // useConfigStore.getState() at call time (same pattern as backgroundTasks).
  // #556: the onboarding wizard's permissions step is now the canonical request
  // point for the notifications OS dialog. This effect re-registers push on
  // later launches, but must never request the permission itself (that would
  // double-fire the OS dialog right after setup) — requestIfUndetermined: false.
  // The token refresh listener is owned by the util (attached once per app
  // session, even on short-circuit), so nothing to subscribe/clean up here.
  useEffect(() => {
    if (!hasHydrated || !isConfigured) return;
    // Cold startup optimization (WF-427-04): defer FCM push registration after interactions
    const task = InteractionManager.runAfterInteractions(() => {
      // Fire registration; failures are silent+logged inside util.
      void registerAndPostToken({ requestIfUndetermined: false });
    });
    return () => {
      task.cancel();
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

    // Cold-start: app launched from killed state via notification tap (deferred after first frame)
    const task = InteractionManager.runAfterInteractions(() => {
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
      task.cancel();
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
      const perms: OSPermission[] = [
        'notifications',
        'camera',
        'microphone',
        'storage',
        'accessibility',
        'background',
        'phone',
        'contacts',
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
    // Cold startup optimization (WF-427-04): defer OS permission queries after first paint
    const task = InteractionManager.runAfterInteractions(() => {
      checkPermissionsAndUpdateStore();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkPermissionsAndUpdateStore();
      }
    });
    return () => {
      task.cancel();
      sub.remove();
    };
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
        <ActivityIndicator size="large" color="#801D78" />
      </View>
    );
  }

  // If we are in the setup screen, render it directly without the Drawer UI
  if (inSetupGroup || isOAuthCallback) {
    return <Slot />;
  }

  const isBrowserRoute = segments[0] === 'browser';
  const shouldShowWebview = isBrowserVisible && isBrowserRoute;

  const currentColors = THEME_COLORS[currentTheme] || THEME_COLORS.berry;
  const currentAurora = getAurora(currentAccent, currentTheme);

  return (
    <View style={{ flex: 1, backgroundColor: currentColors.background }}>
      <OfflineBanner />
      <Drawer
        drawerContent={() => <DrawerContent />}
        screenOptions={{
          drawerType: 'front',
          headerStyle: {
            backgroundColor: currentColors.background,
            borderBottomColor: currentColors.glassBorder,
            borderBottomWidth: StyleSheet.hairlineWidth,
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTitleStyle: {
            fontWeight: '900',
            color: currentAurora.acc1,
            fontSize: 16,
          },
          headerTintColor: currentColors.text,
          headerRight: () => <HeaderRightActions />,
          drawerStyle: {
            backgroundColor: currentColors.background,
            width: 290,
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
              letterSpacing: 4,
              color: currentAurora.acc1,
              fontSize: 18,
            },
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            headerShown: false,
          }}
        />
        <Drawer.Screen
          name="browser"
          options={{
            headerTitle: 'Browser',
            headerTitleStyle: {
              fontWeight: '600',
              color: currentColors.text,
              fontSize: 16,
            },
          }}
        />
        <Drawer.Screen
          name="tasks"
          options={{
            headerTitle: 'Task Scheduler',
            headerTitleStyle: {
              fontWeight: '600',
              color: currentColors.text,
              fontSize: 14,
              letterSpacing: 0,
            },
          }}
        />
        <Drawer.Screen
          name="journal"
          options={{
            headerTitle: 'Journal',
            headerTitleStyle: {
              fontWeight: '600',
              color: currentColors.text,
              fontSize: 16,
            },
          }}
        />
        <Drawer.Screen
          name="omni"
          options={{
            headerTitle: 'Omni Live',
            headerTitleStyle: {
              fontWeight: '600',
              color: currentColors.text,
              fontSize: 16,
            },
          }}
        />
        <Drawer.Screen
          name="gallery"
          options={{
            headerShown: false,
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
    backgroundColor: '#F2EAFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
  },
});
