"use client";

import { CalendarClock, GraduationCap, CalendarDays, BellRing } from "lucide-react";

/**
 * DayAgendaCard — one DAY's combined schedule: class blocks for that weekday +
 * dated work (reminders) + calendar events (Google + local). Rendered inline in
 * chat only when the user asks for a specific day's schedule (distinct from the
 * weekly class timetable). Time-sorted vertical timeline with a type per row.
 */

export type DayItemKind = "class" | "event" | "reminder";

export interface DayItem {
  id: string;
  kind: DayItemKind;
  /** Minutes from midnight (Bangkok) for sorting; null = untimed/all-day. */
  startMin: number | null;
  startLabel: string | null;
  endLabel: string | null;
  title: string;
  sub?: string | null;
  allDay?: boolean;
}

const KIND_META: Record<DayItemKind, { label: string; Icon: typeof GraduationCap }> = {
  class: { label: "เรียน", Icon: GraduationCap },
  event: { label: "นัด", Icon: CalendarDays },
  reminder: { label: "งาน", Icon: BellRing },
};

export function DayAgendaCard({
  dateLabel,
  items,
}: {
  dateLabel: string;
  items: DayItem[];
}) {
  const timed = items
    .filter((i) => i.startMin !== null && !i.allDay)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  const untimed = items.filter((i) => i.startMin === null || i.allDay);

  return (
    <div className="si-card">
      <div className="si-head-title">
        <CalendarClock aria-hidden="true" />
        <span>{dateLabel}</span>
        <span className="si-count">{items.length} รายการ</span>
      </div>

      {items.length === 0 ? (
        <div className="state">วันนี้ว่าง — ไม่มีคาบเรียน งาน หรือนัดในวันนี้</div>
      ) : (
        <div className="day-agenda">
          {untimed.length > 0 && (
            <div className="da-untimed">
              {untimed.map((i) => (
                <DayChip key={i.id} item={i} untimed />
              ))}
            </div>
          )}
          <div className="da-timeline">
            {timed.map((i) => {
              const meta = KIND_META[i.kind];
              return (
                <div className={`da-row kind-${i.kind}`} key={i.id}>
                  <div className="da-time">
                    <span className="da-time-start">{i.startLabel}</span>
                    {i.endLabel && <span className="da-time-end">{i.endLabel}</span>}
                  </div>
                  <div className="da-rail" aria-hidden="true">
                    <span className="da-dot" />
                  </div>
                  <div className="da-card">
                    <span className="da-badge">
                      <meta.Icon aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span className="da-title">{i.title}</span>
                    {i.sub && <span className="da-sub">{i.sub}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DayChip({ item, untimed }: { item: DayItem; untimed?: boolean }) {
  const meta = KIND_META[item.kind];
  return (
    <span className={`da-chip kind-${item.kind}`}>
      <meta.Icon aria-hidden="true" />
      {item.title}
      {untimed && item.allDay && <small>ทั้งวัน</small>}
    </span>
  );
}
