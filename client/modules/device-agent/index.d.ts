interface DeviceAgentNative {
  getScreenTree(): Promise<string>;
  performAction(action: string, target: string, value: string, ref: string): Promise<boolean>;
  getDeviceInfo(): Promise<Record<string, any>>;
  takeScreenshot(): Promise<string>;
}

declare const _default: DeviceAgentNative;
export default _default;
