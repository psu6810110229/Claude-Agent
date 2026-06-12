import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + temp DB + Google disabled BEFORE importing any
// config-dependent module. No network, no real Google API, no Claude. We only
// exercise schemas, the registry, the undo_json column, and fail-closed
// connector behaviour for the Step 14 Google update/delete actions.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step14-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.GOOGLE_CALENDAR_ENABLED = "";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 14 (Google update/delete + undo) smoke...");

  const { actionTypeSchema, actionPayloadSchemas } = await import(
    "../src/schemas/approval.js"
  );
  const {
    updateGoogleEventPayloadSchema,
    deleteGoogleEventPayloadSchema,
  } = await import("../src/schemas/googleCalendar.js");
  const { getActionMeta, capabilityRegistry } = await import(
    "../src/services/actionRegistry.js"
  );
  const {
    GoogleCalendarError,
    updateGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
  } = await import("../src/services/googleCalendar.js");
  const { initDb } = await import("../src/db/init.js");
  const { getDb, closeDb } = await import("../src/db/connection.js");
  const {
    createApproval,
    markApprovalExecutionSucceeded,
    getApprovalById,
  } = await import("../src/db/repositories/approvalRepo.js");

  // --- 1. Allowlist + registry have the new write actions ---
  const actionTypes = (actionTypeSchema as any).options as string[];
  assert(
    actionTypes.includes("google_event.update") &&
      actionTypes.includes("google_event.delete"),
    "allowlist includes google_event.update and google_event.delete",
  );
  assert(
    getActionMeta("google_event.delete").policies.includes("destructive"),
    "google_event.delete carries the destructive policy",
  );
  assert(
    !getActionMeta("google_event.update").policies.includes("create-only") &&
      getActionMeta("google_event.update").policies.includes("external-service"),
    "google_event.update is an external-service, non-create-only action",
  );
  assert(
    Object.hasOwn(capabilityRegistry, "google.calendar.update") &&
      Object.hasOwn(capabilityRegistry, "google.calendar.delete"),
    "capability registry has update and delete capabilities",
  );

  // --- 2. Payload validation ---
  assert(
    updateGoogleEventPayloadSchema.safeParse({ id: "abc", title: "X" }).success,
    "update payload accepts id + one field",
  );
  assert(
    !updateGoogleEventPayloadSchema.safeParse({ id: "abc" }).success,
    "update payload rejects id with no mutable field",
  );
  assert(
    !updateGoogleEventPayloadSchema.safeParse({
      id: "abc",
      starts_at: "2026-06-12T10:00:00+07:00",
    }).success,
    "update payload rejects non-UTC (offset) datetime",
  );
  assert(
    !updateGoogleEventPayloadSchema.safeParse({
      id: "abc",
      starts_at: "2026-06-12T10:00:00.000Z",
      ends_at: "2026-06-12T09:00:00.000Z",
    }).success,
    "update payload rejects ends_at <= starts_at",
  );
  assert(
    deleteGoogleEventPayloadSchema.safeParse({ id: "abc" }).success &&
      !deleteGoogleEventPayloadSchema.safeParse({ id: "" }).success,
    "delete payload requires a non-empty id",
  );
  // The payload map wired into the executor allowlist points at these schemas.
  assert(
    actionPayloadSchemas["google_event.update"] ===
      updateGoogleEventPayloadSchema &&
      actionPayloadSchemas["google_event.delete"] ===
        deleteGoogleEventPayloadSchema,
    "executor payload map wires the Step 14 schemas",
  );

  // initDb() before the connector checks: isGoogleCalendarEnabled() reads the
  // config table (runtime Settings overrides), which must exist first.
  initDb();

  // --- 3. Connector fails closed when Google Calendar is disabled ---
  let updateThrew = false;
  try {
    await updateGoogleCalendarEvent({ id: "abc", title: "X" });
  } catch (err) {
    updateThrew =
      err instanceof GoogleCalendarError && err.reason === "disabled";
  }
  assert(updateThrew, "updateGoogleCalendarEvent fails closed when disabled");

  let deleteThrew = false;
  try {
    await deleteGoogleCalendarEvent({ id: "abc" });
  } catch (err) {
    deleteThrew =
      err instanceof GoogleCalendarError && err.reason === "disabled";
  }
  assert(deleteThrew, "deleteGoogleCalendarEvent fails closed when disabled");

  // --- 4. undo_json column exists and persists a snapshot ---
  const cols = new Set(
    (getDb().prepare("PRAGMA table_info(approval)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  assert(cols.has("undo_json"), "approval table has the undo_json column");

  const a = createApproval("google_event.delete", { id: "evt-1" });
  assert(getApprovalById(a.id)!.undo_json === null, "new approval has null undo_json");
  const snapshot = JSON.stringify({ summary: "Old title", location: "Room A" });
  const done = markApprovalExecutionSucceeded(a.id, "deleted evt-1", snapshot);
  assert(
    done!.undo_json === snapshot &&
      done!.execution_status === "succeeded" &&
      done!.status === "approved",
    "markApprovalExecutionSucceeded persists the undo snapshot",
  );
  const b = createApproval("task.create", { title: "no undo" });
  const bDone = markApprovalExecutionSucceeded(b.id, "created");
  assert(
    bDone!.undo_json === null,
    "actions without a snapshot leave undo_json null",
  );

  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nSTEP 14 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 14 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
