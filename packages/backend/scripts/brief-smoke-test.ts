import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point memory at a throwaway dir BEFORE importing config-dependent modules.
// Briefs only PROPOSE (never write files), but init seeds memory templates, so
// we keep the user's real repo-root memory/ untouched regardless.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-brief-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
// Ensure the real-binary path is never reachable from this test.
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8807);
const BASE = `http://${HOST}:${PORT}`;

// A distinctive summary string so we can prove it never leaks into activity_log.
const SUMMARY_TEXT = "SUMMARY_SENTINEL_should_not_be_logged";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function postBrief(
  type: "daily" | "evening",
): Promise<{ status: number; json: any }> {
  // Bodyless POST (no Content-Type) — matches the dashboard client and avoids
  // Fastify's empty-JSON-body rejection.
  const res = await fetch(`${BASE}/api/briefs/${type}`, { method: "POST" });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 8 (brief) smoke test...");
  console.log(`  using temp memory dir: ${TEST_MEMORY_DIR}`);

  // Dynamic imports so config picks up env set above.
  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { getDb, closeDb } = await import("../src/db/connection.js");
  const { ClaudeError } = await import("../src/services/claudeClient.js");
  const { isBriefRelevantEvent } = await import("../src/services/brief.js");
  const { CLAUDE_MAX_ACTIONS } = await import("../src/config.js");

  // --- 0. Activity allowlist predicate: genuine changes in, runtime noise out ---
  for (const ev of [
    "task.create",
    "task.update",
    "task.archive",
    "memory.write",
    "approval.approve",
    "approval.reject",
  ]) {
    assert(isBriefRelevantEvent(ev), `brief keeps domain event '${ev}'`);
  }
  for (const ev of [
    "brief.daily.failed",
    "brief.evening.requested",
    "ai.command.failed",
    "ai.command.received",
    "command.received",
    "approval.create",
    "memory.propose",
  ]) {
    assert(!isBriefRelevantEvent(ev), `brief drops internal event '${ev}'`);
  }

  const validOutput = JSON.stringify({
    summary: SUMMARY_TEXT,
    actions: [
      { action_type: "task.create", payload: { title: "Brief proposed task" } },
    ],
    notes: "ignored",
  });

  // The stub returns whatever the current `behavior` produces. Briefs are
  // bodyless, so we can't switch on input — the test sets `behavior` before each
  // call. The real binary is NEVER invoked. We also capture the last prompt to
  // assert the brief framing differs by type.
  let lastPrompt = "";
  let behavior: () => Promise<string> = async () => validOutput;
  const stubInvoker = async (prompt: string): Promise<string> => {
    lastPrompt = prompt;
    return behavior();
  };

  initDb();
  const db = getDb();
  const app = buildServer({ aiInvoker: stubInvoker });
  await app.listen({ host: HOST, port: PORT });

  const countApprovals = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM approval").get() as { n: number }).n;
  const countTasks = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM task").get() as { n: number }).n;

  // --- 1. Valid daily brief: 200, summary returned, one pending approval ---
  const approvalsBefore = countApprovals();
  const tasksBefore = countTasks();
  behavior = async () => validOutput;
  const daily = await postBrief("daily");
  assert(
    daily.status === 200 && daily.json.kind === "brief",
    "valid daily brief returns 200 brief",
  );
  assert(daily.json.type === "daily", "daily brief reports type 'daily'");
  assert(daily.json.summary === SUMMARY_TEXT, "brief returns the summary text");
  assert(
    Array.isArray(daily.json.approvals) && daily.json.approvals.length === 1,
    "daily brief created one approval",
  );
  assert(
    daily.json.approvals.every((a: any) => a.status === "pending"),
    "brief-created approvals are pending",
  );
  assert(
    lastPrompt.includes("Daily Brief"),
    "daily prompt carries the Daily Brief framing",
  );
  assert(
    countApprovals() === approvalsBefore + 1,
    "exactly one approval was persisted",
  );
  assert(
    countTasks() === tasksBefore,
    "no task was created (no immediate execution)",
  );

  // --- 2. Valid evening review: 200, evening framing ---
  behavior = async () => validOutput;
  const evening = await postBrief("evening");
  assert(
    evening.status === 200 && evening.json.type === "evening",
    "valid evening review returns 200 brief of type 'evening'",
  );
  assert(
    lastPrompt.includes("Evening Review"),
    "evening prompt carries the Evening Review framing",
  );

  // --- 3. Invalid JSON is rejected; zero approvals ---
  const before3 = countApprovals();
  behavior = async () => "not json {{{";
  const badJson = await postBrief("daily");
  assert(
    badJson.status === 400 && badJson.json.kind === "error",
    "invalid JSON returns 400 error",
  );
  assert(countApprovals() === before3, "invalid JSON created zero approvals");

  // --- 4. Unknown action type is rejected; zero approvals ---
  const before4 = countApprovals();
  behavior = async () =>
    JSON.stringify({
      summary: SUMMARY_TEXT,
      actions: [{ action_type: "task.delete", payload: { id: 1 } }],
    });
  const unknown = await postBrief("daily");
  assert(
    unknown.status === 400 && unknown.json.kind === "error",
    "unknown action type returns 400 error",
  );
  assert(countApprovals() === before4, "unknown action created zero approvals");

  // --- 5. Missing summary is rejected (summary is required) ---
  const before5 = countApprovals();
  behavior = async () => JSON.stringify({ actions: [] });
  const noSummary = await postBrief("daily");
  assert(
    noSummary.status === 400 && noSummary.json.kind === "error",
    "missing summary returns 400 error",
  );
  assert(countApprovals() === before5, "missing summary created zero approvals");

  // --- 6. More than CLAUDE_MAX_ACTIONS actions is rejected ---
  const before6 = countApprovals();
  behavior = async () =>
    JSON.stringify({
      summary: SUMMARY_TEXT,
      // One over the configured cap so the over-limit rejection always fires.
      actions: Array.from({ length: CLAUDE_MAX_ACTIONS + 1 }, (_, i) => ({
        action_type: "task.create",
        payload: { title: `t${i}` },
      })),
    });
  const tooMany = await postBrief("daily");
  assert(
    tooMany.status === 400 && tooMany.json.kind === "error",
    "more than CLAUDE_MAX_ACTIONS actions is rejected",
  );
  assert(countApprovals() === before6, "over-cap response created zero approvals");

  // --- 7. A single outer markdown code fence is unwrapped → accepted ---
  const before7 = countApprovals();
  behavior = async () => "```json\n" + validOutput + "\n```";
  const fenced = await postBrief("daily");
  assert(
    fenced.status === 200 && fenced.json.kind === "brief",
    "fenced brief JSON is unwrapped and accepted",
  );
  assert(
    Array.isArray(fenced.json.approvals) && fenced.json.approvals.length === 1,
    "fenced brief created one approval",
  );
  assert(
    countApprovals() === before7 + 1,
    "fenced brief persisted one approval",
  );

  // --- 7b. Prose before the JSON is still rejected (not unwrapped) ---
  const before7b = countApprovals();
  behavior = async () => "Here is your brief:\n" + validOutput;
  const prose = await postBrief("daily");
  assert(
    prose.status === 400 && prose.json.kind === "error",
    "prose + JSON is rejected",
  );
  assert(countApprovals() === before7b, "prose brief created zero approvals");

  // --- 8. Empty actions is valid: 200 brief with zero approvals ---
  const before8 = countApprovals();
  behavior = async () =>
    JSON.stringify({ summary: SUMMARY_TEXT, actions: [] });
  const empty = await postBrief("evening");
  assert(
    empty.status === 200 && empty.json.kind === "brief",
    "empty actions returns 200 brief",
  );
  assert(
    Array.isArray(empty.json.approvals) && empty.json.approvals.length === 0,
    "empty-actions brief carries an empty approvals list",
  );
  assert(countApprovals() === before8, "empty-actions brief created zero approvals");

  // --- 9. Invoker timeout fails closed with 504 ---
  const before9 = countApprovals();
  behavior = async () => {
    throw new ClaudeError("timeout", "stub: simulated timeout");
  };
  const timedOut = await postBrief("daily");
  assert(
    timedOut.status === 504 && timedOut.json.kind === "error",
    "Claude timeout fails closed with 504",
  );
  assert(countApprovals() === before9, "timeout created zero approvals");

  // --- 10. Disabled fails closed with 503 ---
  behavior = async () => {
    throw new ClaudeError("disabled", "stub: AI disabled");
  };
  const disabled = await postBrief("daily");
  assert(
    disabled.status === 503 && disabled.json.kind === "error",
    "Claude disabled fails closed with 503",
  );

  // --- 11. Other invoker failure fails closed with 502 ---
  behavior = async () => {
    throw new ClaudeError("nonzero-exit", "stub: claude crashed");
  };
  const failed = await postBrief("evening");
  assert(
    failed.status === 502 && failed.json.kind === "error",
    "Claude failure fails closed with 502",
  );

  // --- 11b. Brief context excludes internal/runtime events, keeps real changes ---
  // The log is already full of brief.*/ai.* runtime events from the calls above.
  // Seed one genuine domain change, then assert the prompt reflects the filter.
  const ts = new Date().toISOString();
  const DOMAIN_DETAIL = "DOMAIN_CHANGE_SENTINEL";
  db.prepare(
    "INSERT INTO activity_log (event_type, detail, created_at) VALUES (?, ?, ?)",
  ).run("task.create", DOMAIN_DETAIL, ts);
  behavior = async () => JSON.stringify({ summary: SUMMARY_TEXT, actions: [] });
  await postBrief("evening");
  assert(
    lastPrompt.includes(DOMAIN_DETAIL),
    "brief prompt includes the genuine domain change in RECENT CHANGES",
  );
  for (const noise of [
    "brief.daily.failed",
    "brief.evening.requested",
    "ai.command.received",
    "ai.command.failed",
  ]) {
    assert(
      !lastPrompt.includes(noise),
      `brief prompt excludes internal event '${noise}'`,
    );
  }

  // --- 12. Activity events present, and full brief text never logged ---
  const rows = db
    .prepare("SELECT event_type, detail FROM activity_log")
    .all() as { event_type: string; detail: string | null }[];
  const events = new Set(rows.map((r) => r.event_type));
  assert(events.has("brief.daily.requested"), "activity has brief.daily.requested");
  assert(events.has("brief.daily.generated"), "activity has brief.daily.generated");
  assert(events.has("brief.daily.proposed"), "activity has brief.daily.proposed");
  assert(events.has("brief.daily.rejected"), "activity has brief.daily.rejected");
  assert(events.has("brief.daily.failed"), "activity has brief.daily.failed");
  assert(
    events.has("brief.evening.requested"),
    "activity has brief.evening.requested",
  );
  assert(
    events.has("brief.evening.generated"),
    "activity has brief.evening.generated",
  );
  assert(
    rows.every((r) => !(r.detail ?? "").includes(SUMMARY_TEXT)),
    "full brief summary text is NEVER written to the activity log",
  );

  await app.close();
  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });

  console.log("\nSTEP 8 BRIEF SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 8 BRIEF SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
