import { Platform } from 'react-native';
import DeviceAgentNative from '../modules/device-agent';
import { useConfigStore } from '../store/useConfigStore';
import {
  buildShizukuOp,
  deriveShizukuState,
  describeShizukuState,
  isShizukuTool,
  parseOpResult,
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
  if (isShizukuTool(toolName)) return 'runPrivilegedOp';
  return 'performAction';
}

/**
 * True for tools that change device state (everything routed through
 * `performAction` or the privileged Shizuku service). Derived from the
 * dispatch path rather than a hand-kept list, so a new mutating tool is
 * classified correctly by default.
 */
function isMutating(toolName: string): boolean {
  const method = requiredNativeMethod(toolName);
  return method === 'performAction' || method === 'runPrivilegedOp';
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
