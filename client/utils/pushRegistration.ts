import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useConfigStore } from '../store/useConfigStore';

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('vela_task_completion', {
      name: 'Vela Task Completion',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
    await Notifications.setNotificationChannelAsync('vela_calendar_reminders', {
      name: 'Vela Calendar Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
    await Notifications.setNotificationChannelAsync('vela_briefing', {
      name: 'Vela Briefing',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
    await Notifications.setNotificationChannelAsync('vela_checkin', {
      name: 'Vela Check-in',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F71',
    });
  } catch (e) {
    console.warn('[pushRegistration] Failed to create notification channels', e);
  }
}

async function postTokenToBackend(token: string): Promise<boolean> {
  try {
    const { apiUrl, apiKey } = useConfigStore.getState();
    if (!apiUrl || !apiKey) {
      console.log('[pushRegistration] Skipping token POST — apiUrl/apiKey not configured');
      return false;
    }
    const url = `${apiUrl.replace(/\/+$/, '')}/api/config/device-token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      console.warn('[pushRegistration] Token POST failed', res.status);
      return false;
    }
    console.log('[pushRegistration] Token registered with backend');
    return true;
  } catch (e) {
    console.warn('[pushRegistration] Token POST error', e);
    return false;
  }
}

export async function registerAndPostToken(): Promise<string | null> {
  try {
    await ensureAndroidChannels();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[pushRegistration] Notifications permission not granted — skipping registration');
      return null;
    }

    let token: string;
    try {
      token = (await Notifications.getDevicePushTokenAsync()).data;
    } catch (e) {
      console.warn('[pushRegistration] getDevicePushTokenAsync failed', e);
      return null;
    }

    if (!token) {
      console.warn('[pushRegistration] Empty device push token');
      return null;
    }

    console.log('[FCM Token]:', token);
    await postTokenToBackend(token);
    return token;
  } catch (e) {
    console.warn('[pushRegistration] registerAndPostToken failed', e);
    return null;
  }
}

export function setupTokenRefreshListener(): Notifications.Subscription | null {
  try {
    const subscription = Notifications.addPushTokenListener(async (event) => {
      const newToken = (event as { data?: string })?.data ?? (event as unknown as string);
      const tokenStr = typeof newToken === 'string' ? newToken : (newToken as string);
      if (!tokenStr) {
        console.warn('[pushRegistration] Push token refresh event without token');
        return;
      }
      console.log('[pushRegistration] Push token refreshed:', tokenStr);
      await postTokenToBackend(tokenStr);
    });
    return subscription;
  } catch (e) {
    console.warn('[pushRegistration] Failed to register push token listener', e);
    return null;
  }
}
