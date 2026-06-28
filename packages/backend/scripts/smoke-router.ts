import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Multi-model router smoke (Phase A). Env set BEFORE any config-dependent import
// so PSU + Gemini count as configured. The real PSU/Gemini/Claude runtimes are
// NEVER reached: unit checks only inspect selection metadata, and the HTTP
// checks inject a stub invoker through the route layer.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-router-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_AGENT_AI_ENABLED = "1";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_SCHEDULER_ENABLED = "";
process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED = "";
process.env.GEMINI_ENABLED = "1";
process.env.GEMINI_API_KEY = "stub-key-router";
process.env.PSU_ENABLED = "1";
process.env.PSU_API_KEY = "stub-key-psu-router";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8816);
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

async function main(): Promise<void> {
  console.log("Running multi-model router smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { classifyIntent, routeChat, selectProvider, ProviderError } =
    await import("../src/services/aiProvider.js");
  const { GEMINI_MODEL, PSU_GPT4O_MODEL } = await import(
    "../src/config.js"
  );

  initDb();

  // ---- Unit: intent classifier ----
  assert(
    classifyIntent("ขอตารางงานสัปดาห์หน้าหน่อย") === "schedule",
    "classify schedule request → schedule",
  );
  assert(
    classifyIntent(
      "ช่วยวิเคราะห์ว่าควรจัดการงาน XXX กับ YYY เสร็จก่อนกี่โมงเพราะติดงานอื่น",
    ) === "deep",
    "classify analytical schedule planning → deep",
  );
  assert(
    classifyIntent("เล่าเรื่องตลกให้ฟังหน่อยสิ") === "casual",
    "classify chit-chat → casual",
  );
  assert(classifyIntent("สวัสดีครับ") === "trivial", "classify greeting → trivial");
  assert(
    classifyIntent(undefined) === "schedule",
    "classify undefined → schedule (safe default, never casual)",
  );
  assert(
    classifyIntent("เล่าอะไรก็ได้", { hasFiles: true }) === "schedule",
    "classify with files → schedule (a file is real work)",
  );

  // ---- Unit: routeChat tier → provider/model/budget/stream ----
  const casual = routeChat({ message: "คุยเล่นหน่อยสิ เบื่อ" });
  assert(
    casual.selection.selectedProvider === "gpt4o" &&
      casual.selection.selectedModel === PSU_GPT4O_MODEL &&
      casual.selection.thinkingBudget === undefined &&
      casual.selection.stream === false,
    "casual → gpt4o, no thinking, no stream",
  );

  const schedule = routeChat({ message: "พรุ่งนี้มีประชุมกี่โมง" });
  assert(
    schedule.selection.selectedProvider === "gemini" &&
      schedule.selection.selectedModel === GEMINI_MODEL &&
      schedule.selection.thinkingBudget === 1024 &&
      schedule.selection.stream === true,
    "schedule → gemini, budget 1024, stream",
  );

  const deep = routeChat({
    message:
      "ช่วยวิเคราะห์และวางแผนว่าควรส่งงานไหนก่อนเพราะมีหลายเดดไลน์ชนกัน",
  });
  assert(
    deep.selection.selectedProvider === "gemini" &&
      deep.selection.thinkingBudget === 2048 &&
      deep.selection.stream === true,
    "deep → gemini, budget 2048, stream",
  );

  const files = routeChat({ message: "อันนี้คืออะไร", hasFiles: true });
  assert(
    files.selection.selectedProvider === "gemini",
    "files → gemini (multimodal)",
  );

  // ---- Safety: gpt4o NEVER routed to schedule/deep (auto) ----
  assert(
    schedule.selection.selectedProvider !== "gpt4o" &&
      deep.selection.selectedProvider !== "gpt4o",
    "auto: gpt4o never selected for schedule/deep",
  );

  // ---- Safety: manual gpt4o blocked on schedule/deep, allowed on casual ----
  let blocked = false;
  try {
    selectProvider({
      requestedProvider: "gpt4o",
      message: "พรุ่งนี้มีเรียนกี่โมง",
    });
  } catch (e) {
    blocked = e instanceof ProviderError && e.reason === "schedule-forbidden";
  }
  assert(blocked, "manual gpt4o + schedule intent → ProviderError schedule-forbidden");

  const manualCasual = selectProvider({
    requestedProvider: "gpt4o",
    message: "เล่าเรื่องตลกหน่อย",
  });
  assert(
    manualCasual.selection.selectedProvider === "gpt4o",
    "manual gpt4o + casual intent → allowed",
  );

  // ---- HTTP: stub invoker, auto routing end-to-end ----
  let currentInvoker = async (): Promise<string> =>
    JSON.stringify({ reply: "ok", actions: [] });
  const dynamicInvoker = (_p: string, _o?: unknown) => currentInvoker();
  const app = buildServer({
    aiInvoker: dynamicInvoker as never,
    calendarFetcher: async () => [],
  });
  await app.listen({ host: HOST, port: PORT });

  const httpSchedule = await postJson("/api/chat", {
    message: "ขอตารางวันพรุ่งนี้",
    mode: "auto",
  });
  assert(
    httpSchedule.status === 201 && httpSchedule.json.provider === "gemini",
    "HTTP auto schedule → gemini",
  );

  const httpCasual = await postJson("/api/chat", {
    message: "คุยเล่นหน่อยสิ เบื่อจัง",
    mode: "auto",
  });
  assert(
    httpCasual.status === 201 && httpCasual.json.provider === "gpt4o",
    "HTTP auto casual → gpt4o",
  );

  const httpBlocked = await postJson("/api/chat", {
    message: "พรุ่งนี้มีนัดกี่โมง",
    provider: "gpt4o",
  });
  assert(
    httpBlocked.status === 400 && httpBlocked.json.reason === "schedule-forbidden",
    "HTTP manual gpt4o + schedule → 400 schedule-forbidden",
  );

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nROUTER SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nROUTER SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
