/**
 * WF-583: contract checks that the native voice bridge and app config are
 * wired for push-to-talk. These are source-level assertions: native Kotlin
 * cannot be compiled in the JS test environment.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('WF-583 native voice bridge contract', () => {
  it('declares RECORD_AUDIO in the app android permissions', () => {
    const config = read('../app.config.js');
    expect(config).toMatch(/RECORD_AUDIO/);
  });

  it('declares every speech-recognition method on the DeviceAgentNative interface', () => {
    const dts = read('../modules/device-agent/index.d.ts');
    for (const method of [
      'isSpeechRecognitionAvailable',
      'startSpeechRecognition',
      'stopSpeechRecognition',
      'cancelSpeechRecognition',
      'requestMicrophonePermission',
      'addSpeechPartialListener',
      'removeSpeechPartialListener',
    ]) {
      expect(dts).toContain(method);
    }
  });

  it('implements the SpeechRecognizer bridge with offline preference in Kotlin', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    expect(kt).toContain('SpeechRecognizer');
    expect(kt).toContain('EXTRA_PREFER_OFFLINE');
    expect(kt).toContain('RECORD_AUDIO');
    expect(kt).toContain('startSpeechRecognition');
    expect(kt).toContain('stopSpeechRecognition');
  });

  it('captures audio with MediaRecorder, not the input-only EXTRA_AUDIO_SOURCE', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    expect(kt).toContain('MediaRecorder');
    expect(kt).toContain('setAudioSource(MediaRecorder.AudioSource.MIC)');
    // minSdk is 24: MediaRecorder(Context) is API 26+, so the no-arg constructor
    // must be used on older devices.
    expect(kt).toContain('VERSION.SDK_INT');
    expect(kt).toContain('MediaRecorder()');
    expect(kt).not.toContain('putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE');
  });

  it('resolves the final transcript from onResults instead of synchronously in stopListening', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    expect(kt).toContain('override fun onResults');
    expect(kt).toContain('resolveSpeechStop()');
    expect(kt).toContain('AsyncFunction("stopSpeechRecognition") { promise: Promise ->');
  });

  it('returns a file:// audio URI usable by React Native multipart uploads', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    expect(kt).toContain('"file://${file.absolutePath}"');
  });

  it('runs SpeechRecognizer / permission functions on the main thread', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    // SpeechRecognizer enforces main-thread calls; Expo AsyncFunctions default
    // to a background modulesQueue.
    expect((kt.match(/runOnQueue\(Queues\.MAIN\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('finalizes recorder + recognizer even when no stop promise is pending', () => {
    const kt = read('../modules/device-agent/android/src/main/java/com/vela/client/deviceagent/DeviceAgentModule.kt');
    expect(kt).toContain('finalizeSpeechStop()');
    expect(kt).toContain('if (promise != null) resolveWithCurrent(promise)');
  });
});
