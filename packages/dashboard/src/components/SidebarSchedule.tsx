"use client";

/**
 * Today's schedule timeline in the sidebar. Google Calendar is the primary
 * source, local events and reminders secondary (mirrors the Today page).
 * Read-only; refreshes every 5 minutes. Degrades silently when the backend
 * is unreachable.
 */
import { useCallback, useEffect, useState } from "react";
import { getCalendarToday, listEvents, listReminders } from "@/lib/api";
import { bucketEvents, bucketReminders } from "@/lib/agenda";

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_EVENT_MS = 60 * 60 * 1000;
const MAX_ITEMS = 8;

interface TimelineItem {
  key: string;
  /** ISO instant, or null for all-day items (pinned first). */
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  sub: string | null;
}

function bangkokTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

async function loadTimeline(): Promise<TimelineItem[]> {
  const [calendar, events, reminders] = await Promise.all([
    getCalendarToday().catch(() => ({ events: [], available: false })),
    listEvents().catch(() => []),
    listReminders().catch(() => []),
  ]);

  const items: TimelineItem[] = [];

  for (const e of calendar.events) {
    items.push({
      key: `g-${e.id}`,
      startsAt: e.allDay ? null : e.start,
      endsAt: e.allDay ? null : e.end,
      title: e.title,
      sub: e.location ?? "Calendar",
    });
  }
  for (const e of bucketEvents(events).today) {
    items.push({
      key: `e-${e.id}`,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      title: e.title,
      sub: e.location ?? "Local event",
    });
  }
  const rem = bucketReminders(reminders);
  for (const r of [...rem.overdue, ...rem.today]) {
    items.push({
      key: `r-${r.id}`,
      startsAt: r.due_at,
      endsAt: r.due_at,
      title: r.title,
      sub: "Reminder",
    });
  }

  items.sort((a, b) => {
    if (a.startsAt === null) return b.startsAt === null ? 0 : -1;
    if (b.startsAt === null) return 1;
    return a.startsAt.localeCompare(b.startsAt);
  });
  return items.slice(0, MAX_ITEMS);
}

export function SidebarSchedule() {
  const [items, setItems] = useState<TimelineItem[] | null>(null);

  const refresh = useCallback(() => {
    loadTimeline()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (items === null) return <div className="side-empty">Loading…</div>;
  if (items.length === 0)
    return <div className="side-empty">Nothing scheduled today.</div>;

  const nowIso = new Date().toISOString();
  return (
    <div className="side-schedule">
      {items.map((item) => {
        let cls = "tl-item";
        if (item.startsAt !== null) {
          const endIso =
            item.endsAt ??
            new Date(
              new Date(item.startsAt).getTime() + DEFAULT_EVENT_MS,
            ).toISOString();
          if (endIso < nowIso) cls += " past";
          else if (item.startsAt <= nowIso) cls += " current";
        }
        return (
          <div className={cls} key={item.key}>
            <span className="tl-time">
              {item.startsAt ? bangkokTime(item.startsAt) : "All-day"}
            </span>
            <span className="tl-dot" aria-hidden="true" />
            <span className="tl-body">
              <span className="tl-title">{item.title}</span>
              {item.sub && <span className="tl-sub">{item.sub}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
