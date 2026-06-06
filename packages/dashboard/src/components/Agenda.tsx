"use client";

import { formatTs } from "@/lib/format";
import type { CalendarEvent, GoogleEvent, Reminder } from "@/lib/types";

/** Presentational lists for events and reminders. Read-only. */

export function GoogleEventList({ events }: { events: GoogleEvent[] }) {
  if (events.length === 0) return <div className="state">No calendar events.</div>;
  return (
    <div className="panel">
      {events.map((e) => (
        <div className="row" key={e.id}>
          <span className="badge calendar">calendar</span>
          <span className="item-main">
            <strong className="item-title">{e.title}</strong>
            {e.location ? <span className="item-meta">{e.location}</span> : null}
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
  if (events.length === 0) return <div className="state">No events.</div>;
  return (
    <div className="panel">
      {events.map((e) => (
        <div className="row" key={e.id}>
          <span className="badge event">event</span>
          <span className="item-main">
            <strong className="item-title">{e.title}</strong>
            {e.location ? <span className="item-meta">{e.location}</span> : null}
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
  if (reminders.length === 0) return <div className="state">No reminders.</div>;
  return (
    <div className="panel">
      {reminders.map((r) => (
        <div className="row" key={r.id}>
          <span className={`badge ${overdue ? "danger" : "reminder"}`}>
            {overdue ? "overdue" : "reminder"}
          </span>
          <span className="item-main">
            <strong className="item-title">{r.title}</strong>
            {r.notes ? <span className="item-meta">{r.notes}</span> : null}
          </span>
          <span className="ts">{formatTs(r.due_at)}</span>
        </div>
      ))}
    </div>
  );
}
