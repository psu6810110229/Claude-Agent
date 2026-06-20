import { listActiveFacts } from "../db/repositories/factRepo.js";
import type { MemoryFact } from "../schemas/fact.js";
import type {
  ScheduleConstraint,
  ScheduleConstraintKind,
} from "../schemas/scheduleConstraint.js";

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

/** Scheduling-intent markers (Thai + English). Sticky constraints fire on these. */
const SCHEDULING_INTENT_MARKERS = [
  "เลื่อน", "ย้าย", "นัด", "ตาราง", "ว่าง", "ไม่ว่าง", "ชน", "เตือน",
  "เปลี่ยนน้ำ", "กี่โมง", "ตั้งเวลา",
  "schedule", "reschedule", "move", "remind", "reminder", "free", "busy",
  "conflict", "clash", "available", "availability", "slot",
];

/** True when the message looks like a scheduling/availability question. */
export function isSchedulingIntent(message: string): boolean {
  const m = message.toLowerCase();
  return SCHEDULING_INTENT_MARKERS.some((k) => m.includes(k));
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
const WINDOW_RE = /(\d{1,2})[:.](\d{2})\s*[-–—~]\s*(\d{1,2})[:.](\d{2})/;

/**
 * Parse one fact into a constraint, or null when it carries no time window
 * (conservative: only explicit windows become constraints).
 */
export function parseConstraintFromFact(
  fact: MemoryFact,
): ScheduleConstraint | null {
  const text = fact.content ?? "";
  const win = WINDOW_RE.exec(text);
  if (!win) return null;

  const startLocal = normTime(win[1], win[2]);
  const endLocal = normTime(win[3], win[4]);
  if (!startLocal || !endLocal) return null;

  const lower = text.toLowerCase();

  const weekdays = Array.from(
    new Set(
      WEEKDAY_KEYWORDS.filter((w) => lower.includes(w.kw)).map((w) => w.dow),
    ),
  ).sort((a, b) => a - b);

  const kind: ScheduleConstraintKind = RECURRING_BLOCK_KEYWORDS.some((k) =>
    lower.includes(k),
  )
    ? "recurring_block"
    : "protected_window";

  const hint = LABEL_HINTS.find((h) => lower.includes(h.kw));
  const label = hint ? hint.label : text.trim().slice(0, 24);

  return {
    kind,
    label,
    weekdays,
    startLocal,
    endLocal,
    source: `fact#${fact.id}`,
    raw: text.slice(0, 200),
  };
}

/**
 * Resolve the full sticky constraint set from active facts. Deterministic; the
 * caller decides WHETHER to inject (scheduling intent) — not whether the rule
 * still applies.
 */
export function resolveScheduleConstraints(): ScheduleConstraint[] {
  return listActiveFacts()
    .map(parseConstraintFromFact)
    .filter((c): c is ScheduleConstraint => c !== null);
}

/** One-line human description for the prompt CONSTRAINTS block. */
export function describeConstraint(c: ScheduleConstraint): string {
  const days =
    c.weekdays.length === 0
      ? "every day"
      : c.weekdays.map((d) => WEEKDAY_EN[d]).join(", ");
  return `[${c.kind}] ${c.label}: ${days} ${c.startLocal}–${c.endLocal} (src ${c.source})`;
}
