"use client";

import { listEvents, listReminders } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { bucketEvents, bucketReminders } from "@/lib/agenda";
import { ErrorBanner, Loading } from "@/components/States";
import { EventList, ReminderList } from "@/components/Agenda";
import type { CalendarEvent, Reminder } from "@/lib/types";

async function loadUpcoming(): Promise<{
  events: CalendarEvent[];
  reminders: Reminder[];
}> {
  const [events, reminders] = await Promise.all([
    listEvents(),
    listReminders(),
  ]);
  return { events, reminders };
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
          <h3>Events</h3>
          <EventList events={bucketEvents(data.events).upcoming} />

          <h3>Reminders</h3>
          <ReminderList reminders={bucketReminders(data.reminders).upcoming} />
        </>
      )}
    </>
  );
}
