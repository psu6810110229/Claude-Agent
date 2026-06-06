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
      <h2>Upcoming</h2>
      <p className="muted">Events and reminders in the next 7 days.</p>

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <>
          <h3>Schedule (Google Calendar)</h3>
          {data.calendar.available ? (
            <GoogleEventList events={data.calendar.events} />
          ) : (
            <p className="muted">Google Calendar not connected.</p>
          )}

          <h3>Local events (secondary)</h3>
          <EventList events={bucketEvents(data.events).upcoming} />

          <h3>Reminders</h3>
          <ReminderList reminders={bucketReminders(data.reminders).upcoming} />
        </>
      )}
    </>
  );
}
