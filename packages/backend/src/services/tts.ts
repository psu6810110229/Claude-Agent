import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";
import { logActivity } from "../db/repositories/activityRepo.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { TTS_ENABLED, TTS_PRESET } from "../config.js";
import type { TtsPreset } from "../schemas/tts.js";

/**
 * Runtime gate for speech synthesis: DB config override (Settings toggle) wins;
 * falls back to the env seed default. Gates both /api/tts and scheduler voice.
 */
export function isTtsEnabled(): boolean {
  const dbValue = getConfigBool("tts_enabled");
  if (dbValue !== null) return dbValue;
  return TTS_ENABLED;
}

const DEFAULT_PRESET: TtsPreset = "calm_female";

// FX building blocks (matching POC output)
// Lead-in silence: browsers/players often clip the first few hundred ms before
// decode settles, swallowing the first 1-3 words. Padding the front guarantees
// real speech never sits at sample 0.
const LEAD_SILENCE = "adelay=700:all=1";
const HP = "highpass=f=70";
const COMP = "acompressor=threshold=-18dB:ratio=3:attack=15:release=200";
const COMP_TIGHT = "acompressor=threshold=-20dB:ratio=4:attack=8:release=150";
const NORM = "loudnorm=I=-16:TP=-1.5:LRA=11";
const lowBoost4 = "equalizer=f=120:width_type=o:width=1.5:g=4";
const lowBoost5 = "equalizer=f=120:width_type=o:width=1.5:g=5";
const body = "equalizer=f=300:width_type=o:width=1:g=2";
const tameHigh3 = "equalizer=f=5500:width_type=o:width=1.5:g=-3";
const tameHigh2 = "equalizer=f=5500:width_type=o:width=1.5:g=-2";

interface PresetConfig {
  voice: string;
  prosody: { pitch: string; rate: string; volume?: string };
  fx: string[];
}

const PRESETS: Record<TtsPreset, PresetConfig> = {
  warm: {
    voice: "en-AU-WilliamMultilingualNeural",
    prosody: { pitch: "-8%", rate: "-12%", volume: "+0%" },
    fx: [HP, lowBoost4, body, tameHigh3, COMP, "aecho=0.85:0.82:55:0.18", NORM],
  },
  intimate: {
    voice: "en-AU-WilliamMultilingualNeural",
    prosody: { pitch: "-10%", rate: "-12%" },
    fx: [HP, lowBoost5, body, tameHigh2, COMP_TIGHT, "aecho=0.9:0.75:25:0.06", NORM],
  },
  // Tuned voice (host A/B session): younger, graceful Thai secretary ~23-24,
  // not matronly. Pitch +9% lifts age out of "mature/old"; warmth (230/450 Hz)
  // + a dark top (high-shelf -3.5 @6.5k, lowpass 8k) keep it soft like a real
  // throat/mouth rather than a crisp mic; the surgical high-Q notch @850 Hz
  // removes the nasal "duck" honk without dulling warmth. Calm pace via rate -9%.
  calm_female: {
    voice: "th-TH-PremwadeeNeural",
    prosody: { pitch: "+9%", rate: "-9%", volume: "+0%" },
    fx: [
      "highpass=f=80",
      "equalizer=f=230:width_type=o:width=1:g=3", // warmth/body
      "equalizer=f=450:width_type=o:width=1:g=2", // lower-mid fill
      "equalizer=f=850:width_type=q:width=5:g=-5", // surgical de-nasal (kill duck honk)
      "equalizer=f=2500:width_type=o:width=1.4:g=0.5", // slight presence
      "equalizer=f=6500:width_type=o:width=1.5:g=-2.5", // tame sibilance
      "highshelf=f=6500:g=-3.5", // roll off crisp top
      "lowpass=f=8000", // soft, mouth-like ceiling
      COMP,
      "aecho=0.9:0.85:22:0.06", // tiny room polish
      NORM,
    ],
  },
};

/**
 * Make speech sound more natural and unhurried via punctuation-driven pauses.
 *
 * NOTE: the public Edge endpoint (via msedge-tts `toStream`) returns an EMPTY
 * stream when the input contains SSML <break> tags, so we cannot use those.
 * Instead we lean on punctuation, which Edge neural voices honour as real,
 * un-spoken pauses. Thai uses spaces as phrase delimiters; inserting a comma
 * at each Thai phrase boundary yields a natural breath pause. English word-
 * spaces are left untouched (a Thai char must sit on both sides). Overall
 * slowness comes from the preset `rate` (see PRESETS), not from here.
 */
function withNaturalPauses(text: string): string {
  return text.replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, "$1, ");
}

export interface TtsSynthesizer {
  /** Returns WAV buffer, or null when disabled/unavailable. Never throws. */
  synthesize(text: string, preset?: TtsPreset): Promise<Buffer | null>;
}

export class StubTtsSynthesizer implements TtsSynthesizer {
  readonly calls: Array<{ text: string; preset: TtsPreset }> = [];
  constructor(private readonly out: Buffer | null = Buffer.from("RIFFstubWAVE")) {}
  async synthesize(text: string, preset: TtsPreset = DEFAULT_PRESET): Promise<Buffer | null> {
    this.calls.push({ text, preset });
    return this.out;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Hard cap on a single Edge synthesis so a hung stream rejects (and retries)
 * instead of leaving the HTTP request to hang forever. */
const TTS_ONCE_TIMEOUT_MS = 8000;

function ttsOnce(
  text: string,
  voice: string,
  prosody: PresetConfig["prosody"],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("tts stream timeout"))),
      TTS_ONCE_TIMEOUT_MS,
    );
    void (async () => {
      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text, prosody);
        const chunks: Buffer[] = [];
        audioStream.on("data", (c: Buffer) => chunks.push(c));
        audioStream.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
        audioStream.on("error", (e: Error) => finish(() => reject(e)));
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    })();
  });
}

async function ttsToBuffer(text: string, config: PresetConfig): Promise<Buffer> {
  let last: Error = new Error("no attempt");
  // The free Edge endpoint intermittently returns an EMPTY stream when hit
  // again too quickly (the "first works, second silent" symptom). Backing off
  // between attempts lets it recover instead of firing 4 instant, equally-empty
  // retries. Delays apply BEFORE attempts 2..5.
  const backoffMs = [0, 250, 600, 1200, 2000];
  for (let i = 0; i < backoffMs.length; i++) {
    if (backoffMs[i] > 0) await sleep(backoffMs[i]);
    try {
      const b = await ttsOnce(text, config.voice, config.prosody);
      if (b.length > 1000) return b;
      last = new Error(`empty stream (${b.length} bytes)`);
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw last;
}

function applyFx(inFile: string, outFile: string, fx: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath as string;
    const args = ["-y", "-i", inFile, "-af", fx.join(","), "-ar", "24000", "-ac", "1", outFile];
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errOut = "";
    (p.stderr as NodeJS.ReadableStream).on("data", (d: Buffer) => { errOut += d.toString(); });
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}\n${errOut.slice(-500)}`)),
    );
    p.on("error", reject);
  });
}

class RealTtsSynthesizer implements TtsSynthesizer {
  async synthesize(text: string, preset?: TtsPreset): Promise<Buffer | null> {
    if (!isTtsEnabled()) return null;

    const resolvedPreset: TtsPreset =
      (preset ?? (PRESETS[TTS_PRESET as TtsPreset] ? (TTS_PRESET as TtsPreset) : DEFAULT_PRESET));
    const config = PRESETS[resolvedPreset];

    const id = randomUUID();
    const mp3Path = path.join(os.tmpdir(), `jarvis-tts-${id}.mp3`);
    const wavPath = path.join(os.tmpdir(), `jarvis-tts-${id}.wav`);

    try {
      const mp3 = await ttsToBuffer(withNaturalPauses(text), config);
      await writeFile(mp3Path, mp3);
      await applyFx(mp3Path, wavPath, [LEAD_SILENCE, ...config.fx]);
      const wav = await readFile(wavPath);
      logActivity("tts.served", `${wav.length} bytes preset=${resolvedPreset}`);
      return wav;
    } catch (e) {
      logActivity("tts.synth_failed", e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      await unlink(mp3Path).catch(() => {});
      await unlink(wavPath).catch(() => {});
    }
  }
}

export const realTtsSynthesizer: TtsSynthesizer = new RealTtsSynthesizer();
