"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Check, Pencil, X, LayoutGrid, ListTree, AlertTriangle } from "lucide-react";
import {
  approveScheduleImport,
  patchScheduleImportItem,
  ApiError,
} from "@/lib/api";
import type {
  ScheduleImportItem,
  ApproveImportResult,
} from "@/lib/types";

/** Editable fields for one candidate item (selected is a boolean intent here). */
type ItemPatch = {
  subject?: string;
  weekday?: number | null;
  start_local?: string | null;
  end_local?: string | null;
  location?: string | null;
  selected?: boolean;
};

const WEEKDAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const WEEKDAY_FULL = [
  "อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์",
];

function toMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** An item is calendar-ready only with a weekday + valid start<end. */
function isComplete(i: ScheduleImportItem): boolean {
  const s = toMin(i.start_local);
  const e = toMin(i.end_local);
  return i.weekday !== null && s !== null && e !== null && e > s;
}

/** Pick the default view: a clear weekly pattern → grid, else timeline. */
function adaptiveView(items: ScheduleImportItem[]): "grid" | "timeline" {
  const withDay = items.filter((i) => i.weekday !== null).length;
  return withDay >= Math.max(2, Math.ceil(items.length / 2)) ? "grid" : "timeline";
}

export function ScheduleImportCard({
  importId,
  sourceKind,
  initialItems,
  initialTermFrom,
  initialTermUntil,
  note,
  onApproved,
  onCancel,
}: {
  importId: number;
  sourceKind: string;
  initialItems: ScheduleImportItem[];
  initialTermFrom: string | null;
  initialTermUntil: string | null;
  note: string | null;
  onApproved: (result: ApproveImportResult) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<ScheduleImportItem[]>(initialItems);
  const [view, setView] = useState<"grid" | "timeline">(() => adaptiveView(initialItems));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [termFrom, setTermFrom] = useState(initialTermFrom ?? "");
  const [termUntil, setTermUntil] = useState(initialTermUntil ?? "");
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedCount = items.filter((i) => i.selected === 1).length;
  const readyCount = items.filter((i) => i.selected === 1 && isComplete(i)).length;
  const needsFix = items.filter((i) => i.selected === 1 && !isComplete(i)).length;

  async function syncPatch(itemId: number, patch: ItemPatch) {
    // Optimistic update; revert on failure.
    const before = items;
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              ...patch,
              selected:
                patch.selected !== undefined
                  ? patch.selected
                    ? 1
                    : 0
                  : i.selected,
            }
          : i,
      ),
    );
    try {
      await patchScheduleImportItem(importId, itemId, {
        subject: patch.subject,
        weekday: patch.weekday,
        start_local: patch.start_local,
        end_local: patch.end_local,
        location: patch.location,
        selected: patch.selected,
      });
    } catch (err) {
      setItems(before);
      setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    }
  }

  async function approve() {
    if (approving) return;
    setApproving(true);
    setError(null);
    try {
      const result = await approveScheduleImport(importId, {
        term_from: termFrom || null,
        term_until: termUntil || null,
      });
      setDone(true);
      onApproved(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มตารางไม่สำเร็จ");
    } finally {
      setApproving(false);
    }
  }

  const editingItem = items.find((i) => i.id === editingId) ?? null;

  if (done) {
    return (
      <div className="si-card si-card-done">
        <Check className="si-done-icon" aria-hidden="true" />
        <span>เพิ่มตารางเรียนเข้าระบบแล้ว {readyCount} คาบ</span>
      </div>
    );
  }

  return (
    <div className="si-card" role="group" aria-label="ตัวอย่างตารางเรียนที่อ่านได้">
      <header className="si-head">
        <div className="si-head-title">
          <CalendarRange aria-hidden="true" />
          <span>ตารางเรียนจาก{sourceKind === "pdf" ? " PDF" : "รูปภาพ"}</span>
          <span className="si-count">{items.length} คาบ</span>
        </div>
        <div className="si-view-toggle" role="tablist" aria-label="มุมมอง">
          <button
            type="button"
            role="tab"
            aria-selected={view === "grid"}
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
            title="ตาราง"
          >
            <LayoutGrid aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "timeline"}
            className={view === "timeline" ? "active" : ""}
            onClick={() => setView("timeline")}
            title="ไทม์ไลน์"
          >
            <ListTree aria-hidden="true" />
          </button>
        </div>
      </header>

      {note && <p className="si-note">{note}</p>}

      <div className="si-body">
        {view === "grid" ? (
          <ScheduleGrid
            items={items}
            onEdit={setEditingId}
            onToggle={(id, sel) => syncPatch(id, { selected: sel })}
          />
        ) : (
          <ScheduleTimeline
            items={items}
            onEdit={setEditingId}
            onToggle={(id, sel) => syncPatch(id, { selected: sel })}
          />
        )}
      </div>

      {editingItem && (
        <ItemEditor
          item={editingItem}
          onSave={(patch) => {
            void syncPatch(editingItem.id, patch);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      <div className="si-term">
        <label>
          <span>เริ่มเทอม</span>
          <input
            type="date"
            value={termFrom}
            onChange={(e) => setTermFrom(e.target.value)}
          />
        </label>
        <label>
          <span>จบเทอม</span>
          <input
            type="date"
            value={termUntil}
            onChange={(e) => setTermUntil(e.target.value)}
          />
        </label>
      </div>

      {needsFix > 0 && (
        <p className="si-warn">
          <AlertTriangle aria-hidden="true" />
          {needsFix} คาบยังกรอกวัน/เวลาไม่ครบ — แตะเพื่อแก้ ไม่งั้นจะถูกข้าม
        </p>
      )}
      {error && <p className="si-error">{error}</p>}

      <footer className="si-actions">
        <button type="button" className="si-btn-ghost" onClick={onCancel} disabled={approving}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="si-btn-primary"
          onClick={approve}
          disabled={approving || readyCount === 0}
        >
          {approving ? "กำลังเพิ่ม..." : `เพิ่ม ${readyCount} คาบเข้าตาราง`}
        </button>
      </footer>
      <p className="si-hint">
        บันทึกเป็นตารางในเครื่อง ไม่ขึ้น Google Calendar · Friday ใช้เทียบหาเวลาว่างให้
      </p>
    </div>
  );
}

/** Weekly grid: day columns × an hour rail, class chips positioned by time. */
function ScheduleGrid({
  items,
  onEdit,
  onToggle,
}: {
  items: ScheduleImportItem[];
  onEdit: (id: number) => void;
  onToggle: (id: number, selected: boolean) => void;
}) {
  const placed = items.filter(
    (i) => i.weekday !== null && toMin(i.start_local) !== null && toMin(i.end_local) !== null,
  );
  const unplaced = items.filter((i) => !placed.includes(i));

  const days = useMemo(() => {
    const present = new Set(placed.map((i) => i.weekday as number));
    // Mon..Sat by default; include Sunday only if used.
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => present.has(d));
    return order.length > 0 ? order : [1, 2, 3, 4, 5];
  }, [placed]);

  const { minH, maxH } = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    for (const i of placed) {
      lo = Math.min(lo, toMin(i.start_local)!);
      hi = Math.max(hi, toMin(i.end_local)!);
    }
    if (lo >= hi) {
      lo = 8 * 60;
      hi = 18 * 60;
    }
    return { minH: Math.floor(lo / 60), maxH: Math.ceil(hi / 60) };
  }, [placed]);

  const HOUR_PX = 52;
  const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);
  const gridHeight = (maxH - minH) * HOUR_PX;

  return (
    <div className="si-grid-wrap">
      <div className="si-grid" style={{ gridTemplateColumns: `38px repeat(${days.length}, 1fr)` }}>
        <div className="si-grid-corner" />
        {days.map((d) => (
          <div className="si-grid-dayhead" key={`h-${d}`}>
            {WEEKDAY_FULL[d]}
          </div>
        ))}

        <div className="si-grid-rail" style={{ height: gridHeight }}>
          {hours.slice(0, -1).map((h) => (
            <div className="si-grid-hour" key={h} style={{ height: HOUR_PX }}>
              <span>{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {days.map((d) => (
          <div className="si-grid-col" key={`c-${d}`} style={{ height: gridHeight }}>
            {hours.slice(0, -1).map((h) => (
              <div className="si-grid-line" key={h} style={{ top: (h - minH) * HOUR_PX }} />
            ))}
            {placed
              .filter((i) => i.weekday === d)
              .map((i) => {
                const s = toMin(i.start_local)!;
                const e = toMin(i.end_local)!;
                const top = ((s - minH * 60) / 60) * HOUR_PX;
                const height = Math.max(22, ((e - s) / 60) * HOUR_PX - 3);
                const off = i.selected !== 1;
                const bad = !isComplete(i);
                return (
                  <button
                    type="button"
                    key={i.id}
                    className={`si-chip ${off ? "off" : ""} ${bad ? "bad" : ""}`}
                    style={{ top, height }}
                    onClick={() => onEdit(i.id)}
                    title="แก้ไข"
                  >
                    <span className="si-chip-subj">{i.subject}</span>
                    <span className="si-chip-time">
                      {i.start_local}–{i.end_local}
                    </span>
                    {i.location && <span className="si-chip-loc">{i.location}</span>}
                    <span
                      className="si-chip-check"
                      role="checkbox"
                      aria-checked={!off}
                      tabIndex={0}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onToggle(i.id, off);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === " " || ev.key === "Enter") {
                          ev.preventDefault();
                          ev.stopPropagation();
                          onToggle(i.id, off);
                        }
                      }}
                    >
                      {!off && <Check aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      {unplaced.length > 0 && (
        <div className="si-unplaced">
          <span className="si-unplaced-label">ยังไม่มีวัน/เวลา</span>
          {unplaced.map((i) => (
            <button type="button" key={i.id} className="si-unplaced-chip bad" onClick={() => onEdit(i.id)}>
              {i.subject} <Pencil aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Day-grouped vertical timeline with a time rail. */
function ScheduleTimeline({
  items,
  onEdit,
  onToggle,
}: {
  items: ScheduleImportItem[];
  onEdit: (id: number) => void;
  onToggle: (id: number, selected: boolean) => void;
}) {
  const groups = useMemo(() => {
    const byDay = new Map<number | "none", ScheduleImportItem[]>();
    for (const i of items) {
      const key = i.weekday ?? "none";
      const arr = byDay.get(key) ?? [];
      arr.push(i);
      byDay.set(key, arr);
    }
    const order: (number | "none")[] = [1, 2, 3, 4, 5, 6, 0, "none"];
    return order
      .filter((k) => byDay.has(k))
      .map((k) => ({
        key: k,
        label: k === "none" ? "ยังไม่ระบุวัน" : WEEKDAY_FULL[k as number],
        items: (byDay.get(k) ?? []).sort(
          (a, b) => (toMin(a.start_local) ?? 0) - (toMin(b.start_local) ?? 0),
        ),
      }));
  }, [items]);

  return (
    <div className="si-timeline">
      {groups.map((g) => (
        <div className="si-tl-day" key={String(g.key)}>
          <div className="si-tl-dayhead">{g.label}</div>
          <div className="si-tl-items">
            {g.items.map((i) => {
              const off = i.selected !== 1;
              const bad = !isComplete(i);
              return (
                <div className={`si-tl-row ${off ? "off" : ""} ${bad ? "bad" : ""}`} key={i.id}>
                  <button
                    type="button"
                    className="si-tl-check"
                    role="checkbox"
                    aria-checked={!off}
                    onClick={() => onToggle(i.id, off)}
                  >
                    {!off && <Check aria-hidden="true" />}
                  </button>
                  <span className="si-tl-time">
                    {i.start_local && i.end_local ? `${i.start_local}–${i.end_local}` : "—"}
                  </span>
                  <button type="button" className="si-tl-main" onClick={() => onEdit(i.id)}>
                    <span className="si-tl-subj">{i.subject}</span>
                    {i.location && <span className="si-tl-loc">{i.location}</span>}
                    {bad && <AlertTriangle className="si-tl-bad" aria-hidden="true" />}
                    <Pencil className="si-tl-pencil" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Inline editor for one candidate item. */
function ItemEditor({
  item,
  onSave,
  onClose,
}: {
  item: ScheduleImportItem;
  onSave: (patch: ItemPatch) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(item.subject);
  const [weekday, setWeekday] = useState<number | null>(item.weekday);
  const [start, setStart] = useState(item.start_local ?? "");
  const [end, setEnd] = useState(item.end_local ?? "");
  const [location, setLocation] = useState(item.location ?? "");

  return (
    <div className="si-editor" role="dialog" aria-label="แก้ไขคาบเรียน">
      <div className="si-editor-row">
        <label className="si-editor-field grow">
          <span>วิชา</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <button type="button" className="si-editor-close" onClick={onClose} aria-label="ปิด">
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="si-editor-row">
        <label className="si-editor-field">
          <span>วัน</span>
          <select
            value={weekday ?? ""}
            onChange={(e) => setWeekday(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <option value={d} key={d}>
                {WEEKDAY_FULL[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="si-editor-field">
          <span>เริ่ม</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="si-editor-field">
          <span>จบ</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className="si-editor-row">
        <label className="si-editor-field grow">
          <span>ห้อง/สถานที่</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </div>
      <div className="si-editor-actions">
        <button type="button" className="si-btn-ghost" onClick={onClose}>
          ปิด
        </button>
        <button
          type="button"
          className="si-btn-primary"
          onClick={() =>
            onSave({
              subject: subject.trim() || item.subject,
              weekday,
              start_local: start || null,
              end_local: end || null,
              location: location.trim() || null,
            })
          }
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

export { WEEKDAY_SHORT, WEEKDAY_FULL };
