import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point memory at a throwaway dir BEFORE importing anything that reads config,
// so the smoke test never touches the user's real repo-root memory/ files.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-memory-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8804);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function req(
  method: string,
  p: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers:
      body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 4 (memory) smoke test...");
  console.log(`  using temp memory dir: ${TEST_MEMORY_DIR}`);

  // Dynamic imports so config picks up CLAUDE_AGENT_MEMORY_DIR set above.
  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");

  initDb();
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  // --- Seed files created by init ---
  for (const f of ["preferences.md", "routines.md", "projects.md", "decisions.md"]) {
    assert(
      fs.existsSync(path.join(TEST_MEMORY_DIR, f)),
      `init seeded memory/${f}`,
    );
  }

  // --- List (shared DB, so just assert shape — not emptiness) ---
  const list0 = await req("GET", "/api/memory");
  assert(
    list0.status === 200 && Array.isArray(list0.json.entries),
    "GET /api/memory returns entries array",
  );

  // --- Read whitelisted file (seeded template) ---
  const read0 = await req("GET", "/api/memory/preferences/content");
  assert(
    read0.status === 200 && read0.json.exists === true,
    "GET /api/memory/preferences/content reads seeded file",
  );
  assert(
    read0.json.path === "memory/preferences.md",
    "content response carries relative path",
  );

  // --- Unknown target -> 404 (no path escape) ---
  const bad = await req("GET", "/api/memory/secrets/content");
  assert(bad.status === 404, "unknown memory target returns 404");

  // --- Propose (replace) -> pending approval, no write yet ---
  const prop = await req("POST", "/api/memory/proposals", {
    target: "preferences",
    mode: "replace",
    content: "Likes concise answers.",
    summary: "concise",
  });
  assert(
    prop.status === 201 && prop.json.status === "pending",
    "POST /api/memory/proposals returns pending approval",
  );
  assert(
    prop.json.action_type === "memory.write",
    "proposal becomes a memory.write approval",
  );
  const beforeApprove = await req("GET", "/api/memory/preferences/content");
  assert(
    !beforeApprove.json.content.includes("Likes concise answers."),
    "file is NOT written before approval",
  );

  // --- Approve -> file written + index upserted ---
  const approve = await req("POST", `/api/approvals/${prop.json.id}/approve`);
  assert(
    approve.status === 200 && approve.json.status === "approved",
    "approving memory.write marks approval approved",
  );
  const afterApprove = await req("GET", "/api/memory/preferences/content");
  assert(
    afterApprove.json.content === "Likes concise answers.",
    "replace wrote exact content after approval",
  );
  const list1 = await req("GET", "/api/memory");
  const pref = list1.json.entries.find((e: any) => e.slug === "preferences");
  assert(
    pref && pref.path === "memory/preferences.md" && pref.summary === "concise",
    "memory_index upserted preferences entry with summary",
  );

  // --- Append mode grows the file ---
  const prop2 = await req("POST", "/api/memory/proposals", {
    target: "preferences",
    mode: "append",
    content: "Prefers bullets.",
  });
  await req("POST", `/api/approvals/${prop2.json.id}/approve`);
  const afterAppend = await req("GET", "/api/memory/preferences/content");
  assert(
    afterAppend.json.content.includes("Likes concise answers.") &&
      afterAppend.json.content.includes("Prefers bullets."),
    "append preserved prior content and added new content",
  );

  // --- Reject leaves the file unchanged ---
  const snapshot = (await req("GET", "/api/memory/routines/content")).json
    .content;
  const prop3 = await req("POST", "/api/memory/proposals", {
    target: "routines",
    mode: "replace",
    content: "Should not be written.",
  });
  const reject = await req("POST", `/api/approvals/${prop3.json.id}/reject`);
  assert(reject.status === 200 && reject.json.status === "rejected", "reject marks rejected");
  const routinesAfter = (await req("GET", "/api/memory/routines/content")).json
    .content;
  assert(
    routinesAfter === snapshot,
    "rejected proposal did not write the file",
  );

  // --- Validation: invalid target proposal -> 400 ---
  const badTarget = await req("POST", "/api/memory/proposals", {
    target: "secrets",
    mode: "replace",
    content: "x",
  });
  assert(badTarget.status === 400, "proposal with invalid target returns 400");

  // --- Validation: oversized content -> 400 ---
  const tooBig = await req("POST", "/api/memory/proposals", {
    target: "decisions",
    mode: "replace",
    content: "x".repeat(50_001),
  });
  assert(tooBig.status === 400, "proposal exceeding content cap returns 400");

  // --- Validation: empty content -> 400 ---
  const empty = await req("POST", "/api/memory/proposals", {
    target: "decisions",
    mode: "replace",
    content: "",
  });
  assert(empty.status === 400, "proposal with empty content returns 400");

  // --- Activity logs for propose + approved write ---
  const activity = await req("GET", "/api/activity?limit=100");
  const events = new Set(activity.json.activity.map((a: any) => a.event_type));
  assert(events.has("memory.propose"), "activity log contains 'memory.propose'");
  assert(
    events.has("approval.approve"),
    "activity log contains 'approval.approve' for the executed write",
  );

  await app.close();
  closeDb();

  // Cleanup temp dir.
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });

  console.log("\nSTEP 4 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 4 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
