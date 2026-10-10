import { Platform } from 'react-native';
import DeviceAgentNative from '../modules/device-agent';
import { useConfigStore } from '../store/useConfigStore';
import {
  buildShizukuOp,
  deriveShizukuState,
  describeShizukuState,
  isShizukuTool,
  parseOpResult,
  ShizukuStatus,
} from './shizuku';

/**
 * The five distinct states an action can end in. Callers must not have to
 * parse a string to tell them apart:
 *
 * - `executed`      — the native agent really did it.
 * - `simulated`     — no native agent here (non-Android); mock text is labelled.
 * - `failed`        — the agent was reachable and the action is confirmed not
 *                     to have happened (it reported failure, or the exception
 *                     came from a read-only tool that changes no state).
 * - `unavailable`   — the agent is not loaded at all (PR #300 made a failed
 *                     `requireNativeModule` non-fatal, so the module is
 *                     `null`); nothing was attempted, and nothing must be
 *                     recorded as run.
 * - `indeterminate` — a mutating call was dispatched and then threw, so the
 *                     device may already have changed. Never reported as a
 *                     clean failure: retrying blindly could act twice.
 */
export type DeviceActionOutcome =
  | 'executed'
  | 'simulated'
  | 'failed'
  | 'unavailable'
  | 'indeterminate';

export interface DeviceActionResult {
  outcome: DeviceActionOutcome;
  observation: string;
}

/** Which native method must exist for `toolName` to be runnable at all. */
function requiredNativeMethod(toolName: string): string {
  if (toolName === 'device_screen_read') return 'getScreenTree';
  if (toolName === 'device_info') return 'getDeviceInfo';
  if (toolName === 'device_screenshot') return 'takeScreenshot';
  if (toolName === 'device_call') return 'makeCall';
  if (toolName === 'device_sms') return 'sendSms';
  if (toolName === 'device_contact') return 'searchContacts';
  if (toolName === 'device_set_alarm') return 'setAlarm';
  if (toolName === 'device_set_brightness') return 'setBrightness';
  if (toolName === 'device_set_volume') return 'setVolume';
  if (toolName === 'device_open_app') return 'openApp';
  if (isShizukuTool(toolName)) return 'runPrivilegedOp';
  return 'performAction';
}

/**
 * True for tools that change device state (everything routed through
 * `performAction` or the privileged Shizuku service, plus call, SMS,
 * alarm, brightness, volume, and app launch). Derived from the dispatch path
 * rather than a hand-kept list, so a new mutating tool is classified
 * correctly by default.
 */
function isMutating(toolName: string): boolean {
  if (
    toolName === 'device_call' ||
    toolName === 'device_sms' ||
    toolName === 'device_set_alarm' ||
    toolName === 'device_set_brightness' ||
    toolName === 'device_set_volume' ||
    toolName === 'device_open_app'
  ) {
    return true;
  }
  if (toolName === 'device_contact') return false;
  const method = requiredNativeMethod(toolName);
  return method === 'performAction' || method === 'runPrivilegedOp';
}

interface ParsedAlarm {
  isTimer: boolean;
  hour: number;
  minutes: number;
  lengthSeconds: number;
  message: string;
  skipUi: boolean;
}

function parseAlarmJson(raw: string): { success: true; data: ParsedAlarm } | { success: false; error: string } | null {
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const isTimer = Boolean(parsed.timer || parsed.length !== undefined || parsed.lengthSeconds !== undefined);
    const lengthSeconds = Number(parsed.lengthSeconds ?? parsed.length ?? 0);
    const hour = Number(parsed.hour ?? 0);
    const minutes = Number(parsed.minutes ?? 0);
    const message = String(parsed.message ?? '');
    const skipUi = parsed.skipUi !== false;

    if (isTimer) {
      if (lengthSeconds <= 0) {
        return { success: false, error: 'timer length must be greater than 0 seconds.' };
      }
      return { success: true, data: { isTimer: true, hour: 0, minutes: 0, lengthSeconds, message, skipUi } };
    }
    if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minutes) || minutes < 0 || minutes > 59) {
      return { success: false, error: 'hour must be 0-23 and minutes 0-59 for device_set_alarm.' };
    }
    return { success: true, data: { isTimer: false, hour, minutes, lengthSeconds: 0, message, skipUi } };
  } catch {
    return { success: false, error: 'invalid JSON format for alarm parameters.' };
  }
}

function parseAlarmInput(
  target?: string,
  value?: string
): { success: true; data: ParsedAlarm } | { success: false; error: string } {
  const t = (target || '').trim();
  const v = (value || '').trim();

  const fromJson = parseAlarmJson(t) ?? parseAlarmJson(v);
  if (fromJson) return fromJson;

  if (t.toLowerCase().startsWith('timer:') || v.toLowerCase().startsWith('timer:')) {
    const rawLen = t.toLowerCase().startsWith('timer:') ? t.slice(6) : v.slice(6);
    const lengthSeconds = parseInt(rawLen, 10);
    if (isNaN(lengthSeconds) || lengthSeconds <= 0) {
      return { success: false, error: 'timer length must be greater than 0 seconds.' };
    }
    const message = t.toLowerCase().startsWith('timer:') ? v : '';
    return { success: true, data: { isTimer: true, hour: 0, minutes: 0, lengthSeconds, message, skipUi: true } };
  }

  if (t.toLowerCase() === 'timer') {
    const lengthSeconds = parseInt(v, 10);
    if (isNaN(lengthSeconds) || lengthSeconds <= 0) {
      return { success: false, error: 'timer length must be greater than 0 seconds.' };
    }
    return { success: true, data: { isTimer: true, hour: 0, minutes: 0, lengthSeconds, message: '', skipUi: true } };
  }

  const timeStr = t || v;
  if (!timeStr) {
    return { success: false, error: 'alarm time or timer duration is required for device_set_alarm.' };
  }

  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(am|pm))?$/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) {
      return { success: false, error: 'hour must be 0-23 and minutes 0-59 for device_set_alarm.' };
    }
    const message = t ? v : '';
    return { success: true, data: { isTimer: false, hour, minutes, lengthSeconds: 0, message, skipUi: true } };
  }

  const meridiemOnlyMatch = timeStr.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (meridiemOnlyMatch) {
    let hour = parseInt(meridiemOnlyMatch[1], 10);
    const meridiem = meridiemOnlyMatch[2].toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) {
      return { success: false, error: 'hour must be 0-23 for device_set_alarm.' };
    }
    const message = t ? v : '';
    return { success: true, data: { isTimer: false, hour, minutes: 0, lengthSeconds: 0, message, skipUi: true } };
  }

  return { success: false, error: 'valid alarm time (e.g. "07:30") or timer duration is required.' };
}

function parsePercent(target?: string, value?: string): number | null {
  const raw = target !== undefined && target !== '' ? target : value;
  if (raw === undefined || raw === '') return null;
  const num = Number(raw);
  if (isNaN(num) || num < 0 || num > 100) return null;
  return num;
}

async function executeBrightnessWithShizuku(
  percent: number,
  nativeError: string
): Promise<DeviceActionResult> {
  const nativeAny = DeviceAgentNative as unknown as {
    getShizukuStatus?: () => Promise<ShizukuStatus>;
  };
  if (typeof nativeAny.getShizukuStatus !== 'function') {
    return { outcome: 'failed', observation: `Action failed: ${nativeError}` };
  }
  try {
    const status = await nativeAny.getShizukuStatus();
    if (deriveShizukuState(status) !== 'ready') {
      return { outcome: 'failed', observation: `Action failed: ${nativeError}` };
    }
    const brightnessVal = Math.round((percent / 100) * 255);
    const shizukuResult = await executeShizukuOp(
      'device_setting_put',
      'system/screen_brightness',
      String(brightnessVal)
    );
    if (shizukuResult.outcome === 'executed') {
      return {
        outcome: 'executed',
        observation: `Brightness set to ${percent}% via Shizuku (system/screen_brightness).`,
      };
    }
    return shizukuResult;
  } catch {
    return { outcome: 'failed', observation: `Action failed: ${nativeError}` };
  }
}

async function handleSetAlarm(target?: string, value?: string): Promise<DeviceActionResult> {
  const parsed = parseAlarmInput(target, value);
  if (!parsed.success) {
    return {
      outcome: 'failed',
      observation: `Action failed: ${parsed.error}`,
    };
  }
  const nativeAny = DeviceAgentNative as unknown as {
    setAlarm: (h: number, m: number, msg: string, skip: boolean) => Promise<{ success: boolean; message?: string; error?: string }>;
    setTimer?: (l: number, msg: string, skip: boolean) => Promise<{ success: boolean; message?: string; error?: string }>;
  };
  const res = parsed.data.isTimer && typeof nativeAny.setTimer === 'function'
    ? await nativeAny.setTimer(parsed.data.lengthSeconds, parsed.data.message, parsed.data.skipUi)
    : await nativeAny.setAlarm(parsed.data.hour, parsed.data.minutes, parsed.data.message, parsed.data.skipUi);

  if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
    return {
      outcome: 'failed',
      observation: 'Action failed: device agent returned no acknowledgement for device_set_alarm. Alarm was not confirmed.',
    };
  }
  if (res.success === false) {
    return {
      outcome: 'failed',
      observation: `Action failed: ${res.error || 'Failed to set alarm.'}`,
    };
  }
  return {
    outcome: 'executed',
    observation: res.message || 'Alarm set successfully',
  };
}

async function handleSetBrightness(target?: string, value?: string): Promise<DeviceActionResult> {
  const percent = parsePercent(target, value);
  if (percent === null) {
    return {
      outcome: 'failed',
      observation: 'Action failed: brightness percent must be a number between 0 and 100.',
    };
  }
  const res = await (DeviceAgentNative as unknown as {
    setBrightness: (p: number) => Promise<{ success: boolean; canWrite?: boolean; message?: string; error?: string }>;
  }).setBrightness(percent);

  if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
    return {
      outcome: 'failed',
      observation: 'Action failed: device agent returned no acknowledgement for device_set_brightness. Brightness change was not confirmed.',
    };
  }
  if (res.success === true) {
    return {
      outcome: 'executed',
      observation: res.message || `Brightness set to ${percent}%`,
    };
  }
  if (res.canWrite === false || (res.error && res.error.includes('WRITE_SETTINGS'))) {
    return executeBrightnessWithShizuku(percent, res.error || 'Permission WRITE_SETTINGS not granted.');
  }
  return {
    outcome: 'failed',
    observation: `Action failed: ${res.error || 'Failed to set brightness.'}`,
  };
}

async function handleSetVolume(target?: string, value?: string): Promise<DeviceActionResult> {
  const percent = parsePercent(target, value);
  if (percent === null) {
    return {
      outcome: 'failed',
      observation: 'Action failed: volume percent must be a number between 0 and 100.',
    };
  }
  const res = await (DeviceAgentNative as unknown as {
    setVolume: (p: number) => Promise<{ success: boolean; message?: string; error?: string }>;
  }).setVolume(percent);

  if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
    return {
      outcome: 'failed',
      observation: 'Action failed: device agent returned no acknowledgement for device_set_volume. Volume change was not confirmed.',
    };
  }
  if (res.success === false) {
    return {
      outcome: 'failed',
      observation: `Action failed: ${res.error || 'Failed to set volume.'}`,
    };
  }
  return {
    outcome: 'executed',
    observation: res.message || `Volume set to ${percent}%`,
  };
}

async function handleOpenApp(target?: string, value?: string): Promise<DeviceActionResult> {
  const query = (target || value || '').trim();
  if (!query) {
    return {
      outcome: 'failed',
      observation: 'Action failed: package name or app label is required for device_open_app.',
    };
  }
  const res = await (DeviceAgentNative as unknown as {
    openApp: (q: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  }).openApp(query);

  if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
    return {
      outcome: 'failed',
      observation: `Action failed: device agent returned no acknowledgement for device_open_app. App launch was not confirmed.`,
    };
  }
  if (res.success === false) {
    return {
      outcome: 'failed',
      observation: `Action failed: ${res.error || `Failed to open app "${query}".`}`,
    };
  }
  return {
    outcome: 'executed',
    observation: res.message || `Opened app: ${query}`,
  };
}

/**
 * Builds the outcome for a capability that is simply not there. Kept separate
 * so no caller can dress an unexecuted action up as a fallback execution.
 */
function unavailable(toolName: string, reason: string): DeviceActionResult {
  return {
    outcome: 'unavailable',
    observation: `Action NOT executed: device agent capability unavailable for ${toolName} — ${reason}. No device state was changed.`,
  };
}

/**
 * Executes a device agent tool via the native module and reports which of the
 * five outcomes above actually occurred. Never claims an action ran unless it
 * ran.
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

  // Shizuku allowlisted ops validate arguments and Shizuku readiness BEFORE
  // any dispatch, so a pre-dispatch problem can never be reported as
  // "indeterminate" (which would invite a blind retry on the device).
  if (isShizukuTool(toolName)) {
    return executeShizukuOp(toolName, target, value);
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
        // An empty capture is a failed capture — never a fabricated path.
        if (!uri) {
          return {
            outcome: 'failed',
            observation: 'Action failed: screenshot capture returned no data.',
          };
        }
        return { outcome: 'executed', observation: uri };
      }
      case 'device_call': {
        const phoneNumber = target || value || '';
        if (!phoneNumber) {
          return {
            outcome: 'failed',
            observation: 'Action failed: phone number is required for device_call.',
          };
        }
        const res = await DeviceAgentNative.makeCall(phoneNumber);
        if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
          return {
            outcome: 'failed',
            observation: `Action failed: device agent returned no acknowledgement for device_call. Call to ${phoneNumber} was not confirmed.`,
          };
        }
        if (res.success === false) {
          return {
            outcome: 'failed',
            observation: `Action failed: ${res.error || 'Failed to initiate call.'}`,
          };
        }
        return {
          outcome: 'executed',
          observation: res.message || `Call initiated to ${phoneNumber}`,
        };
      }
      case 'device_sms': {
        const phoneNumber = target || '';
        const message = value || '';
        if (!phoneNumber) {
          return {
            outcome: 'failed',
            observation: 'Action failed: recipient phone number is required for device_sms.',
          };
        }
        const res = await DeviceAgentNative.sendSms(phoneNumber, message);
        if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
          return {
            outcome: 'failed',
            observation: `Action failed: device agent returned no acknowledgement for device_sms. SMS composer for ${phoneNumber} was not confirmed.`,
          };
        }
        if (res.success === false) {
          return {
            outcome: 'failed',
            observation: `Action failed: ${res.error || 'Failed to send SMS.'}`,
          };
        }
        return {
          outcome: 'executed',
          observation: res.message || `SMS composer opened for ${phoneNumber}`,
        };
      }
      case 'device_contact': {
        const query = target || value || '';
        const res = await DeviceAgentNative.searchContacts(query);
        if (Array.isArray(res)) {
          return {
            outcome: 'executed',
            observation: res.length > 0 ? JSON.stringify(res) : `No contacts found matching "${query}".`,
          };
        }
        if (!res || typeof res !== 'object' || typeof res.success !== 'boolean') {
          return {
            outcome: 'failed',
            observation: `Action failed: device agent returned no acknowledgement for device_contact.`,
          };
        }
        if (res.success === false) {
          return {
            outcome: 'failed',
            observation: `Action failed: ${res.error || 'Failed to search contacts.'}`,
          };
        }
        const contacts = res.contacts || [];
        return {
          outcome: 'executed',
          observation: contacts.length > 0 ? JSON.stringify(contacts) : `No contacts found matching "${query}".`,
        };
      }
      case 'device_set_alarm':
        return await handleSetAlarm(target, value);
      case 'device_set_brightness':
        return await handleSetBrightness(target, value);
      case 'device_set_volume':
        return await handleSetVolume(target, value);
      case 'device_open_app':
        return await handleOpenApp(target, value);
      default: {
        let action = 'click';
        if (toolName === 'device_type') action = 'type';
        else if (toolName === 'device_scroll') action = 'scrollforward';
        else if (toolName === 'device_swipe') action = 'scrollforward';
        else if (toolName === 'device_press_key') action = 'click';

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
    // #309 review: a mutating call that throws after being dispatched may
    // already have changed the device. Report that honestly instead of
    // claiming a confirmed non-execution and inviting a blind retry.
    if (isMutating(toolName)) {
      return {
        outcome: 'indeterminate',
        observation: `Action result UNKNOWN: ${toolName} was dispatched to the device agent and then threw (target: ${target}, value: ${value}), so it may already have taken effect. Verify device state before repeating it. Error detail: ${e?.message || e}`,
      };
    }
    return {
      outcome: 'failed',
      observation: `Action failed: the device agent could not run ${toolName} (target: ${target}, value: ${value}). Error detail: ${e?.message || e}`,
    };
  }
}

/**
 * Runs one allowlisted Shizuku operation. Every failure before the
 * `runPrivilegedOp` dispatch is a confirmed non-execution; only a throw after
 * dispatch is reported as indeterminate.
 */
async function executeShizukuOp(
  toolName: string,
  target?: string,
  value?: string
): Promise<DeviceActionResult> {
  const spec = buildShizukuOp(toolName, target, value);
  if (!spec) {
    return {
      outcome: 'failed',
      observation: `Action failed: invalid arguments for ${toolName} (target: ${target}, value: ${value}). Not dispatched — no device state was changed.`,
    };
  }

  const native = DeviceAgentNative as any;
  if (typeof native.getShizukuStatus !== 'function') {
    return unavailable(toolName, 'the module does not provide getShizukuStatus()');
  }

  let status;
  try {
    status = await native.getShizukuStatus();
  } catch (e: any) {
    return {
      outcome: 'failed',
      observation: `Action NOT executed: could not read Shizuku status (${e?.message || e}). No device state was changed.`,
    };
  }

  const state = deriveShizukuState(status);
  if (state !== 'ready') {
    return unavailable(
      toolName,
      `Shizuku is not ready: ${describeShizukuState(state)}. Open Vela Settings → Shizuku Setup to connect it.`
    );
  }

  let raw: string;
  try {
    raw = await native.runPrivilegedOp(spec.op, spec.args);
  } catch (e: any) {
    return {
      outcome: 'indeterminate',
      observation: `Action result UNKNOWN: ${spec.op}(${spec.args.join(
        ', '
      )}) was dispatched to the Shizuku service and then threw, so it may already have taken effect. Verify device state before repeating it. Error detail: ${e?.message || e}`,
    };
  }

  const parsed = parseOpResult(raw);
  if (!parsed) {
    return {
      outcome: 'failed',
      observation: `Action failed: the Shizuku service returned an unparseable result for ${spec.op}; success was not confirmed. Raw: ${String(raw).slice(0, 200)}`,
    };
  }
  if (parsed.exitCode === 0) {
    return { outcome: 'executed', observation: parsed.output || `Success: ${spec.op} completed` };
  }
  // Timeout (124): the command STARTED but did not finish, so the device may
  // already be in a partially-changed state — a plain "failed" would invite a
  // blind retry of a mutating op (CodeRabbit review on PR #332).
  if (parsed.exitCode === 124) {
    return {
      outcome: 'indeterminate',
      observation: `Action result UNKNOWN: ${spec.op}(${spec.args.join(
        ', '
      )}) started on the device but the Shizuku service timed out before it completed, so it may have partially run. Service output: ${
        parsed.output || '(none)'
      } — verify device state before repeating it.`,
    };
  }
  return {
    outcome: 'failed',
    observation: `Action failed: ${spec.op} exited with code ${parsed.exitCode}. ${parsed.output}`.trim(),
  };
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
