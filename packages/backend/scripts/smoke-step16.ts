import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Step 16 (real memory: fact store + auto-capture + recall) smoke. Temp DB +
// memory dir, AUTO_EXECUTE ON, Google disabled. No network, no real Claude.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step16-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = "1";
// Even the destructive-auto toggle ON must NOT let fact.update/forget run.
process.env.CLAUDE_AGENT_AUTO_EXECUTE_DESTRUCTIVE_ENABLED = "1";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 16 (real memory / facts) smoke...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { dispatchProposedAction, requiresConfirmation } = await import(
    "../src/services/actionDispatcher.js"
  );
  const { recallFacts } = await import("../src/services/factRecall.js");
  const { listActiveFacts, getFact } = await import(
    "../src/db/repositories/factRepo.js"
  );
  const { buildChatContext } = await import("../src/services/chat.js");

  initDb();

  // --- 1. memory_fact table exists ---
  const tables = new Set(
    (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((r) => r.name),
  );
  assert(tables.has("memory_fact"), "memory_fact table exists");

  // --- 2. fact.remember auto-executes when auto-execute is ON ---
  const remembered = await dispatchProposedAction(
    "fact.remember",
    {
      content: "User's name is Fan.",
      keywords: "name fan ฟาน",
      category: "identity",
      pinned: true,
    },
    "smoke",
  );
  assert(remembered.mode === "executed", "fact.remember dispatches as executed");
  assert(
    remembered.approval.status === "approved" &&
      remembered.approval.execution_status === "succeeded",
    "fact.remember approval is approved + succeeded",
  );
  assert(listActiveFacts().length === 1, "exactly one active fact stored");

  // --- 3. fact.update + fact.forget STAY pending even with auto-exec +
  //        destructive toggle ON (the 'replace/forget ยืนยัน' rule) ---
  assert(
    requiresConfirmation("fact.remember", { content: "x" }) === false,
    "fact.remember does not require confirmation",
  );
  assert(
    requiresConfirmation("fact.update", { id: 1, content: "y" }) === true,
    "fact.update requires confirmation (even with destructive toggle on)",
  );
  assert(
    requiresConfirmation("fact.forget", { id: 1 }) === true,
    "fact.forget requires confirmation (even with destructive toggle on)",
  );
  const factId = listActiveFacts()[0].id;
  const updated = await dispatchProposedAction(
    "fact.update",
    { id: factId, content: "User's name is Fan (Patcharapon)." },
    "smoke",
  );
  assert(updated.mode === "pending", "fact.update stays pending (confirm)");
  assert(
    getFact(factId)!.content === "User's name is Fan.",
    "fact NOT edited without confirmation",
  );
  const forgot = await dispatchProposedAction(
    "fact.forget",
    { id: factId },
    "smoke",
  );
  assert(forgot.mode === "pending", "fact.forget stays pending (confirm)");
  assert(listActiveFacts().length === 1, "fact NOT forgotten without confirmation");

  // --- 4. recall: pinned always; keyword match; cap respected ---
  await dispatchProposedAction(
    "fact.remember",
    {
      content: "User studies Computer Engineering.",
      keywords: "study major computer engineering",
      category: "general",
    },
    "smoke",
  );
  const recalledUnrelated = recallFacts("วันนี้อากาศเป็นยังไง");
  assert(
    recalledUnrelated.length > 0 && recalledUnrelated.every((f) => f.pinned),
    "recall returns ONLY pinned facts for an unrelated message",
  );
  const recalledMatch = recallFacts("what is my major in computer engineering?");
  assert(
    recalledMatch.some((f) => f.content.includes("Computer Engineering")),
    "recall surfaces a keyword-matched fact",
  );
  const capped = recallFacts("name fan computer engineering study", 1);
  assert(capped.length <= 1, "recall respects the cap");

  // --- 5. dedupe: identical fact.remember stores one row ---
  const before = listActiveFacts().length;
  await dispatchProposedAction(
    "fact.remember",
    { content: "User's name is Fan.", category: "identity" },
    "smoke",
  );
  assert(
    listActiveFacts().length === before,
    "an identical fact.remember does not create a duplicate row",
  );

  // --- 6. unverified chat context redacts facts to [] ---
  const stubFetch = async () => [];
  const ctxUnverified = await buildChatContext("ฟานชื่ออะไร", stubFetch, false);
  assert(
    Array.isArray(ctxUnverified.facts) && ctxUnverified.facts.length === 0,
    "unverified requester gets facts: [] (redacted before prompt)",
  );
  const ctxVerified = await buildChatContext("ฟานชื่ออะไร", stubFetch, true);
  assert(
    ctxVerified.facts.length > 0,
    "verified requester gets the recalled facts",
  );

  // --- 7. fact.forget snapshots undo_json (recoverable) ---
  const { executeAction } = await import("../src/services/executor.js");
  const liveId = listActiveFacts().find((f) => !f.pinned)!.id;
  const res = await executeAction("fact.forget", { id: liveId });
  assert(
    typeof res.undoJson === "string" && res.undoJson.includes(String(liveId)),
    "fact.forget execution returns an undo snapshot",
  );
  assert(getFact(liveId)!.content !== undefined, "row still present (soft-archive)");

  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nSTEP 16 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 16 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
