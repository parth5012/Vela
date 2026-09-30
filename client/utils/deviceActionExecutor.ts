import { Platform } from 'react-native';
import DeviceAgentNative from '../modules/device-agent';
import { useConfigStore } from '../store/useConfigStore';

/**
 * #308: what actually happened to the action. These are four different states
 * and callers must not have to parse a string to tell them apart:
 *
 * - `executed`    — the native agent really did it.
 * - `simulated`   — no native agent here (non-Android); mock text is labelled.
 * - `failed`      — the agent was reachable but the action did not happen.
 * - `unavailable` — the agent is not loaded at all (PR #300 made a failed
 *                   `requireNativeModule` non-fatal, so the module is `null`);
 *                   nothing was attempted, and nothing must be recorded as run.
 */
export type DeviceActionOutcome = 'executed' | 'simulated' | 'failed' | 'unavailable';

export interface DeviceActionResult {
  outcome: DeviceActionOutcome;
  observation: string;
}

function unavailable(toolName: string, reason: string): DeviceActionResult {
  return {
    outcome: 'unavailable',
    observation: `Action NOT executed: device agent capability unavailable for ${toolName} — ${reason}. No device state was changed.`,
  };
}

function requiredNativeMethod(toolName: string): string {
  if (toolName === 'device_screen_read') return 'getScreenTree';
  if (toolName === 'device_info') return 'getDeviceInfo';
  if (toolName === 'device_screenshot') return 'takeScreenshot';
  return 'performAction';
}

/**
 * Executes a device agent tool via the native module.
 */
export async function executeDeviceAction(
  toolName: string,
  target?: string,
  value?: string
): Promise<DeviceActionResult> {
  if (Platform.OS !== 'android') {
    return {
      outcome: 'simulated',
      observation: `[Mock mode] Executed action ${toolName} on platform ${Platform.OS}`,
    };
  }

  // Capability gate: a null module (or one that does not expose the method this
  // tool needs) is NOT an execution and must never reach the catch below, where
  // it used to surface as "[Fallback] Executed ...".
  if (!DeviceAgentNative) {
    return unavailable(toolName, 'DeviceAgentModule did not load');
  }
  const requiredMethod = requiredNativeMethod(toolName);
  if (typeof (DeviceAgentNative as any)[requiredMethod] !== 'function') {
    return unavailable(toolName, `the module does not provide ${requiredMethod}()`);
  }

  try {
    switch (toolName) {
      case 'device_screen_read': {
        const tree = await DeviceAgentNative.getScreenTree();
        return { outcome: 'executed', observation: tree };
      }
      case 'device_info': {
        const info = await DeviceAgentNative.getDeviceInfo();
        return { outcome: 'executed', observation: JSON.stringify(info) };
      }
      case 'device_screenshot': {
        const uri = await DeviceAgentNative.takeScreenshot();
        return { outcome: 'executed', observation: uri || 'file://mock/screenshot.png' };
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
        return success
          ? { outcome: 'executed', observation: 'Success' }
          : { outcome: 'failed', observation: 'Action failed' };
      }
    }
  } catch (e: any) {
    console.warn(`[executeDeviceAction] Native error executing ${toolName}:`, e);
    return {
      outcome: 'failed',
      observation: `Action failed: the device agent could not run ${toolName} (target: ${target}, value: ${value}). Error detail: ${e?.message || e}`,
    };
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
