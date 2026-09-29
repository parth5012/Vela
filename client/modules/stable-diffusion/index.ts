import { requireNativeModule } from 'expo-modules-core';

// This will require the autolinked Native Module "StableDiffusionModule" from Expo autolinking configs
// Guard mirrors modules/needle/index.ts: absent on Jest / Node / web.
let nativeModule: any = null;
try {
  nativeModule = requireNativeModule('StableDiffusionModule');
} catch {
  // Native module not available in this environment
}

export default nativeModule;
