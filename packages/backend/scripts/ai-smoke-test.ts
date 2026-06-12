import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point memory at a throwaway dir BEFORE importing config-dependent modules.
// AI mode only PROPOSES (never writes files), but init seeds memory templates,
// so we keep the user's real repo-root memory/ untouched regardless.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-ai-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
// Ensure the real-binary path is never reachable from this test.
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8806);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function postAi(input: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}/api/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, mode: "ai" }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 6 (AI command) smoke test...");
  console.log(`  using temp memory dir: ${TEST_MEMORY_DIR}`);

  // Dynamic imports so config picks up env set above.
  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { getDb, closeDb } = await import("../src/db/connection.js");
  const { ClaudeError } = await import("../src/services/claudeClient.js");
  const { CLAUDE_MAX_ACTIONS } = await import("../src/config.js");

  const validOutput = JSON.stringify({
    actions: [
      { action_type: "task.create", payload: { title: "AI proposed task" } },
      {
        action_type: "memory.write",
        payload: {
          target: "preferences",
          mode: "append",
          content: "AI proposed note",
        },
      },
    ],
    notes: "ignored",
  });
  const clarificationOutput = JSON.stringify({
    actions: [],
    clarification: "What time should I remind you?",
  });
  const followUpGoogleOutput = JSON.stringify({
    actions: [
      {
        action_type: "google_event.create",
        payload: {
          title: "Call Pam",
          starts_at: "2026-06-07T03:00:00.000Z",
          ends_at: "2026-06-07T03:30:00.000Z",
        },
      },
    ],
  });
  const thaiFollowUpOutput = JSON.stringify({
    actions: [
      {
        action_type: "reminder.create",
        payload: {
          title: "เตรียมเอกสารสละสิทธิ์หอพัก ออกบ้านได้ 11:00",
          due_at: "2026-06-07T02:00:00.000Z",
          notes: "สำนักงานหอ 10 — ปิดรับ 15:00 พักเที่ยง 12:00–13:00",
        },
      },
      {
        action_type: "google_event.create",
        payload: {
          title: "ยื่นเรื่องสละสิทธิ์หอพัก — สำนักงานหอ 10",
          starts_at: "2026-06-07T04:00:00.000Z",
          ends_at: "2026-06-07T08:00:00.000Z",
          location: "สำนักงานหอ 10",
          notes:
            "ออกจากบ้านเร็วสุด 11:00 / พักเที่ยง 12:00–13:00 ไม่รับเรื่อง / ปิดรับเรื่อง 15:00 — ควรไปถึงก่อน 12:00 หรือหลัง 13:00",
        },
      },
    ],
  });

  // Stubbed Claude invoker. Switches on a marker embedded in the user input
  // (the prompt contains the raw input). NEVER calls the real binary.
  const stubInvoker = async (prompt: string): Promise<string> => {
    if (prompt.includes("CASE_VALID")) return validOutput;
    if (prompt.includes("CASE_BADJSON")) return "this is not json {{{";
    if (prompt.includes("CASE_UNKNOWN"))
      return JSON.stringify({
        actions: [{ action_type: "task.delete", payload: { id: 1 } }],
      });
    if (prompt.includes("CASE_FENCE"))
      return "```json\n" + validOutput + "\n```";
    if (prompt.includes("CASE_PROSE"))
      return "Here is the result:\n" + validOutput;
    if (prompt.includes("CASE_TOOMANY"))
      return JSON.stringify({
        // One over the configured cap so the over-limit rejection always fires.
        actions: Array.from({ length: CLAUDE_MAX_ACTIONS + 1 }, (_, i) => ({
          action_type: "task.create",
          payload: { title: `t${i}` },
        })),
      });
    if (prompt.includes("CASE_THAI_FOLLOWUP")) return thaiFollowUpOutput;
    if (prompt.includes("CASE_FOLLOWUP_GOOGLE")) return followUpGoogleOutput;
    if (prompt.includes("CASE_CLARIFY")) return clarificationOutput;
    if (prompt.includes("CASE_EMPTY"))
      return JSON.stringify({ actions: [] });
    if (prompt.includes("CASE_FAIL"))
      throw new ClaudeError("timeout", "stub: simulated timeout");
    return JSON.stringify({ actions: [] });
  };

  initDb();
  const db = getDb();
  const app = buildServer({ aiInvoker: stubInvoker });
  await app.listen({ host: HOST, port: PORT });

  const countApprovals = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM approval").get() as { n: number }).n;
  const countTasks = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM task").get() as { n: number }).n;

  // --- 1. Valid AI response creates pending approvals; nothing executes ---
  const approvalsBefore = countApprovals();
  const tasksBefore = countTasks();
  const valid = await postAi("CASE_VALID please organize my day");
  assert(
    valid.status === 201 && valid.json.kind === "proposal",
    "valid AI response returns 201 proposal",
  );
  assert(
    Array.isArray(valid.json.approvals) && valid.json.approvals.length === 2,
    "valid AI response creates two approvals",
  );
  assert(
    valid.json.approvals.every((a: any) => a.status === "pending"),
    "all AI-created approvals are pending",
  );
  assert(
    valid.json.approvals.map((a: any) => a.action_type).sort().join(",") ===
      "memory.write,task.create",
    "approvals carry the proposed action types",
  );
  assert(
    countApprovals() === approvalsBefore + 2,
    "exactly two approvals were persisted",
  );
  assert(
    countTasks() === tasksBefore,
    "no task was created (no immediate execution)",
  );

  // --- 2. Invalid JSON is rejected; zero approvals ---
  const before2 = countApprovals();
  const badJson = await postAi("CASE_BADJSON do something");
  assert(
    badJson.status === 400 && badJson.json.kind === "error",
    "invalid JSON returns 400 error",
  );
  assert(
    countApprovals() === before2,
    "invalid JSON created zero approvals",
  );

  // --- 3. Unknown action type is rejected; zero approvals ---
  const before3 = countApprovals();
  const unknown = await postAi("CASE_UNKNOWN delete a task");
  assert(
    unknown.status === 400 && unknown.json.kind === "error",
    "unknown action type returns 400 error",
  );
  assert(
    countApprovals() === before3,
    "unknown action type created zero approvals",
  );

  // --- 4. A single outer markdown code fence is unwrapped → accepted ---
  const before4 = countApprovals();
  const fenced = await postAi("CASE_FENCE add a task");
  assert(
    fenced.status === 201 && fenced.json.kind === "proposal",
    "fenced JSON is unwrapped and accepted",
  );
  assert(
    Array.isArray(fenced.json.approvals) && fenced.json.approvals.length === 2,
    "fenced JSON created two approvals",
  );
  assert(
    countApprovals() === before4 + 2,
    "fenced response persisted two approvals",
  );

  // --- 4b. Prose before the JSON is still rejected (not unwrapped) ---
  const before4b = countApprovals();
  const prose = await postAi("CASE_PROSE add a task");
  assert(
    prose.status === 400 && prose.json.kind === "error",
    "prose + JSON is rejected",
  );
  assert(countApprovals() === before4b, "prose response created zero approvals");

  // --- 5. More than CLAUDE_MAX_ACTIONS actions is rejected ---
  const before5 = countApprovals();
  const tooMany = await postAi("CASE_TOOMANY add many tasks");
  assert(
    tooMany.status === 400 && tooMany.json.kind === "error",
    "more than CLAUDE_MAX_ACTIONS actions is rejected",
  );
  assert(countApprovals() === before5, "over-cap response created zero approvals");

  // --- 6. Empty actions is valid but produces no proposals ---
  const before6 = countApprovals();
  const none = await postAi("CASE_EMPTY nothing actionable");
  assert(
    none.status === 200 && none.json.kind === "none",
    "empty actions returns 200 none",
  );
  assert(countApprovals() === before6, "empty actions created zero approvals");

  // --- 7. Clarification asks a follow-up and creates no approvals ---
  const before7 = countApprovals();
  const clarify = await postAi("CASE_CLARIFY remind me to call Pam");
  assert(
    clarify.status === 200 && clarify.json.kind === "clarification",
    "missing details returns 200 clarification",
  );
  assert(
    clarify.json.question === "What time should I remind you?",
    "clarification response carries the follow-up question",
  );
  assert(
    countApprovals() === before7,
    "clarification created zero approvals",
  );

  // --- 8. A follow-up answer can become a Google event approval ---
  const before8 = countApprovals();
  const followUp = await postAi(
    [
      "CASE_FOLLOWUP_GOOGLE remind me to call Pam",
      "",
      'Follow-up answer to "What time should I remind you?": tomorrow 10am',
    ].join("\n"),
  );
  assert(
    followUp.status === 201 && followUp.json.kind === "proposal",
    "follow-up answer can return 201 proposal",
  );
  assert(
    followUp.json.approvals[0].action_type === "google_event.create",
    "follow-up proposal can queue google_event.create",
  );
  assert(
    countApprovals() === before8 + 1,
    "follow-up proposal persisted one approval",
  );

  // --- 9. A Thai follow-up can queue reminder + Google event approvals ---
  const before9 = countApprovals();
  const thaiFollowUp = await postAi(
    [
      "CASE_THAI_FOLLOWUP เตือนและใส่ปฏิทินเรื่องสละสิทธิ์หอพัก",
      "",
      'Follow-up answer to "What time should I remind you?": ออกบ้าน 11 โมง',
    ].join("\n"),
  );
  assert(
    thaiFollowUp.status === 201 && thaiFollowUp.json.kind === "proposal",
    "Thai follow-up returns 201 proposal",
  );
  assert(
    thaiFollowUp.json.approvals.length === 2,
    "Thai follow-up queues two approvals",
  );
  assert(
    thaiFollowUp.json.approvals
      .map((a: any) => a.action_type)
      .sort()
      .join(",") === "google_event.create,reminder.create",
    "Thai follow-up carries reminder and Google event action types",
  );
  assert(
    countApprovals() === before9 + 2,
    "Thai follow-up persisted two approvals",
  );

  // --- 10. Invoker failure fails closed; zero approvals ---
  const before10 = countApprovals();
  const failed = await postAi("CASE_FAIL hang please");
  assert(
    failed.status === 504 && failed.json.kind === "error",
    "Claude timeout fails closed with 504",
  );
  assert(countApprovals() === before10, "failed invocation created zero approvals");

  // --- 11. Activity events present ---
  const events = new Set(
    (
      db.prepare("SELECT event_type FROM activity_log").all() as {
        event_type: string;
      }[]
    ).map((r) => r.event_type),
  );
  assert(events.has("ai.command.received"), "activity has ai.command.received");
  assert(events.has("ai.command.proposed"), "activity has ai.command.proposed");
  assert(events.has("ai.command.rejected"), "activity has ai.command.rejected");
  assert(events.has("ai.command.failed"), "activity has ai.command.failed");
  assert(
    events.has("ai.command.clarification"),
    "activity has ai.command.clarification",
  );

  await app.close();
  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });

  console.log("\nSTEP 6 AI SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 6 AI SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
