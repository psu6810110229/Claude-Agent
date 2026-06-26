import { BANGKOK_OFFSET_MS, UPCOMING_WINDOW_DAYS } from "../config.js";
import type { Event } from "../schemas/event.js";
import type { Reminder } from "../schemas/reminder.js";

/**
 * Agenda bucketing (Step 9). Pure, read-only date math — NO scheduler, NO
 * notifications. Day boundaries are computed in Asia/Bangkok (UTC+7, no DST) so
 * "today" matches the user's wall clock, while all stored/compared values stay
 * ISO 8601 UTC. Buckets are derived on demand by the dashboard and the brief.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Weekday names indexed by JS getUTCDay() (0 = Sunday). Both English and Thai
// so the model never has to compute the day-of-week itself (a frequent source
// of wrong "this Friday is the Nth" answers).
const WEEKDAY_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_TH = [
  "วันอาทิตย์",
  "วันจันทร์",
  "วันอังคาร",
  "วันพุธ",
  "วันพฤหัสบดี",
  "วันศุกร์",
  "วันเสาร์",
];

/**
 * Bangkok wall-clock string for a given instant, with the weekday spelled out,
 * e.g. "2026-06-17 14:19 (Wednesday / วันพุธ)". The weekday is included so the
 * model anchors relative days ("วันศุกร์นี้") off a KNOWN day-of-week instead of
 * deriving it from the date and getting it wrong.
 */
export function bangkokWallClock(now: Date): string {
  const b = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const dow = b.getUTCDay();
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(
    b.getUTCDate(),
  )} ${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())} (${WEEKDAY_EN[dow]} / ${
    WEEKDAY_TH[dow]
  })`;
}

/**
 * Compact Bangkok wall-clock label for a single STORED UTC instant, with the
 * weekday spelled out — e.g. "2026-06-22 07:00 Monday/วันจันทร์". Used to render
 * each agenda line (event/reminder/local-event) so the model never converts
 * UTC→Bangkok (+7h) or derives day-of-week itself — the two arithmetic steps it
 * repeatedly got wrong (RC2). `dateOnly` drops the time for all-day events.
 * Fail-safe: an unparseable input is returned unchanged so a bad value never
 * throws inside prompt building.
 */
export function bangkokInstantLabel(utcIso: string, dateOnly = false): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return utcIso;
  const b = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const dow = b.getUTCDay();
  const date = `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(
    b.getUTCDate(),
  )}`;
  const time = dateOnly ? "" : ` ${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
  return `${date}${time} ${WEEKDAY_EN[dow]}/${WEEKDAY_TH[dow]}`;
}

export interface AgendaBounds {
  /** Current instant (ISO UTC). */
  nowUtc: string;
  /** Start of the past window (today start − pastDays), as a UTC instant. */
  pastStartUtc: string;
  /** Start of today in Bangkok, expressed as a UTC instant (inclusive). */
  todayStartUtc: string;
  /** Start of tomorrow in Bangkok, as a UTC instant (exclusive end of today). */
  todayEndUtc: string;
  /** End of the upcoming window (today end + N days), as a UTC instant. */
  upcomingEndUtc: string;
}

/** Compute today / upcoming-window boundaries in Bangkok local time. */
export function agendaBounds(
  now: Date = new Date(),
  upcomingDays: number = UPCOMING_WINDOW_DAYS,
  pastDays = 0,
): AgendaBounds {
  // Shift into Bangkok wall clock, floor to the calendar date, then shift back.
  const b = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const todayStartMs =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    BANGKOK_OFFSET_MS;
  const todayEndMs = todayStartMs + DAY_MS;
  const upcomingEndMs = todayEndMs + upcomingDays * DAY_MS;
  const pastStartMs = todayStartMs - pastDays * DAY_MS;
  return {
    nowUtc: now.toISOString(),
    pastStartUtc: new Date(pastStartMs).toISOString(),
    todayStartUtc: new Date(todayStartMs).toISOString(),
    todayEndUtc: new Date(todayEndMs).toISOString(),
    upcomingEndUtc: new Date(upcomingEndMs).toISOString(),
  };
}

export interface EventBuckets {
  today: Event[];
  upcoming: Event[];
}

/**
 * Bucket events by `starts_at`: those that start today, and those that start
 * within the next `upcomingDays` (excluding today). Input may be any list;
 * archived events should already be filtered out by the repository.
 */
export function bucketEvents(
  events: Event[],
  now: Date = new Date(),
): EventBuckets {
  const { todayStartUtc, todayEndUtc, upcomingEndUtc } = agendaBounds(now);
  const today: Event[] = [];
  const upcoming: Event[] = [];
  for (const e of events) {
    if (e.starts_at >= todayStartUtc && e.starts_at < todayEndUtc) {
      today.push(e);
    } else if (e.starts_at >= todayEndUtc && e.starts_at < upcomingEndUtc) {
      upcoming.push(e);
    }
  }
  return { today, upcoming };
}

export interface ReminderBuckets {
  /** Active and due strictly before now. */
  overdue: Reminder[];
  /** Active and due later today (>= now, < end of today). */
  today: Reminder[];
  /** Active and due within the next `upcomingDays` (excluding today). */
  upcoming: Reminder[];
}

/** Bucket reminders by `due_at` into overdue / today / upcoming. */
export function bucketReminders(
  reminders: Reminder[],
  now: Date = new Date(),
): ReminderBuckets {
  const { nowUtc, todayEndUtc, upcomingEndUtc } = agendaBounds(now);
  const overdue: Reminder[] = [];
  const today: Reminder[] = [];
  const upcoming: Reminder[] = [];
  for (const r of reminders) {
    if (r.due_at < nowUtc) overdue.push(r);
    else if (r.due_at < todayEndUtc) today.push(r);
    else if (r.due_at < upcomingEndUtc) upcoming.push(r);
  }
  return { overdue, today, upcoming };
}
