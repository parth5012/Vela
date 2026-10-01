import type { ShizukuStatus } from '../../utils/shizuku';

interface DeviceAgentNative {
  getScreenTree(): Promise<string>;
  performAction(action: string, target: string, value: string, ref: string): Promise<boolean>;
  getDeviceInfo(): Promise<Record<string, any>>;
  takeScreenshot(): Promise<string>;
  /** Reads Shizuku availability: manager installed, server running, permission granted. */
  getShizukuStatus(): Promise<ShizukuStatus>;
  /**
   * Opens the Shizuku permission dialog for Vela. Resolves with what happened:
   * 'granted' | 'denied' | 'timeout' | 'already_granted' | 'server_stopped' | 'failed: ...'
   */
  requestShizukuPermission(): Promise<string>;
  /**
   * Executes ONE allowlisted privileged operation inside the Shizuku user
   * service (shell/root uid). Returns "<exit code>\n<output>". Throws when
   * Shizuku is not ready or the op is not on the allowlist.
   */
  runPrivilegedOp(op: string, args: string[]): Promise<string>;
}

declare const _default: DeviceAgentNative;
export default _default;
