import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Set env vars BEFORE any config-dependent import. GEMINI_ENABLED + a stub key
// make isGeminiConfigured() return true so selectProvider("gemini") succeeds.
// The real Gemini API is never called — tests inject stubs through the route layer.
const TEST_TMP = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-phase3-"),
);
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_AGENT_AI_ENABLED = "1";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_SCHEDULER_ENABLED = "";
process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED = "";
// Gemini enabled with a stub key — real API never reached (stubs injected).
process.env.GEMINI_ENABLED = "1";
process.env.GEMINI_API_KEY = "stub-key-phase3";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8813);
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
  console.log("Running Roadmap 11 Phase 3 (Gemini provider) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { getProvider, selectProvider, ProviderError } = await import(
    "../src/services/aiProvider.js"
  );
  const { isGeminiConfigured, GeminiError, realGeminiInvoker } = await import(
    "../src/services/geminiClient.js"
  );
  const { realClaudeInvoker } = await import("../src/services/claudeClient.js");

  type ClaudeInvoker = (
    prompt: string,
    opts?: { timeoutMs?: number },
  ) => Promise<string>;

  initDb();

  // --- 1. isGeminiConfigured() true because env set above ---
  assert(isGeminiConfigured(), "isGeminiConfigured() true when env set");

  // --- 2. geminiProvider registered and available ---
  const geminiProv = getProvider("gemini");
  assert(geminiProv !== undefined, "gemini provider is registered");
  assert(
    geminiProv !== undefined && geminiProv.isAvailable(),
    "geminiProvider.isAvailable() true when GEMINI_ENABLED + GEMINI_API_KEY set",
  );

  // --- 3. selectProvider("gemini") resolves cleanly ---
  const resolved = selectProvider({ mode: "manual", requestedProvider: "gemini" });
  assert(
    resolved.selection.selectedProvider === "gemini",
    "selectProvider manual=gemini resolves to gemini",
  );
  assert(
    resolved.selection.reason.includes("gemini"),
    "selection reason mentions gemini",
  );

  // --- 4. Manual Claude never uses Gemini invoker ---
  const claudeResolved = selectProvider({
    mode: "manual",
    requestedProvider: "claude",
  });
  assert(
    claudeResolved.provider.invoke !== realGeminiInvoker,
    "manual claude selection: invoke is not realGeminiInvoker",
  );
  assert(
    claudeResolved.provider.invoke === realClaudeInvoker,
    "manual claude selection: invoke is realClaudeInvoker",
  );

  // --- 5. Manual Gemini never uses Claude invoker ---
  assert(
    resolved.provider.invoke !== realClaudeInvoker,
    "manual gemini selection: invoke is not realClaudeInvoker",
  );
  assert(
    resolved.provider.invoke === realGeminiInvoker,
    "manual gemini selection: invoke is realGeminiInvoker",
  );

  // --- HTTP-level tests: stub invoker, proposal path ---

  let currentInvoker: ClaudeInvoker = async () => {
    throw new Error("invoker not set");
  };
  const dynamicInvoker: ClaudeInvoker = (prompt, opts) =>
    currentInvoker(prompt, opts);
  const noGoogle = async () => [];

  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: noGoogle });
  await app.listen({ host: HOST, port: PORT });

  // --- 6. provider=gemini with stub → 201, kind:'chat', proposal created ---
  // Stub returns valid JSON exactly like Claude would — same proposal schema.
  currentInvoker = async () =>
    JSON.stringify({
      reply: "Gemini stub: task queued for your review.",
      actions: [
        {
          action_type: "task.create",
          payload: { title: "Gemini test task", priority: "p2" },
        },
      ],
    });

  const chatGemini = await postJson("/api/chat", {
    message: "add a task via gemini",
    provider: "gemini",
  });
  assert(
    chatGemini.status === 201 && chatGemini.json.kind === "chat",
    "provider=gemini with stub: 201 chat reply",
  );
  assert(
    chatGemini.json.provider === "gemini" &&
      chatGemini.json.requestedProvider === "gemini",
    "response echoes selectedProvider=gemini and requestedProvider=gemini",
  );
  assert(
    Array.isArray(chatGemini.json.approvals) &&
      chatGemini.json.approvals.length === 1 &&
      chatGemini.json.approvals[0].action_type === "task.create",
    "gemini stub: task.create action queued as approval",
  );
  assert(
    chatGemini.json.approvals[0].status === "pending",
    "gemini approval is pending (not executed)",
  );

  // --- 7. Approve the gemini-proposed task → it executes ---
  const approvalId: number = chatGemini.json.approvals[0].id;
  const approved = await postJson(`/api/approvals/${approvalId}/approve`);
  assert(
    approved.status === 200 && approved.json.execution_status === "succeeded",
    "gemini-proposed task executes successfully after approval",
  );

  const tasks = await getJson("/api/tasks");
  const found = (tasks.json.tasks as any[]).some(
    (t: any) => t.title === "Gemini test task",
  );
  assert(found, "task 'Gemini test task' exists after gemini proposal approved");

  // --- 8. Malformed Gemini output → 400 error, no false approvals ---
  const pendingBefore = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;

  currentInvoker = async () => "not json {{{broken";
  const malformed = await postJson("/api/chat", {
    message: "malformed test",
    provider: "gemini",
  });
  assert(
    malformed.status === 400 && malformed.json.kind === "error",
    "malformed Gemini output → 400 error (no false approvals)",
  );

  const pendingAfter = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;
  assert(
    pendingAfter === pendingBefore,
    "malformed Gemini output creates zero new pending approvals",
  );

  // --- 9. GeminiError from invoker → fail closed, history not persisted ---
  const histBefore = (await getJson("/api/chat/history?limit=100")).json
    .messages.length;

  currentInvoker = async () => {
    throw new GeminiError("api-error", "Gemini API unavailable (stub)");
  };
  const apiError = await postJson("/api/chat", {
    message: "api error test",
    provider: "gemini",
  });
  assert(
    apiError.status === 502 && apiError.json.kind === "error",
    "GeminiError api-error → 502 error",
  );

  const histAfter = (await getJson("/api/chat/history?limit=100")).json
    .messages.length;
  assert(
    histAfter === histBefore,
    "GeminiError: failed exchange not persisted in history",
  );

  // --- 10. GeminiError disabled → 503 ---
  currentInvoker = async () => {
    throw new GeminiError("disabled", "Gemini disabled (stub)");
  };
  const disabled = await postJson("/api/chat", {
    message: "disabled test",
    provider: "gemini",
  });
  assert(
    disabled.status === 503 && disabled.json.kind === "error",
    "GeminiError disabled → 503 error",
  );

  // --- 11. GeminiError timeout → 504 ---
  currentInvoker = async () => {
    throw new GeminiError("timeout", "Gemini timed out (stub)");
  };
  const timeout = await postJson("/api/chat", {
    message: "timeout test",
    provider: "gemini",
  });
  assert(
    timeout.status === 504 && timeout.json.kind === "error",
    "GeminiError timeout → 504 error",
  );

  currentInvoker = async () => {
    throw new GeminiError(
      "rate-limit",
      "Gemini API rate limit or quota was exceeded.",
    );
  };
  const rateLimit = await postJson("/api/chat", {
    message: "rate limit test",
    provider: "gemini",
  });
  assert(
    rateLimit.status === 429 && rateLimit.json.kind === "error",
    "GeminiError rate-limit → 429 error",
  );
  assert(
    typeof rateLimit.json.error === "string" &&
      rateLimit.json.error.includes("Gemini") &&
      !rateLimit.json.error.includes("generativelanguage.googleapis.com"),
    "rate-limit response is user-safe and does not expose raw Google details",
  );

  const activityAfterRateLimit = await getJson("/api/activity?limit=5");
  const rateLimitActivity = (activityAfterRateLimit.json.activity as any[]).find(
    (a: any) => a.event_type === "chat.message.failed",
  );
  assert(
    rateLimitActivity &&
      String(rateLimitActivity.detail).includes("rate-limit") &&
      !String(rateLimitActivity.detail).includes("generativelanguage.googleapis.com") &&
      !String(rateLimitActivity.detail).includes("QuotaFailure"),
    "rate-limit activity is sanitized and avoids raw Google API payloads",
  );

  // --- 12. Claude still works alongside Gemini ---
  currentInvoker = async () =>
    JSON.stringify({ reply: "Claude reporting in.", actions: [] });
  const claudeChat = await postJson("/api/chat", {
    message: "hello from claude",
    provider: "claude",
  });
  assert(
    claudeChat.status === 201 &&
      claudeChat.json.provider === "claude" &&
      claudeChat.json.requestedProvider === "claude",
    "claude still works normally after Gemini registration",
  );

  // --- 13. Unknown action type from Gemini stub → rejected, zero approvals ---
  currentInvoker = async () =>
    JSON.stringify({
      reply: "Malicious stub",
      actions: [{ action_type: "hack.system", payload: {} }],
    });
  const badAction = await postJson("/api/chat", {
    message: "bad action via gemini",
    provider: "gemini",
  });
  assert(
    badAction.status === 400 && badAction.json.kind === "error",
    "unknown action from Gemini stub → 400 rejected, zero approvals",
  );

  // Cleanup
  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nPHASE 3 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nPHASE 3 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
