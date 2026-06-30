/**
 * Makeup-class planner smoke (Phase 05 / Sprint 3).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies the clarification gate (the
 * 4-dates / 2-ranges case never guesses) and the cancel + makeup operation plan.
 *
 * Anchor week: Mon 2026-06-29 .. Sun 2026-07-05. Circuit class = Thursday 13:00.
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

const tueNow = new Date("2026-06-30T03:00:00.000Z"); // Bangkok Tue 2026-06-30 10:00

async function main(): Promise<void> {
  console.log("Running makeup planner smoke...");

  const { planMakeupClass, pairDatesWithRanges } = await import(
    "../src/services/makeupClassPlanner.js"
  );

  // --- 1. HEADLINE: 4 dates + 2 ranges → clarify, never guess ---
  const r1 = planMakeupClass(
    {
      cancellations: [{ relativeRef: "อาทิตย์นี้" }],
      makeupDates: ["2026-07-09", "2026-07-21", "2026-07-25", "2026-07-26"],
      makeupTimeRanges: [
        { start_local: "19:00", end_local: "21:00" },
        { start_local: "15:00", end_local: "17:00" },
      ],
    },
    { now: tueNow, block: circuit },
  );
  assert(r1.status === "needs_clarification", "4 dates / 2 ranges → needs_clarification");
  assert(r1.clarification?.code === "makeup_date_time_mapping_ambiguous", "mapping ambiguous code");
  assert(r1.operations.length === 0, "no operations staged on ambiguous mapping");

  // --- 2. Single shared range → every date uses it ---
  const r2 = planMakeupClass(
    {
      makeupDates: ["2026-07-09", "2026-07-21"],
      makeupTimeRanges: [{ start_local: "19:00", end_local: "21:00" }],
    },
    { now: tueNow, block: circuit },
  );
  assert(r2.status === "planned", "one range, many dates → planned");
  assert(r2.operations.length === 2, "two makeup operations");
  assert(r2.operations[0].kind === "create_makeup", "makeup op kind");
  assert(r2.operations[0].startUtc === "2026-07-09T12:00:00.000Z", "19:00 Bangkok → 12:00Z");
  assert(r2.operations[0].endUtc === "2026-07-09T14:00:00.000Z", "21:00 Bangkok → 14:00Z");

  // --- 3. Equal counts → zip date[i] with range[i] ---
  const r3 = planMakeupClass(
    {
      makeupDates: ["2026-07-09", "2026-07-21"],
      makeupTimeRanges: [
        { start_local: "19:00", end_local: "21:00" },
        { start_local: "15:00", end_local: "17:00" },
      ],
    },
    { now: tueNow, block: circuit },
  );
  assert(r3.status === "planned", "equal counts → planned");
  assert(r3.operations[1].startUtc === "2026-07-21T08:00:00.000Z", "15:00 Bangkok → 08:00Z (zipped)");

  // --- 4. Cancel relative ref → one cancel op on this week's Thursday ---
  const r4 = planMakeupClass(
    { cancellations: [{ relativeRef: "อาทิตย์นี้" }] },
    { now: tueNow, block: circuit },
  );
  assert(r4.status === "planned" && r4.operations.length === 1, "cancel-only → one op");
  assert(r4.operations[0].kind === "cancel" && r4.operations[0].dateLocal === "2026-07-02", "cancel on 2026-07-02");

  // --- 5. Cancel binds to a live calendar event id ---
  const ev: GoogleEvent = {
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
  const r5 = planMakeupClass(
    { cancellations: [{ relativeRef: "อาทิตย์นี้" }] },
    { now: tueNow, block: circuit, googleEvents: [ev] },
  );
  assert(r5.operations[0].eventId === "evt_thu", "cancel targets the live event id");

  // --- 6. Makeup dates but no time → clarify ---
  const r6 = planMakeupClass(
    { makeupDates: ["2026-07-09"] },
    { now: tueNow, block: circuit },
  );
  assert(r6.clarification?.code === "makeup_time_missing", "dates without time → clarify");

  // --- 7. Invalid range (end<=start) → clarify ---
  const r7 = planMakeupClass(
    { makeupDates: ["2026-07-09"], makeupTimeRanges: [{ start_local: "17:00", end_local: "15:00" }] },
    { now: tueNow, block: circuit },
  );
  assert(r7.clarification?.code === "makeup_time_invalid", "end<=start → clarify");

  // --- 8. Unresolved cancel reference → clarify ---
  const r8 = planMakeupClass(
    { cancellations: [{ relativeRef: "เลื่อนหน่อย" }] },
    { now: tueNow, block: circuit },
  );
  assert(r8.clarification?.code === "cancel_reference_unresolved", "unresolvable cancel → clarify");

  // --- 9. Out-of-term explicit cancel date → clarify ---
  const r9 = planMakeupClass(
    { cancellations: [{ dateLocal: "2026-09-01" }] },
    { now: tueNow, block: { ...circuit, active_until: "2026-07-31" } },
  );
  assert(r9.clarification?.code === "cancel_out_of_term", "cancel past term → clarify");

  // --- 10. Nothing to do → no clarification spam, explicit nothing_to_do ---
  const r10 = planMakeupClass({}, { now: tueNow, block: circuit });
  assert(r10.clarification?.code === "nothing_to_do", "empty intent → nothing_to_do");

  // --- 11. Cancel + makeup combined → both ops, cancel first ---
  const r11 = planMakeupClass(
    {
      cancellations: [{ relativeRef: "อาทิตย์นี้" }],
      makeupDates: ["2026-07-09"],
      makeupTimeRanges: [{ start_local: "19:00", end_local: "21:00" }],
      online: true,
    },
    { now: tueNow, block: circuit },
  );
  assert(r11.status === "planned" && r11.operations.length === 2, "cancel+makeup → 2 ops");
  assert(r11.operations[0].kind === "cancel" && r11.operations[1].kind === "create_makeup", "cancel ordered before makeup");
  assert(r11.operations[1].online === true, "makeup marked online");

  // --- 12. pairDatesWithRanges direct contract ---
  assert(pairDatesWithRanges(["a", "b", "c"], [{ start_local: "1:00", end_local: "2:00" }])!.length === 3, "one range fans out");
  assert(pairDatesWithRanges(["a", "b"], [{ start_local: "1:00", end_local: "2:00" }, { start_local: "3:00", end_local: "4:00" }])!.length === 2, "equal counts zip");
  assert(pairDatesWithRanges(["a", "b", "c", "d"], [{ start_local: "1:00", end_local: "2:00" }, { start_local: "3:00", end_local: "4:00" }]) === null, "4x2 → null");

  console.log("Makeup planner smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
