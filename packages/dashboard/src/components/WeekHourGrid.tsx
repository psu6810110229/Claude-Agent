"use client";

import { useMemo, type ReactNode } from "react";

/**
 * WeekHourGrid — a production-grade weekly timetable grid.
 *
 * Layout: DAY rows × TIME columns (an hour rail across the top, weekdays down
 * the side). Class blocks are positioned horizontally within each day row by
 * their start/end time. Shared by the import review card (editable chips) and
 * the /schedule page (read-only chips), so both look identical.
 *
 * The day-label column is sticky on horizontal scroll and the hour header is
 * sticky vertically, so a long timetable stays legible. Pure/presentational.
 */

const WEEKDAY_FULL = [
  "อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์",
];
const WEEKDAY_ABBR = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

const HOUR_W = 64; // px per hour column
const ROW_H = 56; // px per day row

export interface GridBlock {
  id: number | string;
  weekday: number; // 0=Sun..6=Sat
  startMin: number; // minutes from 00:00 (Bangkok local)
  endMin: number;
  title: string;
  subtitle?: string | null;
  /** Visual tone: normal | muted (deselected) | warn (incomplete). */
  tone?: "normal" | "muted" | "warn";
}

export function WeekHourGrid({
  blocks,
  onChipClick,
  renderChipExtra,
  highlightWeekday,
  emptyHint,
}: {
  blocks: GridBlock[];
  onChipClick?: (id: number | string) => void;
  /** Optional node rendered in the chip's top-right corner (checkbox / delete). */
  renderChipExtra?: (block: GridBlock) => ReactNode;
  /** Weekday to tint as "today" (e.g. on the /schedule page). */
  highlightWeekday?: number;
  emptyHint?: string;
}) {
  const days = useMemo(() => {
    const present = new Set(blocks.map((b) => b.weekday));
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => present.has(d));
    return order.length > 0 ? order : [1, 2, 3, 4, 5];
  }, [blocks]);

  const { minH, maxH } = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    for (const b of blocks) {
      lo = Math.min(lo, b.startMin);
      hi = Math.max(hi, b.endMin);
    }
    if (lo >= hi) {
      lo = 8 * 60;
      hi = 18 * 60;
    }
    // Pad to whole hours, with a little breathing room.
    return { minH: Math.floor(lo / 60), maxH: Math.ceil(hi / 60) };
  }, [blocks]);

  const hours = Array.from({ length: maxH - minH }, (_, i) => minH + i);
  const trackW = (maxH - minH) * HOUR_W;

  if (blocks.length === 0 && emptyHint) {
    return <div className="state">{emptyHint}</div>;
  }

  return (
    <div className="whg-scroll">
      <div className="whg" style={{ minWidth: 64 + trackW }}>
        {/* Header: corner + hour labels */}
        <div className="whg-headrow">
          <div className="whg-corner" />
          <div className="whg-hours" style={{ width: trackW }}>
            {hours.map((h) => (
              <div className="whg-hour" key={h} style={{ width: HOUR_W }}>
                <span>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
        </div>

        {/* One row per weekday */}
        {days.map((d) => (
          <div
            className={`whg-row${d === highlightWeekday ? " today" : ""}`}
            key={d}
            style={{ height: ROW_H }}
          >
            <div className="whg-daylabel">
              <span className="whg-day-full">{WEEKDAY_FULL[d]}</span>
              <span className="whg-day-abbr">{WEEKDAY_ABBR[d]}</span>
            </div>
            <div className="whg-track" style={{ width: trackW }}>
              {hours.map((h, i) =>
                i === 0 ? null : (
                  <div
                    className="whg-vline"
                    key={h}
                    style={{ left: (h - minH) * HOUR_W }}
                  />
                ),
              )}
              {blocks
                .filter((b) => b.weekday === d)
                .map((b) => {
                  const left = ((b.startMin - minH * 60) / 60) * HOUR_W;
                  const width = Math.max(
                    34,
                    ((b.endMin - b.startMin) / 60) * HOUR_W - 4,
                  );
                  return (
                    <button
                      type="button"
                      key={b.id}
                      className={`whg-chip ${b.tone ?? "normal"}`}
                      style={{ left, width }}
                      onClick={onChipClick ? () => onChipClick(b.id) : undefined}
                      title={`${b.title}${b.subtitle ? ` · ${b.subtitle}` : ""}`}
                    >
                      <span className="whg-chip-title">{b.title}</span>
                      {b.subtitle && (
                        <span className="whg-chip-sub">{b.subtitle}</span>
                      )}
                      {renderChipExtra && (
                        <span className="whg-chip-extra">{renderChipExtra(b)}</span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { WEEKDAY_FULL as WEEKDAY_FULL_LABELS };
