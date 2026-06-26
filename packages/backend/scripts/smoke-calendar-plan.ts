import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + DB + AI disabled BEFORE importing config-dependent
// modules, so the test never touches the real data/claude_agent.db. Mirrors
// smoke-schedule-import.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-calplan-"));
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_DIR, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";

/**
 * Calendar bulk-create plan smoke test.
 *
 * Locks the core guarantee the feature exists for: a bulk "add these N events"
 * is staged as a reviewable plan, each item is scanned for a TIME CLASH, and a
 * clashing item is NEVER silently created or silently dropped — it is held until
 * the user either picks it (deselect) or ticks "create anyway" (override). No
 * AI. No real Google write (the approve branch under test only takes the
 * skip/reject paths, which never call the executor).
 *
 * Anchor: 2026-06-29 is a Monday, Bangkok = UTC+7 (no DST).
 *   Item A (ready):    Bangkok 15:00–16:00 → UTC 08:00–09:00 (no existing event).
 *   Item B (conflict): Bangkok 09:00–10:30 → UTC 02:00–03:30 (overlaps existing).
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

const EXISTING = {
  id: "g-existing",
  title: "Existing meeting",
  start: "2026-06-29T02:00:00.000Z",
  end: "2026-06-29T03:30:00.000Z",
  allDay: false,
  location: null,
  description: null,
  htmlLink: null,
  source: "google" as const,
};

// Stub calendar: the SAME existing event for any window. Overlaps item B only.
const stubFetcher = async () => [EXISTING];

async function main(): Promise<void> {
  console.log("Running Calendar Plan smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const {
    buildCalendarPlan,
    approveCalendarPlan,
    discardCalendarPlan,
  } = await import("../src/services/calendarPlanService.js");
  const {
    getCalendarPlanById,
    listCalendarPlanItems,
    updateCalendarPlanItem,
  } = await import("../src/db/repositories/calendarPlanRepo.js");

  initDb();

  // ── Block A: build a plan → per-item conflict scan ─────────────────────────
  const { plan, items } = await buildCalendarPlan(
    {
      note: "test plan",
      items: [
        {
          title: "Item A ready",
          starts_at: "2026-06-29T08:00:00.000Z",
          ends_at: "2026-06-29T09:00:00.000Z",
        },
        {
          title: "Item B conflict",
          starts_at: "2026-06-29T02:00:00.000Z",
          ends_at: "2026-06-29T03:30:00.000Z",
        },
      ],
    },
    stubFetcher,
  );

  assert(items.length === 2, "plan stages both items");
  const a = items.find((i) => i.title === "Item A ready")!;
  const b = items.find((i) => i.title === "Item B conflict")!;
  assert(a.status === "ready", "non-clashing item is 'ready'");
  assert(a.selected === 1, "ready item defaults to selected");
  assert(b.status === "conflict", "clashing item is flagged 'conflict'");
  assert(b.selected === 0, "conflict item defaults to UNSELECTED (opt-in)");
  assert(
    typeof b.conflict_with === "string" && b.conflict_with.includes("Existing"),
    "conflict snapshot names the existing event",
  );

  // ── Block B: approve with B selected (no override) + A deselected ──────────
  // No item is eligible to CREATE, so the executor (real Google) is never hit.
  updateCalendarPlanItem(a.id, { selected: false }); // user drops the ready one
  updateCalendarPlanItem(b.id, { selected: true }); // user wants B but no override

  const res = await approveCalendarPlan(plan.id, stubFetcher);
  assert(res.created.length === 0, "nothing created (no eligible item)");
  assert(res.rejected === 1, "deselected ready item is rejected");
  assert(
    res.skippedConflict.length === 1 && res.skippedConflict[0].id === b.id,
    "selected clashing item without override is SKIPPED (never silently lost)",
  );
  assert(res.failed.length === 0, "no failures");
  assert(
    getCalendarPlanById(plan.id)!.status === "approved",
    "plan finalizes when nothing is left to retry",
  );
  const bAfter = listCalendarPlanItems(plan.id).find((i) => i.id === b.id)!;
  assert(bAfter.status === "skipped", "skipped item carries terminal 'skipped' status");

  // ── Block C: discard a fresh plan → no events, items rejected ──────────────
  const { plan: plan2, items: items2 } = await buildCalendarPlan(
    {
      note: null,
      items: [
        {
          title: "Discard me",
          starts_at: "2026-06-29T08:00:00.000Z",
          ends_at: "2026-06-29T09:00:00.000Z",
        },
      ],
    },
    stubFetcher,
  );
  discardCalendarPlan(plan2.id);
  assert(
    getCalendarPlanById(plan2.id)!.status === "discarded",
    "discarded plan is marked 'discarded'",
  );
  assert(
    listCalendarPlanItems(plan2.id).find((i) => i.id === items2[0].id)!.status ===
      "rejected",
    "discarding rejects pending items",
  );

  closeDb();
  console.log("\nCalendar Plan smoke test PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
