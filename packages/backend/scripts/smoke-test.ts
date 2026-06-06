import fs from "node:fs";
import { buildServer } from "../src/server.js";
import { initDb } from "../src/db/init.js";
import { getDb, closeDb } from "../src/db/connection.js";
import { DB_PATH } from "../src/config.js";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8799);
const REQUIRED_TABLES = ["task", "memory_index", "approval", "activity_log"];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent backend smoke test...");

  // 1. DB init + file exists
  initDb();
  assert(fs.existsSync(DB_PATH), `SQLite database exists at ${DB_PATH}`);

  // 2. the four MVP tables exist
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

  // cleanup
  await app.close();
  closeDb();
  console.log("\nSMOKE OK");
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSMOKE FAILED:", message);
  process.exit(1);
});
