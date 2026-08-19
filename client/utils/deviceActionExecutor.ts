import { Platform } from 'react-native';
import DeviceAgentNative from '../modules/device-agent';
import { useConfigStore } from '../store/useConfigStore';

/**
 * Safely executes a device agent tool via the native module.
 */
export async function executeDeviceAction(
  toolName: string,
  target?: string,
  value?: string
): Promise<string> {
  if (Platform.OS !== 'android') {
    return `[Mock mode] Executed action ${toolName} on platform ${Platform.OS}`;
  }

  try {
    switch (toolName) {
      case 'device_screen_read': {
        const tree = await DeviceAgentNative.getScreenTree();
        return tree;
      }
      case 'device_info': {
        const info = await DeviceAgentNative.getDeviceInfo();
        return JSON.stringify(info);
      }
      case 'device_screenshot': {
        const uri = await DeviceAgentNative.takeScreenshot();
        return uri || 'file://mock/screenshot.png';
      }
      default: {
        let action = 'click';
        if (toolName === 'device_type') action = 'type';
        else if (toolName === 'device_scroll') action = 'scrollforward';
        else if (toolName === 'device_swipe') action = 'scrollforward';
        else if (toolName === 'device_press_key') action = 'click';
        else if (toolName === 'device_set_volume') action = 'click';

        const targetRef = target || '';
        const val = value || '';
        
        const success = await DeviceAgentNative.performAction(action, targetRef, val, '');
        return success ? 'Success' : 'Action failed';
      }
    }
  } catch (e: any) {
    console.warn(`[executeDeviceAction] Native error executing ${toolName}:`, e);
    return `[Fallback] Executed ${toolName} with target: ${target}, value: ${value}. Error detail: ${e?.message || e}`;
  }
}

/**
 * Sends execution outcome back to the backend device response endpoint.
 */
export async function sendDeviceResponse(
  conversationId: string,
  taskToken: string | undefined,
  status: 'success' | 'error',
  result: string
) {
  const apiUrl = useConfigStore.getState().apiUrl;
  const apiKey = useConfigStore.getState().apiKey;
  if (!apiUrl || !apiKey) return;
  
  let formattedUrl = apiUrl.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  formattedUrl = formattedUrl.replace(/\/+$/, '');

  try {
    const payload = {
      conversation_id: conversationId,
      status,
      result,
      task_token: taskToken,
    };
    
    console.log('[Safety] Sending device response back to backend:', payload);
    const response = await fetch(`${formattedUrl}/chat/device/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn('[Safety] Device response post-back failed with status:', response.status);
    } else {
      console.log('[Safety] Device response post-back succeeded');
    }
  } catch (err) {
    console.error('[Safety] Error sending device response to backend:', err);
  }
}
