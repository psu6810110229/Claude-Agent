/**
 * Persona / auth-wording / follow-up smoke (pure, no server, no DB, no network).
 *
 * Guards the Jarvis fine-tune (this step):
 *  - particle ban (no นะครับ in imitable templates)
 *  - adaptive-length + inline-follow-up + context-aware rules present
 *  - unverified BOUNDARY wording never names the auth mechanism (no Thai
 *    พิน/รหัส/คำลับ tokens leak into user-facing copy)
 *  - low-risk conversational grace selector (owner-style opener + non-sensitive)
 *  - voice lines carry no นะ particle and stay polite (ครับ)
 *
 * These exercise the deterministic prompt builders / pure helpers only — the real
 * Claude/Gemini model, TTS endpoint, and LINE files are never touched.
 */
import {
  buildChatPrompt,
  isOwnerStyleOpener,
  type ChatContext,
} from "../src/services/chatPrompt.js";
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
const MECHANISM_TOKENS = ["พิน", "รหัส", "คำลับ", "รหัสลับ", "รหัสผ่าน"];

function main(): void {
  console.log("Running persona / auth-wording / follow-up smoke...");

  // --- 1. Owner-style opener detector (pure) ---
  assert(isOwnerStyleOpener("โอเค เดี๋ยวจัดการ"), "opener: 'โอเค ...' is owner-style");
  assert(isOwnerStyleOpener("เดี๋ยวนะ ขอคิดก่อน"), "opener: 'เดี๋ยวนะ ...' is owner-style");
  assert(isOwnerStyleOpener("จาวิส ช่วยที"), "opener: 'จาวิส ...' is owner-style");
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
    assert(line.includes("ครับ"), `${name} stays polite (ครับ)`);
  }
  assert(nl.includes("2"), "approvalNagLine still reports the count");

  console.log("\nPERSONA SMOKE OK");
}

try {
  main();
} catch (err) {
  console.error("\nPERSONA SMOKE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
