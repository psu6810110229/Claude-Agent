/**
 * Client-side agenda bucketing (Step 9). Mirrors the backend's
 * services/agenda.ts: day boundaries are computed in Asia/Bangkok (UTC+7, no
 * DST) so "today" matches the user's wall clock regardless of the browser's
 * timezone, while all values stay ISO 8601 UTC. Read-only date math — there is
 * no scheduler and nothing fires from "overdue".
 *
 * (A shared types/util package is a later step; for now this is intentionally a
 * small duplicate of the backend helper.)
 */
import type { CalendarEvent, Reminder } from "./types";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_DAYS = 7;

interface Bounds {
  nowUtc: string;
  todayStartUtc: string;
  todayEndUtc: string;
  upcomingEndUtc: string;
}

function bounds(now: Date = new Date()): Bounds {
  const b = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const todayStartMs =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    BANGKOK_OFFSET_MS;
  const todayEndMs = todayStartMs + DAY_MS;
  const upcomingEndMs = todayEndMs + UPCOMING_WINDOW_DAYS * DAY_MS;
  return {
    nowUtc: now.toISOString(),
    todayStartUtc: new Date(todayStartMs).toISOString(),
    todayEndUtc: new Date(todayEndMs).toISOString(),
    upcomingEndUtc: new Date(upcomingEndMs).toISOString(),
  };
}

export interface EventBuckets {
  today: CalendarEvent[];
  upcoming: CalendarEvent[];
}

export function bucketEvents(
  events: CalendarEvent[],
  now: Date = new Date(),
): EventBuckets {
  const { todayStartUtc, todayEndUtc, upcomingEndUtc } = bounds(now);
  const today: CalendarEvent[] = [];
  const upcoming: CalendarEvent[] = [];
  for (const e of events) {
    if (e.status === "archived") continue;
    if (e.starts_at >= todayStartUtc && e.starts_at < todayEndUtc) today.push(e);
    else if (e.starts_at >= todayEndUtc && e.starts_at < upcomingEndUtc)
      upcoming.push(e);
  }
  return { today, upcoming };
}

export interface ReminderBuckets {
  overdue: Reminder[];
  today: Reminder[];
  upcoming: Reminder[];
}

export function bucketReminders(
  reminders: Reminder[],
  now: Date = new Date(),
): ReminderBuckets {
  const { nowUtc, todayEndUtc, upcomingEndUtc } = bounds(now);
  const overdue: Reminder[] = [];
  const today: Reminder[] = [];
  const upcoming: Reminder[] = [];
  for (const r of reminders) {
    if (r.status === "archived") continue;
    if (r.due_at < nowUtc) overdue.push(r);
    else if (r.due_at < todayEndUtc) today.push(r);
    else if (r.due_at < upcomingEndUtc) upcoming.push(r);
  }
  return { overdue, today, upcoming };
}
