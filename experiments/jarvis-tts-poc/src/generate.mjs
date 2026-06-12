// JARVIS voice POC — best free, no-GPU, Thai+English.
// Pipeline: text -> msedge-tts (neural, SSML pitch/rate) -> ffmpeg FX (warm EQ + room reverb + compress + loudnorm) -> wav
// Out-of-scope experiment. NOT wired into backend.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");

// JARVIS-style mixed Thai+English assistant line (tech loanwords / ทับศัพท์).
const TEXT =
  "สวัสดีครับ ผมคือ JARVIS ระบบผู้ช่วยส่วนตัวของคุณ. " +
  "ตอนนี้คุณมีสาม meeting ใน calendar วันนี้ และมี reminder ค้างอยู่สองรายการ. " +
  "ต้องการให้ผม sync ข้อมูลกับ Google Calendar เลยไหมครับ?";

// Candidate voices. Multilingual = one consistent character speaking Thai+English.
const VOICES = [
  { id: "niwat", name: "th-TH-NiwatNeural", note: "Native Thai male (baseline)" },
  { id: "andrew", name: "en-US-AndrewMultilingualNeural", note: "Deep warm US male — closest JARVIS timbre" },
  { id: "brian", name: "en-US-BrianMultilingualNeural", note: "Casual US male" },
  { id: "william", name: "en-AU-WilliamMultilingualNeural", note: "Australian male" },
];

// SSML prosody tuning -> lower, calmer, more authoritative.
const PROSODY = { pitch: "-8%", rate: "-6%", volume: "+0%" };

// ffmpeg JARVIS FX chain: high-pass, low warmth boost, tame highs, compress, subtle room, normalize.
const FX =
  "highpass=f=70," +
  "equalizer=f=120:width_type=o:width=1.5:g=4," +
  "equalizer=f=300:width_type=o:width=1:g=2," +
  "equalizer=f=5500:width_type=o:width=1.5:g=-3," +
  "acompressor=threshold=-18dB:ratio=3:attack=15:release=200," +
  "aecho=0.85:0.82:55:0.18," +
  "loudnorm=I=-16:TP=-1.5:LRA=11";

function ttsOnce(voiceName, text) {
  return new Promise(async (resolve, reject) => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text, PROSODY);
      const chunks = [];
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.on("end", () => resolve(Buffer.concat(chunks)));
      audioStream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

// Edge websocket occasionally returns an empty stream; retry until we get real audio.
async function ttsToBuffer(voiceName, text) {
  let last;
  for (let i = 1; i <= 4; i++) {
    try {
      const b = await ttsOnce(voiceName, text);
      if (b.length > 1000) return b;
      last = new Error(`empty stream (${b.length} bytes)`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function applyFx(inFile, outFile) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", inFile, "-af", FX, "-ar", "24000", "-ac", "1", outFile];
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg exit " + code + "\n" + err.slice(-600)))));
    p.on("error", reject);
  });
}

await mkdir(OUT, { recursive: true });
console.log("ffmpeg:", ffmpegPath, "\n");

for (const v of VOICES) {
  process.stdout.write(`[${v.id}] ${v.name} — ${v.note}\n`);
  try {
    const mp3 = await ttsToBuffer(v.name, TEXT);
    const rawFile = join(OUT, `${v.id}_raw.mp3`);
    const fxFile = join(OUT, `${v.id}_jarvis.wav`);
    await writeFile(rawFile, mp3);
    await applyFx(rawFile, fxFile);
    console.log(`   raw   -> ${rawFile}`);
    console.log(`   jarvis-> ${fxFile}\n`);
  } catch (e) {
    console.error(`   FAILED: ${e.message}\n`);
  }
}

console.log("Done. Compare *_raw.mp3 (dry) vs *_jarvis.wav (FX). Play from out/.");
