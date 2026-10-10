import type { ShizukuStatus } from '../../utils/shizuku';

interface DeviceAgentNative {
  getScreenTree(): Promise<string>;
  performAction(action: string, target: string, value: string, ref: string): Promise<boolean>;
  getDeviceInfo(): Promise<Record<string, any>>;
  takeScreenshot(): Promise<string>;
  makeCall(phoneNumber: string): Promise<{ success: boolean; message?: string; error?: string }>;
  sendSms(phoneNumber: string, message: string): Promise<{ success: boolean; message?: string; error?: string }>;
  searchContacts(query: string): Promise<{ success: boolean; contacts?: Array<{ contactId: string; lookupKey: string; name: string }>; error?: string } | Array<{ contactId: string; lookupKey: string; name: string }>>;
  /** Reads Shizuku availability: manager installed, server running, permission granted. */
  getShizukuStatus(): Promise<ShizukuStatus>;
  /**
   * Opens the Shizuku permission dialog for Vela. Resolves with what happened:
   * 'granted' | 'denied' | 'timeout' | 'already_granted' | 'server_stopped' | 'failed: ...'
   */
  requestShizukuPermission(): Promise<string>;
  /**
   * Executes ONE allowlisted privileged operation inside the Shizuku user
   * service (shell/root uid). Returns "exit=<code>\n<output>": readiness
   * problems come back as exit 125 (a confirmed non-execution), allowlist
   * rejections as 126, start failures as 127, timeouts as 124. Only a
   * RemoteException from the service propagates — the executor reports
   * that as indeterminate.
   */
  runPrivilegedOp(op: string, args: string[]): Promise<string>;
}

declare const _default: DeviceAgentNative;
export default _default;
