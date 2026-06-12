/**
 * Phase 13.1 smoke test.
 * - Real Edge endpoint never called (StubTtsSynthesizer only).
 * - Real audio never played.
 */

// Set env before any imports so config picks it up.
process.env.CLAUDE_AGENT_DB_PATH = ":memory:";
process.env.CLAUDE_AGENT_TTS_ENABLED = "0"; // default: off

import { buildServer } from "../src/server.js";
import { initDb } from "../src/db/init.js";
import { StubTtsSynthesizer } from "../src/services/tts.js";

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
// Summary
// ------------------------------------------------------------------
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
