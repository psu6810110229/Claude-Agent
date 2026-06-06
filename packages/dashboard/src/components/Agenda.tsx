"use client";

import { formatTs } from "@/lib/format";
import type { CalendarEvent, GoogleEvent, Reminder } from "@/lib/types";

/** Presentational lists for events and reminders. Read-only (Step 9 / 10). */

/**
 * Google Calendar events (Step 10) — the PRIMARY schedule, READ-ONLY. All-day
 * events show their date; timed events show local time. There is no edit/create
 * affordance by design.
 */
export function GoogleEventList({ events }: { events: GoogleEvent[] }) {
  if (events.length === 0)
    return <p className="muted">No calendar events.</p>;
  return (
    <div className="panel">
      {events.map((e) => (
        <div className="row" key={e.id}>
          <span className="badge">calendar</span>
          <span className="grow">
            <strong>{e.title}</strong>
            {e.location ? <span className="muted"> · {e.location}</span> : null}
          </span>
          <span className="ts">
            {e.allDay ? `${e.start} (all-day)` : formatTs(e.start)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EventList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return <p className="muted">No events.</p>;
  return (
    <div className="panel">
      {events.map((e) => (
        <div className="row" key={e.id}>
          <span className="badge">event</span>
          <span className="grow">
            <strong>{e.title}</strong>
            {e.location ? <span className="muted"> · {e.location}</span> : null}
          </span>
          <span className="ts">{formatTs(e.starts_at)}</span>
        </div>
      ))}
    </div>
  );
}

export function ReminderList({
  reminders,
  overdue = false,
}: {
  reminders: Reminder[];
  overdue?: boolean;
}) {
  if (reminders.length === 0) return <p className="muted">No reminders.</p>;
  return (
    <div className="panel">
      {reminders.map((r) => (
        <div className="row" key={r.id}>
          <span className={`badge ${overdue ? "danger" : ""}`}>
            {overdue ? "overdue" : "reminder"}
          </span>
          <span className="grow">
            <strong>{r.title}</strong>
            {r.notes ? <span className="muted"> · {r.notes}</span> : null}
          </span>
          <span className="ts">{formatTs(r.due_at)}</span>
        </div>
      ))}
    </div>
  );
}
