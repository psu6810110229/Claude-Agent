import { BANGKOK_OFFSET_MS } from "../config.js";
import type { ClassBlock } from "../schemas/classBlock.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";

/**
 * Phase 05 / Sprint 2 — Class occurrence resolver (contract).
 *
 * A class_block is a WEEKLY rule ("240-218, Thursday 13:00–16:00"). A schedule
 * change names ONE occurrence of it — "อาทิตย์นี้", "พฤหัสนี้", "คาบหน้า",
 * "อาทิตย์หน้า" — and the system must turn that into a concrete dated instant
 * (Bangkok wall clock → UTC) BEFORE it proposes a cancel/makeup. The audit warns
 * that guessing the occurrence is how a one-week skip silently deletes the wrong
 * day (or the whole recurring series).
 *
 * Project rule: Google Calendar is the PRIMARY schedule source. When a live
 * calendar event for the resolved date+time is supplied, the occurrence binds to
 * that event's id (so a later update/delete targets the real series instance);
 * otherwise it falls back to the local class_block window (secondary).
 *
 * Deterministic, pure, no IO. The caller supplies `now` and any calendar events.
 * Times are Asia/Bangkok (UTC+7, no DST), consistent with the rest of the engine.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type OccurrenceMarker =
  | "this_week"
  | "next_week"
  | "next_class"
  | "explicit_weekday";

export type OccurrenceSource = "google_event" | "class_block";

export type ClassOccurrenceStatus =
  | "resolved"
  | "out_of_term"
  | "no_occurrence"
  | "unresolved_reference";

export interface ClassOccurrence {
  /** Bangkok calendar date "YYYY-MM-DD" of the occurrence. */
  dateLocal: string;
  /** Bangkok weekday (0=Sun..6=Sat) of the occurrence. */
  weekday: number;
  startUtc: string;
  endUtc: string;
  /** Where the occurrence is anchored — the real calendar event when known. */
  source: OccurrenceSource;
  /** Google event id when source === "google_event" (target for update/delete). */
  eventId?: string;
}

export interface ClassOccurrenceResult {
  status: ClassOccurrenceStatus;
  marker?: OccurrenceMarker;
  occurrence?: ClassOccurrence;
}

export interface ResolveClassOccurrenceOptions {
  now: Date;
  /** Live calendar events to bind the occurrence to (primary source). */
  googleEvents?: readonly GoogleEvent[];
}

// --- Relative markers (lowercased substring; Thai has no word spaces) ---------

const NEXT_WEEK_MARKERS = ["อาทิตย์หน้า", "สัปดาห์หน้า", "วีคหน้า", "next week"];
const THIS_WEEK_MARKERS = ["อาทิตย์นี้", "สัปดาห์นี้", "วีคนี้", "this week"];
const NEXT_CLASS_MARKERS = ["คาบหน้า", "คาบต่อไป", "คาบถัดไป", "ครั้งหน้า", "next class", "next session"];

/** Named-weekday "นี้" markers → Bangkok weekday index (0=Sun..6=Sat). */
const WEEKDAY_THIS_MARKERS: { weekday: number; markers: string[] }[] = [
  // "อาทิตย์นี้" alone means "this WEEK" colloquially; require "วัน" to mean Sunday.
  { weekday: 0, markers: ["วันอาทิตย์นี้", "this sunday"] },
  { weekday: 1, markers: ["จันทร์นี้", "วันจันทร์นี้", "this monday"] },
  { weekday: 2, markers: ["อังคารนี้", "วันอังคารนี้", "this tuesday"] },
  { weekday: 3, markers: ["พุธนี้", "วันพุธนี้", "this wednesday"] },
  { weekday: 4, markers: ["พฤหัสนี้", "พฤหัสบดีนี้", "วันพฤหัสนี้", "this thursday"] },
  { weekday: 5, markers: ["ศุกร์นี้", "วันศุกร์นี้", "this friday"] },
  { weekday: 6, markers: ["เสาร์นี้", "วันเสาร์นี้", "this saturday"] },
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Bangkok calendar fields for an instant (UTC fields of the +7h-shifted date). */
function bangkokParts(now: Date): { year: number; month: number; day: number; dow: number } {
  const b = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth(),
    day: b.getUTCDate(),
    dow: b.getUTCDay(),
  };
}

/** "YYYY-MM-DD" for a UTC-fielded date that holds a Bangkok calendar day. */
function ymdOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Monday-indexed position of a Sun..Sat weekday (Mon=0 … Sun=6). */
function mondayIndex(dow: number): number {
  return (dow + 6) % 7;
}

/**
 * Build the concrete Bangkok occurrence for a class_block on a specific Bangkok
 * calendar day. Honors term bounds (active_from/until): a day outside the term
 * yields `out_of_term` so a past/future-term class never gets a stray proposal.
 * Pure.
 */
export function buildOccurrenceForDate(
  dateLocal: string,
  block: ClassBlock,
): { status: "resolved" | "out_of_term"; occurrence?: ClassOccurrence } {
  // ISO date strings sort lexicographically — plain comparison is correct.
  if (block.active_from && dateLocal < block.active_from) return { status: "out_of_term" };
  if (block.active_until && dateLocal > block.active_until) return { status: "out_of_term" };

  const [y, mo, d] = dateLocal.split("-").map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const [sh, sm] = block.start_local.split(":").map(Number);
  const [eh, em] = block.end_local.split(":").map(Number);
  const startUtc = Date.UTC(y, mo - 1, d, sh, sm) - BANGKOK_OFFSET_MS;
  const endUtc = Date.UTC(y, mo - 1, d, eh, em) - BANGKOK_OFFSET_MS;

  return {
    status: "resolved",
    occurrence: {
      dateLocal,
      weekday: dow,
      startUtc: new Date(startUtc).toISOString(),
      endUtc: new Date(endUtc).toISOString(),
      source: "class_block",
    },
  };
}

/** Target Bangkok weekday for the occurrence: the named day, else the block's. */
function resolveMarker(
  reference: string,
  block: ClassBlock,
): { marker: OccurrenceMarker; targetWeekday: number } | null {
  const m = reference.toLowerCase();

  // Named "<weekday>นี้" — only honored when it agrees with the class weekday,
  // otherwise it points at a different class; leave it unresolved for the planner.
  for (const { weekday, markers } of WEEKDAY_THIS_MARKERS) {
    if (includesAny(m, markers)) {
      if (weekday === block.weekday) {
        return { marker: "explicit_weekday", targetWeekday: weekday };
      }
      // A "this <day>" that is NOT this class's day → cannot resolve here.
      return null;
    }
  }
  if (includesAny(m, NEXT_WEEK_MARKERS)) return { marker: "next_week", targetWeekday: block.weekday };
  if (includesAny(m, THIS_WEEK_MARKERS)) return { marker: "this_week", targetWeekday: block.weekday };
  if (includesAny(m, NEXT_CLASS_MARKERS)) return { marker: "next_class", targetWeekday: block.weekday };
  return null;
}

/** Days to add to today (Bangkok) to land on the marker's target occurrence. */
function deltaDaysFor(
  marker: OccurrenceMarker,
  targetWeekday: number,
  now: Date,
  block: ClassBlock,
): number {
  const { dow } = bangkokParts(now);
  if (marker === "next_class") {
    // Next upcoming occurrence: today counts only if the class hasn't ended yet.
    let delta = (targetWeekday - dow + 7) % 7;
    if (delta === 0) {
      const [eh, em] = block.end_local.split(":").map(Number);
      const todayEndUtc =
        Date.UTC(
          bangkokParts(now).year,
          bangkokParts(now).month,
          bangkokParts(now).day,
          eh,
          em,
        ) - BANGKOK_OFFSET_MS;
      if (now.getTime() >= todayEndUtc) delta = 7;
    }
    return delta;
  }
  // this_week / explicit_weekday: the target weekday inside the current Mon–Sun
  // week (may be earlier in the week than today). next_week: that + 7.
  const base = mondayIndex(targetWeekday) - mondayIndex(dow);
  return marker === "next_week" ? base + 7 : base;
}

/**
 * Try to bind the occurrence to a live Google Calendar event on the same Bangkok
 * date whose time overlaps the class window. When found, the occurrence carries
 * that event id so a downstream update/delete acts on the real series instance.
 */
function bindCalendarEvent(
  occ: ClassOccurrence,
  events: readonly GoogleEvent[],
): ClassOccurrence {
  const startMs = Date.parse(occ.startUtc);
  const endMs = Date.parse(occ.endUtc);
  for (const e of events) {
    if (e.allDay || !e.end) continue;
    const es = Date.parse(e.start);
    const ee = Date.parse(e.end);
    if (Number.isNaN(es) || Number.isNaN(ee)) continue;
    // Overlap test against the resolved window.
    if (es < endMs && ee > startMs) {
      return { ...occ, source: "google_event", eventId: e.id };
    }
  }
  return occ;
}

/**
 * Resolve a relative class reference to ONE concrete dated occurrence.
 *
 *  - unresolved marker          → `unresolved_reference` (planner asks / uses dates).
 *  - resolved day out of term   → `out_of_term`.
 *  - otherwise                  → `resolved`, bound to a live calendar event when one
 *                                 matches, else the local class_block window.
 */
export function resolveClassOccurrence(
  reference: string,
  block: ClassBlock,
  opts: ResolveClassOccurrenceOptions,
): ClassOccurrenceResult {
  const resolved = resolveMarker(reference ?? "", block);
  if (!resolved) return { status: "unresolved_reference" };

  const { marker, targetWeekday } = resolved;
  const delta = deltaDaysFor(marker, targetWeekday, opts.now, block);
  const { year, month, day } = bangkokParts(opts.now);
  const occDate = new Date(Date.UTC(year, month, day + delta));
  const dateLocal = ymdOf(occDate);

  const built = buildOccurrenceForDate(dateLocal, block);
  if (built.status === "out_of_term") {
    return { status: "out_of_term", marker };
  }
  if (!built.occurrence) return { status: "no_occurrence", marker };

  const occurrence = opts.googleEvents?.length
    ? bindCalendarEvent(built.occurrence, opts.googleEvents)
    : built.occurrence;

  return { status: "resolved", marker, occurrence };
}
