"use client";

/**
 * New-session welcome agenda — "today at a glance" with a real date picker.
 *
 * - A CTA opens a centered month-calendar popup (tour-booking style) to pick
 *   any date; the preview then shows that date's items.
 * - The preview is capped to PREVIEW_CAP; a "view all" CTA opens a scrollable
 *   popup with the full list (it never starts a chat).
 * - Urgency colors: overdue (rose), next ≤3h (green), pending (amber, blinking
 *   dot), done/past (gray). Reminders/events use due time; open tasks are
 *   "pending" until completed.
 * - Tasks carry a quick-finish check that really writes to the DB (PATCH
 *   /api/tasks/:id → done). Reminders/events stay read-only by design.
 *
 * Read-only for calendar/events/reminders; fails soft so a backend hiccup never
 * blocks the empty chat. Responsive: full width on mobile, centered card on
 * desktop; modals are centered overlays.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  getCalendarToday,
  getCalendarUpcoming,
  listEvents,
  listReminders,
  listTasks,
  updateTask,
} from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Modal as OverlayModal } from "@/components/ui/Modal";
import type { CalendarEvent, GoogleEvent, Reminder, Task } from "@/lib/types";

const PREVIEW_CAP = 4;
const NEXT_WINDOW_MS = 3 * 60 * 60 * 1000;
const DEFAULT_EVENT_MS = 60 * 60 * 1000;

const WEEKDAYS_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type Urgency = "overdue" | "next" | "pending" | "past" | "done";

interface AgendaItem {
  key: string;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  sub: string;
  urgency: Urgency;
  /** Present only for items that can be completed in-place (open tasks). */
  taskId?: number;
}

/** YYYY-MM-DD in Bangkok. All-day Google dates already arrive in that form. */
function isoToKey(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return KEY_FMT.format(new Date(iso));
}

function todayKey(): string {
  return KEY_FMT.format(new Date());
}

/** A Date anchored at noon Bangkok for the given key (avoids tz off-by-one). */
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00+07:00`);
}

function bangkokTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

function dateLabel(key: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Bangkok",
  }).format(keyToDate(key));
}

function urgencyOf(
  startsAt: string | null,
  endsAt: string | null,
  kind: "calendar" | "event" | "reminder" | "task",
  done: boolean,
  now: number,
): Urgency {
  if (done) return "done";
  if (startsAt === null) return "pending"; // all-day item / timeless task
  const startMs = Date.parse(startsAt);
  const endMs = endsAt ? Date.parse(endsAt) : startMs + DEFAULT_EVENT_MS;
  if (endMs < now) return kind === "reminder" ? "overdue" : "past";
  if (startMs <= now + NEXT_WINDOW_MS) return "next"; // ongoing or imminent
  return "pending";
}

export function WelcomeAgenda({
  onPrompt,
  disabled,
}: {
  onPrompt: (text: string) => void;
  disabled: boolean;
}) {
  const { notify } = useToast();
  const [calendar, setCalendar] = useState<GoogleEvent[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getCalendarToday().catch(() => ({ events: [], available: false })),
      getCalendarUpcoming().catch(() => ({ events: [], available: false })),
      listEvents().catch(() => [] as CalendarEvent[]),
      listReminders().catch(() => [] as Reminder[]),
      listTasks().catch(() => [] as Task[]),
    ])
      .then(([today, upcoming, ev, rem, tk]) => {
        if (!alive) return;
        const byId = new Map<string, GoogleEvent>();
        for (const e of [...today.events, ...upcoming.events]) {
          byId.set(`${e.calendarId ?? "calendar"}:${e.id}`, e);
        }
        setCalendar([...byId.values()]);
        setEvents(ev);
        setReminders(rem);
        setTasks(tk);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const tKey = todayKey();

  // Dates that have at least one item — used to dot the calendar grid.
  const markedDates = useMemo(() => {
    const set = new Set<string>();
    for (const e of calendar) set.add(isoToKey(e.start));
    for (const e of events) if (e.status !== "archived") set.add(isoToKey(e.starts_at));
    for (const r of reminders) if (r.status === "active") set.add(isoToKey(r.due_at));
    if (tasks.some((t) => t.status === "open")) set.add(tKey);
    return set;
  }, [calendar, events, reminders, tasks, tKey]);

  const items = useMemo<AgendaItem[]>(() => {
    const now = Date.now();
    const out: AgendaItem[] = [];

    for (const e of calendar) {
      if (isoToKey(e.start) !== selectedKey) continue;
      const calendarSub = e.location ?? e.calendarName ?? "ปฏิทิน";
      out.push({
        key: `g-${e.calendarId ?? "calendar"}:${e.id}`,
        startsAt: e.allDay ? null : e.start,
        endsAt: e.allDay ? null : e.end,
        title: e.title,
        sub: calendarSub,
        urgency: urgencyOf(
          e.allDay ? null : e.start,
          e.allDay ? null : e.end,
          "calendar",
          false,
          now,
        ),
      });
    }
    for (const e of events) {
      if (e.status === "archived" || isoToKey(e.starts_at) !== selectedKey) continue;
      out.push({
        key: `e-${e.id}`,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        title: e.title,
        sub: e.location ?? "กิจกรรม",
        urgency: urgencyOf(e.starts_at, e.ends_at, "event", false, now),
      });
    }
    for (const r of reminders) {
      // Completed/archived reminders are auto-hidden for the day.
      if (r.status !== "active" || isoToKey(r.due_at) !== selectedKey) continue;
      out.push({
        key: `r-${r.id}`,
        startsAt: r.due_at,
        endsAt: r.due_at,
        title: r.title,
        sub: "เตือนความจำ",
        urgency: urgencyOf(r.due_at, r.due_at, "reminder", false, now),
      });
    }
    // Tasks are timeless — only meaningful for "today". Done tasks auto-hide.
    if (selectedKey === tKey) {
      for (const t of tasks) {
        if (t.status !== "open") continue;
        out.push({
          key: `t-${t.id}`,
          startsAt: null,
          endsAt: null,
          title: t.title,
          sub: "งาน",
          urgency: "pending",
          taskId: t.id,
        });
      }
    }

    out.sort((a, b) => {
      if (a.startsAt === null) return b.startsAt === null ? 0 : -1;
      if (b.startsAt === null) return 1;
      return a.startsAt.localeCompare(b.startsAt);
    });
    return out;
  }, [calendar, events, reminders, tasks, selectedKey, tKey]);

  const completeTask = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        await updateTask(id, { status: "done" });
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, status: "done" } : t)),
        );
        notify({ kind: "success", title: "ทำเสร็จแล้ว", description: "อัปเดตสถานะงานแล้ว" });
      } catch (err) {
        notify({
          kind: "error",
          title: "อัปเดตงานไม่สำเร็จ",
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  const total = items.length;
  const visible = items.slice(0, PREVIEW_CAP);
  const overflow = total - visible.length;
  const isToday = selectedKey === tKey;

  return (
    <div className="welcome-agenda" aria-label="ตารางวันนี้">
      <div className="welcome-agenda-head">
        <CalendarDays aria-hidden="true" strokeWidth={1.8} />
        <div>
          <span className="welcome-agenda-date">
            {isToday ? "วันนี้ · " : ""}
            {dateLabel(selectedKey)}
          </span>
          <span className="welcome-agenda-meta">
            {loading ? "กำลังโหลด…" : `${total} รายการ`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="wa-cta"
          iconLeading={<CalendarDays aria-hidden="true" strokeWidth={1.8} />}
          onClick={() => setPickerOpen(true)}
        >
          เลือกวันที่
        </Button>
      </div>

      <div className="welcome-agenda-list">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div className="welcome-agenda-row is-skeleton" key={i}>
              <span className="skel" style={{ width: 42, height: 14 }} />
              <span className="wa-dot" aria-hidden="true" />
              <span className="skel" style={{ width: "60%", height: 14 }} />
            </div>
          ))
        ) : total === 0 ? (
          <p className="wa-empty">วันนี้ยังไม่มีนัด</p>
        ) : (
          visible.map((item) => (
            <AgendaRow
              key={item.key}
              item={item}
              busy={busyId === item.taskId}
              onComplete={completeTask}
            />
          ))
        )}
      </div>

      {overflow > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="welcome-agenda-more"
          onClick={() => setAllOpen(true)}
        >
          ดูทั้งหมด ({total} รายการ)
        </Button>
      )}

      {!loading && total === 0 && (
        <div className="chat-empty-actions" aria-label="ตัวอย่างคำถาม">
          {["วันนี้มีนัดอะไรบ้าง", "ขอดูงานที่ค้างอยู่", "ช่วยตั้งเตือนความจำหน่อย"].map(
            (prompt) => (
              <Button
                variant="secondary"
                size="sm"
                key={prompt}
                onClick={() => onPrompt(prompt)}
                disabled={disabled}
              >
                {prompt}
              </Button>
            ),
          )}
        </div>
      )}

      {pickerOpen && (
        <OverlayModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          size="sm"
          ariaLabel="เลือกวันที่"
          hideClose
        >
          <DatePicker
            value={selectedKey}
            marked={markedDates}
            todayK={tKey}
            onSelect={(key) => {
              setSelectedKey(key);
              setPickerOpen(false);
              setAllOpen(false);
            }}
          />
        </OverlayModal>
      )}

      {allOpen && (
        <OverlayModal
          open={allOpen}
          onClose={() => setAllOpen(false)}
          size="sm"
          ariaLabel={dateLabel(selectedKey)}
          hideClose
        >
          <div className="wa-modal-head">
            <h3 id="wa-all-title">{dateLabel(selectedKey)}</h3>
            <IconButton
              variant="ghost"
              size="sm"
              className="wa-modal-close"
              onClick={() => setAllOpen(false)}
              aria-label="ปิด"
            >
              <X aria-hidden="true" strokeWidth={1.8} />
            </IconButton>
          </div>
          <div className="wa-modal-list">
            {items.map((item) => (
              <AgendaRow
                key={item.key}
                item={item}
                busy={busyId === item.taskId}
                onComplete={completeTask}
              />
            ))}
          </div>
        </OverlayModal>
      )}
    </div>
  );
}

function AgendaRow({
  item,
  busy,
  onComplete,
}: {
  item: AgendaItem;
  busy: boolean;
  onComplete: (id: number) => void;
}) {
  return (
    <div className={`welcome-agenda-row u-${item.urgency}`}>
      <span className="wa-time">
        {item.startsAt ? bangkokTime(item.startsAt) : "ทั้งวัน"}
      </span>
      <span
        className={`wa-dot ${item.urgency === "pending" ? "is-blink" : ""}`}
        aria-hidden="true"
      />
      <span className="wa-body">
        <span className="wa-title">{item.title}</span>
        <span className="wa-sub">{item.sub}</span>
      </span>
      {item.taskId !== undefined ? (
        <IconButton
          variant="ghost"
          size="sm"
          className="wa-check"
          onClick={() => onComplete(item.taskId as number)}
          disabled={busy}
          aria-label="ทำเครื่องหมายว่าเสร็จแล้ว"
          title="ทำเครื่องหมายว่าเสร็จแล้ว"
        >
          <Check aria-hidden="true" strokeWidth={2.4} />
        </IconButton>
      ) : item.urgency === "done" ? (
        <span className="wa-check is-done" aria-label="เสร็จแล้ว">
          <Check aria-hidden="true" strokeWidth={2.4} />
        </span>
      ) : null}
    </div>
  );
}

function DatePicker({
  value,
  marked,
  todayK,
  onSelect,
}: {
  value: string;
  marked: Set<string>;
  todayK: string;
  onSelect: (key: string) => void;
}) {
  const init = keyToDate(value);
  const [year, setYear] = useState(init.getFullYear());
  const [month, setMonth] = useState(init.getMonth()); // 0-based

  const title = new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function step(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function dayKey(day: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <div className="wa-cal">
      <div className="wa-cal-head">
        <IconButton variant="ghost" size="sm" className="wa-cal-nav" onClick={() => step(-1)} aria-label="เดือนก่อนหน้า">
          <ChevronLeft aria-hidden="true" strokeWidth={1.8} />
        </IconButton>
        <h3 id="wa-picker-title">{title}</h3>
        <IconButton variant="ghost" size="sm" className="wa-cal-nav" onClick={() => step(1)} aria-label="เดือนถัดไป">
          <ChevronRight aria-hidden="true" strokeWidth={1.8} />
        </IconButton>
      </div>

      <div className="wa-cal-grid wa-cal-wd-row" aria-hidden="true">
        {WEEKDAYS_TH.map((w) => (
          <span className="wa-cal-wd" key={w}>
            {w}
          </span>
        ))}
      </div>

      <div className="wa-cal-grid">
        {cells.map((day, i) => {
          if (day === null) return <span className="wa-cal-day is-blank" key={`b-${i}`} />;
          const key = dayKey(day);
          let cls = "wa-cal-day";
          if (key === value) cls += " is-selected";
          else if (key === todayK) cls += " is-today";
          if (marked.has(key)) cls += " has-dot";
          return (
            <button type="button" className={cls} key={key} onClick={() => onSelect(key)}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
