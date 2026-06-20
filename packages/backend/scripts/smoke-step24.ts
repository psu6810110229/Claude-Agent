import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step24-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8824);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

function ev(id: string, start: string, end: string): any {
  return {
    id,
    title: id,
    start,
    end,
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    source: "google",
  };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 24 (schedule prefs) smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { getDb, closeDb } = await import("../src/db/connection.js");
  const { analyzeSchedule, DEFAULT_SCHEDULE_HEALTH_OPTIONS } = await import(
    "../src/services/scheduleHealth.js"
  );
  const { getSchedulePrefs, setSchedulePrefs } = await import(
    "../src/services/schedulePrefs.js"
  );
  const { buildServer } = await import("../src/server.js");

  initDb();

  // --- 1. protected_day finding from options ---
  {
    const { findings } = analyzeSchedule(
      // 2026-06-17 is a Wednesday (dow=3).
      [ev("w", "2026-06-17T14:00:00+07:00", "2026-06-17T15:00:00+07:00")],
      { ...DEFAULT_SCHEDULE_HEALTH_OPTIONS, protectedDays: [3] },
    );
    const p = findings.find((f: any) => f.kind === "protected_day");
    assert(p && p.severity === "medium", "protected_day flagged for Wed event");
  }

  // --- 2. workStartHour override tightens after_hours ---
  {
    const base = analyzeSchedule([
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
    ]);
    assert(
      !base.findings.some((f: any) => f.kind === "after_hours"),
      "09:00 event is fine under default work-start (08:00)",
    );
    const tight = analyzeSchedule(
      [ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00")],
      { ...DEFAULT_SCHEDULE_HEALTH_OPTIONS, workStartHour: 10 },
    );
    assert(
      tight.findings.some((f: any) => f.kind === "after_hours"),
      "same event flagged after_hours when work-start moved to 10:00",
    );
  }

  // --- 3. defaults when nothing stored ---
  {
    const prefs = getSchedulePrefs();
    assert(
      prefs.workStartHour === 8 &&
        prefs.workEndHour === 19 &&
        prefs.minBufferMin === 10 &&
        prefs.protectedDays.length === 0,
      "getSchedulePrefs returns built-in defaults when unset",
    );
  }

  // --- 4. round-trip set/get ---
  {
    setSchedulePrefs({ workStartHour: 10, protectedDays: [3, 0] });
    const prefs = getSchedulePrefs();
    assert(prefs.workStartHour === 10, "stored workStartHour read back");
    assert(
      prefs.protectedDays.join(",") === "0,3",
      "protectedDays stored sorted/deduped",
    );
    assert(
      prefs.workEndHour === 19,
      "untouched pref keeps default",
    );
  }

  // --- 5. invalid cross-field is guarded on read ---
  {
    // Write an end-hour <= start-hour directly; getSchedulePrefs must fall back.
    const { setConfigString } = await import(
      "../src/db/repositories/configRepo.js"
    );
    setConfigString("schedule_work_start_hour", "15");
    setConfigString("schedule_work_end_hour", "9");
    const prefs = getSchedulePrefs();
    assert(
      prefs.workEndHour === 19,
      "workEndHour <= workStartHour falls back to default",
    );
    // restore sane state
    setConfigString("schedule_work_start_hour", "8");
    setConfigString("schedule_work_end_hour", "19");
  }

  // --- 6. routes: GET/PUT + validation ---
  {
    const stubFetcher = async (): Promise<any[]> => [
      ev("w", "2026-06-17T14:00:00+07:00", "2026-06-17T15:00:00+07:00"),
    ];
    const app = buildServer({ calendarFetcher: stubFetcher });
    await app.listen({ host: HOST, port: PORT });
    try {
      const get = await fetch(`${BASE}/api/settings/schedule`);
      const getJson: any = await get.json();
      assert(
        get.status === 200 && typeof getJson.workStartHour === "number",
        "GET /api/settings/schedule returns prefs",
      );

      const putBad = await fetch(`${BASE}/api/settings/schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workStartHour: 30 }),
      });
      assert(putBad.status === 400, "PUT rejects out-of-range workStartHour");

      const putOk = await fetch(`${BASE}/api/settings/schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protectedDays: [3] }),
      });
      const putJson: any = await putOk.json();
      assert(
        putOk.status === 200 && putJson.protectedDays.join(",") === "3",
        "PUT stores protectedDays and echoes effective prefs",
      );

      // Integration: the stored protected day now drives /health.
      const health = await fetch(`${BASE}/api/calendar/health`);
      const healthJson: any = await health.json();
      assert(
        healthJson.available === true &&
          healthJson.findings.some((f: any) => f.kind === "protected_day"),
        "/api/calendar/health honours stored protectedDays",
      );
    } finally {
      await app.close();
    }
  }

  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 24 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 24 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
