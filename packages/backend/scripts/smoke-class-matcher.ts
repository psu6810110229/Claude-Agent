/**
 * Class matcher smoke (Phase 05 / Sprint 1).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies a terse class reference binds to
 * the right class_block / calendar event, and stays ambiguous when two distinct
 * subjects match comparably.
 */

import type { ClassBlock } from "../src/services/../schemas/classBlock.js";
import type { GoogleEvent } from "../src/services/../schemas/googleCalendar.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function block(
  partial: Partial<ClassBlock> & Pick<ClassBlock, "id" | "subject">,
): ClassBlock {
  return {
    weekday: 4,
    start_local: "13:00",
    end_local: "16:00",
    location: null,
    active_from: null,
    active_until: null,
    status: "active",
    source: "manual",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...partial,
  };
}

function gevent(id: string, title: string): GoogleEvent {
  return {
    id,
    title,
    start: "2026-07-02T13:00:00+07:00",
    end: "2026-07-02T16:00:00+07:00",
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    source: "google",
  };
}

async function main(): Promise<void> {
  console.log("Running class matcher smoke...");

  const { matchClassReference } = await import(
    "../src/services/classMatcher.js"
  );

  const circuit = block({ id: 1, subject: "240-218 วงจรไฟฟ้า Circuit Analysis" });
  const signals = block({ id: 2, subject: "240-301 Signals and Systems" });
  const calc = block({ id: 3, subject: "Calculus II" });

  // --- 1. Course code (dashed) → exact class_block ---
  const r1 = matchClassReference("งดเรียน 240-218 อาทิตย์นี้", {
    classBlocks: [circuit, signals, calc],
  });
  assert(r1.status === "matched", "dashed course code matches one class");
  assert(r1.selected?.id === "1", "code binds the circuit block");
  assert(r1.selected?.signal === "course_code", "code signal recorded");

  // --- 2. Course code without dash still matches ---
  const r2 = matchClassReference("240218 เรียนชดวันไหน", {
    classBlocks: [circuit, signals],
  });
  assert(r2.status === "matched" && r2.selected?.id === "1", "dashless code matches");

  // --- 3. Title token (Latin) → matched ---
  const r3 = matchClassReference("ขอเลื่อน circuit", { classBlocks: [circuit, signals, calc] });
  assert(r3.status === "matched" && r3.selected?.id === "1", "title token binds circuit");
  assert(r3.selected?.signal === "title_token", "token signal recorded");

  // --- 4. Title token (Thai substring) → matched ---
  const r4 = matchClassReference("งดเรียนวงจรไฟฟ้า", { classBlocks: [circuit, signals] });
  assert(r4.status === "matched" && r4.selected?.id === "1", "thai substring binds circuit");

  // --- 5. Ambiguous: shared generic token across two subjects → ambiguous ---
  const sysA = block({ id: 10, subject: "Operating Systems" });
  const sysB = block({ id: 11, subject: "Distributed Systems" });
  const r5 = matchClassReference("งดเรียน systems", { classBlocks: [sysA, sysB] });
  assert(r5.status === "ambiguous", "two subjects sharing a token → ambiguous");
  assert(r5.candidates.length === 2, "ambiguous carries both candidate subjects");

  // --- 6. Decisive code beats weak token noise ---
  const r6 = matchClassReference("240-218 systems", { classBlocks: [circuit, sysA, sysB] });
  assert(r6.status === "matched" && r6.selected?.id === "1", "course code wins over token matches");

  // --- 7. No match → no_match ---
  const r7 = matchClassReference("กินข้าวเย็นกี่โมง", { classBlocks: [circuit, signals] });
  assert(r7.status === "no_match", "unrelated text matches nothing");

  // --- 8. Calendar event candidate matches by code; block preferred when both ---
  const r8 = matchClassReference("240-218", {
    classBlocks: [circuit],
    googleEvents: [gevent("g1", "240-218 วงจรไฟฟ้า (lecture)")],
  });
  assert(r8.status === "matched", "code matches across block+event (same subject)");
  assert(r8.selected?.kind === "class_block", "class_block preferred over calendar event");

  // --- 9. Calendar-only match still resolves ---
  const r9 = matchClassReference("240-301", {
    classBlocks: [circuit],
    googleEvents: [gevent("g2", "240-301 Signals")],
  });
  assert(r9.status === "matched" && r9.selected?.kind === "google_event", "calendar-only code matches event");

  console.log("Class matcher smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
