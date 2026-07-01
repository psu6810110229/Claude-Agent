import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Roadmap 11 Phase 4 — Transparent Auto provider selection.
//
// Env set BEFORE any config-dependent import so Gemini counts as configured
// (isGeminiConfigured() === true). The real Gemini/Claude runtimes are NEVER
// reached: HTTP tests inject a stub invoker through the route layer, and the
// unit-level checks only inspect selection metadata (never call invoke()).
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-phase4-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_SKIP_ENV_FILE = "1";
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_AGENT_AI_ENABLED = "1";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_SCHEDULER_ENABLED = "";
process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED = "";
process.env.PSU_ENABLED = "";
process.env.PSU_API_KEY = "";
// Gemini enabled with a stub key — real API never reached (stubs injected).
process.env.GEMINI_ENABLED = "1";
process.env.GEMINI_API_KEY = "stub-key-phase4";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8814);
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
  console.log("Running Roadmap 11 Phase 4 (transparent auto selection) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const {
    selectProvider,
    classifyTaskComplexity,
    otherAvailableProvider,
  } = await import("../src/services/aiProvider.js");
  const { GeminiError } = await import("../src/services/geminiClient.js");
  const { GEMINI_MODEL, CLAUDE_MODEL } = await import("../src/config.js");

  type ClaudeInvoker = (
    prompt: string,
    opts?: { timeoutMs?: number },
  ) => Promise<string>;

  initDb();

  // ---- Unit: deterministic classifier ----
  assert(
    classifyTaskComplexity("summarize my open tasks") === "low-risk",
    "classify 'summarize ...' → low-risk",
  );
  assert(
    classifyTaskComplexity("rewrite this paragraph") === "low-risk",
    "classify 'rewrite ...' → low-risk",
  );
  assert(
    classifyTaskComplexity("สรุปงานสัปดาห์นี้ให้หน่อย") === "low-risk",
    "classify Thai 'สรุป' → low-risk",
  );
  assert(
    classifyTaskComplexity("plan my quarterly delivery strategy") === "complex",
    "classify open-ended planning → complex",
  );
  assert(
    classifyTaskComplexity(undefined) === "complex",
    "classify undefined message → complex (safe default)",
  );

  // ---- Unit: auto policy with Gemini configured ----
  const autoLowRisk = selectProvider({
    mode: "auto",
    message: "summarize my week",
  });
  assert(
    autoLowRisk.selection.mode === "auto" &&
      autoLowRisk.selection.selectedProvider === "gemini",
    "auto + low-risk + gemini configured → gemini",
  );
  assert(
    autoLowRisk.selection.selectedModel === GEMINI_MODEL,
    "auto gemini selection records the Gemini model",
  );
  assert(
    autoLowRisk.selection.reason.includes("auto") &&
      autoLowRisk.selection.reason.includes("gemini"),
    "auto gemini selection records a transparent reason",
  );

  const autoComplex = selectProvider({
    mode: "auto",
    message: "design a migration plan for our database",
  });
  assert(
    autoComplex.selection.selectedProvider === "claude" &&
      autoComplex.selection.selectedModel === CLAUDE_MODEL,
    "auto + complex task → claude (even when gemini configured)",
  );
  assert(
    autoComplex.selection.reason.includes("complex"),
    "auto claude selection reason explains complexity routing",
  );

  // ---- Unit: visible fallback helper ----
  assert(
    otherAvailableProvider("gemini")?.id === "claude",
    "otherAvailableProvider('gemini') → claude",
  );
  assert(
    otherAvailableProvider("claude")?.id === "gemini",
    "otherAvailableProvider('claude') → gemini (configured)",
  );

  // ---- HTTP: stub invoker, never calls a real provider ----
  let currentInvoker: ClaudeInvoker = async () => {
    throw new Error("invoker not set");
  };
  const dynamicInvoker: ClaudeInvoker = (prompt, opts) =>
    currentInvoker(prompt, opts);
  const noGoogle = async () => [];

  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: noGoogle });
  await app.listen({ host: HOST, port: PORT });

  // 1. mode=auto + low-risk → routed to gemini, mode + reason echoed.
  currentInvoker = async () =>
    JSON.stringify({ _analysis: "fixture constraint audit", reply: "Here is your summary.", actions: [] });
  const autoSummary = await postJson("/api/chat", {
    message: "summarize my open tasks",
    mode: "auto",
  });
  assert(
    autoSummary.status === 201 && autoSummary.json.kind === "chat",
    "auto low-risk: 201 chat reply",
  );
  assert(
    autoSummary.json.mode === "auto" && autoSummary.json.provider === "gemini",
    "auto low-risk: response mode=auto, provider=gemini",
  );
  assert(
    autoSummary.json.selectedModel === GEMINI_MODEL,
    "auto low-risk: response carries selectedModel (gemini)",
  );
  assert(
    typeof autoSummary.json.providerReason === "string" &&
      autoSummary.json.providerReason.includes("auto"),
    "auto low-risk: providerReason exposed and transparent",
  );

  // 2. mode=auto + complex → routed to claude.
  currentInvoker = async () =>
    JSON.stringify({ _analysis: "fixture constraint audit", reply: "Let me reason through this.", actions: [] });
  const autoPlan = await postJson("/api/chat", {
    message: "help me architect a multi-step delivery plan",
    mode: "auto",
  });
  assert(
    autoPlan.status === 201 &&
      autoPlan.json.mode === "auto" &&
      autoPlan.json.provider === "claude",
    "auto complex: response mode=auto, provider=claude",
  );

  // 3. mode=auto + low-risk that proposes an action → approval pending only.
  currentInvoker = async () =>
    JSON.stringify({
      _analysis: "fixture constraint audit",
      reply: "Queued for your review.",
      actions: [
        {
          action_type: "task.create",
          payload: { title: "Auto-mode task", priority: "p2" },
        },
      ],
    });
  const autoAction = await postJson("/api/chat", {
    message: "summarize then add a task",
    mode: "auto",
  });
  assert(
    autoAction.status === 201 &&
      autoAction.json.provider === "gemini" &&
      autoAction.json.approvals.length === 1 &&
      autoAction.json.approvals[0].status === "pending",
    "auto proposal queued as pending approval (not executed)",
  );

  // 4. mode=auto provider failure → no false success, VISIBLE fallback offered.
  const pendingBefore = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;

  currentInvoker = async () => {
    throw new GeminiError(
      "rate-limit",
      "Gemini API rate limit or quota was exceeded.",
    );
  };
  const autoFail = await postJson("/api/chat", {
    message: "summarize my tasks", // low-risk → selected gemini
    mode: "auto",
  });
  assert(
    autoFail.status === 429 && autoFail.json.kind === "error",
    "auto rate-limit failure: 429 error (no false success)",
  );
  assert(
    autoFail.json.mode === "auto" &&
      autoFail.json.provider === "gemini" &&
      autoFail.json.fallbackProvider === "claude",
    "auto failure: fallbackProvider=claude surfaced for explicit retry",
  );
  const pendingAfter = (
    (await getJson("/api/approvals")).json.approvals as any[]
  ).filter((a: any) => a.status === "pending").length;
  assert(
    pendingAfter === pendingBefore,
    "auto failure: zero new approvals created",
  );

  // 5. mode=auto invalid JSON → 400, no approvals, no fallback masking.
  currentInvoker = async () => "not json {{{broken";
  const autoBad = await postJson("/api/chat", {
    message: "summarize this",
    mode: "auto",
  });
  assert(
    autoBad.status === 400 && autoBad.json.kind === "error",
    "auto invalid output → 400 (fails closed)",
  );

  // 6. Manual mode still works and is NOT auto.
  currentInvoker = async () =>
    JSON.stringify({ _analysis: "fixture constraint audit", reply: "Manual claude here.", actions: [] });
  const manualClaude = await postJson("/api/chat", {
    message: "summarize my tasks", // low-risk text, but manual must ignore auto policy
    provider: "claude",
  });
  assert(
    manualClaude.status === 201 &&
      manualClaude.json.mode === "manual" &&
      manualClaude.json.provider === "claude",
    "manual claude unaffected: mode=manual, provider=claude despite low-risk text",
  );

  // 7. Manual failure does NOT offer auto fallback.
  currentInvoker = async () => {
    throw new GeminiError("api-error", "stub claude-side failure");
  };
  const manualFail = await postJson("/api/chat", {
    message: "do something",
    provider: "claude",
  });
  assert(
    manualFail.status === 502 &&
      (manualFail.json.fallbackProvider === undefined ||
        manualFail.json.fallbackProvider === null),
    "manual failure: no auto fallbackProvider offered",
  );

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nPHASE 4 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nPHASE 4 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
