import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + DB + AI disabled BEFORE importing config-dependent
// modules, so the test never touches the real data/claude_agent.db. Mirrors
// smoke-step27.
const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-schedimport-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_DIR, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";

/**
 * Schedule Import — Sprint 1 (local timetable engine) smoke test.
 *
 * Locks the LOCAL class_block store + its bridge into the existing availability
 * engine + the new free-slot finder. No Google call, no AI.
 *
 * Anchor day: 2026-06-29 is a Monday (weekday 1). Bangkok = UTC+7, no DST.
 *   class:  Bangkok Mon 09:00–10:30 → UTC 02:00–03:30.
 *   google: Bangkok Mon 13:00–14:00 → UTC 06:00–07:00.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

const MON = new Date("2026-06-29T05:00:00.000Z"); // Bangkok Mon 12:00

async function main(): Promise<void> {
  console.log("Running Schedule Import Sprint 1 smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const {
    createClassBlock,
    createClassBlockDedup,
    listActiveClassBlocks,
    archiveClassBlock,
  } = await import("../src/db/repositories/classBlockRepo.js");
  const { resolveClassBlockConstraints } = await import(
    "../src/services/classBlockConstraints.js"
  );
  const { resolveScheduleConstraints } = await import(
    "../src/services/scheduleConstraints.js"
  );
  const { materializeConstraints } = await import(
    "../src/services/availabilityResolver.js"
  );
  const { findFreeSlotsForDay } = await import(
    "../src/services/freeSlotFinder.js"
  );

  initDb();

  // ── Block A: class_block → recurring_block constraint ──────────────────────
  const calc = createClassBlock({
    subject: "Calculus",
    weekday: 1,
    start_local: "09:00",
    end_local: "10:30",
    location: "B201",
    active_from: null,
    active_until: null,
    source: "import",
  });
  const constraints = resolveClassBlockConstraints();
  assert(constraints.length === 1, "one class block → one constraint");
  assert(constraints[0].kind === "recurring_block", "kind is recurring_block");
  assert(
    constraints[0].weekdays.length === 1 && constraints[0].weekdays[0] === 1,
    "constraint weekday is Monday (1)",
  );
  assert(
    constraints[0].source === `class_block#${calc.id}`,
    "constraint carries class_block provenance",
  );
  assert(
    resolveScheduleConstraints().some((c) => c.source === `class_block#${calc.id}`),
    "class block flows into resolveScheduleConstraints (availability engine)",
  );

  // ── Block B: materialize for the Monday → one concrete window ──────────────
  const windows = materializeConstraints(resolveClassBlockConstraints(), MON, 1);
  assert(windows.length === 1, "materializes to exactly one window on Monday");
  assert(
    windows[0].start === "2026-06-29T02:00:00.000Z" &&
      windows[0].end === "2026-06-29T03:30:00.000Z",
    "Bangkok 09:00–10:30 → UTC 02:00–03:30",
  );
  // A non-Monday day → no window.
  const tue = new Date("2026-06-30T05:00:00.000Z");
  assert(
    materializeConstraints(resolveClassBlockConstraints(), tue, 1).length === 0,
    "no window materializes on a non-class weekday",
  );

  // ── Block C: term active-range filter ──────────────────────────────────────
  const pastBlock = createClassBlock({
    subject: "OldTerm",
    weekday: 1,
    start_local: "15:00",
    end_local: "16:00",
    location: null,
    active_from: "2020-01-01",
    active_until: "2020-05-01", // entirely in the past
    source: "import",
  });
  const pastConstraint = resolveClassBlockConstraints().find(
    (c) => c.source === `class_block#${pastBlock.id}`,
  )!;
  assert(
    materializeConstraints([pastConstraint], MON, 1).length === 0,
    "out-of-term class block does NOT materialize on 2026 Monday",
  );
  const futureBlock = createClassBlock({
    subject: "ThisTerm",
    weekday: 1,
    start_local: "16:00",
    end_local: "17:00",
    location: null,
    active_from: "2026-06-01",
    active_until: "2026-10-10",
    source: "import",
  });
  const futureConstraint = resolveClassBlockConstraints().find(
    (c) => c.source === `class_block#${futureBlock.id}`,
  )!;
  assert(
    materializeConstraints([futureConstraint], MON, 1).length === 1,
    "in-term class block DOES materialize on 2026 Monday",
  );
  archiveClassBlock(pastBlock.id);
  archiveClassBlock(futureBlock.id);

  // ── Block D: free-slot finder ──────────────────────────────────────────────
  const googleEvent = {
    id: "g1",
    title: "Lunch meeting",
    start: "2026-06-29T06:00:00.000Z", // Bangkok 13:00
    end: "2026-06-29T07:00:00.000Z", // Bangkok 14:00
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    source: "google" as const,
  };
  const slots = findFreeSlotsForDay(MON, {
    googleEvents: [googleEvent],
    localEvents: [],
    constraints: resolveClassBlockConstraints(),
  });
  // Day window 08:00–22:00; busy = class 09:00–10:30 + lunch 13:00–14:00.
  assert(slots.length === 3, "three free windows around class + lunch");
  assert(
    slots[0].startUtc === "2026-06-29T01:00:00.000Z" && slots[0].minutes === 60,
    "first gap is 08:00–09:00 (60m)",
  );
  assert(slots[1].minutes === 150, "second gap 10:30–13:00 is 150m");
  assert(slots[2].minutes === 480, "third gap 14:00–22:00 is 480m");

  // minMinutes filter drops the 60m gap.
  const longOnly = findFreeSlotsForDay(
    MON,
    { googleEvents: [googleEvent], localEvents: [], constraints: resolveClassBlockConstraints() },
    { minMinutes: 120 },
  );
  assert(
    longOnly.length === 2 && longOnly.every((s) => s.minutes >= 120),
    "minMinutes=120 keeps only the two long gaps",
  );

  // An all-day Google event must NOT block leisure time.
  const allDay = { ...googleEvent, id: "g2", allDay: true, end: null };
  const withAllDay = findFreeSlotsForDay(MON, {
    googleEvents: [allDay],
    localEvents: [],
    constraints: [],
  });
  assert(
    withAllDay.length === 1 && withAllDay[0].minutes === 14 * 60,
    "all-day event ignored → whole 08:00–22:00 window free",
  );

  // ── Block E: dedup on (subject, weekday, start) ────────────────────────────
  const before = listActiveClassBlocks().length;
  const dup = createClassBlockDedup({
    subject: "Calculus",
    weekday: 1,
    start_local: "09:00",
    end_local: "10:30",
    location: "B201",
    active_from: null,
    active_until: null,
    source: "import",
  });
  assert(dup.created === false, "duplicate class is not re-created");
  assert(dup.block.id === calc.id, "dedup returns the existing row");
  assert(
    listActiveClassBlocks().length === before,
    "active class block count unchanged after dedup",
  );

  closeDb();
  console.log("\nSchedule Import Sprint 1 smoke test PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
