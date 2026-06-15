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
// Hermetic: neutralize a local .env that may enable the privacy guard (would make
// the default no-session requester unverified and skip dispatch) or auto-execute
// (would run actions immediately instead of leaving them pending). Step 12 asserts
// the pending-approval baseline.
process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_DESTRUCTIVE_ENABLED = "";
// Gemini must read as UNCONFIGURED here: the test asserts a manual gemini request
// fails closed (503). A local .env with GEMINI_ENABLED/GEMINI_API_KEY would make
// it "available" and return 201 instead.
process.env.GEMINI_ENABLED = "";
process.env.GEMINI_API_KEY = "";

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

  const stubClarification: ClaudeInvoker = async () =>
    JSON.stringify({
      reply: "ผมไม่แน่ใจว่าหมายถึงนัดไหนครับ เลือกจากตัวเลือกนี้ก่อนได้ไหม",
      actions: [],
      clarification: "หมายถึงนัดไหนครับ",
      clarification_choices: ["นัดวันนี้", "นัดพรุ่งนี้", "ข้ามก่อน"],
    });

  const stubDisabled: ClaudeInvoker = async () => {
    throw new ClaudeError("disabled", "AI command mode is disabled.");
  };

  // --- 1. POST /api/chat: successful reply persists both messages ---
  let readOnlyPrompt = "";
  currentInvoker = async (prompt) => {
    readOnlyPrompt = prompt;
    return JSON.stringify({
      reply: "You have 3 open tasks. Anything I can help with?",
      actions: [],
    });
  };

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
  assert(
    readOnlyPrompt.includes("Read-only questions are valid chat") &&
      readOnlyPrompt.includes('set "actions" to []'),
    "prompt explicitly allows read-only chat answers without tool/action proposals",
  );
  assert(
    readOnlyPrompt.includes("You are Jarvis") &&
      readOnlyPrompt.includes("Never say you have no name") &&
      readOnlyPrompt.includes('masculine polite phrasing: "ผม"') &&
      readOnlyPrompt.includes('Use "ครับ" SPARINGLY') &&
      readOnlyPrompt.includes("chief-of-staff reasoning") &&
      readOnlyPrompt.includes("Never expose internal implementation labels"),
    "prompt pins Jarvis identity, Thai tone, and hides internal role labels",
  );
  // Persona fine-tune (this step): particle ban + adaptive length + inline-only follow-up.
  assert(
    readOnlyPrompt.includes("PARTICLE BAN") &&
      readOnlyPrompt.includes("RESPONSE LENGTH RULES") &&
      readOnlyPrompt.includes("INLINE FOLLOW-UP RULES"),
    "prompt carries particle ban + adaptive-length + inline-follow-up rules",
  );
  // The imitable ACK template strings must no longer TEACH the นะครับ particle
  // (the only "นะครับ" left should be inside the ban rule's "Wrong:" examples).
  assert(
    !readOnlyPrompt.includes("รอคุณยืนยันนะครับ") &&
      !readOnlyPrompt.includes("ขอดูให้ก่อนนะครับ"),
    "execution-policy ACK examples are de-particled (no นะครับ in imitable templates)",
  );
  assert(
    readOnlyPrompt.includes("MEMORY CAPTURE RULES") &&
      readOnlyPrompt.includes("fact.remember") &&
      readOnlyPrompt.includes("User's name is <name>.") &&
      readOnlyPrompt.includes("EXECUTION POLICY"),
    "prompt gives a concrete fact.remember pattern for user-name statements (Step 16)",
  );
  assert(
    readOnlyPrompt.includes("APPROVAL / ACTION AUDIT RULES") &&
      readOnlyPrompt.includes("Approval payloads are intentionally omitted") &&
      readOnlyPrompt.includes("Do not infer or") &&
      readOnlyPrompt.includes("Activity detail UI"),
    "prompt prevents guessing hidden approval payload details",
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
  assert(
    typeof badJsonRes.json.error === "string" &&
      !badJsonRes.json.error.includes("Raw(") &&
      !badJsonRes.json.error.includes("not json"),
    "invalid JSON fallback is user-safe and does not expose raw output",
  );

  const histAfterBad = await getJson("/api/chat/history?limit=100");
  assert(
    histAfterBad.json.messages.length === lenBefore,
    "failed exchange not persisted in history",
  );

  const activityAfterBadJson = await getJson("/api/activity?limit=10");
  const badJsonActivity = (activityAfterBadJson.json.activity as any[]).find(
    (a: any) => a.event_type === "chat.message.rejected",
  );
  assert(
    badJsonActivity &&
      !String(badJsonActivity.detail).includes("Raw(") &&
      !String(badJsonActivity.detail).includes("not json"),
    "invalid JSON activity avoids raw model output",
  );

  // --- 6. Clarification → 201 reply, zero approvals, compact choices ---
  currentInvoker = stubClarification;

  const clarification = await postJson("/api/chat", {
    message: "เลื่อนนัดนี้ให้หน่อย",
  });
  assert(
    clarification.status === 201 && clarification.json.kind === "chat",
    "clarification response returns normal chat result",
  );
  assert(
    clarification.json.clarification === "หมายถึงนัดไหนครับ",
    "clarification question is returned",
  );
  assert(
    Array.isArray(clarification.json.clarification_choices) &&
      clarification.json.clarification_choices.length === 3,
    "clarification choices are returned for quick UI buttons",
  );
  assert(
    Array.isArray(clarification.json.approvals) &&
      clarification.json.approvals.length === 0,
    "clarification queues no approvals before the user answers",
  );

  // --- 7. Unknown action type → 400 error, zero pending approvals ---
  currentInvoker = stubBadAction;

  const badAction = await postJson("/api/chat", { message: "do bad thing" });
  assert(
    badAction.status === 400 && badAction.json.kind === "error",
    "unknown action type → 400 error, zero approvals",
  );
  assert(
    typeof badAction.json.error === "string" &&
      !badAction.json.error.includes("hack.system"),
    "bad action fallback does not expose raw invalid action details",
  );
  const approvalsAfterBad = await getJson("/api/approvals");
  const pendingAfterBad = (approvalsAfterBad.json.approvals as any[]).filter(
    (a: any) => a.status === "pending",
  );
  assert(pendingAfterBad.length === 0, "no pending approvals after bad action type");

  // --- 8. Failed execution stays pending but records failed metadata ---
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

  // --- 9. AI disabled → 503 fail closed, no messages persisted ---
  currentInvoker = stubDisabled;
  const histBeforeDisabled = await getJson("/api/chat/history?limit=100");
  const histLenBefore = histBeforeDisabled.json.messages.length;

  const disabledRes = await postJson("/api/chat", { message: "hello disabled" });
  assert(
    disabledRes.status === 503 && disabledRes.json.kind === "error",
    "disabled AI → 503 error",
  );
  assert(
    disabledRes.json.error !== "AI command mode is disabled.",
    "disabled AI returns a provider-neutral fallback message",
  );

  const histAfterDisabled = await getJson("/api/chat/history?limit=100");
  assert(
    histAfterDisabled.json.messages.length === histLenBefore,
    "disabled AI: no messages persisted",
  );

  // --- 10. POST /api/chat/reset → archives all active messages, history empty ---
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

  // --- 11. Roadmap 11 Phase 2: manual provider selection ---
  // Explicit Claude -> normal 201 reply, response echoes selected provider.
  currentInvoker = stubOk("Claude reporting in.");
  const pClaude = await postJson("/api/chat", {
    message: "hello claude",
    provider: "claude",
  });
  assert(
    pClaude.status === 201 && pClaude.json.kind === "chat",
    "manual provider=claude returns normal 201 chat reply",
  );
  assert(
    pClaude.json.provider === "claude" &&
      pClaude.json.requestedProvider === "claude",
    "response echoes selected + requested provider (UI never hides the choice)",
  );

  // Omitted provider -> default Claude, still echoed.
  currentInvoker = stubOk("Default provider here.");
  const pDefault = await postJson("/api/chat", { message: "no provider field" });
  assert(
    pDefault.status === 201 && pDefault.json.provider === "claude",
    "omitted provider defaults to claude and is reported",
  );

  // Explicit Gemini WITHOUT config -> fail closed: no fake success, nothing
  // persisted, requested provider still visible. (Gemini arrives in Phase 3.)
  const histBeforeGemini = (await getJson("/api/chat/history?limit=100")).json
    .messages.length;
  const pendingBeforeGemini = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;

  const pGemini = await postJson("/api/chat", {
    message: "hello gemini",
    provider: "gemini",
  });
  assert(
    pGemini.status === 503 && pGemini.json.kind === "error",
    "manual provider=gemini (unconfigured) does not pretend success (503)",
  );
  assert(
    pGemini.json.requestedProvider === "gemini",
    "gemini error response does not hide the requested provider",
  );

  const histAfterGemini = (await getJson("/api/chat/history?limit=100")).json
    .messages.length;
  assert(
    histAfterGemini === histBeforeGemini,
    "unconfigured gemini request persists no chat history",
  );
  const pendingAfterGemini = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;
  assert(
    pendingAfterGemini === pendingBeforeGemini,
    "unconfigured gemini request creates no approvals (no false success)",
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
