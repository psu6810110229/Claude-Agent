import { BANGKOK_OFFSET_MS } from "../config.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";

/**
 * Schedule health analysis (Tier 1 conflict/gap detection).
 *
 * Pure, read-only, deterministic — same spirit as `agenda.ts`. Given a list of
 * Google events it derives "findings" (overlaps, tight gaps, overloaded days,
 * after-hours/weekend work). NO AI, NO scheduler, NO writes. It only OBSERVES
 * and RANKS; any fix is a separate approval-gated action the user must confirm.
 *
 * Time model: timed events carry RFC 3339 instants (with offset) which
 * `Date.parse` resolves to an absolute epoch. Wall-clock checks (work hours,
 * weekday, day bucketing) are done in Asia/Bangkok (UTC+7, no DST) via
 * BANGKOK_OFFSET_MS so they match the user's clock. All-day events have no
 * instant and are skipped from time-based analysis.
 */

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FindingKind =
  | "overlap"
  | "tight_travel"
  | "no_buffer"
  | "long_streak"
  | "overloaded_day"
  | "after_hours"
  | "weekend"
  | "protected_day";

export type Severity = "high" | "medium" | "low";

export interface ScheduleFinding {
  kind: FindingKind;
  severity: Severity;
  /** Anchor window for the finding (UTC ISO instants). */
  startUtc: string;
  endUtc: string;
  /** Google event ids involved (1 for per-event findings, 2 for pairwise). */
  eventIds: string[];
  /** Event titles involved (display-only; never logged). */
  titles: string[];
  /** Short, machine-stable note, e.g. "gap 5m" or "busy 9h12m". */
  detail: string;
}

export interface ScheduleHealth {
  findings: ScheduleFinding[];
}

/** Tunable thresholds. Defaults are sensible; tests/config may override. */
export interface ScheduleHealthOptions {
  /** Back-to-back gap (min) below this is flagged `no_buffer`. */
  minBufferMin: number;
  /** Gap (min) below this between DIFFERENT locations is `tight_travel`. */
  travelBufferMin: number;
  /** A continuous busy block this long (hours) or more is a `long_streak`. */
  streakHours: number;
  /** Busy minutes in one day at/above this is an `overloaded_day`. */
  overloadDayMin: number;
  /** Bangkok work-day window; outside it timed events are `after_hours`. */
  workStartHour: number;
  workEndHour: number;
  /** Bangkok weekdays (0=Sun..6=Sat) the user wants kept clear; timed events on
   * these days are flagged `protected_day`. Empty = feature off. */
  protectedDays: number[];
}

export const DEFAULT_SCHEDULE_HEALTH_OPTIONS: ScheduleHealthOptions = {
  minBufferMin: 10,
  travelBufferMin: 30,
  streakHours: 4,
  overloadDayMin: 8 * 60,
  workStartHour: 8,
  workEndHour: 19,
  protectedDays: [],
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

interface Interval {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  location: string | null;
}

/** Resolve a timed event to an absolute [start,end) interval, or null to skip. */
function toInterval(ev: GoogleEvent): Interval | null {
  if (ev.allDay) return null;
  const startMs = Date.parse(ev.start);
  if (Number.isNaN(startMs)) return null;
  const endRaw = ev.end ? Date.parse(ev.end) : NaN;
  // Zero-length / missing end → treat as a 0-duration point; still usable for
  // overlap/buffer anchoring but contributes no busy minutes.
  const endMs = Number.isNaN(endRaw) || endRaw < startMs ? startMs : endRaw;
  return {
    id: ev.id,
    title: ev.title,
    startMs,
    endMs,
    location: ev.location,
  };
}

/** Bangkok wall-clock parts for an instant. */
function bkk(ms: number): { dow: number; hour: number; dayKey: number } {
  const b = new Date(ms + BANGKOK_OFFSET_MS);
  const dayKey = Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS);
  return { dow: b.getUTCDay(), hour: b.getUTCHours(), dayKey };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Human-ish compact duration, e.g. 552 -> "9h12m", 45 -> "45m". */
function fmtMin(totalMin: number): string {
  const m = Math.round(totalMin);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h${rem}m` : `${h}h`;
}

function locNorm(loc: string | null): string {
  return (loc ?? "").trim().toLowerCase();
}

/**
 * Analyze events into severity-ranked findings. Input may include all-day and
 * out-of-order events; only timed events participate in time analysis.
 */
export function analyzeSchedule(
  events: GoogleEvent[],
  options: ScheduleHealthOptions = DEFAULT_SCHEDULE_HEALTH_OPTIONS,
): ScheduleHealth {
  const intervals = events
    .map(toInterval)
    .filter((i): i is Interval => i !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const findings: ScheduleFinding[] = [];

  // --- Pairwise: overlap, no_buffer, tight_travel ---------------------------
  for (let i = 0; i < intervals.length; i++) {
    const a = intervals[i];
    for (let j = i + 1; j < intervals.length; j++) {
      const b = intervals[j];
      // Sorted by start: once b starts after a ends + the widest gap we care
      // about, no later b can be relevant to a.
      const gapMs = b.startMs - a.endMs;
      if (gapMs > options.travelBufferMin * MIN_MS) break;

      if (b.startMs < a.endMs) {
        // True time overlap (ignore exact touch, gapMs === 0, handled below).
        findings.push({
          kind: "overlap",
          severity: "high",
          startUtc: iso(Math.max(a.startMs, b.startMs)),
          endUtc: iso(Math.min(a.endMs, b.endMs)),
          eventIds: [a.id, b.id],
          titles: [a.title, b.title],
          detail: `overlap ${fmtMin((Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)) / MIN_MS)}`,
        });
        continue;
      }

      const gapMin = gapMs / MIN_MS;
      const differentPlace =
        locNorm(a.location) !== "" &&
        locNorm(b.location) !== "" &&
        locNorm(a.location) !== locNorm(b.location);

      if (differentPlace && gapMin < options.travelBufferMin) {
        findings.push({
          kind: "tight_travel",
          severity: "high",
          startUtc: iso(a.endMs),
          endUtc: iso(b.startMs),
          eventIds: [a.id, b.id],
          titles: [a.title, b.title],
          detail: `gap ${fmtMin(gapMin)} between locations`,
        });
      } else if (gapMin < options.minBufferMin) {
        findings.push({
          kind: "no_buffer",
          severity: "medium",
          startUtc: iso(a.endMs),
          endUtc: iso(b.startMs),
          eventIds: [a.id, b.id],
          titles: [a.title, b.title],
          detail: `gap ${fmtMin(gapMin)}`,
        });
      }
    }
  }

  // --- Merge busy blocks for long_streak ------------------------------------
  if (intervals.length > 0) {
    let blockStart = intervals[0].startMs;
    let blockEnd = intervals[0].endMs;
    let blockIds: string[] = [intervals[0].id];
    let blockTitles: string[] = [intervals[0].title];
    const flushStreak = (): void => {
      const lenMin = (blockEnd - blockStart) / MIN_MS;
      if (lenMin >= options.streakHours * 60) {
        findings.push({
          kind: "long_streak",
          severity: "medium",
          startUtc: iso(blockStart),
          endUtc: iso(blockEnd),
          eventIds: blockIds,
          titles: blockTitles,
          detail: `busy ${fmtMin(lenMin)} no break`,
        });
      }
    };
    for (let i = 1; i < intervals.length; i++) {
      const it = intervals[i];
      if (it.startMs <= blockEnd) {
        blockEnd = Math.max(blockEnd, it.endMs);
        blockIds.push(it.id);
        blockTitles.push(it.title);
      } else {
        flushStreak();
        blockStart = it.startMs;
        blockEnd = it.endMs;
        blockIds = [it.id];
        blockTitles = [it.title];
      }
    }
    flushStreak();
  }

  // --- Per-day busy minutes for overloaded_day ------------------------------
  // Sum non-overlapping busy time per Bangkok day (merge first to avoid double
  // counting overlaps).
  const merged: Array<{ s: number; e: number }> = [];
  for (const it of intervals) {
    const last = merged[merged.length - 1];
    if (last && it.startMs <= last.e) last.e = Math.max(last.e, it.endMs);
    else merged.push({ s: it.startMs, e: it.endMs });
  }
  const dayBusy = new Map<number, { min: number; start: number; end: number }>();
  for (const m of merged) {
    // Attribute the block to the Bangkok day of its start (blocks rarely cross
    // midnight; if they do the start day carries the weight — good enough v1).
    const { dayKey } = bkk(m.s);
    const cur = dayBusy.get(dayKey) ?? { min: 0, start: m.s, end: m.e };
    cur.min += (m.e - m.s) / MIN_MS;
    cur.start = Math.min(cur.start, m.s);
    cur.end = Math.max(cur.end, m.e);
    dayBusy.set(dayKey, cur);
  }
  for (const [, v] of dayBusy) {
    if (v.min >= options.overloadDayMin) {
      findings.push({
        kind: "overloaded_day",
        severity: "medium",
        startUtc: iso(v.start),
        endUtc: iso(v.end),
        eventIds: [],
        titles: [],
        detail: `busy ${fmtMin(v.min)} in one day`,
      });
    }
  }

  // --- Per-event: after_hours, weekend --------------------------------------
  for (const it of intervals) {
    const start = bkk(it.startMs);
    const end = bkk(it.endMs);
    if (start.dow === 0 || start.dow === 6) {
      findings.push({
        kind: "weekend",
        severity: "low",
        startUtc: iso(it.startMs),
        endUtc: iso(it.endMs),
        eventIds: [it.id],
        titles: [it.title],
        detail: "weekend",
      });
    }
    if (options.protectedDays.includes(start.dow)) {
      findings.push({
        kind: "protected_day",
        severity: "medium",
        startUtc: iso(it.startMs),
        endUtc: iso(it.endMs),
        eventIds: [it.id],
        titles: [it.title],
        detail: "on a day you keep clear",
      });
    }
    const startsEarly = start.hour < options.workStartHour;
    const endsLate =
      end.hour > options.workEndHour ||
      (end.hour === options.workEndHour && new Date(it.endMs + BANGKOK_OFFSET_MS).getUTCMinutes() > 0);
    if (startsEarly || endsLate) {
      findings.push({
        kind: "after_hours",
        severity: "low",
        startUtc: iso(it.startMs),
        endUtc: iso(it.endMs),
        eventIds: [it.id],
        titles: [it.title],
        detail: startsEarly ? "starts before work hours" : "ends after work hours",
      });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.startUtc.localeCompare(b.startUtc) ||
      a.kind.localeCompare(b.kind),
  );

  return { findings };
}
