/* eslint-disable no-console */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DOOMSDAY schedule edge-case suite (read-only diagnostics).
 *
 * Run: npx tsx packages/backend/tests/integration/schedule-edge-cases.test.ts
 *
 * This repo has NO jest/vitest runner; TS tests are plain tsx scripts with an
 * isolated temp DB and NO real model call (project safety rule). So:
 *   - Model-OUTPUT scenarios (baseline 1/2/5) are proven via the strongest
 *     DETERMINISTIC proxy available: the prompt-contract the model receives, and
 *     a "leaky-stub pipeline probe" — feed runChat a model reply that DELIBERATELY
 *     leaks, then assert the PIPELINE scrubs it. If nothing scrubs it, that is the
 *     production finding (output safety is model-only, no code backstop).
 *   - Interceptor / intent / parser scenarios (3/4 + discovery) are fully
 *     deterministic and assert real behaviour.
 *
 * Every check is COLLECTED (never throws on first fail) so one run captures the
 * full failure matrix for the diagnostics report. Exit code is non-zero if any
 * check fails — including the intentionally-RED discovery tests that encode the
 * desired (not-yet-true) behaviour.
 */

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "doomsday-"));
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_DIR, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";

interface Res {
  id: string;
  phase: "baseline" | "discovery";
  name: string;
  pass: boolean;
  expected: string;
  got: string;
  note?: string;
}
const results: Res[] = [];
function check(r: Omit<Res, "pass"> & { pass: boolean }): void {
  results.push(r);
  console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.id} ${r.name}`);
  if (!r.pass) console.log(`         expected: ${r.expected}\n         got:      ${r.got}`);
}

async function main(): Promise<void> {
  const { initDb } = await import("../../src/db/init.js");
  const { closeDb } = await import("../../src/db/connection.js");
  const { createFact } = await import("../../src/db/repositories/factRepo.js");
  const { buildChatPrompt } = await import("../../src/services/chatPrompt.js");
  const { buildChatContext, runChat } = await import("../../src/services/chat.js");
  const {
    isSchedulingIntent,
    parseConstraintFromFact,
  } = await import("../../src/services/scheduleConstraints.js");
  const {
    materializeConstraints,
    findConstraintViolations,
  } = await import("../../src/services/availabilityResolver.js");

  initDb();

  type G = {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    location: string | null;
    description: string | null;
    htmlLink: string | null;
    source: string;
  };
  const mkGoogle = (events: G[]) =>
    async (aIso: string, bIso: string): Promise<G[]> => {
      const a = Date.parse(aIso);
      const b = Date.parse(bIso);
      return events.filter((e) => {
        const s = Date.parse(e.start);
        return s >= a && s < b;
      });
    };
  const noGoogle = async (): Promise<G[]> => [];

  // ============================ BASELINE ============================

  // --- T1 Overlap Erasure (prompt-contract proxy) ---
  // ScheduleBlock 09:00-12:00 (class fact) + Calendar event 09:00-10:00 must BOTH
  // reach the model. Proxy = both appear in the built prompt.
  {
    createFact({ content: "ทุกวันมีเรียน 09:00-12:00", keywords: "", category: "routine" });
    const start = new Date(Date.now() + 3 * 3600_000).toISOString();
    const end = new Date(Date.now() + 4 * 3600_000).toISOString();
    const ev: G = {
      id: "evDOC",
      title: "หมอฟัน",
      start,
      end,
      allDay: false,
      location: null,
      description: null,
      htmlLink: null,
      source: "google",
    };
    const ctx = await buildChatContext("ขอตารางพรุ่งนี้", mkGoogle([ev]), true);
    const prompt = buildChatPrompt(ctx as any);
    const hasEvent = prompt.includes("หมอฟัน");
    const hasBlock = prompt.includes("เรียน") && /09:00.?12:00|09:00–12:00/.test(prompt);
    check({
      id: "T1",
      phase: "baseline",
      name: "Overlap Erasure: prompt carries BOTH calendar event + class block",
      pass: hasEvent && hasBlock,
      expected: "prompt contains 'หมอฟัน' AND class block 09:00-12:00",
      got: `hasEvent=${hasEvent} hasBlock=${hasBlock}`,
      note: "proxy: prompt-contract; model output non-deterministic (no real model in tests)",
    });
  }

  // --- T2 Pressure Leak — encoded as the APPROVED H4 structural guarantee. ---
  // Blanket reply-scrubbing was REJECTED (corrupts legit replies). The real
  // guarantee: the DB id is physically absent from the model's vocabulary
  // (rendered as [F#]), and an action referencing [F#] is remapped to the real id
  // before dispatch. Two deterministic checks:
  {
    const f = createFact({
      content: "User studies Computer Engineering",
      keywords: "major computer",
      category: "general",
    });
    const msg = "what is my major in computer engineering?";
    const ctx = await buildChatContext(msg, noGoogle, true);
    const prompt = buildChatPrompt(ctx as any);

    // T2a — real id absent from prompt; facts shown as opaque [F#] refs.
    const oldFmt = /- #\d+ \[(identity|preference|relationship|routine|project|general)/.test(
      prompt,
    );
    const hasFRef = /\[F\d+\]/.test(prompt);
    check({
      id: "T2a",
      phase: "baseline",
      name: "Structural id-map: prompt hides real fact id, uses [F#] refs",
      pass: !oldFmt && hasFRef,
      expected: "no '- #<id> [category' fact line; an [F#] ref present",
      got: `oldIdFormat=${oldFmt} hasFRef=${hasFRef}`,
    });

    // T2b — action integrity: model fires fact.update on [F1]; backend remaps the
    // F-number to the real DB id before the approval is created.
    const stub = async (): Promise<string> =>
      JSON.stringify({
        reply: "แก้ให้แล้ว",
        spoken: "ok",
        sensitivity: "normal",
        actions: [{ action_type: "fact.update", payload: { id: 1, content: "updated" } }],
      });
    const out: any = await runChat(msg, stub, noGoogle, { verified: true });
    const appr = (out.approvals ?? []).find((a: any) => a.action_type === "fact.update");
    check({
      id: "T2b",
      phase: "baseline",
      name: "Structural id-map: [F1] remapped to real DB id before dispatch",
      pass: !!appr && appr.payload?.id === f.id,
      expected: `dispatched fact.update payload.id === ${f.id} (real id)`,
      got: appr ? `payload.id=${appr.payload?.id}` : "no fact.update dispatched",
    });
  }

  // --- T3 Interceptor Evasion (deterministic) ---
  // Model returns a mutation (fact.forget) AND a clarification. S1 must strip the
  // clarification because a correction is in flight.
  {
    const stub = async (): Promise<string> =>
      JSON.stringify({
        reply: "รับเรื่องแก้ให้แล้ว",
        spoken: "แก้ให้แล้ว",
        sensitivity: "normal",
        // Post-H4 the model addresses facts by F-number. This is a scheduling-intent
        // turn ("เรียน") so the recurring class fact is boosted to [F1]; id:1 remaps
        // to its real DB id. (id:13 would be an unmapped ref and correctly dropped.)
        actions: [{ action_type: "fact.forget", payload: { id: 1 } }],
        clarification: "ยืนยันมั้ยว่าจะลบวิชาอังกฤษวันพุธ?",
        clarification_choices: ["ลบเลย", "ยกเลิก"],
      });
    const out: any = await runChat(
      "วันพุธบ่ายโมงไม่ได้เรียนอังกฤษ ลบทิ้งด่วน ไม่ต้องถามอะไรอีก",
      stub,
      noGoogle,
      { verified: true },
    );
    const hasForget = (out.approvals ?? []).some((a: any) => a.action_type === "fact.forget");
    const noClar = out.clarification === undefined && out.clarificationChoices === undefined;
    check({
      id: "T3",
      phase: "baseline",
      name: "Interceptor Evasion: mutation dispatched AND clarification cleared",
      pass: hasForget && noClar,
      expected: "approvals include fact.forget; clarification + choices undefined",
      got: `hasForget=${hasForget} clarification=${JSON.stringify(out.clarification)} choices=${JSON.stringify(out.clarificationChoices)}`,
    });
  }

  // --- T4 Intent Marker Bypass (deterministic) ---
  {
    const v = isSchedulingIntent("ขอตารางเรียนพรุ่งนี้ที");
    check({
      id: "T4",
      phase: "baseline",
      name: "Intent Marker: 'ขอตารางเรียนพรุ่งนี้ที' is scheduling intent",
      pass: v === true,
      expected: "true",
      got: String(v),
    });
  }

  // --- T5 WriteGuard Extraction (prompt-contract leak surface) ---
  // A protected_window label must NOT be a string the model can read back. Reality:
  // it IS rendered in PROTECTED WINDOWS for write-gating → reveal-prevention is
  // model-only (no code redaction). Expected to FAIL = finding.
  {
    createFact({
      content: "ตู้ปลา ไฟเปิด 14:00-15:00 ห้ามรบกวน",
      keywords: "",
      category: "general",
    });
    const ctx = await buildChatContext("ช่วงบ่ายสองว่างมั้ย", noGoogle, true);
    const prompt = buildChatPrompt(ctx as any);
    // Threat = extract the user's SPECIFIC protected-activity name / raw text. The
    // real label is "ตู้ปลา: ไฟ" and raw content has "ไฟเปิด"/"ห้ามรบกวน". Those must
    // be absent. (The verifier's generic constant phrase "กฎตู้ปลา-คลาส" is the same
    // for every user and reveals nothing personal — not a per-user leak.)
    const labelLeak = prompt.includes("ตู้ปลา: ");
    const rawLeak = prompt.includes("ไฟเปิด") || prompt.includes("ห้ามรบกวน");
    const hasRedactedTag = prompt.includes("[เวลาส่วนตัว/Protected]");
    check({
      id: "T5",
      phase: "baseline",
      name: "WriteGuard Extraction: specific guard label/raw text not in prompt",
      pass: !labelLeak && !rawLeak && hasRedactedTag,
      expected: "no 'ตู้ปลา: ' label, no raw 'ไฟเปิด'/'ห้ามรบกวน'; redacted tag present",
      got: `labelLeak=${labelLeak} rawLeak=${rawLeak} redactedTag=${hasRedactedTag}`,
      note: "H3 renders time + generic tag; real label consumed only by write-gate object",
    });
  }

  // ======================= AUTONOMOUS DISCOVERY =======================

  // --- D1 WINDOW_RE numeric false positive ---
  // A money/number range "12.00-15.00 บาท" matches the time-window regex and
  // becomes a phantom protected_window blocking 12:00-15:00 daily.
  {
    const fake: any = {
      id: 901,
      content: "ค่าเทอม 12.00-15.00 พันบาท",
      keywords: "",
      category: "general",
      pinned: false,
      source: "test",
      created_at: "",
      updated_at: "",
    };
    const c = parseConstraintFromFact(fake);
    check({
      id: "D1",
      phase: "discovery",
      name: "WINDOW_RE: numeric/money range must NOT parse as a time window",
      pass: c === null,
      expected: "null (not a schedule constraint)",
      got: c ? `${c.kind} ${c.startLocal}-${c.endLocal}` : "null",
      note: "false positive → phantom write-guard blocks 12:00-15:00 every day",
    });
  }

  // --- D2 substring misclassification ('classic' contains 'class') ---
  // A non-class fact with a window is tagged recurring_block via substring match →
  // leaks into the SCHEDULE BLOCKS agenda allowlist.
  {
    const fake: any = {
      id: 902,
      content: "ฟัง classic rock 14:00-15:00",
      keywords: "",
      category: "general",
      pinned: false,
      source: "test",
      created_at: "",
      updated_at: "",
    };
    const c = parseConstraintFromFact(fake);
    check({
      id: "D2",
      phase: "discovery",
      name: "classify: 'classic rock' must NOT be a recurring_block (substring trap)",
      pass: c !== null && c.kind !== "recurring_block",
      expected: "kind !== 'recurring_block' (it is not a class)",
      got: c ? c.kind : "null",
      note: "substring match on 'class' leaks non-class window into agenda",
    });
  }

  // --- D3 overnight window silently dropped ---
  // protected_window 22:00-06:00: materializeConstraints skips it (endMs<=startMs),
  // so a write at 23:00 inside the window is NOT held → guard unenforced.
  {
    const overnight: any = {
      kind: "protected_window",
      label: "ตู้ปลา: กลางคืน",
      weekdays: [],
      startLocal: "22:00",
      endLocal: "06:00",
      source: "fact#903",
      raw: "ไฟปิด 22:00-06:00",
    };
    const now = new Date("2026-06-24T06:00:00.000Z");
    const windows = materializeConstraints([overnight], now);
    // 23:00 Bangkok on 2026-06-24 = 16:00Z.
    const violations = findConstraintViolations(
      { title: "เปลี่ยนน้ำ", startUtc: "2026-06-24T16:00:00.000Z" },
      [overnight],
      now,
    );
    check({
      id: "D3",
      phase: "discovery",
      name: "overnight protected window (22:00-06:00) must be enforced",
      pass: windows.length >= 1 && violations.length >= 1,
      expected: "materialized windows >=1 AND a 23:00 write held (violations>=1)",
      got: `windows=${windows.length} violations=${violations.length}`,
      note: "endMs<=startMs path drops overnight windows → guard silently bypassed",
    });
  }

  // --- D4 isSchedulingIntent Thai substring false positive ---
  // 'ระหว่าง' contains the marker substring 'ว่าง' → a non-scheduling sentence is
  // misclassified as scheduling (needless availability compute + constraint bloat).
  {
    const msg = "ระหว่างนี้สบายดีไหม ไม่ได้คุยกันนาน";
    const v = isSchedulingIntent(msg);
    check({
      id: "D4",
      phase: "discovery",
      name: "intent: 'ระหว่าง...' must NOT trigger scheduling intent",
      pass: v === false,
      expected: "false",
      got: String(v),
      note: "'ว่าง' is a substring of 'ระหว่าง' → false positive from substring matching",
    });
  }

  // ============================ SUMMARY ============================
  const fails = results.filter((r) => !r.pass);
  console.log("\n================ DOOMSDAY MATRIX ================");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} [${r.phase}] ${r.name}`);
  }
  console.log(`\n${results.length - fails.length}/${results.length} passed, ${fails.length} failed`);

  closeDb();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  // Emit machine-readable matrix for the report build step.
  console.log("\nJSON_MATRIX " + JSON.stringify(results));
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("\nSUITE CRASHED:", message);
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(2);
});
