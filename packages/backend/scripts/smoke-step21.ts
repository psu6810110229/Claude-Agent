import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Step 21 — LINE follow-up watches (scheduled READ-ONLY export check).
 *
 * Temp DB + temp LINE export dir. No real LINE files/DB, no Claude, no network,
 * no real desktop toast (StubDesktopNotifier). LINE starts DISABLED so we can
 * assert fail-soft, then enable via DB config. Asserts:
 *   - action schema / registry coverage for line_followup.create (local-only,
 *     never external-service / destructive; no LINE send/reply/update/delete)
 *   - an approval creates a PENDING watch only AFTER it is executed/approved
 *   - a due watch + new matching message → one line.followup notification
 *   - a due watch with no match → an explicit "no new matches" notification
 *   - messages older than baseline_at do NOT count
 *   - scheduler dedup (a fired watch is not re-checked → one notification)
 *   - the activity log carries COUNTS ONLY — never message text/keywords/topic
 *   - LINE disabled does not throw
 */

const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step21-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_LINE_DIR = path.join(TEST_TMP, "line-exports");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
fs.mkdirSync(TEST_LINE_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.LINE_EXPORT_DIR = TEST_LINE_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.LINE_ENABLED = ""; // disabled at import time
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = ""; // auto-execute off

// One exported chat: a media line teaches the sender registry, then the real
// message we want to match (text contains "กยศ"). Bangkok 15:30 → 08:30Z.
const SECRET_TEXT = "กยศ อนุมัติแล้วนะครับ";
const SAMPLE = [
  "2026.06.10 Wednesday",
  "15:29 PSARA Photos",
  `15:30 PSARA ${SECRET_TEXT}`,
  "",
].join("\n");

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 21 (LINE follow-up) smoke test...");

  fs.writeFileSync(path.join(TEST_LINE_DIR, "[LINE]Loan.txt"), SAMPLE, "utf8");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { setConfigBool } = await import(
    "../src/db/repositories/configRepo.js"
  );
  const { actionTypeSchema, actionPayloadSchemas } = await import(
    "../src/schemas/approval.js"
  );
  const { createLineFollowupPayloadSchema } = await import(
    "../src/schemas/lineFollowup.js"
  );
  const { ACTION_TYPES, getActionMeta } = await import(
    "../src/services/actionRegistry.js"
  );
  const { aiActionSchema } = await import("../src/schemas/aiCommand.js");
  const { executeAction } = await import("../src/services/executor.js");
  const { createApproval } = await import(
    "../src/db/repositories/approvalRepo.js"
  );
  const {
    createLineFollowup,
    listPendingLineFollowups,
    getLineFollowupById,
  } = await import("../src/db/repositories/lineFollowupRepo.js");
  const { runLineFollowupChecks } = await import("../src/services/scheduler.js");
  const { listNotifications } = await import(
    "../src/db/repositories/notificationRepo.js"
  );
  const { StubDesktopNotifier } = await import(
    "../src/services/desktopNotifier.js"
  );
  const { requiresConfirmation, dispatchProposedAction } = await import(
    "../src/services/actionDispatcher.js"
  );

  initDb();

  const notifier = new StubDesktopNotifier();

  try {
    // --- 1. Action schema / registry coverage ---
    assert(
      actionTypeSchema.options.includes("line_followup.create"),
      "actionTypeSchema enum includes line_followup.create",
    );
    assert(
      "line_followup.create" in actionPayloadSchemas,
      "actionPayloadSchemas has line_followup.create",
    );
    const meta = getActionMeta("line_followup.create");
    assert(
      meta.policies.includes("approval-required") &&
        meta.policies.includes("local-only"),
      "line_followup.create is approval-required + local-only",
    );
    assert(
      !meta.policies.includes("external-service") &&
        !meta.policies.includes("destructive"),
      "line_followup.create is NOT external-service / destructive",
    );
    assert(
      aiActionSchema.safeParse({
        action_type: "line_followup.create",
        payload: {
          topic: "loan",
          keywords: ["กยศ"],
          due_at: "2026-06-11T09:00:00.000Z",
        },
      }).success,
      "aiActionSchema accepts line_followup.create",
    );
    // Payload validation: rejects empty keywords + non-UTC due_at.
    assert(
      !createLineFollowupPayloadSchema.safeParse({
        topic: "x",
        keywords: [],
        due_at: "2026-06-11T09:00:00.000Z",
      }).success,
      "payload rejects empty keywords",
    );
    assert(
      !createLineFollowupPayloadSchema.safeParse({
        topic: "x",
        keywords: ["a"],
        due_at: "2026-06-11T16:00:00+07:00",
      }).success,
      "payload rejects non-UTC (offset) due_at",
    );

    // --- 2. No LINE mutation/send/reply path exists ---
    const lineActions = ACTION_TYPES.filter((t) => t.startsWith("line"));
    assert(
      JSON.stringify(lineActions) === JSON.stringify(["line_followup.create"]),
      "the ONLY line* action is line_followup.create (no send/reply/update/delete)",
    );
    assert(
      !requiresConfirmation("line_followup.create", {}),
      "line_followup.create does not require destructive confirmation",
    );

    // --- 3. An approval creates a PENDING watch only AFTER it is executed ---
    const goodPayload = {
      topic: "loan approval",
      keywords: ["กยศ"],
      due_at: "2026-06-11T09:00:00.000Z",
    };
    // Auto-execute is OFF → dispatcher leaves it pending; NO watch row yet.
    const dispatched = await dispatchProposedAction(
      "line_followup.create",
      goodPayload,
      "smoke",
    );
    assert(dispatched.mode === "pending", "auto-exec off → proposal stays pending");
    assert(
      listPendingLineFollowups().length === 0,
      "no watch row created while approval is only pending",
    );
    // Approving == executing the action: now the watch row appears.
    const approval = createApproval("line_followup.create", goodPayload);
    assert(
      listPendingLineFollowups().length === 0,
      "createApproval alone still creates no watch row",
    );
    await executeAction("line_followup.create", approval.payload);
    const afterExec = listPendingLineFollowups();
    assert(
      afterExec.length === 1,
      "executing line_followup.create creates exactly one watch row",
    );
    assert(
      afterExec[0].baseline_at.endsWith("Z") && afterExec[0].status === "pending",
      "watch baseline_at is set (creation time) and status pending",
    );

    // --- 4. LINE disabled does not throw (fail-soft) ---
    assert(getDb !== undefined, "db handle available");
    const disabledWatch = createLineFollowup({
      topic: "while disabled",
      keywords: ["กยศ"],
      chat_filter: null,
      due_at: "2026-06-11T00:00:00.000Z",
      baseline_at: "2026-06-01T00:00:00.000Z",
    });
    let threw = false;
    try {
      runLineFollowupChecks("2026-06-11T01:00:00.000Z", notifier);
    } catch {
      threw = true;
    }
    assert(!threw, "runLineFollowupChecks does not throw when LINE is disabled");
    const disabledNote = listNotifications(50).find(
      (n) => n.kind === "line.followup" && n.source_id === disabledWatch.id,
    );
    assert(
      disabledNote !== undefined &&
        disabledNote.body !== null &&
        disabledNote.body.includes("ปิดอยู่"),
      "disabled check fires an explicit 'couldn't check (LINE off)' notification",
    );
    assert(
      getLineFollowupById(disabledWatch.id)?.status === "fired",
      "disabled watch is marked fired",
    );

    // Enable LINE for the remaining checks.
    setConfigBool("line_enabled", true);

    // --- 5. Due watch + new matching message → match notification ---
    const matchWatch = createLineFollowup({
      topic: "loan reply",
      keywords: ["กยศ"],
      chat_filter: null,
      due_at: "2026-06-11T09:00:00.000Z",
      baseline_at: "2026-06-01T00:00:00.000Z", // before the 2026-06-10 message
    });
    runLineFollowupChecks("2026-06-11T10:00:00.000Z", notifier);
    const matchNote = listNotifications(50).find(
      (n) => n.kind === "line.followup" && n.source_id === matchWatch.id,
    );
    assert(matchNote !== undefined, "matching watch fires a line.followup notification");
    assert(
      matchNote!.body !== null && matchNote!.body.includes("1 ข้อความ"),
      "match notification reports the match count (1)",
    );
    assert(
      matchNote!.body!.includes(SECRET_TEXT.slice(0, 20)),
      "match notification body carries the (capped) snippet",
    );
    assert(
      getLineFollowupById(matchWatch.id)?.status === "fired",
      "matched watch is marked fired",
    );

    // --- 6. Scheduler dedup: re-running does not create a second notification ---
    runLineFollowupChecks("2026-06-11T10:05:00.000Z", notifier);
    const matchNotes = listNotifications(100).filter(
      (n) => n.kind === "line.followup" && n.source_id === matchWatch.id,
    );
    assert(
      matchNotes.length === 1,
      "a fired watch is not re-checked → exactly one notification (dedup)",
    );

    // --- 7. No-match due watch → explicit 'no new matches' notification ---
    const noMatchWatch = createLineFollowup({
      topic: "nothing here",
      keywords: ["zzznomatch"],
      chat_filter: null,
      due_at: "2026-06-11T09:00:00.000Z",
      baseline_at: "2026-06-01T00:00:00.000Z",
    });
    runLineFollowupChecks("2026-06-11T10:10:00.000Z", notifier);
    const noMatchNote = listNotifications(100).find(
      (n) => n.kind === "line.followup" && n.source_id === noMatchWatch.id,
    );
    assert(
      noMatchNote !== undefined &&
        noMatchNote.body !== null &&
        noMatchNote.body.includes("ยังไม่พบ"),
      "no-match watch fires an explicit 'no new messages matched' notification",
    );

    // --- 8. Messages older than baseline_at do NOT count ---
    const staleWatch = createLineFollowup({
      topic: "too late baseline",
      keywords: ["กยศ"], // WOULD match, but baseline is after the message
      chat_filter: null,
      due_at: "2026-06-11T09:00:00.000Z",
      baseline_at: "2026-06-20T00:00:00.000Z", // after the 2026-06-10 message
    });
    runLineFollowupChecks("2026-06-21T00:00:00.000Z", notifier);
    const staleNote = listNotifications(100).find(
      (n) => n.kind === "line.followup" && n.source_id === staleWatch.id,
    );
    assert(
      staleNote !== undefined &&
        staleNote.body !== null &&
        staleNote.body.includes("ยังไม่พบ"),
      "a match older than baseline_at does NOT count (treated as no new match)",
    );

    // --- 9. Activity log carries COUNTS ONLY — never message text/keywords/topic ---
    const logRows = getDb()
      .prepare(
        "SELECT detail FROM activity_log WHERE event_type = 'line_followup.checked'",
      )
      .all() as { detail: string }[];
    assert(logRows.length >= 4, "line_followup.checked activity rows were written");
    for (const row of logRows) {
      assert(
        /^id=\d+ matches=\d+ line_enabled=[01]$/.test(row.detail),
        `activity detail is counts-only: ${row.detail}`,
      );
      assert(
        !row.detail.includes(SECRET_TEXT) &&
          !row.detail.includes("กยศ") &&
          !row.detail.includes("loan"),
        "activity detail leaks no message text / keyword / topic",
      );
    }

    console.log("\nAll Step 21 smoke assertions passed.");
  } finally {
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(
    "\nStep 21 smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
