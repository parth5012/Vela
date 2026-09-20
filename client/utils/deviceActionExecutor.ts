import { Platform } from 'react-native';
import DeviceAgentNative from '../modules/device-agent';
import { useConfigStore } from '../store/useConfigStore';
import { parseNeedleCoords } from './needleDeviceTools';

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
      case 'device_click':
      case 'device_tap': {
        // target is "@e3" (preferred) or typed "x,y" coords from Needle JSON.
        const targetRef = target || '';
        if (targetRef && !targetRef.startsWith('@e') && !parseNeedleCoords(targetRef)) {
          throw new Error(`Invalid tap target "${targetRef}". Use an @e ref or "x,y".`);
        }
        const success = await DeviceAgentNative.performAction('click', targetRef, '', '');
        return success ? 'Success' : 'Action failed';
      }
      case 'device_type': {
        const targetRef = target || '';
        const val = value || '';
        const success = await DeviceAgentNative.performAction('type', targetRef, val, '');
        return success ? 'Success' : 'Action failed';
      }
      case 'device_scroll':
      case 'device_swipe': {
        const targetRef = target || '@e0';
        const val = value || '';
        const success = await DeviceAgentNative.performAction('scroll', targetRef, val, '');
        return success ? 'Success' : 'Action failed';
      }
      case 'device_press_key': {
        const key = value || target || 'back';
        const success = await DeviceAgentNative.performAction('press_key', '', key, '');
        return success ? 'Success' : 'Action failed';
      }
      case 'device_set_volume': {
        const level = value || target || '';
        const success = await DeviceAgentNative.performAction('set_volume', '', level, '');
        return success ? 'Success' : 'Action failed';
      }
      case 'device_open_app': {
        const app = value || target || '';
        const success = await DeviceAgentNative.performAction('open_app', app, app, '');
        return success ? 'Success' : 'Action failed';
      }
      default: {
        throw new Error(`Unknown device tool "${toolName}".`);
      }
    }
  } catch (e: any) {
    console.warn(`[executeDeviceAction] Native error executing ${toolName}:`, e);
    throw new Error(
      `Device action "${toolName}" failed${target ? ` on target ${target}` : ''}${
        value ? ` with value ${value}` : ''
      }: ${e?.message || e}`
    );
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
