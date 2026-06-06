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
    if (prompt.includes("CASE_TOOMANY"))
      return JSON.stringify({
        actions: Array.from({ length: 6 }, (_, i) => ({
          action_type: "task.create",
          payload: { title: `t${i}` },
        })),
      });
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

  // --- 4. Markdown fences are NOT stripped → rejected (strict parsing) ---
  const before4 = countApprovals();
  const fenced = await postAi("CASE_FENCE add a task");
  assert(
    fenced.status === 400 && fenced.json.kind === "error",
    "fenced JSON is rejected (no fence-stripping)",
  );
  assert(countApprovals() === before4, "fenced response created zero approvals");

  // --- 5. More than 5 actions is rejected ---
  const before5 = countApprovals();
  const tooMany = await postAi("CASE_TOOMANY add many tasks");
  assert(
    tooMany.status === 400 && tooMany.json.kind === "error",
    "more than 5 actions is rejected",
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

  // --- 7. Invoker failure fails closed; zero approvals ---
  const before7 = countApprovals();
  const failed = await postAi("CASE_FAIL hang please");
  assert(
    failed.status === 504 && failed.json.kind === "error",
    "Claude timeout fails closed with 504",
  );
  assert(countApprovals() === before7, "failed invocation created zero approvals");

  // --- 8. Activity events present ---
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
