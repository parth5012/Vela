/**
 * WF-583: pure helpers for the recording UI (elapsed clock + waveform bars).
 * No native dependency and no animation side effects — deterministic output
 * so the recording bar stays testable.
 */

/** Hard cap for a single push-to-talk recording. */
export const MAX_RECORDING_MS = 60_000;

/** Format elapsed milliseconds as `mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A bounded (0.15–1), deterministic pseudo-waveform derived from time. The
 * native SpeechRecognizer does not stream amplitude on Android, so the bar is
 * a live, time-driven visualisation rather than real level metering.
 */
export function buildWaveformLevels(elapsedMs: number, count = 24): number[] {
  const safeCount = Math.max(0, Math.floor(count));
  return Array.from({ length: safeCount }, (_, i) => {
    const phase = i * 0.7 + elapsedMs / 180;
    return 0.15 + 0.85 * Math.abs(Math.sin(phase));
  });
}
