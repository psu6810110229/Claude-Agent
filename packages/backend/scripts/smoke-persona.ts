/**
 * Persona / auth-wording / follow-up smoke (pure, no server, no DB, no network).
 *
 * Guards the Friday fine-tune (this step):
 *  - particle ban (no นะคะ in imitable templates)
 *  - adaptive-length + inline-follow-up + context-aware rules present
 *  - unverified BOUNDARY wording never names the auth mechanism (no Thai
 *    พิน/รหัส/คำลับ tokens leak into user-facing copy)
 *  - low-risk conversational grace selector (owner-style opener + non-sensitive)
 *  - voice lines carry no นะ particle and stay polite (ค่ะ)
 *
 * These exercise the deterministic prompt builders / pure helpers only — the real
 * Claude/Gemini model, TTS endpoint, and LINE files are never touched.
 */
import {
  buildChatPrompt,
  isOwnerStyleOpener,
  RESTRICTED_BOUNDARY_EXAMPLES,
  type ChatContext,
} from "../src/services/chatPrompt.js";
import { buildActionReport } from "../src/services/chat.js";
import type { DispatchResult } from "../src/services/actionDispatcher.js";
import type { Approval } from "../src/schemas/approval.js";
import {
  reminderDueLine,
  eventSoonLine,
  approvalNagLine,
} from "../src/services/voiceLines.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

/** Minimal ChatContext; override `message` / `restricted` per case. */
function makeCtx(over: Partial<ChatContext> = {}): ChatContext {
  return {
    message: "hello",
    openTasks: [],
    memorySummaries: [],
    facts: [],
    nowUtc: "2026-06-15T00:00:00.000Z",
    nowBangkok: "2026-06-15 07:00",
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
    restricted: false,
    ...over,
  };
}

// Thai mechanism tokens that must NEVER appear in user-facing denial copy.
// NOTE: used to scan the WHOLE restricted prompt — English tokens (secret /
// passcode / passphrase) are intentionally NOT here, because the prompt's own
// INSTRUCTIONS legitimately use those English words to tell the model NOT to say
// them (e.g. "do not mention any code, passcode, passphrase, or secret").
const MECHANISM_TOKENS = ["พิน", "รหัส", "คำลับ", "รหัสลับ", "รหัสผ่าน"];

// Full ban list (Thai + English) — applied ONLY to the extracted user-facing
// boundary EXAMPLE phrases (RESTRICTED_BOUNDARY_EXAMPLES), never the whole prompt.
const ALL_MECHANISM_TOKENS = [
  ...MECHANISM_TOKENS,
  "pin",
  "secret",
  "passcode",
  "passphrase",
];

function main(): void {
  console.log("Running persona / auth-wording / follow-up smoke...");

  // --- 1. Owner-style opener detector (pure) ---
  assert(isOwnerStyleOpener("โอเค เดี๋ยวจัดการ"), "opener: 'โอเค ...' is owner-style");
  assert(isOwnerStyleOpener("เดี๋ยวนะ ขอคิดก่อน"), "opener: 'เดี๋ยวนะ ...' is owner-style");
  assert(isOwnerStyleOpener("ฟรายเดย์ ช่วยที"), "opener: 'ฟรายเดย์ ...' is owner-style");
  assert(isOwnerStyleOpener("คืองี้ คือผมว่า"), "opener: 'คืองี้ ...' is owner-style");
  assert(!isOwnerStyleOpener("ฟานไปไหนกับใคร"), "opener: private probe is NOT owner-style");
  assert(!isOwnerStyleOpener("give me the schedule"), "opener: plain English ask is NOT owner-style");
  assert(!isOwnerStyleOpener(""), "opener: empty string is NOT owner-style");

  // --- 2. Normal prompt carries the new persona rule blocks ---
  const normal = buildChatPrompt(makeCtx({ message: "วันนี้มีงานอะไรบ้าง" }));
  assert(normal.includes("PARTICLE BAN"), "normal prompt has PARTICLE BAN rule");
  assert(normal.includes("RESPONSE LENGTH RULES"), "normal prompt has adaptive RESPONSE LENGTH RULES");
  assert(normal.includes("INLINE FOLLOW-UP RULES"), "normal prompt has INLINE FOLLOW-UP RULES");
  assert(normal.includes("CONTEXT-AWARE SECRETARY RULES"), "normal prompt has CONTEXT-AWARE rules");
  assert(
    !normal.includes("รอคุณยืนยันนะครับ") && !normal.includes("ขอดูให้ก่อนนะครับ"),
    "normal prompt: imitable ACK templates carry no นะครับ",
  );

  // --- 3. Restricted prompt: generic boundary, no mechanism tokens ---
  const restricted = buildChatPrompt(makeCtx({ message: "ฟานไปไหนกับใคร", restricted: true }));
  assert(restricted.includes("PRIVACY MODE (CRITICAL"), "restricted prompt keeps the PRIVACY MODE guard");
  assert(restricted.includes("ยืนยันตัวตน"), "restricted prompt uses generic 'ยืนยันตัวตน' boundary wording");
  for (const tok of MECHANISM_TOKENS) {
    assert(!restricted.includes(tok), `restricted prompt never names the auth mechanism ('${tok}')`);
  }
  assert(!restricted.includes("ใส่พิน") && !restricted.includes("พิมพ์คำลับ"), "restricted prompt has no direct auth prompts");

  // --- 4. Grace: owner-style + non-sensitive softens; sensitive does not ---
  const graceOn = buildChatPrompt(makeCtx({ message: "โอเค แล้วช่วยเล่าหน่อย", restricted: true }));
  assert(graceOn.includes("CONVERSATIONAL GRACE"), "grace: owner-opener + non-sensitive renders grace block");
  // Even in grace, mechanism tokens still never appear.
  for (const tok of MECHANISM_TOKENS) {
    assert(!graceOn.includes(tok), `grace prompt still never names the auth mechanism ('${tok}')`);
  }
  const graceOffSensitive = buildChatPrompt(
    makeCtx({ message: "โอเค ฟานไปไหนกับใคร", restricted: true }),
  );
  assert(
    !graceOffSensitive.includes("CONVERSATIONAL GRACE"),
    "grace: owner-opener BUT private probe does NOT get grace (boundary stays)",
  );
  const graceOffPlain = buildChatPrompt(makeCtx({ message: "who are you", restricted: true }));
  assert(
    !graceOffPlain.includes("CONVERSATIONAL GRACE"),
    "grace: non-owner-style opener does NOT get grace",
  );

  // --- 5. Voice lines: polite, no นะ particle, text↔voice persona parity ---
  const rl = reminderDueLine("ประชุมทีม");
  const el = eventSoonLine("สแตนด์อัป", "ห้อง A");
  const el2 = eventSoonLine("สแตนด์อัป");
  const nl = approvalNagLine(2);
  for (const [name, line] of [
    ["reminderDueLine", rl],
    ["eventSoonLine+loc", el],
    ["eventSoonLine", el2],
    ["approvalNagLine", nl],
  ] as const) {
    assert(!line.includes("นะ"), `${name} carries no นะ particle`);
    assert(line.includes("ค่ะ"), `${name} stays polite (ค่ะ)`);
  }
  assert(nl.includes("2"), "approvalNagLine still reports the count");

  // --- 6. Second-pass tuning: new persona rule blocks present ---
  assert(normal.includes("GROUP G"), "normal prompt has GROUP G (local-vs-durable memory)");
  assert(
    normal.includes("ในบทสนทนานี้"),
    "normal prompt has the LOCAL-only correction phrasing ('ในบทสนทนานี้')",
  );
  assert(
    normal.includes("ACTIVE TOPIC TRACKING"),
    "normal prompt has ACTIVE TOPIC TRACKING rules",
  );
  assert(
    normal.includes("LOCAL ALIASES & GROUP NAMES"),
    "normal prompt has LOCAL ALIASES rules",
  );
  assert(
    normal.includes("หมายถึง Family หรือเอ๋วน้องต้าว?"),
    "normal prompt has the กลุ่มครอบครัว disambiguation question",
  );
  assert(
    normal.includes("RECOMMENDATION & ADVICE RULES"),
    "normal prompt has RECOMMENDATION & ADVICE grounding rules",
  );

  // --- 7. New imitable templates carry no นะ particle ---
  const NEW_TEMPLATES = [
    "เข้าใจแล้ว ในบทสนทนานี้จะอ่าน 'กลุ่มครอบครัว' เป็นเอ๋วน้องต้าว",
    "หมายถึง Family หรือเอ๋วน้องต้าว?",
    "อยากเดินใกล้หรือยอมไปไกลหน่อย?",
  ];
  for (const t of NEW_TEMPLATES) {
    assert(normal.includes(t), `new imitable template present: "${t.slice(0, 28)}..."`);
    assert(!t.includes("นะ"), `new imitable template carries no นะ: "${t.slice(0, 28)}..."`);
  }

  // --- 8. Exported boundary examples: appear verbatim + name no mechanism ---
  assert(RESTRICTED_BOUNDARY_EXAMPLES.length > 0, "RESTRICTED_BOUNDARY_EXAMPLES is non-empty");
  for (const phrase of RESTRICTED_BOUNDARY_EXAMPLES) {
    // Drift-proof: each test-mirror phrase must exist verbatim in the real prompt.
    assert(
      restricted.includes(phrase),
      `boundary example appears verbatim in prompt: "${phrase.slice(0, 24)}..."`,
    );
    const low = phrase.toLowerCase();
    for (const tok of ALL_MECHANISM_TOKENS) {
      assert(
        !low.includes(tok.toLowerCase()),
        `boundary example never names auth mechanism ('${tok}'): "${phrase.slice(0, 24)}..."`,
      );
    }
    assert(!phrase.includes("นะ"), `boundary example carries no นะ: "${phrase.slice(0, 24)}..."`);
  }

  // --- 9. buildActionReport honesty (no false "จัดการให้แล้ว") ---
  const fakeApproval = (over: Partial<Approval> = {}): Approval =>
    ({ action_type: "task.create", execution_error: null, ...over }) as Approval;
  const r = (mode: DispatchResult["mode"], over?: Partial<Approval>): DispatchResult =>
    ({ mode, approval: fakeApproval(over) }) as DispatchResult;

  assert(buildActionReport([]) === null, "report: no actions → null (pure Q&A says nothing)");

  const pendingOnly = buildActionReport([r("pending")]);
  assert(pendingOnly !== null, "report: pending-only produces a line");
  assert(
    !pendingOnly!.text.includes("จัดการให้แล้ว"),
    "report: pending-only never claims 'จัดการให้แล้ว'",
  );

  const executedReport = buildActionReport([r("executed")]);
  assert(
    !!executedReport && executedReport.text.includes("จัดการให้แล้ว"),
    "report: a real executed action DOES report 'จัดการให้แล้ว'",
  );

  const failedReport = buildActionReport([r("failed", { execution_error: "boom" })]);
  assert(
    !!failedReport && !failedReport.text.includes("จัดการให้แล้ว"),
    "report: a failed action never claims 'จัดการให้แล้ว'",
  );

  // --- 10. Spoken parity: TTS contract preserves detail (no 30-word shrink) ---
  // Regression guard: the old aggressive-shortening rules must be gone.
  assert(
    !normal.includes("at most 30 words"),
    "spoken contract no longer caps at 30 words",
  );
  assert(
    !normal.includes('Drop lists, IDs, URLs, and detail'),
    "spoken contract no longer says to drop detail",
  );
  // Detail-preserving + bounded wording present.
  assert(
    normal.includes("but NOT shallow"),
    "spoken contract: shorter-but-not-shallow rule present",
  );
  assert(
    normal.includes("chat names, dates, times, people, topics"),
    "spoken contract: preserves chat names / dates / times / people / topics",
  );
  assert(
    normal.includes("the rest is on screen") || normal.includes("ที่เหลือดูบนหน้าจอ"),
    "spoken contract: very-long reply → 'rest is on screen' fallback",
  );
  assert(
    normal.includes("follow-up question that is not already in"),
    "spoken contract: no invented follow-up rule",
  );
  assert(
    normal.includes("STRIP markdown"),
    "spoken contract: strips markdown/IDs/URLs/emoji",
  );

  // Notification voice lines stay clean (no นะ) — re-affirm parity with text persona.
  for (const [name, line] of [
    ["reminderDueLine", rl],
    ["eventSoonLine", el2],
    ["approvalNagLine", nl],
  ] as const) {
    assert(!line.includes("นะ"), `${name} still carries no นะ particle`);
  }

  // --- 11. Contacts state wording: never conflate redacted/empty/disabled ---
  // The fixed section's HEADER legitimately documents every state, so we assert
  // against DATA-BLOCK-ONLY markers (phrases that appear only in the rendered
  // ${contacts} body, never in the explanatory header) to know which branch ran.
  const REDACTED_MARK = "this is the privacy gate";
  const DISABLED_MARK = "do NOT pretend you have contacts";
  const EMPTY_MARK = "NOT that it is disabled";
  const stateMarks = (p: string) => ({
    redacted: p.includes(REDACTED_MARK),
    disabled: p.includes(DISABLED_MARK),
    empty: p.includes(EMPTY_MARK),
  });

  // The old ambiguous "(none or Contacts disabled)" must be gone in every state.
  for (const st of ["redacted", "disabled", "empty", "available"] as const) {
    const p = buildChatPrompt(makeCtx({ restricted: st === "redacted", contactsStatus: st }));
    assert(
      !p.includes("none or Contacts disabled"),
      `contacts: old ambiguous '(none or Contacts disabled)' wording gone (${st})`,
    );
  }

  const mR = stateMarks(buildChatPrompt(makeCtx({ restricted: true, contactsStatus: "redacted" })));
  assert(
    mR.redacted && !mR.disabled && !mR.empty,
    "contacts: redacted renders privacy-gate note only (not a disabled claim)",
  );

  const mD = stateMarks(buildChatPrompt(makeCtx({ contactsStatus: "disabled" })));
  assert(
    mD.disabled && !mD.redacted && !mD.empty,
    "contacts: disabled renders 'not connected' note only",
  );

  const mE = stateMarks(buildChatPrompt(makeCtx({ contactsStatus: "empty" })));
  assert(
    mE.empty && !mE.disabled && !mE.redacted,
    "contacts: empty (enabled) renders 'no contacts returned' note only",
  );

  // Available: renders the contact list and NONE of the state notes. Synthetic
  // non-PII labels prove the branch lists entries (count-capable) without values.
  const cAvail = buildChatPrompt(
    makeCtx({
      contactsStatus: "available",
      contacts: [{ name: "CONTACT_A" }, { name: "CONTACT_B" }],
    }),
  );
  const mA = stateMarks(cAvail);
  assert(
    cAvail.includes("CONTACT_A") && cAvail.includes("CONTACT_B"),
    "contacts: available renders the contact list (2 entries)",
  );
  assert(
    !mA.redacted && !mA.disabled && !mA.empty,
    "contacts: available shows no disabled/empty/redacted note",
  );

  // --- 12. Planning/advice + warmth + hesitation + self-reference tune ---
  assert(
    normal.includes("PLANNING & ADVICE RULES"),
    "normal prompt has PLANNING & ADVICE RULES",
  );
  assert(
    normal.includes("ANSWER FROM EVIDENCE, NOT VIBES"),
    "planning rules ground answers in evidence",
  );
  assert(
    normal.includes("PRACTICAL CONSTRAINTS") && normal.includes("CLEAR RECOMMENDATION"),
    "planning rules: evidence → constraints → recommendation",
  );
  assert(
    normal.includes("DO NOT invent event end times"),
    "planning rules forbid inventing end times / transport schedules",
  );

  assert(
    normal.includes("FRIDAY WARMTH RULES"),
    "normal prompt has FRIDAY WARMTH RULES",
  );
  assert(
    normal.includes("ได้ค่ะ เดี๋ยวฟรายเดย์ดูให้"),
    "warmth: gentle imitable example present",
  );
  for (const banned of [
    "คิดถึงคุณค่ะ",
    "ฟรายเดย์เป็นห่วงคุณมากๆ",
  ]) {
    assert(
      normal.includes(banned),
      `warmth rules explicitly forbid romantic line: "${banned.slice(0, 16)}..."`,
    );
  }
  assert(
    normal.includes("never a girlfriend") && normal.includes("not flirtatious"),
    "warmth: practical-secretary boundary, romance/flirt forbidden",
  );

  assert(
    normal.includes("NATURAL SPEECH RHYTHM"),
    "normal prompt has NATURAL SPEECH RHYTHM (hesitation) rules",
  );
  assert(
    normal.includes("AT MOST ONE marker per reply"),
    "hesitation: at most one marker per reply",
  );
  assert(
    normal.includes("NOT every reply"),
    "hesitation: not every reply",
  );
  assert(
    normal.includes("DO NOT use hesitation for") &&
      normal.includes("boundary replies") &&
      normal.includes("approval / action reports"),
    "hesitation: avoid direct-factual / safety / action-report answers",
  );

  assert(
    normal.includes("FRIDAY SELF-REFERENCE CADENCE"),
    "normal prompt has FRIDAY SELF-REFERENCE CADENCE rules",
  );

  // PARTICLE BAN still wins over hesitation: no นะคะ marker leaks in.
  assert(
    !normal.includes("เดี๋ยวนะคะ") && normal.includes("เดี๋ยวก่อนค่ะ"),
    "hesitation markers obey PARTICLE BAN (เดี๋ยวก่อนค่ะ, never เดี๋ยวนะคะ)",
  );

  // New imitable Friday templates must carry no นะ particle.
  const TUNE_TEMPLATES = [
    "ได้ค่ะ เดี๋ยวฟรายเดย์ดูให้",
    "ฟรายเดย์ว่าอันนี้เช็กอีกนิดจะปลอดภัยกว่าค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ];
  for (const t of TUNE_TEMPLATES) {
    assert(normal.includes(t), `tune template present: "${t.slice(0, 24)}..."`);
    assert(!t.includes("นะ"), `tune template carries no นะ: "${t.slice(0, 24)}..."`);
  }

  console.log("\nPERSONA SMOKE OK");
}

try {
  main();
} catch (err) {
  console.error("\nPERSONA SMOKE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
