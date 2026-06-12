// William-only tuning matrix. Voice: en-AU-WilliamMultilingualNeural (picked as best JARVIS base).
// Generates several variants varying prosody (pitch/rate) + FX flavor so we can ear-pick the best.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
const VOICE = "en-AU-WilliamMultilingualNeural";

const TEXT =
  "สวัสดีครับ ผมคือ JARVIS ระบบผู้ช่วยส่วนตัวของคุณ. " +
  "ตอนนี้คุณมีสาม meeting ใน calendar วันนี้ และมี reminder ค้างอยู่สองรายการ. " +
  "ต้องการให้ผม sync ข้อมูลกับ Google Calendar เลยไหมครับ?";

// Reusable FX blocks.
const HP = "highpass=f=70";
const COMP = "acompressor=threshold=-18dB:ratio=3:attack=15:release=200";
const COMP_TIGHT = "acompressor=threshold=-20dB:ratio=4:attack=8:release=150";
const NORM = "loudnorm=I=-16:TP=-1.5:LRA=11";
const lowBoost = (g) => `equalizer=f=120:width_type=o:width=1.5:g=${g}`;
const body = "equalizer=f=300:width_type=o:width=1:g=2";
const tameHigh = (g) => `equalizer=f=5500:width_type=o:width=1.5:g=${g}`;
const presence = "equalizer=f=3000:width_type=o:width=1:g=2";

// Variant matrix: prosody + ffmpeg -af chain.
const VARIANTS = [
  {
    id: "v1_warm", // current liked baseline
    note: "Warm baseline (current). Balanced.",
    prosody: { pitch: "-8%", rate: "-6%", volume: "+0%" },
    fx: [HP, lowBoost(4), body, tameHigh(-3), COMP, "aecho=0.85:0.82:55:0.18", NORM],
  },
  {
    id: "v2_deep",
    note: "Deeper + slower. More authoritative low end.",
    prosody: { pitch: "-15%", rate: "-9%", volume: "+0%" },
    fx: [HP, lowBoost(6), body, tameHigh(-4), COMP, "aecho=0.85:0.82:55:0.18", NORM],
  },
  {
    id: "v3_clean",
    note: "Clean & clear. Minimal reverb, brighter presence.",
    prosody: { pitch: "-6%", rate: "-4%", volume: "+0%" },
    fx: [HP, lowBoost(3), body, presence, COMP, "aecho=0.9:0.7:30:0.08", NORM],
  },
  {
    id: "v4_cinematic",
    note: "Film JARVIS. Deep + bigger room + tamed highs.",
    prosody: { pitch: "-12%", rate: "-8%", volume: "+0%" },
    fx: [HP, lowBoost(6), body, tameHigh(-3), COMP, "aecho=0.85:0.85:80:0.30", NORM],
  },
  {
    id: "v5_intimate",
    note: "Close-mic, speaking-in-your-ear. Tight compression, tiny room.",
    prosody: { pitch: "-10%", rate: "-6%", volume: "+0%" },
    fx: [HP, lowBoost(5), body, tameHigh(-2), COMP_TIGHT, "aecho=0.9:0.75:25:0.06", NORM],
  },
  {
    id: "v6_hall",
    note: "Spacious hall. Multi-tap reverb, atmospheric.",
    prosody: { pitch: "-11%", rate: "-7%", volume: "+0%" },
    fx: [HP, lowBoost(5), body, tameHigh(-3), COMP, "aecho=0.8:0.85:60|95:0.28|0.16", NORM],
  },
];

function ttsOnce(prosody) {
  return new Promise(async (resolve, reject) => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(TEXT, prosody);
      const chunks = [];
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.on("end", () => resolve(Buffer.concat(chunks)));
      audioStream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function ttsToBuffer(prosody) {
  let last;
  for (let i = 1; i <= 4; i++) {
    try {
      const b = await ttsOnce(prosody);
      if (b.length > 1000) return b;
      last = new Error(`empty stream (${b.length} bytes)`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function applyFx(inFile, outFile, fxChain) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", inFile, "-af", fxChain.join(","), "-ar", "24000", "-ac", "1", outFile];
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg exit " + c + "\n" + err.slice(-500)))));
    p.on("error", reject);
  });
}

await mkdir(OUT, { recursive: true });
console.log(`Voice: ${VOICE}\n`);

for (const v of VARIANTS) {
  process.stdout.write(`[${v.id}] ${v.note}\n`);
  try {
    const mp3 = await ttsToBuffer(v.prosody); // re-synth: prosody differs per variant
    const rawFile = join(OUT, `william_${v.id}_raw.mp3`);
    const fxFile = join(OUT, `william_${v.id}.wav`);
    await writeFile(rawFile, mp3);
    await applyFx(rawFile, fxFile, v.fx);
    console.log(`   -> ${fxFile}\n`);
  } catch (e) {
    console.error(`   FAILED: ${e.message}\n`);
  }
}

console.log("Done. Play out/william_v*.wav and pick the winner.");
