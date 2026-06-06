import { buildServer } from "../src/server.js";
import { initDb } from "../src/db/init.js";
import { closeDb } from "../src/db/connection.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8800);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 2 smoke test...");
  initDb();
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  // --- Tasks ---
  const created = await req("POST", "/api/tasks", { title: "Smoke task" });
  assert(created.status === 201, "POST /api/tasks returns 201");
  assert(created.json.status === "open", "new task defaults to status 'open'");
  const id: number = created.json.id;

  const list = await req("GET", "/api/tasks");
  assert(list.status === 200 && Array.isArray(list.json.tasks), "GET /api/tasks returns array");
  assert(list.json.tasks.some((t: any) => t.id === id), "created task appears in list");

  const got = await req("GET", `/api/tasks/${id}`);
  assert(got.status === 200 && got.json.id === id, "GET /api/tasks/:id returns the task");

  const patched = await req("PATCH", `/api/tasks/${id}`, { status: "done" });
  assert(patched.status === 200 && patched.json.status === "done", "PATCH updates status to 'done'");
  assert(patched.json.updated_at >= created.json.updated_at, "updated_at advanced on patch");

  const archived = await req("POST", `/api/tasks/${id}/archive`);
  assert(archived.status === 200 && archived.json.status === "archived", "archive sets status 'archived'");

  const missing = await req("GET", "/api/tasks/999999999");
  assert(missing.status === 404, "GET missing task returns 404");

  const badPatch = await req("PATCH", `/api/tasks/${id}`, {});
  assert(badPatch.status === 400, "PATCH with empty body returns 400");

  const badStatus = await req("PATCH", `/api/tasks/${id}`, { status: "archived" });
  assert(badStatus.status === 400, "PATCH cannot set status 'archived' (use archive route)");

  // --- Approvals: create -> approve -> executes ---
  const ap = await req("POST", "/api/approvals", {
    action_type: "task.create",
    payload: { title: "Via approval" },
  });
  assert(ap.status === 201 && ap.json.status === "pending", "POST /api/approvals returns pending approval");
  const apId: number = ap.json.id;

  const tasksBefore = (await req("GET", "/api/tasks")).json.tasks.length;
  const approve = await req("POST", `/api/approvals/${apId}/approve`);
  assert(approve.status === 200 && approve.json.status === "approved", "approve marks approval 'approved'");
  const tasksAfter = (await req("GET", "/api/tasks")).json.tasks.length;
  assert(tasksAfter === tasksBefore + 1, "approving task.create created exactly one task");

  const approveAgain = await req("POST", `/api/approvals/${apId}/approve`);
  assert(approveAgain.status === 409, "re-approving a resolved approval returns 409");

  // --- Approvals: reject ---
  const ap2 = await req("POST", "/api/approvals", {
    action_type: "task.create",
    payload: { title: "To reject" },
  });
  const reject = await req("POST", `/api/approvals/${ap2.json.id}/reject`);
  assert(reject.status === 200 && reject.json.status === "rejected", "reject marks approval 'rejected'");
  const rejectAgain = await req("POST", `/api/approvals/${ap2.json.id}/reject`);
  assert(rejectAgain.status === 409, "re-rejecting a resolved approval returns 409");

  // --- Approvals: invalid payload rejected at propose time ---
  const badPayload = await req("POST", "/api/approvals", {
    action_type: "task.create",
    payload: { title: "" },
  });
  assert(badPayload.status === 400, "approval with invalid payload returns 400");

  const badType = await req("POST", "/api/approvals", {
    action_type: "task.delete",
    payload: {},
  });
  assert(badType.status === 400, "approval with disallowed action_type returns 400");

  // --- Approvals: execution failure leaves approval pending ---
  const ap3 = await req("POST", "/api/approvals", {
    action_type: "task.archive",
    payload: { id: 999999999 },
  });
  const failExec = await req("POST", `/api/approvals/${ap3.json.id}/approve`);
  assert(failExec.status === 422, "approving action on missing target returns 422");
  const stillPending = await req("GET", "/api/approvals");
  const ap3Row = stillPending.json.approvals.find((a: any) => a.id === ap3.json.id);
  assert(ap3Row.status === "pending", "failed execution leaves approval 'pending'");

  // --- Activity ---
  const activity = await req("GET", "/api/activity?limit=100");
  assert(activity.status === 200 && Array.isArray(activity.json.activity), "GET /api/activity returns array");
  const events = new Set(activity.json.activity.map((a: any) => a.event_type));
  for (const e of ["task.create", "task.update", "task.archive", "approval.create", "approval.approve", "approval.reject"]) {
    assert(events.has(e), `activity log contains '${e}' event`);
  }

  await app.close();
  closeDb();
  console.log("\nSTEP 2 SMOKE OK");
  // Let the process exit naturally; forcing process.exit() here can trip a
  // libuv teardown assertion on Windows while handles are still closing.
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 2 SMOKE FAILED:", message);
  process.exit(1);
});
