import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regression: a verified session must SURVIVE a backend restart (dev `tsx watch`
// reload), so a just-unlocked owner is not re-locked on their next message.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-persist-"));
fs.mkdirSync(path.join(TMP, "memory"), { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = path.join(TMP, "memory");
process.env.CLAUDE_AGENT_DB_PATH = path.join(TMP, "test.db");
process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED = "1";
process.env.CLAUDE_AGENT_OWNER_PIN = "1234";
process.env.CLAUDE_AGENT_OWNER_SECRET_PHRASE = "โอเค";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running privacy verified-session persistence smoke...");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { verify, isVerified, clearVerified, __resetForTest } = await import(
    "../src/services/identityVerifier.js"
  );
  initDb();

  const SID = "sess-abcdef12";

  assert(isVerified(SID) === false, "session starts unverified");
  assert(verify(SID, "1234").ok === true, "verify with PIN succeeds");
  assert(isVerified(SID) === true, "session verified after PIN");

  // Simulate a backend restart: wipe in-memory state but KEEP the DB.
  __resetForTest();
  assert(
    isVerified(SID) === true,
    "session STILL verified after restart (hydrated from DB) — the real fix",
  );

  // A reset (logout) clears it and persists the clear.
  clearVerified(SID);
  assert(isVerified(SID) === false, "clearVerified locks the session");
  __resetForTest();
  assert(
    isVerified(SID) === false,
    "cleared session stays locked after restart too",
  );

  closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("\nPRIVACY PERSIST SMOKE OK");
}

main().catch((err: unknown) => {
  console.error("\nPRIVACY PERSIST SMOKE FAILED:", err instanceof Error ? err.message : String(err));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
