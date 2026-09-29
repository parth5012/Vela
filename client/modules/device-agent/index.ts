import { requireNativeModule } from 'expo-modules-core';

// Require autolinked Native Module "DeviceAgentModule" Expo autolinking configs
// Guard mirrors modules/needle/index.ts: absent on Jest / Node / web.
let nativeModule: any = null;
try {
  nativeModule = requireNativeModule('DeviceAgentModule');
} catch {
  // Native module not available in this environment
}

export default nativeModule;
