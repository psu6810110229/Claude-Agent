import {
  BANGKOK_OFFSET_MS,
  FREE_SLOT_DAY_START_HOUR,
  FREE_SLOT_DAY_END_HOUR,
  FREE_SLOT_MIN_MINUTES,
} from "../config.js";
import { materializeConstraints } from "./availabilityResolver.js";
import type { LocalEventInput } from "./availabilityResolver.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";
import type { ScheduleConstraint } from "../schemas/scheduleConstraint.js";

/**
 * Free-slot finder (the read-side complement to the clash resolver).
 *
 * The availability resolver answers "does X clash?"; this answers "when am I
 * FREE on day D?" — the "หาเวลาว่างไปปั่นจักรยาน" question. It subtracts every
 * busy interval (Google events + local events + materialized class blocks /
 * protected windows) from the user's waking-hours day window and returns the
 * open gaps ≥ a minimum duration.
 *
 * Deterministic, no AI. Times are computed in Asia/Bangkok wall-clock (the day
 * window is local) and returned as UTC ISO. All-day Google events are ignored
 * (a holiday marker does not occupy a clock slot). Pure apart from the inputs.
 */

const MIN_MS = 60 * 1000;

export interface FreeSlot {
  startUtc: string;
  endUtc: string;
  minutes: number;
}

export interface FreeSlotSources {
  /** Raw Google events (any day); all-day skipped, others clipped to the day. */
  googleEvents: GoogleEvent[];
  /** Local secondary events. */
  localEvents: LocalEventInput[];
  /** Class blocks + protected windows as constraints (materialized for the day). */
  constraints: ScheduleConstraint[];
}

export interface FreeSlotOptions {
  /** Minimum gap to report (minutes). Default FREE_SLOT_MIN_MINUTES. */
  minMinutes?: number;
  /** Bangkok day-window start hour. Default FREE_SLOT_DAY_START_HOUR. */
  dayStartHour?: number;
  /** Bangkok day-window end hour. Default FREE_SLOT_DAY_END_HOUR. */
  dayEndHour?: number;
}

interface Interval {
  start: number;
  end: number;
}

/** Bangkok Y/M/D for the calendar day containing `instant`. */
function bangkokYmd(instant: Date): { y: number; m: number; d: number } {
  const b = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth(), d: b.getUTCDate() };
}

/** UTC ms for a Bangkok-local wall time on a given Bangkok calendar day. */
function bangkokWallToUtcMs(
  y: number,
  m: number,
  d: number,
  hour: number,
  min: number,
): number {
  return Date.UTC(y, m, d, hour, min) - BANGKOK_OFFSET_MS;
}

/** Clip an interval to [lo, hi]; null when it does not overlap the window. */
function clip(iv: Interval, lo: number, hi: number): Interval | null {
  const start = Math.max(iv.start, lo);
  const end = Math.min(iv.end, hi);
  return end > start ? { start, end } : null;
}

/** Merge overlapping/adjacent intervals (input need not be sorted). */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Find free gaps on the Bangkok day containing `targetDay`.
 *
 * `targetDay` may be `now` (today) or any instant within the wanted day. Returns
 * gaps inside the waking-hours window only, each ≥ `minMinutes`, soonest first.
 */
export function findFreeSlotsForDay(
  targetDay: Date,
  sources: FreeSlotSources,
  options: FreeSlotOptions = {},
): FreeSlot[] {
  const minMinutes = options.minMinutes ?? FREE_SLOT_MIN_MINUTES;
  const dayStartHour = options.dayStartHour ?? FREE_SLOT_DAY_START_HOUR;
  const dayEndHour = options.dayEndHour ?? FREE_SLOT_DAY_END_HOUR;

  const { y, m, d } = bangkokYmd(targetDay);
  const windowStart = bangkokWallToUtcMs(y, m, d, dayStartHour, 0);
  const windowEnd = bangkokWallToUtcMs(y, m, d, dayEndHour, 0);
  if (windowEnd <= windowStart) return [];

  const busy: Interval[] = [];

  // Class blocks + protected windows for THIS day (horizon 1 from the target).
  for (const ce of materializeConstraints(sources.constraints, targetDay, 1)) {
    if (!ce.end) continue; // materialized windows always carry an end; guard the type
    const iv = clip(
      { start: Date.parse(ce.start), end: Date.parse(ce.end) },
      windowStart,
      windowEnd,
    );
    if (iv) busy.push(iv);
  }

  // Google events (skip all-day; require a valid end after start).
  for (const e of sources.googleEvents) {
    if (e.allDay || !e.end) continue;
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const iv = clip({ start, end }, windowStart, windowEnd);
    if (iv) busy.push(iv);
  }

  // Local events (need a real end; a point/no-end event occupies no slot).
  for (const ev of sources.localEvents) {
    if (!ev.ends_at) continue;
    const start = Date.parse(ev.starts_at);
    const end = Date.parse(ev.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const iv = clip({ start, end }, windowStart, windowEnd);
    if (iv) busy.push(iv);
  }

  const merged = mergeIntervals(busy);

  // Invert the busy set within the window → free gaps.
  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  const minMs = minMinutes * MIN_MS;
  for (const iv of merged) {
    if (iv.start - cursor >= minMs) {
      slots.push(makeSlot(cursor, iv.start));
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (windowEnd - cursor >= minMs) {
    slots.push(makeSlot(cursor, windowEnd));
  }
  return slots;
}

function makeSlot(startMs: number, endMs: number): FreeSlot {
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    minutes: Math.round((endMs - startMs) / MIN_MS),
  };
}
