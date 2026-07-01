/**
 * Makeup-plan staging smoke (Phase 05 / Sprint 4).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies a planned cancel+makeup maps to
 * canonical approval-queue actions, that summaries line up 1:1 with staged
 * actions, that a cancel without a live event is reported (not dropped, not
 * staged), and that a non-planned plan stages nothing.
 */

import type { ClassBlock } from "../src/services/../schemas/classBlock.js";
import type { GoogleEvent } from "../src/services/../schemas/googleCalendar.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

const circuit: ClassBlock = {
  id: 1,
  subject: "240-218 วงจรไฟฟ้า",
  weekday: 4,
  start_local: "13:00",
  end_local: "16:00",
  location: "R201",
  active_from: null,
  active_until: null,
  status: "active",
  source: "manual",
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

const tueNow = new Date("2026-06-30T03:00:00.000Z");

const liveEvent: GoogleEvent = {
  id: "evt_thu",
  title: "240-218 วงจรไฟฟ้า",
  start: "2026-07-02T13:00:00+07:00",
  end: "2026-07-02T16:00:00+07:00",
  allDay: false,
  location: null,
  description: null,
  htmlLink: null,
  source: "google",
};

async function main(): Promise<void> {
  console.log("Running makeup staging smoke...");

  const { planMakeupClass, stageMakeupPlan } = await import(
    "../src/services/makeupClassPlanner.js"
  );

  // --- 1. Cancel (bound event) + online makeup → delete + create, summaries 1:1 ---
  const plan1 = planMakeupClass(
    {
      cancellations: [{ relativeRef: "อาทิตย์นี้" }],
      makeupDates: ["2026-07-09"],
      makeupTimeRanges: [{ start_local: "19:00", end_local: "21:00" }],
      online: true,
    },
    { now: tueNow, block: circuit, googleEvents: [liveEvent] },
  );
  const s1 = stageMakeupPlan(plan1);
  assert(s1.actions.length === 2, "two staged actions");
  assert(s1.actions.length === s1.actionSummaries.length, "summary line per action (1:1)");
  assert(s1.actions[0].action_type === "google_event.delete", "cancel → google_event.delete");
  assert((s1.actions[0].payload as { id: string }).id === "evt_thu", "delete targets the live event id");
  assert((s1.actions[0].payload as { scope?: string }).scope === "instance", "delete scope is instance (not series)");
  assert(s1.actions[1].action_type === "google_event.create", "makeup → google_event.create");
  assert((s1.actions[1].payload as { location?: string }).location === "ออนไลน์", "online makeup carries online location");
  assert((s1.actions[1].payload as { starts_at: string }).starts_at === "2026-07-09T12:00:00.000Z", "makeup start instant correct");
  assert(s1.unstaged.length === 0, "nothing unstaged when event is bound");

  // --- 2. Cancel with NO live event → unstaged, not an action ---
  const plan2 = planMakeupClass(
    { cancellations: [{ relativeRef: "อาทิตย์นี้" }] },
    { now: tueNow, block: circuit }, // no googleEvents → no eventId
  );
  const s2 = stageMakeupPlan(plan2);
  assert(s2.actions.length === 0, "cancel without event stages no action");
  assert(s2.unstaged.length === 1 && s2.unstaged[0].reason === "cancel_no_calendar_event", "cancel without event reported as unstaged");
  assert(s2.actionSummaries.length === 0, "no summary for an unstaged op (summary==actions invariant)");

  // --- 3. series scope override is honored ---
  const s3 = stageMakeupPlan(plan1, { cancelScope: "series" });
  assert((s3.actions[0].payload as { scope?: string }).scope === "series", "cancelScope override → series");

  // --- 4. Non-planned plan (clarification) → stages nothing ---
  const plan4 = planMakeupClass(
    {
      makeupDates: ["2026-07-09", "2026-07-21", "2026-07-25", "2026-07-26"],
      makeupTimeRanges: [
        { start_local: "19:00", end_local: "21:00" },
        { start_local: "15:00", end_local: "17:00" },
      ],
    },
    { now: tueNow, block: circuit },
  );
  const s4 = stageMakeupPlan(plan4);
  assert(plan4.status === "needs_clarification", "ambiguous plan stays clarification");
  assert(s4.actions.length === 0 && s4.unstaged.length === 0, "clarification plan stages nothing");

  // --- 5. Makeup-only (no cancel) → one create action ---
  const plan5 = planMakeupClass(
    { makeupDates: ["2026-07-09"], makeupTimeRanges: [{ start_local: "19:00", end_local: "21:00" }] },
    { now: tueNow, block: circuit },
  );
  const s5 = stageMakeupPlan(plan5);
  assert(s5.actions.length === 1 && s5.actions[0].action_type === "google_event.create", "makeup-only → one create");
  assert((s5.actions[0].payload as { location?: string }).location === undefined, "offline makeup has no online location");

  console.log("Makeup staging smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
