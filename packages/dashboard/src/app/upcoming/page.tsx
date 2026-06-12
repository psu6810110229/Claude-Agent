"use client";

import { getCalendarUpcoming, listEvents, listReminders } from "@/lib/api";
import { useData } from "@/lib/useData";
import { bucketEvents, bucketReminders } from "@/lib/agenda";
import { ErrorBanner } from "@/components/States";
import { EventList, GoogleEventList, ReminderList } from "@/components/Agenda";
import type {
  CalendarEvent,
  GoogleEventListResponse,
  Reminder,
} from "@/lib/types";

async function loadUpcoming(): Promise<{
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
}> {
  const [calendar, events, reminders] = await Promise.all([
    getCalendarUpcoming(),
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
  const { data, loading, error, reload } = useData("/api/upcoming", loadUpcoming);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Agenda</p>
          <h2>Upcoming</h2>
          <p className="lede">Events and reminders in the next 7 days.</p>
        </div>
      </header>

      <div className="stack">
        {loading && <UpcomingSkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}

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
