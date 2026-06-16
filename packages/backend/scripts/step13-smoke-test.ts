/**
 * Phase 13.1 + 13.2 smoke test.
 * - Real Edge endpoint never called (StubTtsSynthesizer only).
 * - Real audio never played (StubAudioPlayer only).
 */

// Set env before any imports so config picks it up.
process.env.CLAUDE_AGENT_DB_PATH = ":memory:";
process.env.CLAUDE_AGENT_TTS_ENABLED = "0"; // default: off
// Short nag timings so tests don't have to wait.
process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS = "0";  // any pending approval qualifies
process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS = "1"; // 1 ms — re-nag after 1 ms advance

import { buildServer } from "../src/server.js";
import { initDb } from "../src/db/init.js";
import { StubTtsSynthesizer } from "../src/services/tts.js";
import { StubAudioPlayer } from "../src/services/audioPlayer.js";
import { reminderDueLine, eventSoonLine, approvalNagLine } from "../src/services/voiceLines.js";
import { runSchedulerTick, createNagState } from "../src/services/scheduler.js";
import { StubDesktopNotifier } from "../src/services/desktopNotifier.js";
import { createReminder } from "../src/db/repositories/reminderRepo.js";
import {
  createApproval,
  listPendingApprovals,
  setApprovalStatus,
} from "../src/db/repositories/approvalRepo.js";
import { TTS_APPROVAL_NAG_INTERVAL_MS } from "../src/config.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
initDb();
const stubNull = new StubTtsSynthesizer(null);
const stubBuf = new StubTtsSynthesizer(Buffer.from("RIFFstubWAVEdata"));

const appDisabled = buildServer({ ttsSynthesizer: stubNull });
const appEnabled = buildServer({ ttsSynthesizer: stubBuf });
await appDisabled.ready();
await appEnabled.ready();

console.log("\nStep 13.1 — TTS smoke tests\n");

// ------------------------------------------------------------------
// 1. Route disabled → 204 (synthesizer returns null)
// ------------------------------------------------------------------
{
  const res = await appDisabled.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "Hello JARVIS" }),
  });
  assert(res.statusCode === 204, "disabled → 204 No Content");
  assert(res.body === "", "disabled → empty body");
  assert(stubNull.calls.length === 1, "disabled → synthesizer was called once");
}

// ------------------------------------------------------------------
// 2. Route enabled → 200 audio/wav
// ------------------------------------------------------------------
{
  const res = await appEnabled.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "Hello JARVIS" }),
  });
  assert(res.statusCode === 200, "enabled → 200 OK");
  assert(
    (res.headers["content-type"] as string)?.includes("audio/wav"),
    "enabled → content-type audio/wav",
  );
  assert(
    Buffer.from(res.rawPayload).toString() === "RIFFstubWAVEdata",
    "enabled → body matches stub wav bytes",
  );
  assert(stubBuf.calls.length === 1, "enabled → synthesizer called once");
  assert(stubBuf.calls[0].text === "Hello JARVIS", "enabled → correct text forwarded");
}

// ------------------------------------------------------------------
// 3. Bad body → 400
// ------------------------------------------------------------------
{
  const res = await appEnabled.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "" }),
  });
  assert(res.statusCode === 400, "empty text → 400");
}

{
  const res = await appEnabled.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({}),
  });
  assert(res.statusCode === 400, "missing text → 400");
}

// ------------------------------------------------------------------
// 4. Preset forwarded
// ------------------------------------------------------------------
{
  const stubPreset = new StubTtsSynthesizer(Buffer.from("wav"));
  const appPreset = buildServer({ ttsSynthesizer: stubPreset });
  await appPreset.ready();
  await appPreset.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "test", preset: "intimate" }),
  });
  assert(stubPreset.calls[0]?.preset === "intimate", "preset forwarded to synthesizer");
}

{
  const stubPreset = new StubTtsSynthesizer(Buffer.from("wav"));
  const appPreset = buildServer({ ttsSynthesizer: stubPreset });
  await appPreset.ready();
  await appPreset.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "test", preset: "calm_female" }),
  });
  assert(
    stubPreset.calls[0]?.preset === "calm_female",
    "calm_female preset forwarded to synthesizer",
  );
}

// ------------------------------------------------------------------
// 5. Invalid preset → 400
// ------------------------------------------------------------------
{
  const res = await appEnabled.inject({
    method: "POST",
    url: "/api/tts",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ text: "test", preset: "invalid_preset" }),
  });
  assert(res.statusCode === 400, "invalid preset → 400");
}

// ------------------------------------------------------------------
// 13.2 — voiceLines unit tests
// ------------------------------------------------------------------
console.log("\nStep 13.2 — voiceLines + scheduler voice\n");

{
  const line = reminderDueLine("Daily standup");
  assert(line.includes("Daily standup"), "reminderDueLine contains title");
  assert(line.includes("ค่ะ"), "reminderDueLine is Thai");
}

{
  const line = eventSoonLine("Team meeting", "Room 3");
  assert(line.includes("Team meeting"), "eventSoonLine contains title");
  assert(line.includes("Room 3"), "eventSoonLine contains location");
}

{
  const line = eventSoonLine("Standup");
  assert(line.includes("Standup"), "eventSoonLine no-location contains title");
  assert(!line.includes("ที่"), "eventSoonLine no-location omits location marker");
}

{
  const line = approvalNagLine(3);
  assert(line.includes("3"), "approvalNagLine contains count");
  assert(line.includes("ค่ะ"), "approvalNagLine is Thai");
}

// ------------------------------------------------------------------
// 13.2 — scheduler speaks newly-due reminder (dedup: only once)
// ------------------------------------------------------------------
{
  const synth = new StubTtsSynthesizer(Buffer.from("RIFFstubWAVE"));
  const player = new StubAudioPlayer();
  const notifier = new StubDesktopNotifier();
  const voice = { synthesizer: synth, player };

  // Seed an overdue reminder (due 1 hour ago).
  const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  createReminder({ title: "Test reminder", due_at: pastIso });

  const now = new Date();

  // First tick — should synth + play (net-new notification insert).
  runSchedulerTick(now, notifier, voice);

  // Give the fire-and-forget speakLine microtask a chance to run.
  await new Promise<void>((r) => setTimeout(r, 50));

  assert(synth.calls.length === 1, "scheduler: synthesizer called once for new due reminder");
  assert(
    synth.calls[0].text.includes("Test reminder"),
    "scheduler: synthesized text contains reminder title",
  );

  // Second tick — DB dedup prevents re-insert; no new voice call.
  runSchedulerTick(now, notifier, voice);
  await new Promise<void>((r) => setTimeout(r, 50));

  assert(synth.calls.length === 1, "scheduler: no duplicate voice call on second tick (dedup)");
}

// ------------------------------------------------------------------
// 13.3 — approval nag timing (uses injected stubs; real audio never played)
//
// Tick times are derived from the imported config value so the test is
// correct whether or not the env override is picked up by the module cache.
//   tFirst  = t0                              → first nag (lastNagAt undefined)
//   tMid    = t0 + floor(interval / 2)        → before threshold: no re-nag
//   tRenag  = t0 + interval + 1               → past threshold: re-nag
// ------------------------------------------------------------------
console.log("\nStep 13.3 — approval nag\n");

{
  const created = createApproval("task.create", { title: "Nag smoke task" });

  const nagSynth = new StubTtsSynthesizer(Buffer.from("RIFFnag"));
  const nagPlayer = new StubAudioPlayer();
  const nagVoice = { synthesizer: nagSynth, player: nagPlayer };
  const nagNotifier = new StubDesktopNotifier();
  const nag = createNagState();

  const t0 = new Date();
  const tMid = new Date(t0.getTime() + Math.floor(TTS_APPROVAL_NAG_INTERVAL_MS / 2));
  const tRenag = new Date(t0.getTime() + TTS_APPROVAL_NAG_INTERVAL_MS + 1);

  // First tick: lastNagAt undefined → should nag.
  runSchedulerTick(t0, nagNotifier, nagVoice, nag);
  await new Promise<void>((r) => setTimeout(r, 50));
  assert(nagSynth.calls.length === 1, "nag: first tick speaks once");
  assert(nagSynth.calls[0].text.includes("1"), "nag: spoken text mentions count");

  // Mid-interval tick: interval not elapsed → should NOT re-nag.
  runSchedulerTick(tMid, nagNotifier, nagVoice, nag);
  await new Promise<void>((r) => setTimeout(r, 50));
  assert(nagSynth.calls.length === 1, "nag: mid-interval tick does not re-nag");

  // Post-interval tick: interval elapsed → should nag again.
  runSchedulerTick(tRenag, nagNotifier, nagVoice, nag);
  await new Promise<void>((r) => setTimeout(r, 50));
  assert(nagSynth.calls.length === 2, "nag: post-interval tick re-nags");

  // --- Cleanup test: approve the pending approval then tick ---
  // Approve ALL pending approvals so no stale state from earlier tests interferes.
  for (const a of listPendingApprovals()) {
    setApprovalStatus(a.id, "approved");
  }

  const nagSynth2 = new StubTtsSynthesizer(Buffer.from("RIFFnag2"));
  const nagVoice2 = { synthesizer: nagSynth2, player: new StubAudioPlayer() };
  const nag2 = createNagState();

  runSchedulerTick(new Date(), new StubDesktopNotifier(), nagVoice2, nag2);
  await new Promise<void>((r) => setTimeout(r, 50));
  assert(nagSynth2.calls.length === 0, "nag: stops after approval actioned");
  assert(nag2.lastNagAtMs.size === 0, "nag: lastNagAtMs clean after no due approvals");

  // Suppress unused-var warning from TypeScript.
  void created;
}

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
