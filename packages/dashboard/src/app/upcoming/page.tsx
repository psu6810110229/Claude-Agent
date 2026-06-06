"use client";

import { getCalendarUpcoming, listEvents, listReminders } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { bucketEvents, bucketReminders } from "@/lib/agenda";
import { ErrorBanner, Loading } from "@/components/States";
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

export default function UpcomingPage() {
  const { data, loading, error, reload } = useResource(loadUpcoming);

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
        {loading && <Loading />}
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
