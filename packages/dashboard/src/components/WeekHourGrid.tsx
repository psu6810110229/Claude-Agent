"use client";

import { useMemo, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

/**
 * WeekHourGrid — a production-grade weekly timetable grid.
 *
 * Layout: DAY rows × TIME columns (an hour rail across the top, weekdays down
 * the side). Class blocks are positioned horizontally within each day row by
 * their start/end time, and vertically into LANES so overlapping classes never
 * stack on top of each other. Shared by the import review card (editable chips)
 * and the /schedule page (read-only / edit-mode chips), so both look identical.
 *
 * The day-label column is sticky on horizontal scroll and the hour header is
 * sticky vertically, so a long timetable stays legible. Pure/presentational.
 */

const WEEKDAY_FULL = [
  "อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์",
];
const WEEKDAY_ABBR = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

const HOUR_W = 72; // px per hour column
const LANE_H = 52; // px per lane within a day row
const LANE_GAP = 4; // px between lanes
const ROW_PAD = 6; // px top/bottom padding inside a row

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

/** Greedy lane assignment: each block gets the first lane free at its start. */
function assignLanes(dayBlocks: GridBlock[]): { laneOf: Map<GridBlock["id"], number>; lanes: number } {
  const sorted = [...dayBlocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds: number[] = []; // endMin of the last block in each lane
  const laneOf = new Map<GridBlock["id"], number>();
  for (const b of sorted) {
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endMin);
    } else {
      laneEnds[lane] = b.endMin;
    }
    laneOf.set(b.id, lane);
  }
  return { laneOf, lanes: Math.max(1, laneEnds.length) };
}

export function WeekHourGrid({
  blocks,
  onChipClick,
  renderChipExtra,
  highlightWeekday,
  emptyHint,
  editable,
  onDelete,
}: {
  blocks: GridBlock[];
  onChipClick?: (id: number | string) => void;
  /** Optional node rendered in the chip's top-right corner (checkbox). */
  renderChipExtra?: (block: GridBlock) => ReactNode;
  /** Weekday to tint as "today" (e.g. on the /schedule page). */
  highlightWeekday?: number;
  emptyHint?: string;
  /** When true, show a delete affordance on each chip (paired with onDelete). */
  editable?: boolean;
  onDelete?: (block: GridBlock) => void;
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
    // Pad to whole hours.
    return { minH: Math.floor(lo / 60), maxH: Math.ceil(hi / 60) };
  }, [blocks]);

  // Per-day lane assignment + the tallest row drives a shared row height so the
  // grid reads as a clean matrix.
  const dayLanes = useMemo(() => {
    const map = new Map<number, ReturnType<typeof assignLanes>>();
    for (const d of days) {
      map.set(d, assignLanes(blocks.filter((b) => b.weekday === d)));
    }
    return map;
  }, [days, blocks]);

  // Header includes a trailing label (maxH:00) so the closing edge is always
  // marked — otherwise a class ending at the last hour looks unbounded.
  const hourLabels = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);
  const trackW = (maxH - minH) * HOUR_W;

  if (blocks.length === 0 && emptyHint) {
    return <div className="state">{emptyHint}</div>;
  }

  return (
    <div className="whg-scroll">
      <div className="whg" style={{ minWidth: 64 + trackW }}>
        {/* Header: corner + hour labels (last label sits on the right edge) */}
        <div className="whg-headrow">
          <div className="whg-corner" />
          <div className="whg-hours" style={{ width: trackW }}>
            {hourLabels.map((h, i) => (
              <div
                className={`whg-hour${i === hourLabels.length - 1 ? " whg-hour-end" : ""}`}
                key={h}
                style={{ left: (h - minH) * HOUR_W }}
              >
                <span>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
        </div>

        {/* One row per weekday */}
        {days.map((d) => {
          const { laneOf, lanes } = dayLanes.get(d)!;
          const rowH = lanes * LANE_H + (lanes - 1) * LANE_GAP + ROW_PAD * 2;
          return (
            <div
              className={`whg-row${d === highlightWeekday ? " today" : ""}`}
              key={d}
              style={{ height: rowH }}
            >
              <div className="whg-daylabel">
                <span className="whg-day-full">{WEEKDAY_FULL[d]}</span>
                <span className="whg-day-abbr">{WEEKDAY_ABBR[d]}</span>
              </div>
              <div className="whg-track" style={{ width: trackW }}>
                {hourLabels.map((h, i) =>
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
                    const rawW = ((b.endMin - b.startMin) / 60) * HOUR_W - 4;
                    const width = Math.min(
                      Math.max(34, rawW),
                      Math.max(34, trackW - left - 2),
                    );
                    const lane = laneOf.get(b.id) ?? 0;
                    const top = ROW_PAD + lane * (LANE_H + LANE_GAP);
                    return (
                      <div
                        key={b.id}
                        className={`whg-chip ${b.tone ?? "normal"}`}
                        style={{ left, width, top, height: LANE_H }}
                        role={onChipClick ? "button" : undefined}
                        tabIndex={onChipClick ? 0 : undefined}
                        onClick={onChipClick ? () => onChipClick(b.id) : undefined}
                        onKeyDown={
                          onChipClick
                            ? (ev) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  onChipClick(b.id);
                                }
                              }
                            : undefined
                        }
                        title={`${b.title}${b.subtitle ? ` · ${b.subtitle}` : ""}`}
                      >
                        <span className="whg-chip-title">{b.title}</span>
                        {b.subtitle && (
                          <span className="whg-chip-sub">{b.subtitle}</span>
                        )}
                        {renderChipExtra && (
                          <span className="whg-chip-extra">{renderChipExtra(b)}</span>
                        )}
                        {editable && onDelete && (
                          <button
                            type="button"
                            className="whg-del"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onDelete(b);
                            }}
                            aria-label={`ลบ ${b.title}`}
                            title="ลบคาบนี้"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { WEEKDAY_FULL as WEEKDAY_FULL_LABELS };
