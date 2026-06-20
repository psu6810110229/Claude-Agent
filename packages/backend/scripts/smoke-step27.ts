import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + AI disabled before importing config-dependent modules.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step27-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

/**
 * Step 27 — Friday scheduling reliability REPRO HARNESS (Sprint 0).
 *
 * Locks the 2026-06-20 fish-tank scheduling failures (F1–F5) down with a
 * deterministic, AI-free reproduction. Each assertion encodes the CURRENT
 * (broken) behaviour so later sprints flip it green. No model is called.
 *
 * Mapping (see docs/FRIDAY_SCHEDULING_RCA.md):
 *   - Block A  RC2 → F1/F2  : event/reminder lines render raw UTC, no weekday.
 *   - Block B  RC1/RC5 → F4 : read path computes no availability/conflicts.
 *   - Block C  RC4 → F3     : durable constraints drop out on keyword-free turns.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

// Transcript anchors (Bangkok = UTC+7). 2026-06-20 is a Friday.
//   reminder: water-change, UTC 00:00Z on 06-22 (a Monday) → Bangkok 07:00.
//   event:    Sunday 06-21 club-room, UTC 02:00Z → Bangkok 09:00.
const WATER_CHANGE_DUE_UTC = "2026-06-22T00:00:00.000Z";
const CLUBROOM_START_UTC = "2026-06-21T02:00:00.000Z";

// Weekday tokens that a FIXED render (Sprint 1) would add to these lines.
const WEEKDAY_TOKENS = ["Mon", "Tue", "Sun", "จันทร์", "อังคาร", "อาทิตย์"];

async function main(): Promise<void> {
  console.log(
    "Running Claude_Agent Step 27 (Friday scheduling repro harness) smoke test...",
  );

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { buildChatPrompt } = await import("../src/services/chatPrompt.js");
  const { buildChatContext } = await import("../src/services/chat.js");
  const { createFact } = await import("../src/db/repositories/factRepo.js");
  const { recallFacts } = await import("../src/services/factRecall.js");

  initDb();

  // A fully-populated minimal ChatContext; blocks override only what they need.
  const baseCtx = (): any => ({
    message: "",
    openTasks: [],
    memorySummaries: [],
    facts: [],
    nowUtc: "2026-06-20T06:00:00.000Z",
    nowBangkok: "2026-06-20 13:00 (Friday / ศุกร์)",
    googleEvents: [],
    events: [],
    reminders: [],
    approvalOutcomes: [],
    history: [],
    gmailUnread: [],
    contacts: [],
    contactsStatus: "disabled",
    recentDriveFiles: [],
    lineChats: [],
    lineMessages: [],
    lineMatches: [],
    autoExecute: false,
    autoExecuteDestructive: false,
  });

  // === Block A — RC2 FIXED (Sprint 1): Bangkok time + weekday pre-computed ===
  // Each agenda line now carries the Bangkok wall-clock AND weekday inline, with
  // the raw UTC kept as a `utc=` anchor for action targeting. The model no longer
  // does +7h or day-of-week math itself → F1/F2 inputs are deterministic.
  {
    const ctx = baseCtx();
    ctx.reminders = [
      {
        id: 44,
        due_at: WATER_CHANGE_DUE_UTC,
        title: "เปลี่ยนน้ำตู้ปลา",
        bucket: "upcoming",
      },
    ];
    ctx.googleEvents = [
      {
        id: "clubroom",
        start: CLUBROOM_START_UTC,
        title: "ประชุมห้องชมรม",
        allDay: false,
        bucket: "upcoming",
      },
    ];
    const prompt = buildChatPrompt(ctx);

    // Pull out just the seeded reminder + event lines (avoid the now-line, which
    // legitimately carries a weekday). Anchor on the raw ISO substrings.
    const reminderLine = prompt
      .split("\n")
      .find((l) => l.includes("เปลี่ยนน้ำตู้ปลา"))!;
    const eventLine = prompt
      .split("\n")
      .find((l) => l.includes("ประชุมห้องชมรม"))!;

    // Raw UTC retained as `utc=` anchor (action targeting still works).
    assert(
      reminderLine.includes(`utc=${WATER_CHANGE_DUE_UTC}`),
      "F2/RC2 fixed: reminder line keeps raw UTC as utc= anchor",
    );
    // Bangkok time pre-computed: 00:00Z → 07:00 Bangkok, weekday Monday.
    assert(
      reminderLine.includes("07:00") &&
        WEEKDAY_TOKENS.some((w) => reminderLine.includes(w)),
      "F1/F2 fixed: reminder line shows Bangkok 07:00 + weekday inline",
    );
    assert(
      eventLine.includes(`utc=${CLUBROOM_START_UTC}`),
      "F2/RC2 fixed: event line keeps raw UTC as utc= anchor",
    );
    // 02:00Z → 09:00 Bangkok, weekday Sunday.
    assert(
      eventLine.includes("09:00") &&
        WEEKDAY_TOKENS.some((w) => eventLine.includes(w)),
      "F1/F2 fixed: event line shows Bangkok 09:00 + weekday inline",
    );
  }

  // === Block B — RC1/RC5: read path computes no availability/conflict set ===
  // REPRO F4 (missed same-day clashes): buildChatContext assembles raw lists and
  // never runs analyzeSchedule / a cross-source resolver. No findings field.
  {
    const stubGoogle = async (): Promise<any[]> => [];
    const ctx: any = await buildChatContext(
      "เลื่อนเปลี่ยนน้ำไปจันทร์ 16:30 ได้ไหม",
      stubGoogle,
    );
    // Sprint 2 flip: a constraints field now exists on the read path.
    assert(
      "constraints" in ctx && Array.isArray(ctx.constraints),
      "F3/RC4 fixed: ChatContext now carries a constraints array",
    );
    // Sprint 3 flip: a deterministic availability report is computed on a
    // scheduling-intent turn (was absent → model free-handed clashes → F4).
    assert(
      "availability" in ctx &&
        ctx.availability !== null &&
        Array.isArray(ctx.availability.clashes),
      "F4/RC1 fixed: ChatContext carries an availability report on scheduling turns",
    );
  }

  // === Block C — RC4: durable constraints drop out on keyword-free follow-ups ==
  // REPRO F3 (forgot tank window mid-thread): recallFacts is keyword-gated. A
  // tank-window fact is recalled ONLY when the message shares a keyword.
  {
    // Note: tokenizer keeps digit runs, so times share tokens (07:00 vs 22:30
    // both yield "00"). Keep the fixture text digit-free to isolate the keyword
    // gate being tested, not numeric coincidence.
    const tank = createFact({
      content: "ตู้ปลา ไฟเปิดตอนเย็นห้ามรบกวนช่วงนั้น",
      keywords: "",
      category: "general",
    });

    // Keyword-free scheduling follow-up (transcript: "เลื่อนไปอังคาร 7:00").
    const dropped = recallFacts("เลื่อนไปอังคารตอนเช้าได้ไหม");
    assert(
      !dropped.some((f) => f.id === tank.id),
      "RC4: recall stays keyword-gated (constraint stickiness is the fix, Block E)",
    );

    // Positive control: it IS recalled when the message names the tank — proving
    // the rule exists and is only gated by keyword overlap, nothing sticky.
    const matched = recallFacts("ตู้ปลา ไฟเปิดกี่โมง");
    assert(
      matched.some((f) => f.id === tank.id),
      "control/RC4: same tank fact recalled when message shares a keyword",
    );
  }

  // === Block E — RC3/RC4 FIXED (Sprint 2): structured + STICKY constraints ====
  // Tank window + class block parse into structured constraints and stay in
  // context on a keyword-free scheduling follow-up (the F3 drop-out is gone).
  {
    const { resolveScheduleConstraints, isSchedulingIntent } = await import(
      "../src/services/scheduleConstraints.js"
    );

    createFact({
      content: "ทุกวันจันทร์มีเรียน 15:00-18:00",
      keywords: "",
      category: "general",
    });
    createFact({
      content: "ตู้ปลา ไฟเปิด 15:00-22:30 ห้ามรบกวน",
      keywords: "",
      category: "general",
    });

    const resolved = resolveScheduleConstraints();
    const classC = resolved.find((c) => c.kind === "recurring_block");
    const tankC = resolved.find((c) => c.kind === "protected_window");

    assert(
      classC !== undefined &&
        classC.weekdays.length === 1 &&
        classC.weekdays[0] === 1 &&
        classC.startLocal === "15:00" &&
        classC.endLocal === "18:00",
      "RC3: Monday class parses to recurring_block Mon 15:00–18:00",
    );
    assert(
      tankC !== undefined &&
        tankC.weekdays.length === 0 &&
        tankC.startLocal === "15:00" &&
        tankC.endLocal === "22:30",
      "RC3: tank light parses to protected_window, every day 15:00–22:30",
    );
    // Digit-free fact from Block C carries no window → never a constraint.
    assert(
      !resolved.some((c) => c.raw.includes("ตอนเย็น")),
      "RC3: conservative parser ignores facts with no explicit time window",
    );

    // STICKY: keyword-free scheduling follow-up still carries the constraints.
    const stub = async (): Promise<any[]> => [];
    const ctxSched: any = await buildChatContext(
      "เลื่อนไปอังคารตอนเช้าได้ไหม",
      stub,
    );
    assert(
      isSchedulingIntent("เลื่อนไปอังคารตอนเช้าได้ไหม"),
      "RC4: 'เลื่อน...' is detected as scheduling intent",
    );
    assert(
      ctxSched.constraints.some((c: any) => c.kind === "protected_window"),
      "F3/RC4 fixed: tank window STICKY on keyword-free scheduling turn",
    );

    // Non-scheduling chatter does not inject constraints (no prompt bloat).
    const ctxChat: any = await buildChatContext("สวัสดีครับ วันนี้เป็นไง", stub);
    assert(
      ctxChat.constraints.length === 0,
      "RC4: non-scheduling message injects no constraints",
    );
  }

  // === Block F — RC1/RC5 FIXED (Sprint 3): unified cross-source clash pass =====
  // A water-change reminder at Monday 16:30 (BKK) lands INSIDE both the class
  // block (15:00–18:00 Mon) and the tank window (15:00–22:30 daily). The resolver
  // surfaces these as constraint clashes — deterministically, no model.
  {
    const { resolveScheduleConstraints } = await import(
      "../src/services/scheduleConstraints.js"
    );
    const { resolveAvailability, materializeConstraints } = await import(
      "../src/services/availabilityResolver.js"
    );

    const constraints = resolveScheduleConstraints(); // class + tank from Block E
    const now = new Date("2026-06-20T06:00:00.000Z"); // Friday, transcript day

    // Monday 2026-06-22 16:30 Bangkok = 09:30 UTC.
    const report = resolveAvailability(
      {
        googleEvents: [],
        localEvents: [],
        reminders: [
          { id: 44, title: "เปลี่ยนน้ำตู้ปลา", due_at: "2026-06-22T09:30:00.000Z" },
        ],
        constraints,
      },
      now,
    );

    const constraintClashes = report.clashes.filter((c) => c.involvesConstraint);
    assert(
      constraintClashes.length >= 1,
      "F4/RC5: reminder inside class/tank window surfaces as a constraint clash",
    );
    assert(
      constraintClashes.every((c) =>
        c.labels.some((l) => l.includes("เปลี่ยนน้ำ")),
      ),
      "RC5: every constraint clash references the real reminder item",
    );
    // Constraint-vs-constraint (class ⨯ tank, both Monday) must NOT be surfaced.
    assert(
      report.clashes.every((c) => c.involvesRealItem),
      "RC1: the user's own overlapping rules are NOT reported as a clash",
    );

    // A clear time (Monday 08:00 BKK = 01:00 UTC, before any window) → no clash.
    const clear = resolveAvailability(
      {
        googleEvents: [],
        localEvents: [],
        reminders: [
          { id: 45, title: "ตื่นนอน", due_at: "2026-06-22T01:00:00.000Z" },
        ],
        constraints,
      },
      now,
    );
    assert(
      clear.clashes.length === 0,
      "RC1: a reminder outside every window/event yields no clash",
    );

    // Cross-source event⨯event clash (no constraint involved) is still caught.
    const evClash = resolveAvailability(
      {
        googleEvents: [],
        localEvents: [
          {
            id: 1,
            title: "ประชุม A",
            starts_at: "2026-06-23T03:00:00.000Z",
            ends_at: "2026-06-23T04:00:00.000Z",
          },
        ],
        reminders: [
          { id: 9, title: "โทรหาลูกค้า", due_at: "2026-06-23T03:30:00.000Z" },
        ],
        constraints: [],
      },
      now,
    );
    assert(
      evClash.clashes.some(
        (c) => c.kind === "overlap" && !c.involvesConstraint,
      ),
      "RC1/RC5: local-event ⨯ reminder overlap is caught in one pass",
    );

    // Horizon sanity: daily tank window materializes once per day (≥8).
    assert(
      materializeConstraints(constraints, now).length >= 8,
      "Sprint 3: constraints materialize into concrete daily windows over horizon",
    );
  }

  // === Block D — bangkokInstantLabel unit checks (Sprint 1 formatter) ========
  {
    const { bangkokInstantLabel } = await import("../src/services/agenda.js");

    // Weekday correctness across a full week. 2026-06-21 is a Sunday; each
    // following UTC-noon instant is the next weekday (no DST in Asia/Bangkok).
    const weekdays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    for (let i = 0; i < 7; i++) {
      const day = String(21 + i).padStart(2, "0");
      const label = bangkokInstantLabel(`2026-06-${day}T05:00:00.000Z`); // 12:00 BKK
      assert(
        label.includes(weekdays[i]) && label.includes("12:00"),
        `formatter: 2026-06-${day} 12:00 BKK is ${weekdays[i]}`,
      );
    }

    // +7h crossing midnight: 22:00Z on Sun rolls to Mon 05:00 Bangkok.
    const cross = bangkokInstantLabel("2026-06-21T22:00:00.000Z");
    assert(
      cross.includes("2026-06-22") &&
        cross.includes("05:00") &&
        cross.includes("Monday"),
      "formatter: +7h crosses midnight to the next Bangkok day/weekday",
    );

    // all-day: dateOnly drops the time component.
    const allDay = bangkokInstantLabel("2026-06-22T00:00:00.000Z", true);
    assert(
      allDay.includes("2026-06-22") && !/\d\d:\d\d/.test(allDay),
      "formatter: dateOnly omits the time for all-day events",
    );

    // fail-safe: garbage input returned unchanged (never throws in prompt build).
    assert(
      bangkokInstantLabel("not-a-date") === "not-a-date",
      "formatter: unparseable input returned unchanged (fail-safe)",
    );
  }

  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 27 SMOKE OK (Sprint 1: temporal render green)");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 27 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
