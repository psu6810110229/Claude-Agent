/**
 * Class occurrence resolver smoke (Phase 05 / Sprint 2).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies relative class references resolve
 * to the correct Bangkok-dated occurrence (UTC instants), honor term bounds, and
 * bind to a live calendar event when one matches.
 *
 * Anchor week: Mon 2026-06-29 .. Sun 2026-07-05. Circuit class = Thursday 13:00.
 * "this week" Thursday = 2026-07-02; "next week" = 2026-07-09.
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
  weekday: 4, // Thursday
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

// Bangkok Tue 2026-06-30 10:00 → UTC 03:00Z.
const tueNow = new Date("2026-06-30T03:00:00.000Z");

async function main(): Promise<void> {
  console.log("Running class occurrence resolver smoke...");

  const { resolveClassOccurrence, buildOccurrenceForDate } = await import(
    "../src/services/classOccurrenceResolver.js"
  );

  // --- 1. "อาทิตย์นี้" (this week) → this week's Thursday ---
  const r1 = resolveClassOccurrence("งดเรียนอาทิตย์นี้", circuit, { now: tueNow });
  assert(r1.status === "resolved", "this-week resolves");
  assert(r1.occurrence?.dateLocal === "2026-07-02", "this-week → Thu 2026-07-02");
  assert(r1.occurrence?.startUtc === "2026-07-02T06:00:00.000Z", "13:00 Bangkok → 06:00Z");
  assert(r1.occurrence?.endUtc === "2026-07-02T09:00:00.000Z", "16:00 Bangkok → 09:00Z");
  assert(r1.occurrence?.source === "class_block", "no calendar event → block source");

  // --- 2. "อาทิตย์หน้า" (next week) → +7 days ---
  const r2 = resolveClassOccurrence("เรียนชดอาทิตย์หน้า", circuit, { now: tueNow });
  assert(r2.occurrence?.dateLocal === "2026-07-09", "next-week → Thu 2026-07-09");

  // --- 3. "คาบหน้า" (next class) from Tuesday → upcoming Thursday ---
  const r3 = resolveClassOccurrence("คาบหน้าเรียนกี่โมง", circuit, { now: tueNow });
  assert(r3.marker === "next_class", "next-class marker");
  assert(r3.occurrence?.dateLocal === "2026-07-02", "next-class → 2026-07-02");

  // --- 4. "คาบหน้า" AFTER today's class ended → skips to next week ---
  // Bangkok Thu 2026-07-02 17:00 → UTC 10:00Z (after 16:00 end).
  const afterClass = new Date("2026-07-02T10:00:00.000Z");
  const r4 = resolveClassOccurrence("คาบหน้า", circuit, { now: afterClass });
  assert(r4.occurrence?.dateLocal === "2026-07-09", "next-class after end → 2026-07-09");

  // --- 5. "คาบหน้า" BEFORE today's class ends → today ---
  // Bangkok Thu 2026-07-02 12:00 → UTC 05:00Z (before 16:00 end).
  const beforeClass = new Date("2026-07-02T05:00:00.000Z");
  const r5 = resolveClassOccurrence("คาบหน้า", circuit, { now: beforeClass });
  assert(r5.occurrence?.dateLocal === "2026-07-02", "next-class before end → today 2026-07-02");

  // --- 6. Named weekday agreeing with the class ("พฤหัสนี้") → resolves ---
  const r6 = resolveClassOccurrence("พฤหัสนี้งดเรียน", circuit, { now: tueNow });
  assert(r6.marker === "explicit_weekday" && r6.occurrence?.dateLocal === "2026-07-02", "this-Thursday resolves to 07-02");

  // --- 7. Named weekday NOT this class's day ("พุธนี้") → unresolved ---
  const r7 = resolveClassOccurrence("พุธนี้ว่างไหม", circuit, { now: tueNow });
  assert(r7.status === "unresolved_reference", "this-Wednesday for a Thursday class → unresolved");

  // --- 8. No relative marker → unresolved ---
  const r8 = resolveClassOccurrence("ขอเลื่อนหน่อย", circuit, { now: tueNow });
  assert(r8.status === "unresolved_reference", "no marker → unresolved");

  // --- 9. Term bound excludes the occurrence → out_of_term ---
  const ended = { ...circuit, active_until: "2026-07-01" };
  const r9 = resolveClassOccurrence("อาทิตย์นี้", ended, { now: tueNow });
  assert(r9.status === "out_of_term", "occurrence past active_until → out_of_term");

  // --- 10. Binds to a live calendar event on the same date/time ---
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
  const r10 = resolveClassOccurrence("อาทิตย์นี้", circuit, { now: tueNow, googleEvents: [ev] });
  assert(r10.occurrence?.source === "google_event", "matching calendar event → google_event source");
  assert(r10.occurrence?.eventId === "evt_thu", "occurrence carries the event id");

  // --- 11. buildOccurrenceForDate honors term bounds directly ---
  const b1 = buildOccurrenceForDate("2026-07-02", circuit);
  assert(b1.status === "resolved" && b1.occurrence?.weekday === 4, "explicit date builds Thursday occurrence");
  const b2 = buildOccurrenceForDate("2026-06-15", { ...circuit, active_from: "2026-07-01" });
  assert(b2.status === "out_of_term", "explicit date before active_from → out_of_term");

  console.log("Class occurrence resolver smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
