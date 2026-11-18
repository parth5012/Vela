import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

// Require autolinked Native Module "DeviceAgentModule" Expo autolinking configs
// Guard mirrors modules/needle/index.ts: absent on Jest / Node / web.
let nativeModule: any = null;
try {
  nativeModule = requireNativeModule('DeviceAgentModule');
} catch {
  // Native module not available in this environment
}

// WF-583: SpeechRecognizer partial results arrive as Expo events. Native
// functions cannot take a JS callback, so the subscription helpers live here
// and hand back an id the Transcriber adapter can later release.
const partialSubscriptions = new Map<string, EventSubscription>();
let nextPartialSubId = 1;

function addSpeechPartialListener(cb: (text: string, isFinal: boolean) => void): Promise<string> {
  const addListener = nativeModule?.addListener;
  if (typeof addListener !== 'function') return Promise.resolve('');
  try {
    const sub: EventSubscription = addListener.call(nativeModule, 'onSpeechPartial', (event: { text?: string; isFinal?: boolean }) => {
      cb(event?.text ?? '', Boolean(event?.isFinal));
    });
    const id = `speech-partial-${nextPartialSubId++}`;
    partialSubscriptions.set(id, sub);
    return Promise.resolve(id);
  } catch {
    return Promise.resolve('');
  }
}

function removeSpeechPartialListener(id: string): Promise<void> {
  const sub = partialSubscriptions.get(id);
  if (sub) {
    try {
      sub.remove();
    } catch {
      // Best-effort teardown.
    }
    partialSubscriptions.delete(id);
  }
  return Promise.resolve();
}

const voiceHelpers = { addSpeechPartialListener, removeSpeechPartialListener };

// Mutate in place so every existing consumer of the default export sees the
// same native module object, with the two additive voice helpers attached.
const exported = nativeModule
  ? Object.assign(nativeModule, voiceHelpers)
  : { ...voiceHelpers };

export default exported;
