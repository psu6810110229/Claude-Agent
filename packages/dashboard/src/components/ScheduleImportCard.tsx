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
import { WeekHourGrid, type GridBlock } from "./WeekHourGrid";
import { Button, IconButton } from "@/components/ui";

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
          <IconButton
            role="tab"
            aria-selected={view === "grid"}
            aria-label="ตาราง"
            className={view === "grid" ? "active" : ""}
            onClick={() => setView("grid")}
          >
            <LayoutGrid />
          </IconButton>
          <IconButton
            role="tab"
            aria-selected={view === "timeline"}
            aria-label="ไทม์ไลน์"
            className={view === "timeline" ? "active" : ""}
            onClick={() => setView("timeline")}
          >
            <ListTree />
          </IconButton>
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
        <Button variant="ghost" onClick={onCancel} disabled={approving}>
          ยกเลิก
        </Button>
        <Button
          variant="primary"
          onClick={approve}
          loading={approving}
          disabled={readyCount === 0}
        >
          {approving ? "กำลังเพิ่ม..." : `เพิ่ม ${readyCount} คาบเข้าตาราง`}
        </Button>
      </footer>
      <p className="si-hint">
        บันทึกเป็นตารางในเครื่อง ไม่ขึ้น Google Calendar · Friday ใช้เทียบหาเวลาว่างให้
      </p>
    </div>
  );
}

/** Weekly grid (day rows × time columns), delegated to the shared WeekHourGrid. */
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

  const blocks: GridBlock[] = placed.map((i) => ({
    id: i.id,
    weekday: i.weekday as number,
    startMin: toMin(i.start_local)!,
    endMin: toMin(i.end_local)!,
    title: i.subject,
    subtitle: i.location,
    tone: i.selected !== 1 ? "muted" : !isComplete(i) ? "warn" : "normal",
  }));

  return (
    <div className="si-grid-wrap">
      <WeekHourGrid
        blocks={blocks}
        onChipClick={(id) => onEdit(id as number)}
        renderChipExtra={(b) => {
          const item = items.find((x) => x.id === b.id);
          const off = item?.selected !== 1;
          return (
            <span
              className="whg-check"
              role="checkbox"
              aria-checked={!off}
              tabIndex={0}
              onClick={(ev) => {
                ev.stopPropagation();
                onToggle(b.id as number, off);
              }}
              onKeyDown={(ev) => {
                if (ev.key === " " || ev.key === "Enter") {
                  ev.preventDefault();
                  ev.stopPropagation();
                  onToggle(b.id as number, off);
                }
              }}
            >
              {!off && <Check aria-hidden="true" />}
            </span>
          );
        }}
      />

      {unplaced.length > 0 && (
        <div className="si-unplaced">
          <span className="si-unplaced-label">ยังไม่มีวัน/เวลา</span>
          {unplaced.map((i) => (
            <Button
              key={i.id}
              variant="ghost"
              size="sm"
              className="si-unplaced-chip bad"
              onClick={() => onEdit(i.id)}
              iconTrailing={<Pencil />}
            >
              {i.subject}
            </Button>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="si-tl-check"
                    role="checkbox"
                    aria-checked={!off}
                    onClick={() => onToggle(i.id, off)}
                  >
                    {!off && <Check aria-hidden="true" />}
                  </Button>
                  <span className="si-tl-time">
                    {i.start_local && i.end_local ? `${i.start_local}–${i.end_local}` : "—"}
                  </span>
                  <Button variant="ghost" className="si-tl-main" onClick={() => onEdit(i.id)}>
                    <span className="si-tl-subj">{i.subject}</span>
                    {i.location && <span className="si-tl-loc">{i.location}</span>}
                    {bad && <AlertTriangle className="si-tl-bad" aria-hidden="true" />}
                    <Pencil className="si-tl-pencil" aria-hidden="true" />
                  </Button>
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
        <IconButton aria-label="ปิด" onClick={onClose}>
          <X />
        </IconButton>
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
        <Button variant="ghost" onClick={onClose}>
          ปิด
        </Button>
        <Button
          variant="primary"
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
        </Button>
      </div>
    </div>
  );
}

export { WEEKDAY_SHORT, WEEKDAY_FULL };
