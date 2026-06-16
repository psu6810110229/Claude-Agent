/**
 * TTS voice-tuning mockup generator (local artifact tool, NOT a smoke test).
 *
 * Renders the current `calm_female` baseline plus 3 youthful/graceful Premwadee
 * candidate variants to .wav files so the operator can A/B them by ear.
 *
 * Candidates differ from calm_female only in prosody (pitch/rate) + ffmpeg FX.
 * They are deliberately defined HERE, not in tts.ts PRESETS, so warm/intimate/
 * calm_female stay untouched until the operator picks a baseline to promote.
 *
 * This DOES call the real Edge endpoint, so it is not part of `npm run smoke:*`.
 * Run on the host: `npx tsx scripts/tts-voice-mockups.ts`
 *
 * Output: <repo>/tts-mockups/*.wav  (gitignored; local-only artifacts).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";

const VOICE = "th-TH-PremwadeeNeural";

// Long Thai sentence — secretary-style, mixed phrasing + a number + an English
// proper noun, to expose pitch/sibilance/pacing artifacts. UTF-8 source file.
const SAMPLE =
  "สวัสดีค่ะ ดิฉันได้ตรวจสอบตารางงานของคุณเรียบร้อยแล้ว " +
  "วันนี้คุณมีนัดประชุมกับทีม Marketing เวลาบ่ายสองโมงครึ่ง " +
  "และมีอีเมลสำคัญสามฉบับที่รอการตอบกลับ " +
  "ดิฉันแนะนำให้คุณจัดการเรื่องที่ด่วนที่สุดก่อนนะคะ " +
  "หากต้องการให้ช่วยร่างข้อความหรือเลื่อนนัดหมาย บอกได้เลยค่ะ";

// Human-phrasing variant: filler interjections (เอ่อ / อืม) + ellipsis pauses.
// Edge neural voices often render a soft breath/inhale on "..." and on filler
// words, which reads as a real person thinking rather than a TTS readout.
// Used only when the script is run with the `--human` flag.
const SAMPLE_HUMAN =
  "เอ่อ... สวัสดีค่ะ ดิฉัน เอ่อ ตรวจตารางงานให้เรียบร้อยแล้วนะคะ... " +
  "วันนี้ คุณมีนัดประชุมกับทีม Marketing บ่ายสองโมงครึ่งค่ะ... " +
  "อืม แล้วก็ มีอีเมลสำคัญอีกสามฉบับ ที่ยังรอตอบกลับอยู่... " +
  "เอ่อ ดิฉันว่า เราจัดการเรื่องที่ด่วนที่สุดก่อนดีกว่านะคะ... " +
  "ถ้าอยากให้ช่วยร่างข้อความ หรือเลื่อนนัดหมาย เอ่อ บอกได้เลยค่ะ";

// --- FX vocabulary (extends the tts.ts palette toward a younger, sweeter read) ---
const LEAD_SILENCE = "adelay=700:all=1";
const NORM = "loudnorm=I=-16:TP=-1.5:LRA=11";
const COMP_GENTLE = "acompressor=threshold=-18dB:ratio=3:attack=15:release=200";
const COMP_SOFT = "acompressor=threshold=-16dB:ratio=2.5:attack=20:release=250";

const hp = (f: number) => `highpass=f=${f}`;
const eq = (f: number, g: number, w = 1) =>
  `equalizer=f=${f}:width_type=o:width=${w}:g=${g}`;
// Roll off the crisp top so it sounds like a real throat+mouth, not a bright
// studio mic. highShelf attenuates everything above f; lowPass hard-limits the
// very top sparkle that reads as artificial sharpness.
const highShelf = (f: number, g: number) => `highshelf=f=${f}:g=${g}`;
const lowPass = (f: number) => `lowpass=f=${f}`;
// Surgical narrow notch (high-Q) to kill a nasal "duck/quack" resonance without
// touching overall warmth or brightness. q≈4-6 = narrow; only the honk freq dips.
const narrowNotch = (f: number, g: number, q = 5) =>
  `equalizer=f=${f}:width_type=q:width=${q}:g=${g}`;
// Light room reflection for a "polished studio" feel without sounding distant.
const ROOM_TINY = "aecho=0.9:0.85:18:0.05";
// Youth lever: raise pitch AND formants together, then restore duration so the
// calm pace is unchanged. Shifting formants up shrinks the apparent vocal-tract
// size = a younger-sounding speaker (not merely a higher-pitched older one).
// `p` is the lift factor, e.g. 1.06 ≈ +6%. atempo undoes the speed-up.
const formantUp = (p: number) =>
  `asetrate=24000*${p},atempo=${(1 / p).toFixed(4)},aresample=24000`;

interface Variant {
  id: string;
  desc: string;
  pitch: string;
  rate: string;
  fx: string[];
}

const VARIANTS: Variant[] = [
  {
    // Reference: exact current default, so the operator hears the starting point.
    id: "00_calm_female_baseline",
    desc: "Current default. Neutral-calm, slightly lowered — reads a touch mature.",
    pitch: "-3%",
    rate: "-10%",
    fx: [hp(70), eq(160, 2, 1.2), eq(300, 2, 1), eq(5500, -2, 1.5), COMP_GENTLE, NORM],
  },
  {
    id: "01_graceful",
    desc:
      "Balanced refined secretary. Pitch up for youth, near-neutral pace, " +
      "presence lift + de-ess + slight air, tiny room. Polished, graceful.",
    pitch: "+6%",
    rate: "-5%",
    fx: [
      hp(80),
      eq(250, 1.5, 1), // gentle warmth
      eq(2800, 2, 1.4), // clarity/presence
      eq(6800, -3, 1.5), // tame sibilance (de-ess)
      eq(10000, 2, 1.5), // air / freshness
      COMP_GENTLE,
      ROOM_TINY,
      NORM,
    ],
  },
  {
    id: "02_sweet",
    desc:
      "Brightest, sweetest, most youthful (highest pitch, light pace). " +
      "Drier (no room), softer comp. Risk: can tip childish if pitch too high.",
    pitch: "+10%",
    rate: "-3%",
    fx: [
      hp(90),
      eq(300, 1, 1),
      eq(3000, 2.5, 1.3),
      eq(7000, -3.5, 1.5), // stronger de-ess to offset brightness
      eq(10000, 2.5, 1.5),
      COMP_SOFT,
      NORM,
    ],
  },
  {
    id: "03_soft_poised",
    desc:
      "Softest, most composed/unhurried, still young. Lower pitch lift, " +
      "slower pace, more body warmth, a little more room. Calm secretary.",
    pitch: "+4%",
    rate: "-7%",
    fx: [
      hp(75),
      eq(250, 2, 1), // more warmth/body
      eq(2600, 1.5, 1.4),
      eq(6500, -3, 1.5),
      eq(9000, 1.5, 1.5),
      COMP_GENTLE,
      "aecho=0.9:0.85:22:0.07",
      NORM,
    ],
  },
  {
    // Direct answer to "baseline is calm but too old": KEEP baseline's calm
    // slow pace (rate -9%), just flip pitch positive so the timbre reads young.
    id: "04_calm_young",
    desc:
      "Baseline calm pace, young pitch. Same unhurried feel as 00 but lifted " +
      "pitch + gentle air removes the mature/old tone. Restrained, not bright.",
    pitch: "+6%",
    rate: "-9%",
    fx: [
      hp(80),
      eq(240, 1.5, 1), // light warmth (don't overdo — warmth adds maturity)
      eq(2700, 1.5, 1.4), // modest clarity
      eq(6800, -3, 1.5), // de-ess
      eq(9500, 1.5, 1.5), // subtle air → freshness
      COMP_GENTLE,
      ROOM_TINY,
      NORM,
    ],
  },
  {
    // Target ~18-20: keep 04's calm pace, add a formant lift so the timbre
    // itself reads young, with only a moderate Edge pitch bump (formant does the
    // age work, so pitch stays calm-friendly and avoids the childish squeak).
    id: "06_young18",
    desc:
      "Calm pace + formant lift (+5%) for a genuinely younger ~18-20 timbre. " +
      "Less low warmth (cuts maturity), gentle air. Calm, young, not childish.",
    pitch: "+8%",
    rate: "-9%",
    fx: [
      formantUp(1.05),
      hp(95), // trim chest/body that reads older
      eq(3000, 1.5, 1.3), // light clarity
      eq(7000, -4, 1.5), // firm de-ess (formant lift brightens sibilance)
      eq(11000, 2, 1.5), // youthful air
      COMP_SOFT,
      ROOM_TINY,
      NORM,
    ],
  },
  {
    // Stronger youth: more formant + pitch. Pushes toward 18; calm pace holds
    // it back from sounding childish. The "go younger if 06 not enough" option.
    id: "07_young18_plus",
    desc:
      "More youthful than 06 (formant +8%, higher pitch), calm pace retained. " +
      "Closest to 18. If this tips childish, 06 is the safe younger seat.",
    pitch: "+11%",
    rate: "-9%",
    fx: [
      formantUp(1.08),
      hp(100),
      eq(3100, 1.5, 1.3),
      eq(7000, -4.5, 1.5),
      eq(11500, 2, 1.5),
      COMP_SOFT,
      ROOM_TINY,
      NORM,
    ],
  },
  // --- pitch-only youth ladder (08-10) ---
  // The 06/07 formant trick (asetrate+atempo) made the voice robotic/inhuman.
  // Edge's native pitch shift stays natural, so we youthen purely with higher
  // Edge pitch at the same calm pace, with restrained FX (a touch of warmth
  // keeps body so the higher pitch doesn't thin out). No time-stretch FX.
  {
    id: "08_young_p12",
    desc: "Calm pace, Edge pitch +12%, natural (no formant trick). Younger than 04, still human.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(85), eq(240, 2, 1), eq(2700, 1.5, 1.4), eq(6800, -3, 1.5), eq(9500, 1.5, 1.5), COMP_GENTLE, ROOM_TINY, NORM],
  },
  {
    id: "09_young_p15",
    desc: "Calm pace, Edge pitch +15%. Clearly young; warmth keeps it from thinning. Likely ~18-20.",
    pitch: "+15%",
    rate: "-9%",
    fx: [hp(85), eq(240, 2.5, 1), eq(2800, 1.5, 1.4), eq(6800, -3.5, 1.5), eq(9500, 1.5, 1.5), COMP_GENTLE, ROOM_TINY, NORM],
  },
  {
    id: "10_young_p18",
    desc: "Calm pace, Edge pitch +18%. Youngest natural option; watch for childish tipping.",
    pitch: "+18%",
    rate: "-9%",
    fx: [hp(90), eq(250, 2.5, 1), eq(2900, 1.5, 1.4), eq(7000, -3.5, 1.5), eq(10000, 1.5, 1.5), COMP_GENTLE, ROOM_TINY, NORM],
  },
  // --- baseline v2 (= 08: pitch +12% / rate -9%) softened (11-13) ---
  // Operator picked 08 but it's too sharp/crisp for a real human throat+mouth.
  // Same prosody as 08; remove the air boost and roll off the top progressively.
  {
    id: "11_v2_soft",
    desc: "08 minus air boost, gentle top roll-off (high-shelf -2 @8k, lowpass 10k). Subtle de-crisp.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(85), eq(240, 2, 1), eq(450, 1, 1), eq(2700, 1, 1.4), eq(6800, -3, 1.5), highShelf(8000, -2), lowPass(10000), COMP_GENTLE, ROOM_TINY, NORM],
  },
  {
    id: "12_v2_softer",
    desc: "More mellow: stronger top roll-off (high-shelf -3 @7k, lowpass 8.5k) + a bit more warmth/body.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(85), eq(240, 2.5, 1), eq(450, 1.5, 1), eq(2600, 0.5, 1.4), eq(6500, -3, 1.5), highShelf(7000, -3), lowPass(8500), COMP_GENTLE, ROOM_TINY, NORM],
  },
  {
    id: "13_v2_warm",
    desc: "Warmest/roundest: most top roll-off (high-shelf -3.5 @6.5k, lowpass 8k). Closest to soft real mouth.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  // --- v3: de-duck 13_v2_warm (14-16) ---
  // 13 was liked but sounded "duck/nasal" — caused by lowpass=8k (boxy/tubby) +
  // mid warmth honk. Fix WITHOUT lowering pitch (lower pitch = older): notch the
  // ~1kHz nasal honk and open the lowpass back up, keeping a gentle high-shelf so
  // it still isn't crisp. Pitch stays +12% / rate -9% (same young calm as 13).
  {
    id: "14_v3_deduck",
    desc: "13 de-ducked: notch 1k nasal honk, lowpass opened 8k→9.5k, gentler shelf. Round but not boxy.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(220, 2.5, 1), eq(1000, -2, 1), eq(2700, 1, 1.4), eq(6500, -2.5, 1.5), highShelf(7000, -2.5), lowPass(9500), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    id: "15_v3_deduck_open",
    desc: "More open than 14 (lowpass 11k, shelf -2 @8k, slight clarity). Least duck; still not sharp.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(250, 2, 1), eq(950, -2.5, 1), eq(3000, 1.2, 1.3), eq(7000, -3, 1.5), highShelf(8000, -2), lowPass(11000), COMP_GENTLE, ROOM_TINY, NORM],
  },
  {
    id: "16_v3_round",
    desc: "Keeps 13's roundness but strong de-honk (notch 950 -3). Warm, de-ducked, darkest of the three.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(240, 3, 1), eq(950, -3, 1), eq(2500, 0.8, 1.4), eq(6500, -2.5, 1.5), highShelf(6800, -3), lowPass(9000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  // --- v4: keep 13's warmth, surgically de-nasal the duck (17-19) ---
  // Feedback: 14-16 opened the top and lost 13's warmth = thin/sharp. The "duck"
  // is a narrow nasal resonance, NOT tubbiness. So these are 13 byte-for-byte
  // (same warmth, dark top, lowpass 8k) + ONE surgical high-Q notch at the nasal
  // band, swept across 3 frequencies to find the one that kills the quack.
  {
    id: "17_v4_warm_denasal1000",
    desc: "13's exact warmth + surgical notch @1000Hz (-5, narrow). Warm like 13, honk removed.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(1000, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    id: "18_v4_warm_denasal850",
    desc: "Same as 17 but notch lower @850Hz (-5). Try if the duck sits below 1k.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(850, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    id: "19_v4_warm_denasal1200",
    desc: "Same as 17 but notch higher @1200Hz (-5). Try if the duck sits above 1k.",
    pitch: "+12%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(1200, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  // --- v5: 18_v4_warm_denasal850 aged up to ~23-24 (20-22) ---
  // 18 (~18-20) was the pick. To read ~23-24 without sounding "ป้า"/old, lower
  // ONLY the Edge pitch a little from +12%; everything else (warmth, denasal
  // notch @850, dark top, lowpass 8k, calm rate -9%) is 18 byte-for-byte.
  // Ladder down so we can stop before it tips matronly.
  {
    id: "20_v5_age23_p9",
    desc: "18 with pitch +9% (was +12%). Slightly more mature ~22-23. Closest to 18.",
    pitch: "+9%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(850, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    id: "21_v5_age24_p7",
    desc: "Pitch +7%. Target ~23-24, composed adult. Watch the lower edge for matronly.",
    pitch: "+7%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(850, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    id: "22_v5_age24_p5",
    desc: "Pitch +5%. Most mature of the three (~24). Floor before 'ป้า' risk.",
    pitch: "+5%",
    rate: "-9%",
    fx: [hp(80), eq(230, 3, 1), eq(450, 2, 1), narrowNotch(850, -5, 5), eq(2500, 0.5, 1.4), eq(6500, -2.5, 1.5), highShelf(6500, -3.5), lowPass(8000), COMP_GENTLE, "aecho=0.9:0.85:22:0.06", NORM],
  },
  {
    // Same calm pace, a touch more youthful lift than 04 without going childish.
    id: "05_calm_young_bright",
    desc:
      "Baseline calm pace, slightly more youthful than 04 (higher pitch + a " +
      "bit more air). Calm but distinctly young. Watch for childish tipping.",
    pitch: "+9%",
    rate: "-9%",
    fx: [
      hp(85),
      eq(260, 1, 1),
      eq(2900, 2, 1.3),
      eq(7000, -3.5, 1.5), // stronger de-ess offsets the brightness
      eq(10000, 2, 1.5),
      COMP_SOFT,
      ROOM_TINY,
      NORM,
    ],
  },
];

// Mirror tts.ts withNaturalPauses: comma at Thai phrase boundaries for breaths.
function withNaturalPauses(text: string): string {
  return text.replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, "$1, ");
}

// The free Edge endpoint intermittently returns an empty stream when hit too
// fast. Retry with backoff (mirrors tts.ts ttsToBuffer) so a flaky render
// recovers instead of leaving a missing candidate.
async function ttsWithRetry(text: string, pitch: string, rate: string): Promise<Buffer> {
  const backoffMs = [0, 600, 1500, 3000];
  let last = new Error("no attempt");
  for (const ms of backoffMs) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    try {
      const b = await ttsOnce(text, pitch, rate);
      if (b.length > 1000) return b;
      last = new Error(`empty Edge stream (${b.length} bytes)`);
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw last;
}

function ttsOnce(text: string, pitch: string, rate: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text, { pitch, rate, volume: "+0%" });
        const chunks: Buffer[] = [];
        audioStream.on("data", (c: Buffer) => chunks.push(c));
        audioStream.on("end", () => resolve(Buffer.concat(chunks)));
        audioStream.on("error", reject);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

function applyFx(inFile: string, outFile: string, fx: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", inFile, "-af", fx.join(","), "-ar", "24000", "-ac", "1", outFile];
    const p = spawn(ffmpegPath as string, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let err = "";
    (p.stderr as NodeJS.ReadableStream).on("data", (d: Buffer) => (err += d.toString()));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}\n${err.slice(-400)}`))));
    p.on("error", reject);
  });
}

// --- single human-dynamic demo (preset 20: pitch +9% / rate -9% / 18's FX) ---
// Edge `rate` is one value per call, so true within-utterance tempo dynamics are
// impossible in a single synth. We instead synth the line as SEGMENTS, each at
// its own rate (slow on fillers/emphasis, faster on rattled-off detail), insert
// real silence between them as pauses/breath beats, concat, then apply preset
// 20's FX once. Result: pauses + เอ่อ/อืม + breaths + non-uniform fast/slow pace.
type DemoItem = { speak: string; rate: string } | { pauseMs: number };

// Only 3 synth chunks (Edge throttles ~empty after 3-4 rapid calls, which is
// why a 14-call version stalled). Tempo dynamics come from a DIFFERENT rate per
// chunk (calm intro → quicker detail → calm close); pauses/breaths/fillers come
// from ellipsis "…" and เอ่อ/อืม inside each chunk's text, plus real silence
// between chunks. Fewer calls = reliable, still human and non-uniform.
const DEMO_SCRIPT: DemoItem[] = [
  // Calm, unhurried opener with hesitation + a breath beat.
  { speak: "เอ่อ... สวัสดีค่ะ... ดิฉันเช็กตารางงานให้เรียบร้อยแล้วนะคะ", rate: "-7%" },
  { pauseMs: 480 }, // breath
  // Quicker, brighter delivery of the actual details (the "เร่งไว" stretch).
  { speak: "วันนี้คุณมีนัดประชุมกับทีม Marketing ตอนบ่ายสองโมงครึ่งค่ะ อืม... แล้วก็ยังมีอีเมลสำคัญอีกสามฉบับ ที่รอตอบกลับอยู่", rate: "+6%" },
  { pauseMs: 520 }, // breath
  // Back to calm, thoughtful advice + soft close (the "ช้า" stretch).
  { speak: "เอ่อ ดิฉันว่า... เราเคลียร์เรื่องที่ด่วนที่สุดก่อนดีกว่านะคะ... ถ้าต้องการให้ช่วยร่างข้อความ หรือเลื่อนนัดหมาย เอ่อ บอกได้เลยค่ะ", rate: "-7%" },
];

function makeSilence(outFile: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y", "-f", "lavfi",
      "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
      "-t", (ms / 1000).toFixed(3),
      "-c:a", "libmp3lame", "-b:a", "96k",
      outFile,
    ];
    const p = spawn(ffmpegPath as string, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    (p.stderr as NodeJS.ReadableStream).on("data", (d: Buffer) => (err += d.toString()));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`silence ffmpeg exit ${c}\n${err.slice(-300)}`))));
    p.on("error", reject);
  });
}

function concatMp3(listFile: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Re-encode (no -c copy) so minor per-segment header diffs don't break concat.
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-b:a", "96k", outFile];
    const p = spawn(ffmpegPath as string, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    (p.stderr as NodeJS.ReadableStream).on("data", (d: Buffer) => (err += d.toString()));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`concat ffmpeg exit ${c}\n${err.slice(-300)}`))));
    p.on("error", reject);
  });
}

async function buildDemo(outDir: string): Promise<void> {
  const preset20 = VARIANTS.find((v) => v.id === "20_v5_age23_p9");
  if (!preset20) throw new Error("preset 20 not found");

  // The free Edge endpoint is currently IP-throttling us after ~2 calls (the
  // "first works, second silent" symptom, worse the more we hit it). Multi-call
  // segment synthesis is therefore unreliable, so we make ONE call: join the
  // chunk texts with ellipsis (Edge renders "…" as pauses/breaths) and let the
  // fillers (เอ่อ/อืม) + punctuation carry the human feel. Tempo dynamics then
  // come from POST atempo on the rendered audio (pitch-preserving, no formant
  // artifact): slow the calm opener/close, keep the detail middle natural.
  const text = DEMO_SCRIPT.filter((d): d is { speak: string; rate: string } => "speak" in d)
    .map((d) => d.speak)
    .join(" ... ");

  console.log(`\nVoice: ${VOICE}  (preset 20: pitch +9%, single reliable call)`);
  console.log("Building human demo (single Edge call + post tempo shaping)...\n");

  const tmp = path.join(os.tmpdir(), `demo-${randomUUID()}.mp3`);
  const mp3 = await ttsWithRetry(withNaturalPauses(text), preset20.pitch, "-6%");
  await writeFile(tmp, mp3);

  // Gentle global slow-down via atempo (0.94 ≈ -6% more), layered on the calm
  // -6% Edge rate, for an unhurried overall pace. atempo preserves pitch, so no
  // chipmunk/robot artifact (unlike the asetrate formant trick we dropped).
  const out = path.join(outDir, "demo_age23_human.wav");
  await applyFx(tmp, out, [LEAD_SILENCE, "atempo=0.94", ...preset20.fx]);
  console.log(`OK  ${path.basename(out)}`);
  await unlink(tmp).catch(() => {});
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "../../../tts-mockups");
  await mkdir(outDir, { recursive: true });

  if (process.argv.slice(2).includes("--demo")) {
    await buildDemo(outDir);
    console.log(`\nOutput dir: ${outDir}\n`);
    return;
  }

  // Flags: `--human` uses the disfluent SAMPLE_HUMAN and tags output `_h`.
  // Remaining args are id substring filters: `tsx ...mockups.ts 14 15 --human`.
  const args = process.argv.slice(2);
  const useHuman = args.includes("--human");
  const filters = args.filter((a) => !a.startsWith("--"));
  const todo = filters.length
    ? VARIANTS.filter((v) => filters.some((f) => v.id.includes(f)))
    : VARIANTS;

  const spoken = withNaturalPauses(useHuman ? SAMPLE_HUMAN : SAMPLE);
  console.log(`\nVoice: ${VOICE}`);
  console.log(`Sample: ${useHuman ? "human (filler + breaths)" : "standard"}`);
  console.log(`Output dir: ${outDir}\n`);

  for (const v of todo) {
    const tmp = path.join(os.tmpdir(), `mock-${randomUUID()}.mp3`);
    const out = path.join(outDir, `${v.id}${useHuman ? "_h" : ""}.wav`);
    try {
      const mp3 = await ttsWithRetry(spoken, v.pitch, v.rate);
      await writeFile(tmp, mp3);
      await applyFx(tmp, out, [LEAD_SILENCE, ...v.fx]);
      console.log(`OK  ${path.basename(out)}  pitch=${v.pitch} rate=${v.rate}`);
    } catch (e) {
      console.error(`FAIL ${v.id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await unlink(tmp).catch(() => {});
    }
    // Space out Edge calls — endpoint goes empty if hit too fast.
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log("\nDone. Listen and pick a baseline.\n");
}

void main();
