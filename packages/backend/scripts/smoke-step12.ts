import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Set env vars BEFORE any config-dependent import (module-level consts in
// config.ts are evaluated on first import).
const TEST_TMP = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step12-"),
);
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_AGENT_AI_ENABLED = "1";        // enabled — stubs injected
process.env.GOOGLE_CALENDAR_ENABLED = "";          // Google off — stub injected
process.env.CLAUDE_AGENT_SCHEDULER_ENABLED = "";   // scheduler off
process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8812);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function postJson(
  p: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function getJson(p: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 12 (chat agent) smoke...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { ClaudeError } = await import("../src/services/claudeClient.js");
  type ClaudeInvoker = (prompt: string, opts?: { timeoutMs?: number }) => Promise<string>;

  initDb();

  // --- 0. Nine tables exist (config added for runtime feature flags) ---
  const db = getDb();
  const tables: string[] = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
  const expected = [
    "activity_log",
    "approval",
    "chat_message",
    "config",
    "event",
    "memory_index",
    "notification",
    "reminder",
    "task",
  ];
  assert(
    expected.every((t) => tables.includes(t)),
    `9 tables exist: ${expected.join(", ")}`,
  );

  // --- Single server with a dynamic stub invoker ---
  // Swapping `currentInvoker` changes what Claude "responds" each test without
  // restarting the server (avoids port-release races on Windows).
  let currentInvoker: ClaudeInvoker = async () => {
    throw new Error("invoker not set");
  };
  const dynamicInvoker: ClaudeInvoker = (prompt, opts) =>
    currentInvoker(prompt, opts);

  const noGoogle = async () => [];

  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: noGoogle });
  await app.listen({ host: HOST, port: PORT });

  // --- Stub helpers ---

  function stubOk(reply: string, actions: unknown[] = []): ClaudeInvoker {
    return async () => JSON.stringify({ reply, actions });
  }

  const stubWithTask: ClaudeInvoker = async () =>
    JSON.stringify({
      reply: "I'll add that task for you. Check Approvals to confirm.",
      actions: [
        {
          action_type: "task.create",
          payload: { title: "Buy groceries", status: "open" },
        },
      ],
    });

  const stubBadJson: ClaudeInvoker = async () => "not json at all!!!";

  const stubBadAction: ClaudeInvoker = async () =>
    JSON.stringify({
      reply: "Sure",
      actions: [{ action_type: "hack.system", payload: {} }],
    });

  const stubDisabled: ClaudeInvoker = async () => {
    throw new ClaudeError("disabled", "AI command mode is disabled.");
  };

  // --- 1. POST /api/chat: successful reply persists both messages ---
  currentInvoker = stubOk("You have 3 open tasks. Anything I can help with?");

  const chat1 = await postJson("/api/chat", { message: "What's on my plate?" });
  assert(
    chat1.status === 201 && chat1.json.kind === "chat",
    "POST /api/chat returns 201 + kind:'chat'",
  );
  assert(
    chat1.json.reply === "You have 3 open tasks. Anything I can help with?",
    "reply matches stub output",
  );
  assert(
    Array.isArray(chat1.json.approvals) && chat1.json.approvals.length === 0,
    "no approvals queued for info-only reply",
  );

  // --- 2. History persisted: GET /api/chat/history returns 2 rows ---
  const hist1 = await getJson("/api/chat/history?limit=10");
  assert(
    hist1.status === 200 && Array.isArray(hist1.json.messages),
    "GET /api/chat/history returns 200 + messages array",
  );
  assert(hist1.json.messages.length === 2, "history has 2 rows after one exchange");
  assert(hist1.json.messages[0].role === "user", "first message is user");
  assert(hist1.json.messages[1].role === "assistant", "second message is assistant");
  assert(
    hist1.json.messages[0].content === "What's on my plate?",
    "user message content persisted",
  );

  // --- 3. Task.create action → exactly one pending approval ---
  currentInvoker = stubWithTask;

  const chat2 = await postJson("/api/chat", { message: "add Buy groceries" });
  assert(
    chat2.status === 201 && chat2.json.kind === "chat",
    "POST /api/chat with task.create returns 201",
  );
  assert(
    chat2.json.approvals.length === 1 &&
      chat2.json.approvals[0].action_type === "task.create",
    "task.create action queued as pending approval",
  );
  assert(
    chat2.json.approvals[0].status === "pending",
    "approval status is 'pending' (not executed)",
  );

  // Approve it and verify the task exists.
  const approvalId: number = chat2.json.approvals[0].id;
  const approved = await postJson(`/api/approvals/${approvalId}/approve`);
  assert(
    approved.status === 200 && approved.json.status === "approved",
    "approval can be approved via existing route",
  );
  assert(
    approved.json.execution_status === "succeeded" &&
      typeof approved.json.executed_at === "string" &&
      approved.json.result_summary === "created task #1" &&
      approved.json.execution_error === null,
    "approved action records succeeded execution metadata",
  );

  const tasks = await getJson("/api/tasks");
  const found = (tasks.json.tasks as any[]).some(
    (t: any) => t.title === "Buy groceries",
  );
  assert(found, "task 'Buy groceries' exists after approval executed");

  // --- 4. Multi-turn: history grows across turns ---
  currentInvoker = stubOk("Got it, second turn.");
  await postJson("/api/chat", { message: "second message" });

  const hist2 = await getJson("/api/chat/history?limit=20");
  // Turn 1 (2 rows) + turn 2 (task.create, 2 rows) + turn 3 (2 rows) = 6 total.
  assert(hist2.json.messages.length >= 4, "history grows across turns (multi-turn)");

  // --- 5. Invalid JSON → 400 error, failed exchange NOT persisted ---
  currentInvoker = stubBadJson;
  const lenBefore = hist2.json.messages.length;

  const badJsonRes = await postJson("/api/chat", { message: "bad json test" });
  assert(
    badJsonRes.status === 400 && badJsonRes.json.kind === "error",
    "invalid JSON from Claude → 400 error",
  );

  const histAfterBad = await getJson("/api/chat/history?limit=100");
  assert(
    histAfterBad.json.messages.length === lenBefore,
    "failed exchange not persisted in history",
  );

  // --- 6. Unknown action type → 400 error, zero pending approvals ---
  currentInvoker = stubBadAction;

  const badAction = await postJson("/api/chat", { message: "do bad thing" });
  assert(
    badAction.status === 400 && badAction.json.kind === "error",
    "unknown action type → 400 error, zero approvals",
  );
  const approvalsAfterBad = await getJson("/api/approvals");
  const pendingAfterBad = (approvalsAfterBad.json.approvals as any[]).filter(
    (a: any) => a.status === "pending",
  );
  assert(pendingAfterBad.length === 0, "no pending approvals after bad action type");

  // --- 7. Failed execution stays pending but records failed metadata ---
  const failingApproval = await postJson("/api/approvals", {
    action_type: "task.update",
    payload: { id: 999, title: "Missing task" },
  });
  assert(
    failingApproval.status === 201 &&
      failingApproval.json.status === "pending" &&
      failingApproval.json.execution_status === "not_started",
    "new approval starts pending + not_started",
  );

  const failedExec = await postJson(
    `/api/approvals/${failingApproval.json.id}/approve`,
  );
  assert(
    failedExec.status === 422 && failedExec.json.approval.status === "pending",
    "failed execution returns 422 and keeps approval pending for retry/reject",
  );
  assert(
    failedExec.json.approval.execution_status === "failed" &&
      failedExec.json.approval.execution_error === "task #999 not found" &&
      typeof failedExec.json.approval.executed_at === "string",
    "failed execution records failed metadata and error summary",
  );

  const activityAfterFailure = await getJson("/api/activity?limit=20");
  const failureLogged = (activityAfterFailure.json.activity as any[]).some(
    (a: any) =>
      a.event_type === "approval.execute_failed" &&
      String(a.detail).includes("task #999 not found"),
  );
  assert(failureLogged, "failed execution creates readable activity");

  let capturedPrompt = "";
  currentInvoker = async (prompt) => {
    capturedPrompt = prompt;
    return JSON.stringify({
      reply: "I see the latest action outcomes.",
      actions: [],
    });
  };
  const outcomeChat = await postJson("/api/chat", {
    message: "What happened with the last approvals?",
  });
  assert(
    outcomeChat.status === 201,
    "chat still replies after succeeded/failed approvals exist",
  );
  assert(
    capturedPrompt.includes("RECENT APPROVAL / ACTION OUTCOMES") &&
      capturedPrompt.includes("task.create: succeeded: created task #1") &&
      capturedPrompt.includes("task.update: failed: task #999 not found"),
    "chat context includes recent succeeded/failed action summaries",
  );

  // --- 7. AI disabled → 503 fail closed, no messages persisted ---
  currentInvoker = stubDisabled;
  const histBeforeDisabled = await getJson("/api/chat/history?limit=100");
  const histLenBefore = histBeforeDisabled.json.messages.length;

  const disabledRes = await postJson("/api/chat", { message: "hello disabled" });
  assert(
    disabledRes.status === 503 && disabledRes.json.kind === "error",
    "disabled AI → 503 error",
  );

  const histAfterDisabled = await getJson("/api/chat/history?limit=100");
  assert(
    histAfterDisabled.json.messages.length === histLenBefore,
    "disabled AI: no messages persisted",
  );

  // --- 8. POST /api/chat/reset → archives all active messages, history empty ---
  const histBeforeReset = await getJson("/api/chat/history?limit=100");
  const activeCountBefore: number = histBeforeReset.json.messages.length;
  assert(activeCountBefore > 0, "history has active messages before reset");

  const resetRes = await postJson("/api/chat/reset");
  assert(
    resetRes.status === 200 && resetRes.json.kind === "reset",
    "POST /api/chat/reset returns 200 + kind:'reset'",
  );
  assert(
    resetRes.json.archived === activeCountBefore,
    `reset archived all ${activeCountBefore} active message(s)`,
  );

  const histAfterReset = await getJson("/api/chat/history?limit=100");
  assert(
    histAfterReset.json.messages.length === 0,
    "history empty after reset (zero history tokens for next turn)",
  );

  // Next chat turn after reset: no prior history sent (context window starts fresh).
  currentInvoker = stubOk("Fresh start!");
  const chatAfterReset = await postJson("/api/chat", { message: "hello new session" });
  assert(
    chatAfterReset.status === 201 && chatAfterReset.json.reply === "Fresh start!",
    "chat works normally after reset",
  );
  const histFresh = await getJson("/api/chat/history?limit=100");
  assert(
    histFresh.json.messages.length === 2,
    "new session starts with only 2 messages (current exchange)",
  );

  // Cleanup
  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nSTEP 12 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 12 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
