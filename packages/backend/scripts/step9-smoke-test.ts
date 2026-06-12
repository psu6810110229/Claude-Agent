import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point memory at a throwaway dir BEFORE importing config-dependent modules, and
// ensure the real Claude binary is never reachable (we inject a stub invoker).
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step9-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8808);
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

async function getJson(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function postApprove(id: number): Promise<{ status: number; json: any }> {
  // Bodyless POST (no content-type) — matches the dashboard client.
  const res = await fetch(`${BASE}/api/approvals/${id}/approve`, {
    method: "POST",
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 9 (events & reminders) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { getDb, closeDb } = await import("../src/db/connection.js");
  const { bucketEvents, bucketReminders } = await import(
    "../src/services/agenda.js"
  );
  const { listReminders } = await import(
    "../src/db/repositories/reminderRepo.js"
  );

  // --- 0. Agenda bucketing math (Asia/Bangkok, fixed instant) ---
  const now = new Date("2026-06-06T05:00:00.000Z"); // 12:00 in Bangkok
  const ev = bucketEvents(
    [
      mkEvent(1, "2026-06-06T08:00:00.000Z"), // today
      mkEvent(2, "2026-06-09T08:00:00.000Z"), // upcoming
      mkEvent(3, "2026-07-01T08:00:00.000Z"), // beyond window
    ] as any,
    now,
  );
  assert(
    ev.today.map((e: any) => e.id).join(",") === "1",
    "agenda: event today bucket is correct",
  );
  assert(
    ev.upcoming.map((e: any) => e.id).join(",") === "2",
    "agenda: event upcoming (7-day) bucket is correct",
  );

  const rem = bucketReminders(
    [
      mkReminder(1, "2026-06-06T04:00:00.000Z"), // overdue (before now)
      mkReminder(2, "2026-06-06T10:00:00.000Z"), // today (after now)
      mkReminder(3, "2026-06-10T10:00:00.000Z"), // upcoming
    ] as any,
    now,
  );
  assert(
    rem.overdue.map((r: any) => r.id).join(",") === "1",
    "agenda: reminder overdue bucket is correct",
  );
  assert(
    rem.today.map((r: any) => r.id).join(",") === "2",
    "agenda: reminder today bucket is correct",
  );
  assert(
    rem.upcoming.map((r: any) => r.id).join(",") === "3",
    "agenda: reminder upcoming bucket is correct",
  );

  // --- Stub Claude invoker: switch on a marker embedded in the user input ---
  const validProposal = JSON.stringify({
    actions: [
      {
        action_type: "event.create",
        payload: {
          title: "Dentist",
          starts_at: "2026-06-07T08:00:00.000Z",
          location: "Clinic",
        },
      },
      {
        action_type: "reminder.create",
        payload: {
          title: "Pay rent",
          due_at: "2026-06-08T02:00:00.000Z",
        },
      },
    ],
  });
  const badDateProposal = JSON.stringify({
    actions: [
      {
        action_type: "event.create",
        // Non-UTC offset must be rejected by the ISO-UTC schema.
        payload: { title: "Bad", starts_at: "2026-06-07T15:00:00+07:00" },
      },
    ],
  });
  const stubInvoker = async (prompt: string): Promise<string> => {
    if (prompt.includes("CASE_VALID")) return validProposal;
    if (prompt.includes("CASE_BADDATE")) return badDateProposal;
    return JSON.stringify({ actions: [] });
  };

  initDb();
  const db = getDb();

  // --- 1. event/reminder tables exist ---
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  assert(tables.has("event"), "table 'event' exists");
  assert(tables.has("reminder"), "table 'reminder' exists");

  const app = buildServer({ aiInvoker: stubInvoker });
  await app.listen({ host: HOST, port: PORT });

  const countEvents = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM event").get() as { n: number }).n;
  const countReminders = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM reminder").get() as { n: number }).n;

  // --- 2. AI proposes event + reminder → pending approvals, nothing stored ---
  const eventsBefore = countEvents();
  const remindersBefore = countReminders();
  const proposed = await postAi("CASE_VALID schedule my week");
  assert(
    proposed.status === 201 && proposed.json.kind === "proposal",
    "AI event/reminder proposal returns 201",
  );
  assert(
    proposed.json.approvals.length === 2 &&
      proposed.json.approvals.every((a: any) => a.status === "pending"),
    "two pending approvals created",
  );
  assert(
    countEvents() === eventsBefore && countReminders() === remindersBefore,
    "nothing stored before approval (no direct execution)",
  );

  // --- 3. Approving stores the event and the reminder ---
  const ids: Record<string, number> = {};
  for (const a of proposed.json.approvals) ids[a.action_type] = a.id;
  const okEvent = await postApprove(ids["event.create"]);
  const okReminder = await postApprove(ids["reminder.create"]);
  assert(
    okEvent.status === 200 && okEvent.json.status === "approved",
    "approving event.create succeeds",
  );
  assert(
    okReminder.status === 200 && okReminder.json.status === "approved",
    "approving reminder.create succeeds",
  );
  assert(
    countEvents() === eventsBefore + 1,
    "one event row stored after approval",
  );
  assert(
    countReminders() === remindersBefore + 1,
    "one reminder row stored after approval",
  );

  // --- 4. Read routes return the stored rows ---
  const eventsRes = await getJson("/api/events");
  assert(
    eventsRes.status === 200 &&
      eventsRes.json.events.some((e: any) => e.title === "Dentist"),
    "GET /api/events returns the stored event",
  );
  const remindersRes = await getJson("/api/reminders");
  assert(
    remindersRes.status === 200 &&
      remindersRes.json.reminders.some((r: any) => r.title === "Pay rent"),
    "GET /api/reminders returns the stored reminder",
  );

  // --- 5. Ambiguous/non-UTC datetime is rejected → zero approvals ---
  const beforeBad = (
    db.prepare("SELECT COUNT(*) AS n FROM approval").get() as { n: number }
  ).n;
  const bad = await postAi("CASE_BADDATE book something vague");
  assert(
    bad.status === 400 && bad.json.kind === "error",
    "non-UTC datetime proposal is rejected with 400",
  );
  assert(
    (db.prepare("SELECT COUNT(*) AS n FROM approval").get() as { n: number })
      .n === beforeBad,
    "rejected datetime created zero approvals",
  );

  // --- 6. update + archive flow through the approval queue/executor ---
  const storedEvent = eventsRes.json.events.find(
    (e: any) => e.title === "Dentist",
  );
  const updateApproval = await createApprovalRow("event.update", {
    id: storedEvent.id,
    location: "New Clinic",
  });
  const okUpdate = await postApprove(updateApproval.id);
  assert(okUpdate.status === 200, "approving event.update succeeds");
  const afterUpdate = (
    db.prepare("SELECT location FROM event WHERE id = ?").get(storedEvent.id) as {
      location: string;
    }
  ).location;
  assert(afterUpdate === "New Clinic", "event.update changed the row");

  const archiveApproval = await createApprovalRow("event.archive", {
    id: storedEvent.id,
  });
  await postApprove(archiveApproval.id);
  const afterArchive = (
    db.prepare("SELECT status FROM event WHERE id = ?").get(storedEvent.id) as {
      status: string;
    }
  ).status;
  assert(afterArchive === "archived", "event.archive soft-archived the row");
  assert(
    !(await getJson("/api/events")).json.events.some(
      (e: any) => e.id === storedEvent.id,
    ),
    "archived event is excluded from GET /api/events",
  );

  // --- 7. reminder.done (Sprint 1) — distinct from archive ---
  const storedReminder = remindersRes.json.reminders.find(
    (r: any) => r.title === "Pay rent",
  );
  const doneApproval = await createApprovalRow("reminder.done", {
    id: storedReminder.id,
  });
  const okDone = await postApprove(doneApproval.id);
  assert(
    okDone.status === 200 && okDone.json.status === "approved",
    "approving reminder.done succeeds",
  );
  const reminderStatus = (
    db
      .prepare("SELECT status FROM reminder WHERE id = ?")
      .get(storedReminder.id) as { status: string }
  ).status;
  assert(
    reminderStatus === "done",
    "reminder.done sets DB status to 'done' (not 'archived')",
  );
  assert(
    !(await getJson("/api/reminders")).json.reminders.some(
      (r: any) => r.id === storedReminder.id,
    ),
    "done reminder is excluded from GET /api/reminders (active-only)",
  );
  {
    // Overdue bucketing must never include a done reminder.
    const past = new Date("2000-01-01T00:00:00.000Z").toISOString();
    db.prepare("UPDATE reminder SET due_at = ? WHERE id = ?").run(
      past,
      storedReminder.id,
    );
    const buckets = bucketReminders(listReminders(), new Date());
    const allBucketed = [
      ...buckets.overdue,
      ...buckets.today,
      ...buckets.upcoming,
    ];
    assert(
      !allBucketed.some((r: any) => r.id === storedReminder.id),
      "done reminder (even past-due) is not counted as overdue",
    );
  }

  async function createApprovalRow(
    action_type: string,
    payload: unknown,
  ): Promise<any> {
    const res = await fetch(`${BASE}/api/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action_type, payload }),
    });
    return res.json();
  }

  await app.close();
  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });

  console.log("\nSTEP 9 SMOKE OK");
}

function mkEvent(id: number, starts_at: string) {
  return {
    id,
    title: `e${id}`,
    starts_at,
    ends_at: null,
    location: null,
    notes: null,
    status: "scheduled",
    created_at: starts_at,
    updated_at: starts_at,
  };
}

function mkReminder(id: number, due_at: string) {
  return {
    id,
    title: `r${id}`,
    due_at,
    notes: null,
    status: "active",
    created_at: due_at,
    updated_at: due_at,
  };
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 9 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
