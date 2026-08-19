import { useEffect } from 'react';
import { useRouter, useSegments, useRootNavigationState, Slot } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { ActivityIndicator, View, StyleSheet, Platform, Pressable, Text } from 'react-native';
import { useConfigStore } from '../store/useConfigStore';
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
import { persistentWebviewContainerStyle, persistentWebviewPointerEvents } from './persistentWebviewStyle';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function registerForPushNotificationsAsync() {
  let token;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('vela_task_completion', {
      name: 'Vela Task Completion',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
    await Notifications.setNotificationChannelAsync('vela_calendar_reminders', {
      name: 'Vela Calendar Reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return;
  }

  try {
    token = (await Notifications.getDevicePushTokenAsync()).data;
    console.log('[FCM Token]:', token);
  } catch (error) {
    console.error('Error getting device push token:', error);
  }

  return token;
}


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
