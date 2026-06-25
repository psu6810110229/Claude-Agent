import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-schedextract-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_DIR, "test.db");
process.env.CLAUDE_AGENT_UPLOAD_DIR = path.join(TEST_DIR, "uploads");
process.env.CLAUDE_AGENT_AI_ENABLED = "";

/**
 * Schedule Import — Sprint 2 (upload → extract → review → approve) smoke test.
 *
 * Exercises the extraction + staging pipeline with NO real Gemini call (stub
 * invokers) and NO HTTP. Locks: magic-byte sniff, weekday/time normalization,
 * the extractor contract, upload consumption, and approve → class_block with term
 * bounds + incomplete-item handling.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Schedule Import Sprint 2 smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { sniffFileKind } = await import("../src/services/fileExtractor.js");
  const {
    parseWeekday,
    normalizeHhmm,
    normalizeExtractionToItems,
    runScheduleExtraction,
  } = await import("../src/services/scheduleExtractor.js");
  const { saveUpload, readUpload } = await import("../src/services/uploadStore.js");
  const { createImportFromUpload, approveImport } = await import(
    "../src/services/scheduleImportService.js"
  );
  const { updateScheduleImportItem } = await import(
    "../src/db/repositories/scheduleImportRepo.js"
  );
  const { getClassBlockById } = await import(
    "../src/db/repositories/classBlockRepo.js"
  );

  initDb();

  // ── Block A: magic-byte sniff (allowlist by content, not name) ─────────────
  assert(
    sniffFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])) === "image/png",
    "PNG signature → image/png",
  );
  assert(
    sniffFileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg",
    "JPEG signature → image/jpeg",
  );
  assert(
    sniffFileKind(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])) === "application/pdf",
    "%PDF signature → application/pdf",
  );
  assert(
    sniffFileKind(Buffer.from("GIF89a")) === null,
    "disallowed type (GIF) → null (rejected)",
  );
  assert(sniffFileKind(Buffer.from([0x00])) === null, "tiny garbage → null");

  // ── Block B: weekday + time normalization (pure) ───────────────────────────
  assert(parseWeekday("Monday") === 1, "Monday → 1");
  assert(parseWeekday("จันทร์") === 1, "จันทร์ → 1");
  assert(parseWeekday("WED") === 3, "WED → 3");
  assert(parseWeekday("blah") === null, "unknown weekday → null");
  assert(normalizeHhmm("9:05") === "09:05", "9:05 → 09:05");
  assert(normalizeHhmm("13.30") === "13:30", "13.30 → 13:30");
  assert(normalizeHhmm("25:00") === null, "out-of-range time → null");
  assert(normalizeHhmm("noon") === null, "non-time → null");

  const normItems = normalizeExtractionToItems({
    classes: [
      { subject: "Calc", day: "monday", start: "9:00", end: "10:30", location: "B1" },
      { subject: "Bad", day: "tuesday", start: "11:00", end: "10:00", location: null },
    ],
    term_from: null,
    term_until: null,
    note: null,
  } as any);
  assert(normItems[0].weekday === 1 && normItems[0].start_local === "09:00", "item normalized");
  assert(
    normItems[1].end_local === null,
    "end<=start drops the end (forces user fix)",
  );

  // ── Block C: extractor contract via stub (text source) ─────────────────────
  const stubText = async () =>
    JSON.stringify({
      classes: [{ subject: "History", day: "friday", start: "14:00", end: "15:30", location: "C9" }],
      term_from: "2026-06-01",
      term_until: "2026-10-10",
      note: null,
    });
  const extracted = await runScheduleExtraction(
    { mode: "text", text: "History Fri 14:00-15:30 C9" },
    { textInvoke: stubText },
  );
  assert(extracted.items.length === 1, "extractor returns one item");
  assert(extracted.items[0].weekday === 5, "Friday mapped to 5");
  assert(extracted.extraction.term_from === "2026-06-01", "term_from parsed");

  // ── Block D: upload → import → approve (vision stub) ────────────────────────
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const uploadId = saveUpload(pngBuf);
  const stubVision = async () =>
    JSON.stringify({
      classes: [
        { subject: "Calculus", day: "monday", start: "09:00", end: "10:30", location: "B201" },
        { subject: "Physics", day: "tuesday", start: "13:00", end: "14:30", location: null },
        { subject: "Unreadable", day: null, start: null, end: null, location: null },
      ],
      term_from: "2026-06-01",
      term_until: "2026-10-10",
      note: null,
    });
  const created = await createImportFromUpload(uploadId, { visionInvoke: stubVision });
  assert(created.items.length === 3, "import has 3 candidate items");
  assert(created.import.term_from === "2026-06-01", "import carries parsed term_from");
  assert(readUpload(uploadId) === null, "upload file consumed/deleted after import");

  // Deselect the unreadable item; approve the rest.
  const unreadable = created.items.find((i) => i.subject === "Unreadable")!;
  updateScheduleImportItem(unreadable.id, { selected: false });

  const result = approveImport(created.import.id, { term_from: null, term_until: null });
  assert(result.created.length === 2, "two complete items → two class blocks");
  assert(result.rejected === 1, "deselected unreadable item rejected");
  assert(result.skipped.length === 0, "no incomplete selected items left");
  const block = getClassBlockById(result.created[0].id)!;
  assert(
    block.active_from === "2026-06-01" && block.active_until === "2026-10-10",
    "approved block inherits term bounds",
  );
  assert(block.source === "import", "approved block source = import");

  // ── Block E: incomplete selected item is skipped, session stays pending ────
  const u2 = saveUpload(pngBuf);
  const created2 = await createImportFromUpload(u2, { visionInvoke: stubVision });
  const r2 = approveImport(created2.import.id, { term_from: null, term_until: null });
  assert(r2.skipped.length === 1, "incomplete selected item is skipped, not created");
  assert(r2.created.length === 2, "the two complete items still created");

  closeDb();
  console.log("\nSchedule Import Sprint 2 smoke test PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
