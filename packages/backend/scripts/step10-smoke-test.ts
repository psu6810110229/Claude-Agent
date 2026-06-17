import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + temp DB + AI/Google disabled BEFORE importing
// config-dependent modules. We inject stub invokers/fetchers; the real Claude
// binary and the real Google API are NEVER reached in this test. The temp DB
// matters: runtime Settings toggles store config overrides in the real DB
// (e.g. google_calendar_enabled) which would beat the env flags below.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step10-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8810);
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

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 10 (Google Calendar read/create) smoke...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { actionTypeSchema } = await import("../src/schemas/approval.js");
  const { GOOGLE_CALENDAR_SCOPES } = await import("../src/config.js");
  const { GoogleCalendarError, realGoogleEventsFetcher } = await import(
    "../src/services/googleCalendar.js"
  );

  // --- 0. The allowlist has the Google Calendar write actions (Step 14 added
  // update/delete); unrelated/legacy names stay absent. ---
  const actionTypes = (actionTypeSchema as any).options as string[];
  const forbidden = [
    "calendar.create",
    "calendar.update",
    "calendar.delete",
    "calendar.event.create",
    "gcal.create",
    "google_event.archive",
  ];
  assert(
    actionTypes.includes("google_event.create") &&
      actionTypes.includes("google_event.update") &&
      actionTypes.includes("google_event.delete") &&
      forbidden.every((t) => !actionTypes.includes(t)),
    "allowlist has Google Calendar create/update/delete write action types",
  );
  assert(
    GOOGLE_CALENDAR_SCOPES.length === 1 &&
      GOOGLE_CALENDAR_SCOPES[0] ===
        "https://www.googleapis.com/auth/calendar.events",
    "Google OAuth scope is limited to Calendar events",
  );

  // initDb() before the disabled-gate check: isGoogleCalendarEnabled() reads
  // the config table (runtime Settings overrides), which must exist.
  initDb();

  // --- 1. Disabled (real fetcher, flag off) fails closed with 'disabled' ---
  let disabledThrew = false;
  try {
    await realGoogleEventsFetcher(
      "2026-06-06T00:00:00.000Z",
      "2026-06-07T00:00:00.000Z",
    );
  } catch (err) {
    disabledThrew =
      err instanceof GoogleCalendarError && err.reason === "disabled";
  }
  assert(disabledThrew, "real fetcher fails closed when disabled");

  // --- Stub Google fetcher returns one timed + one all-day event ---
  const stubEvents = [
    {
      id: "g1",
      title: "Standup",
      start: "2026-06-06T02:00:00.000Z",
      end: "2026-06-06T02:30:00.000Z",
      allDay: false,
      location: "Meet",
      description: "Bring the deck",
      htmlLink: "https://example.test/g1",
      source: "google" as const,
    },
    {
      id: "g2",
      title: "Conference",
      start: "2026-06-09",
      end: "2026-06-10",
      allDay: true,
      location: null,
      description: null,
      htmlLink: null,
      source: "google" as const,
    },
  ];
  const stubFetcher = async () => stubEvents;

  // Stub Claude invoker: assert the Google event title reached the brief prompt,
  // then return an empty (no-action) brief.
  let promptSawGoogle = false;
  const stubInvoker = async (prompt: string): Promise<string> => {
    if (prompt.includes("Standup")) promptSawGoogle = true;
    return JSON.stringify({ summary: "ok", actions: [] });
  };

  const app = buildServer({
    aiInvoker: stubInvoker,
    calendarFetcher: stubFetcher,
  });
  await app.listen({ host: HOST, port: PORT });

  // --- 2. Read routes return stubbed events, available: true ---
  const today = await getJson("/api/calendar/today");
  assert(
    today.status === 200 && today.json.available === true,
    "GET /api/calendar/today returns available:true",
  );
  assert(
    today.json.events.length === 2 &&
      today.json.events[0].source === "google",
    "today returns normalized Google events tagged source:google",
  );
  assert(
    today.json.events.find((e: any) => e.id === "g2").allDay === true,
    "all-day Google event preserves allDay flag",
  );
  // Read route exposes location + description so chat context can surface "where".
  const g1 = today.json.events.find((e: any) => e.id === "g1");
  assert(
    g1.location === "Meet" && g1.description === "Bring the deck",
    "read route returns event location + description",
  );

  const upcoming = await getJson("/api/calendar/upcoming");
  assert(
    upcoming.status === 200 && upcoming.json.available === true,
    "GET /api/calendar/upcoming returns available:true",
  );

  // --- 3. Brief includes Google events in its context ---
  const res = await fetch(`${BASE}/api/briefs/daily`, { method: "POST" });
  assert(res.status === 200, "POST /api/briefs/daily succeeds");
  assert(promptSawGoogle, "Google Calendar events reach the brief prompt");

  await app.close();

  // --- 4. Fail closed: a throwing fetcher -> available:false, empty ---
  const failingApp = buildServer({
    aiInvoker: stubInvoker,
    calendarFetcher: async () => {
      throw new GoogleCalendarError("api", "boom");
    },
  });
  await failingApp.listen({ host: HOST, port: PORT + 1 });
  const failRes = await fetch(`${BASE.replace(String(PORT), String(PORT + 1))}/api/calendar/today`);
  const failJson = await failRes.json();
  assert(
    failRes.status === 200 &&
      failJson.available === false &&
      failJson.events.length === 0,
    "fetch error fails closed (available:false, no events)",
  );
  await failingApp.close();

  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 10 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 10 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
