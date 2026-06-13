import { execFile } from "node:child_process";
import { TTS_SPEAKER_ENABLED } from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Runtime gate for backend speaker playback: DB config override (Settings toggle)
 * wins; falls back to the env seed default.
 */
export function isTtsSpeakerEnabled(): boolean {
  const dbValue = getConfigBool("tts_speaker_enabled");
  if (dbValue !== null) return dbValue;
  return TTS_SPEAKER_ENABLED;
}

/**
 * Abstraction for playing a WAV file on the local speaker.
 * Injectable so smoke tests can pass a stub — the real PowerShell call
 * is never reached in tests.
 */
export interface AudioPlayer {
  /** Fire-and-forget; serialized internally so calls don't overlap. */
  play(wavPath: string): void;
}

/** No-op stub: records calls. Used by smoke tests. */
export class StubAudioPlayer implements AudioPlayer {
  readonly calls: string[] = [];
  play(p: string): void {
    this.calls.push(p);
  }
}

/**
 * Windows speaker playback via PowerShell System.Media.SoundPlayer.
 * Gated by TTS_SPEAKER_ENABLED; fails soft on spawn error.
 * Concurrent play() calls are serialized — each waits for the previous
 * child process to close before spawning the next.
 */
class RealAudioPlayer implements AudioPlayer {
  private queue: Promise<void> = Promise.resolve();

  play(wavPath: string): void {
    if (!isTtsSpeakerEnabled()) return;
    // Strip single-quotes so they can't break the PowerShell string literal.
    // Path is backend-generated (os.tmpdir()), but strip defensively.
    const safePath = wavPath.replace(/'/g, "");
    this.queue = this.queue.then(
      () =>
        new Promise<void>((resolve) => {
          execFile(
            "powershell.exe",
            [
              "-NonInteractive",
              "-WindowStyle",
              "Hidden",
              "-Command",
              `(New-Object System.Media.SoundPlayer '${safePath}').PlaySync()`,
            ],
            { timeout: 30_000, windowsHide: true },
            (err) => {
              if (err) {
                try {
                  logActivity("tts.play_failed", err.message);
                } catch {
                  // best-effort
                }
              }
              resolve();
            },
          );
        }),
    );
  }
}

export const realAudioPlayer: AudioPlayer = new RealAudioPlayer();
