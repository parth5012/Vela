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
import { initializeDatabase } from '../db/client';

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
          borderColor: isBrowserRoute ? '#818cf8' : '#3730a3',
          borderWidth: 1,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 4,
          marginRight: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: '#c7d2fe', fontSize: 12, fontWeight: '600' }}>
          🌐 Webview
        </Text>
      </Pressable>
      <HealthIndicator />
    </View>
  );
}

export default function RootLayout() {
  const isConfigured = useConfigStore((s) => s.isConfigured);
  const hasHydrated = useConfigStore((s) => s.hasHydrated);
  const chatHasHydrated = useChatStore((s) => s.hasHydrated);
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const isBrowserVisible = useBrowserStore((s) => s.isVisible);
  const currentUrl = useBrowserStore((s) => s.currentUrl);

  const isRouterReady = navigationState?.key != null;

  useEffect(() => {
    if (hasHydrated) {
      hydrateGoogleTokens();
      registerVelaBackgroundTask();
      initializeDatabase().catch((err) => {
        console.warn('[RootLayout] DB initialization error:', err);
      });
    }
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !isRouterReady) return;

    const inSetupGroup = segments[0] === 'setup';

    if (!isConfigured && !inSetupGroup) {
      router.replace('/setup');
    } else if (isConfigured && inSetupGroup) {
      router.replace('/');
    }
  }, [isConfigured, hasHydrated, isRouterReady, segments]);

  if (!hasHydrated || !chatHasHydrated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const inSetupGroup = segments[0] === 'setup';

  if (inSetupGroup) {
    return <Slot />;
  }

  const isBrowserRoute = segments[0] === 'browser';
  const shouldShowWebview = isBrowserVisible && isBrowserRoute;

  return (
    <View style={{ flex: 1 }}>
      <Drawer
        drawerContent={(props: any) => <DrawerContent {...props} />}
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
            },
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
            },
          }}
        />
      </Drawer>

      {/* Persistent WebView — always mounted, visibility toggled with offscreen positioning */}
      <View
        style={[
          styles.persistentWebview,
          !shouldShowWebview && styles.persistentWebviewHidden,
        ]}
        pointerEvents={shouldShowWebview ? 'auto' : 'none'}
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
    top: Platform.OS === 'ios' ? 190 : 155,
  },
  persistentWebviewHidden: {
    position: 'absolute',
    top: -99999,
    left: -99999,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
