"use client";

import { useState } from "react";
import { getCalendarUpcoming, listEvents, listReminders } from "@/lib/api";
import { useData } from "@/lib/useData";
import { bucketEvents, bucketReminders } from "@/lib/agenda";
import { ErrorBanner } from "@/components/States";
import { EventList, GoogleEventList, ReminderList } from "@/components/Agenda";
import { ScheduleHealth } from "@/components/ScheduleHealth";
import { ScheduleFixProposals } from "@/components/ScheduleFixProposals";
import type {
  CalendarEvent,
  GoogleEventListResponse,
  Reminder,
} from "@/lib/types";

type ViewDays = 7 | 14 | 30;
const VIEW_RANGES: ViewDays[] = [7, 14, 30];

async function loadUpcoming(days: ViewDays): Promise<{
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
}> {
  const [calendar, events, reminders] = await Promise.all([
    getCalendarUpcoming(days),
    listEvents(),
    listReminders(),
  ]);
  return { calendar, events, reminders };
}

function UpcomingSkeleton() {
  return (
    <div className="stack">
      {[3, 4, 3].map((rowCount, si) => (
        <section className="section" key={si}>
          <span className="skel" style={{ display: "block", width: 180, height: 19, marginBottom: 14 }} />
          {Array.from({ length: rowCount }).map((_, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <span className="skel" style={{ width: 65, height: 13, flexShrink: 0 }} />
              <span className="skel" style={{ flex: 1, height: 13, margin: "0 8px" }} />
              <span className="skel" style={{ width: 48, height: 13, flexShrink: 0 }} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function UpcomingPage() {
  const [days, setDays] = useState<ViewDays>(7);
  const { data, loading, error, reload } = useData(
    `/api/upcoming?days=${days}`,
    () => loadUpcoming(days),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Agenda</p>
          <h2>Upcoming</h2>
          <p className="lede">
            Google Calendar for the next {days} days; local events and reminders
            for the next 7.
          </p>
        </div>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Calendar view range in days"
        >
          {VIEW_RANGES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              className={`segment${days === d ? " active" : ""}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      <div className="stack">
        {loading && <UpcomingSkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}

        <section className="section">
          <h3>สุขภาพตาราง</h3>
          <ScheduleHealth />
          <ScheduleFixProposals />
        </section>

        {data && (
          <>
            <section className="section">
              <h3>Schedule (Google Calendar)</h3>
              {data.calendar.available ? (
                <GoogleEventList events={data.calendar.events} />
              ) : (
                <div className="state">Google Calendar not connected.</div>
              )}
            </section>

            <section className="section">
              <h3>Local events (secondary)</h3>
              <EventList events={bucketEvents(data.events).upcoming} />
            </section>

            <section className="section">
              <h3>Reminders</h3>
              <ReminderList reminders={bucketReminders(data.reminders).upcoming} />
            </section>
          </>
        )}
      </div>
    </>
  );
}
