import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Set env vars BEFORE importing any config-dependent module (module-level
// consts in config.ts are evaluated on first import).
// Scheduler and desktop notifications stay OFF in tests; stub injected.
const TEST_TMP = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step11-"),
);
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.CLAUDE_AGENT_SCHEDULER_ENABLED = "";        // off — we drive tick directly
process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED = ""; // off — stub injected

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8811);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function getJson(p: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function postJson(
  p: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`, { method: "POST" });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 11 (scheduler + notifications) smoke...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { runSchedulerTick } = await import("../src/services/scheduler.js");
  const { StubDesktopNotifier } = await import("../src/services/desktopNotifier.js");
  const { listUnreadNotifications } = await import(
    "../src/db/repositories/notificationRepo.js"
  );
  const { listRecentActivity } = await import(
    "../src/db/repositories/activityRepo.js"
  );
  const { nowIso } = await import("../src/config.js");

  initDb();

  // --- 0. Seven tables exist ---
  const db = getDb();
  const tables: string[] = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
  const expected = [
    "activity_log",
    "approval",
    "event",
    "memory_index",
    "notification",
    "reminder",
    "task",
  ];
  assert(
    expected.every((t) => tables.includes(t)),
    `7 tables exist: ${expected.join(", ")}`,
  );

  // --- 1. Unique index exists on notification(kind, source_id) ---
  const idxRow = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notification_source'",
    )
    .get() as { name: string } | undefined;
  assert(idxRow !== undefined, "unique index idx_notification_source exists");

  // --- 2. Seed: one overdue reminder + one soon event ---
  const nowMs = Date.now();
  const pastIso = new Date(nowMs - 10 * 60 * 1000).toISOString(); // 10 min ago
  const soonIso = new Date(nowMs + 5 * 60 * 1000).toISOString();  // 5 min ahead
  const ts = nowIso();

  db.prepare(
    `INSERT INTO reminder (title, due_at, notes, status, created_at, updated_at)
     VALUES ('Pay bill', ?, 'Electric bill', 'active', ?, ?)`,
  ).run(pastIso, ts, ts);

  db.prepare(
    `INSERT INTO event (title, starts_at, status, created_at, updated_at)
     VALUES ('Team meeting', ?, 'scheduled', ?, ?)`,
  ).run(soonIso, ts, ts);

  // --- 3. First tick with stub notifier → 2 new notifications ---
  const stub = new StubDesktopNotifier();
  runSchedulerTick(new Date(), stub);

  const unread1 = listUnreadNotifications();
  assert(unread1.length === 2, "first tick creates 2 unread notifications");

  assert(
    unread1.some((n) => n.kind === "reminder.due"),
    "overdue reminder fires notification.kind='reminder.due'",
  );
  assert(
    unread1.some((n) => n.kind === "event.soon"),
    "soon event fires notification.kind='event.soon'",
  );

  assert(stub.calls.length === 2, "stub notifier called 2 times on first tick");

  // --- 4. Activity log has 2 notification.fired entries ---
  const activity = listRecentActivity(10);
  const fired = activity.filter((a) => a.event_type === "notification.fired");
  assert(fired.length === 2, "2 notification.fired activity events logged");

  // --- 5. Second tick → no new notifications (dedup) ---
  const stub2 = new StubDesktopNotifier();
  runSchedulerTick(new Date(), stub2);

  const unread2 = listUnreadNotifications();
  assert(unread2.length === 2, "second tick adds 0 new notifications (dedup)");
  assert(stub2.calls.length === 0, "stub notifier not called on second tick");

  // --- 6. Start server for HTTP route tests ---
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  // GET /api/notifications
  const all = await getJson("/api/notifications");
  assert(
    all.status === 200 && Array.isArray(all.json.notifications),
    "GET /api/notifications returns 200 + notifications array",
  );
  assert(
    all.json.notifications.length === 2,
    "GET /api/notifications returns 2 rows",
  );

  // GET /api/notifications/unread
  const unreadRoute = await getJson("/api/notifications/unread");
  assert(
    unreadRoute.status === 200 && unreadRoute.json.notifications.length === 2,
    "GET /api/notifications/unread returns 2 unread rows",
  );

  // POST /api/notifications/:id/read
  const firstId: number = unreadRoute.json.notifications[0].id;
  const markRead = await postJson(`/api/notifications/${firstId}/read`);
  assert(
    markRead.status === 200 && markRead.json.status === "read",
    "POST /api/notifications/:id/read marks notification as read",
  );

  const unreadAfter = await getJson("/api/notifications/unread");
  assert(
    unreadAfter.json.notifications.length === 1,
    "unread count drops to 1 after marking one read",
  );

  // POST non-existent id → 404
  const notFound = await postJson("/api/notifications/99999/read");
  assert(
    notFound.status === 404,
    "POST /api/notifications/99999/read returns 404",
  );

  // --- 7. No approval queue touched, no Claude invoked ---
  const approvals = await getJson("/api/approvals");
  assert(
    approvals.status === 200 && approvals.json.approvals.length === 0,
    "scheduler did not create any approvals",
  );

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
  console.log("\nSTEP 11 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 11 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
