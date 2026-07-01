import { listActiveFacts } from "../db/repositories/factRepo.js";
import type { MemoryFact } from "../schemas/fact.js";
import type {
  ScheduleConstraint,
  ScheduleConstraintKind,
} from "../schemas/scheduleConstraint.js";
import { resolveClassBlockConstraints } from "./classBlockConstraints.js";
import {
  defaultAppliesToForDomain,
  inferConstraintDomainFromText,
} from "./scheduleTargetClassifier.js";

/**
 * Step 27 / Sprint 2 — fact → structured constraint resolver (RC3, RC4).
 *
 * Deterministic, AI-free. A fact becomes a constraint ONLY when it carries an
 * explicit time window (HH:MM–HH:MM) — the conservative gate that keeps random
 * facts out. Weekday and kind are inferred from keyword presence; anything
 * unsure falls back to the safe default (applies every day, protected). The raw
 * fact text is always retained as evidence.
 *
 * Constraints are STICKY: callers inject them on every scheduling-intent turn,
 * not gated by per-message keyword recall — that drop-out is the F3 bug.
 */

/** Thai + English weekday keyword → JS getUTCDay index (0 = Sunday). */
const WEEKDAY_KEYWORDS: { kw: string; dow: number }[] = [
  { kw: "อาทิตย์", dow: 0 },
  { kw: "sunday", dow: 0 },
  { kw: "จันทร์", dow: 1 },
  { kw: "monday", dow: 1 },
  { kw: "อังคาร", dow: 2 },
  { kw: "tuesday", dow: 2 },
  { kw: "พุธ", dow: 3 },
  { kw: "wednesday", dow: 3 },
  { kw: "พฤหัส", dow: 4 },
  { kw: "thursday", dow: 4 },
  { kw: "ศุกร์", dow: 5 },
  { kw: "friday", dow: 5 },
  { kw: "เสาร์", dow: 6 },
  { kw: "saturday", dow: 6 },
];

const WEEKDAY_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Keywords that mark a fact as a recurring commitment rather than a quiet window. */
const RECURRING_BLOCK_KEYWORDS = ["เรียน", "คลาส", "วิชา", "class", "lecture"];

/**
 * Explicit kind tags an operator/AI may put in a fact's `keywords` to OVERRIDE
 * the text heuristic (top of the §3 priority cascade). Lowercase, substring-matched.
 */
const EXPLICIT_BLOCK_TAGS = ["recurring_block", "class_block", "classblock", "class-block"];
const EXPLICIT_GUARD_TAGS = [
  "protected_window",
  "protected-window",
  "write_guard",
  "writeguard",
  "no-disturb-window",
];

/**
 * §3 priority cascade — classify a windowed fact into a constraint kind
 * DETERMINISTICALLY, most-trusted signal first, with a SAFE-FAIL default:
 *   1. Explicit kind tag in `keywords` wins (operator override).
 *   2. category "routine" + a recurring keyword in the content → recurring_block.
 *   3. Recurring keyword anywhere in the content (legacy heuristic).
 *   4. DEFAULT → protected_window. Failing this way HIDES a misparsed class
 *      (visible, recoverable); the opposite failure would EXPOSE a tank window as
 *      an appointment — the original bug. So the safe direction is guard.
 */
function classifyConstraintKind(
  fact: MemoryFact,
  lowerContent: string,
): ScheduleConstraintKind {
  const kw = (fact.keywords ?? "").toLowerCase();
  if (EXPLICIT_BLOCK_TAGS.some((t) => kw.includes(t))) return "recurring_block";
  if (EXPLICIT_GUARD_TAGS.some((t) => kw.includes(t))) return "protected_window";
  const hasRecurringKw = RECURRING_BLOCK_KEYWORDS.some((k) =>
    markerHit(lowerContent, k),
  );
  if (fact.category === "routine" && hasRecurringKw) return "recurring_block";
  if (hasRecurringKw) return "recurring_block";
  return "protected_window";
}

/**
 * Map a constraint kind to its rendering ROLE. The agenda section uses an
 * ALLOWLIST (`role === "agenda"`); a guard never reaches the agenda. The `never`
 * assertion is a COMPILE-TIME lock: adding a new ScheduleConstraintKind without
 * deciding its role fails the build instead of silently leaking at runtime. An
 * unreachable runtime value still fails safe to "guard" (hidden).
 */
export function constraintRole(kind: ScheduleConstraintKind): "agenda" | "guard" {
  switch (kind) {
    case "recurring_block":
      return "agenda";
    case "protected_window":
      return "guard";
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return "guard";
    }
  }
}

/** Domain keywords → a tidy label for protected windows (first match wins). */
const LABEL_HINTS: { kw: string; label: string }[] = [
  { kw: "co2", label: "ตู้ปลา: CO2" },
  { kw: "คาร์บอน", label: "ตู้ปลา: CO2" },
  { kw: "ไฟ", label: "ตู้ปลา: ไฟ" },
  { kw: "light", label: "ตู้ปลา: light" },
  { kw: "ห้ามรบกวน", label: "ตู้ปลา: ห้ามรบกวน" },
  { kw: "รบกวน", label: "ตู้ปลา: ห้ามรบกวน" },
  { kw: "disturb", label: "tank: no-disturb" },
  { kw: "เรียน", label: "เรียน" },
  { kw: "class", label: "class" },
];

/**
 * H2 — robust keyword match. Latin keywords match on WORD BOUNDARIES (\b) so
 * "class" ≠ "classic", "free" ≠ "freedom", "move" ≠ "remove". Thai has no word
 * boundaries → substring, EXCEPT the notorious container "ว่าง" (a substring of
 * the very common "ระหว่าง") which uses a negative lookbehind so "ระหว่าง" no
 * longer trips a scheduling intent. Lowercase `lower` expected.
 */
function markerHit(lower: string, kw: string): boolean {
  if (kw === "ว่าง") return /(?<!ระห)ว่าง/u.test(lower);
  if (/^[\x00-\x7f]+$/.test(kw)) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`, "i").test(lower);
  }
  return lower.includes(kw);
}

/**
 * H2 — time-context tokens. When a window uses the "." separator (which collides
 * with decimals/money like "12.00-15.00 บาท"), a constraint is only accepted if
 * one of these appears in the fact — proving the digits are a CLOCK time, not a
 * number range. Colon-separated windows ("12:00-15:00") are always accepted.
 */
const TIME_CONTEXT_TOKENS = [
  "น.", "โมง", "นาฬิกา", "ทุ่ม", "เที่ยง", "เช้า", "บ่าย", "เย็น", "ค่ำ", "ดึก",
  "am", "pm", "a.m", "p.m",
  ...RECURRING_BLOCK_KEYWORDS,
  "co2", "คาร์บอน", "ไฟ", "light", "ห้ามรบกวน", "รบกวน", "disturb", "ตู้ปลา",
];

function hasTimeContext(lower: string): boolean {
  return TIME_CONTEXT_TOKENS.some((t) => lower.includes(t));
}

/** Scheduling-intent markers (Thai + English). Sticky constraints fire on these. */
const SCHEDULING_INTENT_MARKERS = [
  "เลื่อน", "ย้าย", "นัด", "ตาราง", "ว่าง", "ไม่ว่าง", "ชน", "เตือน",
  "เปลี่ยนน้ำ", "กี่โมง", "ตั้งเวลา",
  // Class/schedule queries: "พรุ่งนี้มีเรียนไหม" must trigger sticky constraints +
  // availability so a class-schedule fact is not dropped from a read turn.
  "เรียน", "คลาส", "วิชา", "มีเรียน",
  "schedule", "reschedule", "move", "remind", "reminder", "free", "busy",
  "conflict", "clash", "available", "availability", "slot", "class", "lecture",
];

/** True when the message looks like a scheduling/availability question. */
export function isSchedulingIntent(message: string): boolean {
  const m = message.toLowerCase();
  return SCHEDULING_INTENT_MARKERS.some((k) => markerHit(m, k));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Normalize "9:5" / "9.05" → "09:05"; null when out of range. */
function normTime(h: string, m: string): string | null {
  const hh = Number(h);
  const mm = Number(m);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${pad2(hh)}:${pad2(mm)}`;
}

// First HH:MM–HH:MM window in the text. Accepts : or . separators and -, –, —, ~.
// Separators are CAPTURED (groups 2 + 5) so the parser can demand time-context
// when the "." form is used (it collides with decimals/money — see H2/D1).
const WINDOW_RE =
  /(\d{1,2})([:.])(\d{2})\s*[-–—~]\s*(\d{1,2})([:.])(\d{2})/;

/** Global variant for extracting EVERY window in a fact (multi-class facts). */
const WINDOW_RE_G = new RegExp(WINDOW_RE.source, "g");

/**
 * Parse one fact into a constraint, or null when it carries no time window
 * (conservative: only explicit windows become constraints).
 */
/**
 * Parse ALL time windows from a fact into constraints. A single schedule fact can
 * list several classes ("…09:00-12:00…และ…15:00-17:00…") — each window becomes its
 * own constraint. Weekday + kind are derived once from the whole fact (they apply
 * to every window in it). Returns [] when no valid window survives the D1/H2
 * currency guard. Pure apart from reading the fact.
 */
export function parseScheduleConstraintsFromFact(
  fact: MemoryFact,
): ScheduleConstraint[] {
  const text = fact.content ?? "";
  const lower = text.toLowerCase();

  const weekdays = Array.from(
    new Set(
      WEEKDAY_KEYWORDS.filter((w) => lower.includes(w.kw)).map((w) => w.dow),
    ),
  ).sort((a, b) => a - b);

  const kind: ScheduleConstraintKind = classifyConstraintKind(fact, lower);
  const domain = inferConstraintDomainFromText(
    kind,
    `${text} ${fact.keywords ?? ""}`,
  );
  const hint = LABEL_HINTS.find((h) => lower.includes(h.kw));
  const label = hint ? hint.label : text.trim().slice(0, 24);
  const sourceRef = `fact#${fact.id}`;

  const out: ScheduleConstraint[] = [];
  for (const m of text.matchAll(WINDOW_RE_G)) {
    const startLocal = normTime(m[1], m[3]);
    const endLocal = normTime(m[4], m[6]);
    if (!startLocal || !endLocal) continue;
    // H2/D1 — a "." separator collides with decimals/money ("12.00-15.00 บาท");
    // only trust it as a clock time when the fact carries a time-context token.
    // Colon windows are always trusted. Skips ONLY the offending window.
    const usesDotSeparator = m[2] === "." || m[5] === ".";
    if (usesDotSeparator && !hasTimeContext(lower)) continue;
    out.push({
      kind,
      label,
      domain,
      applies_to: defaultAppliesToForDomain(kind, domain),
      status: "active",
      source_ref: sourceRef,
      provenance_created_at: fact.created_at,
      provenance_updated_at: fact.updated_at,
      weekdays,
      startLocal,
      endLocal,
      source: sourceRef,
      raw: text.slice(0, 200),
    });
  }
  return out;
}

/**
 * Back-compat single-window accessor: the FIRST valid window in the fact (or null).
 * Kept so existing callers/tests that expect one constraint per fact are unchanged;
 * new callers that need every class should use `parseScheduleConstraintsFromFact`.
 */
export function parseConstraintFromFact(
  fact: MemoryFact,
): ScheduleConstraint | null {
  return parseScheduleConstraintsFromFact(fact)[0] ?? null;
}

/**
 * Resolve the full sticky constraint set from active facts. Deterministic; the
 * caller decides WHETHER to inject (scheduling intent) — not whether the rule
 * still applies.
 */
export function resolveScheduleConstraints(): ScheduleConstraint[] {
  // Structured class_block rows (the import store) + legacy fact-derived
  // constraints. Both feed the same availability/verifier engine; the
  // dedup on (subject, weekday, start) at create time keeps a class entered in
  // both stores from double-counting in the common case.
  return [
    ...resolveClassBlockConstraints(),
    ...listActiveFacts().flatMap(parseScheduleConstraintsFromFact),
  ];
}

/** One-line human description for the prompt CONSTRAINTS block. */
export function describeConstraint(c: ScheduleConstraint): string {
  const days =
    c.weekdays.length === 0
      ? "every day"
      : c.weekdays.map((d) => WEEKDAY_EN[d]).join(", ");
  return `[${c.kind}] ${c.label}: ${days} ${c.startLocal}–${c.endLocal} (src ${c.source})`;
}

/**
 * H3 — REDACTED description for the model-visible PROTECTED WINDOWS section. Emits
 * the time window + a GENERIC tag only — never the real `label` or `source`. The
 * write-gate (dispatcher) consumes the constraint OBJECT, not this text, so gating
 * is unaffected while the actual activity name can no longer be extracted by a
 * "เอาชื่อกิจกรรมออกมา" probe.
 */
export function describeConstraintRedacted(c: ScheduleConstraint): string {
  const days =
    c.weekdays.length === 0
      ? "every day"
      : c.weekdays.map((d) => WEEKDAY_EN[d]).join(", ");
  return `[เวลาส่วนตัว/Protected] ${days} ${c.startLocal}–${c.endLocal}`;
}
