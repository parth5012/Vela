/**
 * Shizuku integration surface shared by the executor, the safety classifier
 * and the Settings → Shizuku Setup guide.
 *
 * Scope decision (documented in docs/shizuku-integration.md): Vela exposes
 * ONLY the eight allowlisted operations in SHIZUKU_TOOLS. No raw shell string
 * ever reaches the native layer, so nothing here builds an arbitrary command.
 */

export interface ShizukuStatus {
  /** The Shizuku manager app (moe.shizuku.manager) is installed. */
  installed: boolean;
  /** Shizuku.pingBinder() answered — the privileged server is running. */
  serverRunning: boolean;
  /** Shizuku.checkSelfPermission() == PERMISSION_GRANTED for Vela. */
  permissionGranted: boolean;
  /** Server uid: 0 = root, 2000 = adb/shell, -1 = unknown. */
  uid?: number;
}

export type ShizukuState = 'app_missing' | 'server_stopped' | 'permission_denied' | 'ready';

/** The eight allowlisted privileged tools — the complete Shizuku surface. */
export const SHIZUKU_TOOLS = [
  'device_app_permission_grant',
  'device_app_permission_revoke',
  'device_setting_put',
  'device_app_force_stop',
  'device_app_set_state',
  'device_app_clear_data',
  'device_app_install',
  'device_app_uninstall',
] as const;

export function isShizukuTool(toolName: string): boolean {
  return (SHIZUKU_TOOLS as readonly string[]).includes(toolName);
}

/**
 * readiness: a live server is authoritative — Sui (root) answers pingBinder()
 * with NO manager app installed, so `installed` is only consulted when the
 * server is down, where it separates "not set up yet" from "not started".
 */
export function deriveShizukuState(status: ShizukuStatus): ShizukuState {
  if (status.serverRunning) return status.permissionGranted ? 'ready' : 'permission_denied';
  if (!status.installed) return 'app_missing';
  return 'server_stopped';
}

export function describeShizukuState(state: ShizukuState): string {
  switch (state) {
    case 'app_missing':
      return 'the Shizuku app is not installed';
    case 'server_stopped':
      return 'the Shizuku server is not running — start it from the Shizuku app';
    case 'permission_denied':
      return 'Vela has not been granted Shizuku permission yet';
    case 'ready':
      return 'Shizuku is ready';
  }
}

export interface ShizukuOp {
  /** Allowlisted operation name understood by the native service. */
  op: string;
  /** Operation arguments, validated again on the privileged side. */
  args: string[];
}

const APP_ID = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

function isPackageId(value: string | undefined): value is string {
  return !!value && APP_ID.test(value);
}

/**
 * Maps a tool call to its allowlisted native op, or null when the arguments
 * are malformed. A null return means "fail before dispatch" — the executor
 * must never send a partially-validated op to the privileged service.
 */
export function buildShizukuOp(
  toolName: string,
  target?: string,
  value?: string
): ShizukuOp | null {
  switch (toolName) {
    case 'device_app_permission_grant':
      if (!isPackageId(target) || !value) return null;
      return { op: 'pm_grant', args: [target, value] };

    case 'device_app_permission_revoke':
      if (!isPackageId(target) || !value) return null;
      return { op: 'pm_revoke', args: [target, value] };

    case 'device_setting_put': {
      // Contract: target = "<namespace>/<key>", value = new value.
      if (!target || !value) return null;
      const idx = target.indexOf('/');
      if (idx <= 0 || idx === target.length - 1) return null;
      const ns = target.slice(0, idx);
      const key = target.slice(idx + 1);
      if (!['system', 'secure', 'global'].includes(ns)) return null;
      if (!/^[A-Za-z0-9_.]+$/.test(key)) return null;
      return { op: 'settings_put', args: [ns, key, value] };
    }

    case 'device_app_force_stop':
      if (!isPackageId(target)) return null;
      return { op: 'force_stop', args: [target] };

    case 'device_app_set_state':
      if (!isPackageId(target)) return null;
      if (value !== 'enabled' && value !== 'disabled') return null;
      return { op: 'set_enabled', args: [target, value] };

    case 'device_app_clear_data':
      if (!isPackageId(target)) return null;
      return { op: 'clear_data', args: [target] };

    case 'device_app_install':
      if (!target || !target.endsWith('.apk')) return null;
      return { op: 'install', args: [target] };

    case 'device_app_uninstall':
      if (!isPackageId(target)) return null;
      return { op: 'uninstall', args: [target] };

    default:
      return null;
  }
}

/**
 * Parses the native service result ("<exit code>\n<output>"). Returns null
 * when the result does not follow the contract (never guessed at).
 */
export function parseOpResult(raw: string): { exitCode: number; output: string } | null {
  const match = /^exit=(-?\d+)\n?([\s\S]*)$/.exec(raw ?? '');
  if (!match) return null;
  return { exitCode: parseInt(match[1], 10), output: match[2].trim() };
}
