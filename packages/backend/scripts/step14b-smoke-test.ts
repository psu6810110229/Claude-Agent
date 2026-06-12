import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Phase 2 (auto-execute engine) smoke. Temp DB + memory dir, AUTO_EXECUTE ON,
// Google disabled. Only local-DB actions are exercised — no network, no Claude.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step14b-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = "1";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 14b (auto-execute engine) smoke...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const {
    dispatchProposedAction,
    requiresConfirmation,
    isAutoExecuteEnabled,
  } = await import("../src/services/actionDispatcher.js");
  const { setConfigBool } = await import(
    "../src/db/repositories/configRepo.js"
  );
  const { AUTO_EXECUTE_ENABLED } = await import("../src/config.js");
  const { getApprovalById } = await import(
    "../src/db/repositories/approvalRepo.js"
  );
  const { listTasks } = await import("../src/db/repositories/taskRepo.js");

  assert(AUTO_EXECUTE_ENABLED === true, "AUTO_EXECUTE_ENABLED reads the env flag");

  // requiresConfirmation now reads a DB config override for recoverable
  // destructive types, so the DB must be initialised first.
  initDb();

  // --- 1. requiresConfirmation classification ---
  assert(
    requiresConfirmation("task.create", { title: "x" }) === false,
    "task.create does not require confirmation",
  );
  assert(
    requiresConfirmation("task.archive", { id: 1 }) === true,
    "task.archive requires confirmation",
  );
  assert(
    requiresConfirmation("google_event.delete", { id: "g1" }) === true,
    "google_event.delete requires confirmation (destructive, toggle off)",
  );
  assert(
    requiresConfirmation("memory.write", { mode: "replace", target: "preferences", content: "x" }) ===
      true,
    "memory.write replace requires confirmation",
  );
  assert(
    requiresConfirmation("memory.write", { mode: "append", target: "preferences", content: "x" }) ===
      false,
    "memory.write append does not require confirmation",
  );

  // --- 1b. Destructive-auto-execute toggle exempts ONLY recoverable Google
  //         delete; archive + memory-replace stay confirm-gated regardless. ---
  setConfigBool("auto_execute_destructive_enabled", true);
  assert(
    requiresConfirmation("google_event.delete", { id: "g1" }) === false,
    "google_event.delete auto-executes when destructive toggle is on",
  );
  assert(
    requiresConfirmation("task.archive", { id: 1 }) === true,
    "task.archive STILL requires confirmation even with destructive toggle on",
  );
  assert(
    requiresConfirmation("event.archive", { id: 1 }) === true,
    "event.archive STILL requires confirmation even with destructive toggle on",
  );
  assert(
    requiresConfirmation("memory.write", { mode: "replace", target: "preferences", content: "x" }) ===
      true,
    "memory.write replace STILL requires confirmation with destructive toggle on",
  );
  setConfigBool("auto_execute_destructive_enabled", false);
  assert(
    requiresConfirmation("google_event.delete", { id: "g1" }) === true,
    "google_event.delete back to confirm-gated when toggle off",
  );

  // --- 2. Reversible action auto-executes and reports the real outcome ---
  const created = await dispatchProposedAction(
    "task.create",
    { title: "Auto task" },
    "smoke",
  );
  assert(created.mode === "executed", "task.create dispatches as executed");
  assert(
    created.approval.status === "approved" &&
      created.approval.execution_status === "succeeded" &&
      typeof created.approval.result_summary === "string",
    "auto-executed approval is approved + succeeded with a real summary",
  );
  const newTaskId = listTasks().find((t) => t.title === "Auto task")?.id;
  assert(newTaskId !== undefined, "the task actually exists in the DB");

  // --- 3. Destructive action stays pending (must be confirmed) ---
  const archived = await dispatchProposedAction(
    "task.archive",
    { id: newTaskId },
    "smoke",
  );
  assert(archived.mode === "pending", "task.archive stays pending (confirm)");
  assert(
    archived.approval.status === "pending" &&
      archived.approval.execution_status === "not_started",
    "pending destructive approval is not executed",
  );
  assert(
    listTasks().find((t) => t.id === newTaskId)?.status !== "archived",
    "the task was NOT archived without confirmation",
  );

  // --- 4. Failure is reported truthfully, never faked as success ---
  const failed = await dispatchProposedAction(
    "task.update",
    { id: 999999, title: "ghost" },
    "smoke",
  );
  assert(failed.mode === "failed", "update of a missing task dispatches as failed");
  assert(
    failed.approval.execution_status === "failed" &&
      failed.approval.status === "pending" &&
      typeof failed.approval.execution_error === "string" &&
      failed.approval.result_summary === null,
    "failed auto-exec records the real error, no fake success",
  );
  // The row remains so it can be retried/rejected.
  assert(
    getApprovalById(failed.approval.id)!.execution_status === "failed",
    "failed approval row is persisted",
  );

  // --- 5. Runtime DB override (Settings toggle) beats the env flag ---
  assert(
    isAutoExecuteEnabled() === true,
    "isAutoExecuteEnabled() reflects the env flag when DB has no override",
  );
  setConfigBool("auto_execute_enabled", false);
  assert(
    isAutoExecuteEnabled() === false,
    "DB override (off) wins over env flag (on)",
  );
  const offResult = await dispatchProposedAction(
    "task.create",
    { title: "Should stay pending" },
    "smoke",
  );
  assert(
    offResult.mode === "pending",
    "with auto-execute toggled off at runtime, actions stay pending",
  );
  setConfigBool("auto_execute_enabled", true);
  assert(
    isAutoExecuteEnabled() === true,
    "DB override (on) re-enables auto-execute",
  );

  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nSTEP 14b SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 14b SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
