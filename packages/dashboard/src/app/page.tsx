"use client";

import Link from "next/link";
import {
  getCalendarToday,
  listActivity,
  listEvents,
  listReminders,
  listTasks,
} from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { formatTs } from "@/lib/format";
import { bucketEvents, bucketReminders } from "@/lib/agenda";
import { ErrorBanner, Loading } from "@/components/States";
import { CommandBar } from "@/components/CommandBar";
import { BriefPanel } from "@/components/BriefPanel";
import { EventList, GoogleEventList, ReminderList } from "@/components/Agenda";
import type {
  Activity,
  CalendarEvent,
  GoogleEventListResponse,
  Reminder,
  Task,
} from "@/lib/types";

async function loadToday(): Promise<{
  tasks: Task[];
  activity: Activity[];
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
}> {
  const [tasks, activity, calendar, events, reminders] = await Promise.all([
    listTasks(),
    listActivity(10),
    getCalendarToday(),
    listEvents(),
    listReminders(),
  ]);
  return { tasks, activity, calendar, events, reminders };
}

export default function TodayPage() {
  const { data, loading, error, reload } = useResource(loadToday);

  return (
    <>
      <h2>Today</h2>

      <CommandBar onProposed={reload} />
      <BriefPanel onProposed={reload} />

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <>
          <Summary tasks={data.tasks} />

          <TodayAgenda
            calendar={data.calendar}
            events={data.events}
            reminders={data.reminders}
          />

          <h3>Recent activity</h3>
          {data.activity.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <div className="panel">
              {data.activity.map((a) => (
                <div className="row" key={a.id}>
                  <span className="badge">{a.event_type}</span>
                  <span className="grow">{a.detail ?? ""}</span>
                  <span className="ts">{formatTs(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="muted">
            <Link href="/activity">View all activity →</Link>
          </p>
        </>
      )}
    </>
  );
}

function TodayAgenda({
  calendar,
  events,
  reminders,
}: {
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
}) {
  const ev = bucketEvents(events);
  const rem = bucketReminders(reminders);

  return (
    <>
      {rem.overdue.length > 0 && (
        <>
          <h3>Overdue reminders</h3>
          <ReminderList reminders={rem.overdue} overdue />
        </>
      )}

      <h3>Today’s schedule (Google Calendar)</h3>
      {calendar.available ? (
        <GoogleEventList events={calendar.events} />
      ) : (
        <p className="muted">Google Calendar not connected.</p>
      )}

      <h3>Local events (secondary)</h3>
      <EventList events={ev.today} />

      <h3>Reminders due today</h3>
      <ReminderList reminders={rem.today} />

      <p className="muted">
        <Link href="/upcoming">View upcoming (next 7 days) →</Link>
      </p>
    </>
  );
}

function Summary({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => t.status === "open").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const archived = tasks.filter((t) => t.status === "archived").length;

  return (
    <div className="summary-grid">
      <Stat n={open} label="Open tasks" />
      <Stat n={done} label="Done" />
      <Stat n={archived} label="Archived" />
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{label}</div>
    </div>
  );
}
