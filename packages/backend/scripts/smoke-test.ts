import fs from "node:fs";
import { buildServer } from "../src/server.js";
import { initDb } from "../src/db/init.js";
import { getDb, closeDb } from "../src/db/connection.js";
import { DB_PATH } from "../src/config.js";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8799);
const REQUIRED_TABLES = [
  "task",
  "memory_index",
  "approval",
  "activity_log",
  "event",
  "reminder",
  "notification",
  "chat_message",
  "memory_fact",
];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent backend smoke test...");

  // 1. DB init + file exists
  initDb();
  assert(fs.existsSync(DB_PATH), `SQLite database exists at ${DB_PATH}`);

  // 2. the required tables exist (4 MVP + event/reminder from Step 9)
  const db = getDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  const names = new Set(rows.map((r) => r.name));
  for (const t of REQUIRED_TABLES) {
    assert(names.has(t), `table '${t}' exists`);
  }

  // 3. backend starts (bound to 127.0.0.1)
  const app = buildServer();
  await app.listen({ host: TEST_HOST, port: TEST_PORT });
  assert(true, `backend started on ${TEST_HOST}:${TEST_PORT}`);

  // 4. GET /api/health returns { status: "ok" }
  const res = await fetch(`http://${TEST_HOST}:${TEST_PORT}/api/health`);
  assert(res.status === 200, "GET /api/health returns HTTP 200");
  const body = (await res.json()) as unknown;
  assert(
    JSON.stringify(body) === JSON.stringify({ status: "ok" }),
    'GET /api/health body equals { status: "ok" }',
  );

  // 5. POST /api/command — deterministic command bar (Step 5).
  // NOTE: this queues a couple of *pending* approvals in the dev DB (none are
  // executed, so no memory files are written); they can be rejected in the UI.
  const base = `http://${TEST_HOST}:${TEST_PORT}`;
  async function postCommand(
    input: string,
  ): Promise<{ status: number; body: any }> {
    const r = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    return { status: r.status, body: (await r.json()) as unknown };
  }

  const help = await postCommand("help");
  assert(
    help.status === 200 &&
      help.body.kind === "help" &&
      Array.isArray(help.body.examples),
    "command 'help' returns help examples",
  );

  const addCmd = await postCommand("add task: Smoke task");
  console.log(JSON.stringify(addCmd.body, null, 2));
  assert(
    addCmd.status === 201 &&
      addCmd.body.kind === "proposal" &&
      addCmd.body.approval.action_type === "task.create",
    "command 'add task' creates a task.create proposal",
  );
  assert(
    addCmd.body.approval.status === "pending",
    "command-created approval is pending (not executed immediately)",
  );

  const memCmd = await postCommand("append memory preferences: concise please");
  assert(
    memCmd.status === 201 &&
      memCmd.body.approval.action_type === "memory.write" &&
      memCmd.body.approval.payload.mode === "append",
    "command 'append memory' creates an append memory.write proposal",
  );

  const bad = await postCommand("frobnicate the widget");
  assert(
    bad.status === 400 && bad.body.kind === "error",
    "unrecognized command returns a 400 error",
  );

  const badTarget = await postCommand("append memory nonsense: hi");
  assert(
    badTarget.status === 400 && badTarget.body.kind === "error",
    "unknown memory target is rejected",
  );

  const events = new Set(
    (db.prepare("SELECT event_type FROM activity_log").all() as {
      event_type: string;
    }[]).map((r) => r.event_type),
  );
  assert(events.has("command.received"), "activity log has command.received");
  assert(events.has("command.proposed"), "activity log has command.proposed");
  assert(events.has("command.rejected"), "activity log has command.rejected");

  // cleanup
  await app.close();
  closeDb();
  // Let the process exit naturally after teardown. Calling process.exit(0) here
  // raced libuv handle teardown on Windows (UV_HANDLE_CLOSING assertion) and
  // produced a nonzero exit despite all assertions passing.
  console.log("\nSMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSMOKE FAILED:", message);
  process.exit(1);
});
