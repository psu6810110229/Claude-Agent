"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getCalendarToday,
  getSettings,
  listActivity,
  listEvents,
  listReminders,
  listTasks,
  updateSetting,
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
  Setting,
  Task,
} from "@/lib/types";

async function loadToday(): Promise<{
  tasks: Task[];
  activity: Activity[];
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
  settings: Setting[];
}> {
  const [tasks, activity, calendar, events, reminders, settings] = await Promise.all([
    listTasks(),
    listActivity(10),
    getCalendarToday(),
    listEvents(),
    listReminders(),
    getSettings(),
  ]);
  return { tasks, activity, calendar, events, reminders, settings };
}

export default function TodayPage() {
  const { data, loading, error, reload } = useResource(loadToday);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Dashboard</p>
          <h2>Today</h2>
          <p className="lede">
            Command surface, brief generation, schedule, and recent local
            activity.
          </p>
        </div>
      </header>

      <div className="today-grid">
        <div className="stack">
          <CommandBar onProposed={reload} />
          <BriefPanel onProposed={reload} />

          {data && <RecentActivity activity={data.activity} />}
        </div>

        <div className="stack">
          {loading && <Loading />}
          {error && <ErrorBanner message={error} onRetry={reload} />}

          {data && (
            <>
              <Summary tasks={data.tasks} />
              <TodayAgenda
                calendar={data.calendar}
                events={data.events}
                reminders={data.reminders}
                gcalSetting={data.settings.find((s) => s.key === "google_calendar")}
                onCalendarToggled={reload}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function RecentActivity({ activity }: { activity: Activity[] }) {
  return (
    <section className="section">
      <div className="section-header">
        <h3>Recent activity</h3>
        <Link className="section-link" href="/activity">
          View all
        </Link>
      </div>
      {activity.length === 0 ? (
        <div className="state">Nothing yet.</div>
      ) : (
        <div className="panel">
          {activity.map((a) => (
            <div className="row" key={a.id}>
              <span className="badge">{a.event_type}</span>
              <span className="grow">{a.detail ?? ""}</span>
              <span className="ts">{formatTs(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TodayAgenda({
  calendar,
  events,
  reminders,
  gcalSetting,
  onCalendarToggled,
}: {
  calendar: GoogleEventListResponse;
  events: CalendarEvent[];
  reminders: Reminder[];
  gcalSetting?: Setting;
  onCalendarToggled: () => void;
}) {
  const ev = bucketEvents(events);
  const rem = bucketReminders(reminders);

  return (
    <div className="stack">
      {rem.overdue.length > 0 && (
        <section className="section">
          <h3>Overdue reminders</h3>
          <ReminderList reminders={rem.overdue} overdue />
        </section>
      )}

      <section className="section">
        <div className="section-header">
          <h3>Today's schedule (Google Calendar)</h3>
          {!calendar.available && gcalSetting && (
            <CalendarEnableButton setting={gcalSetting} onToggled={onCalendarToggled} />
          )}
        </div>
        {calendar.available ? (
          <GoogleEventList events={calendar.events} />
        ) : (
          <div className="state">Google Calendar not connected.</div>
        )}
      </section>

      <section className="section">
        <h3>Local events (secondary)</h3>
        <EventList events={ev.today} />
      </section>

      <section className="section">
        <div className="section-header">
          <h3>Reminders due today</h3>
          <Link className="section-link" href="/upcoming">
            Upcoming
          </Link>
        </div>
        <ReminderList reminders={rem.today} />
      </section>
    </div>
  );
}

function CalendarEnableButton({
  setting,
  onToggled,
}: {
  setting: Setting;
  onToggled: () => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!setting.configured) {
    return (
      <Link href="/settings" className="section-link" title={setting.description}>
        Setup required
      </Link>
    );
  }

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      await updateSetting("google_calendar", true);
      onToggled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="primary" onClick={enable} disabled={busy} style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }}>
      {busy ? "Enabling…" : "Enable"}
    </button>
  );
}

function Summary({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => t.status === "open").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const archived = tasks.filter((t) => t.status === "archived").length;

  return (
    <div className="summary-grid" aria-label="Task summary">
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
