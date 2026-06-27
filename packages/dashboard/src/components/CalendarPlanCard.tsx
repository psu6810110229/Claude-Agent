"use client";

import { useMemo, useState } from "react";
import { CalendarRange, AlertTriangle, ChevronDown } from "lucide-react";
import {
  patchCalendarPlanItem,
  approveCalendarPlan,
  ApiError,
} from "@/lib/api";
import type {
  CalendarPlanItem,
  ApproveCalendarPlanResult,
} from "@/lib/types";

/**
 * Review card for a bulk Google Calendar add staged from chat. The model put the
 * WHOLE event list in one action, so nothing is lost to the per-turn action cap.
 *
 * Deliberately simple: ONE checklist of the events to add. The backend already
 * decided what is NEW vs already on the calendar, so:
 *   - NEW items (clean, or merely overlapping another subject) sit in the main
 *     list, pre-checked. An overlap is shown as a quiet note, NOT a decision — a
 *     fixed timetable is added regardless.
 *   - Items already on the calendar (duplicates) are tucked into a collapsed
 *     "already there" section, unchecked, so they are skipped by default and the
 *     user does not have to think about them.
 * One control type — a checkbox — and one question: add it or not.
 */

type Category = "clean" | "duplicate" | "overlap";

/** Bangkok-local "dd/mm/yyyy HH:MM" for an ISO UTC instant. */
function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bucket of an item, with a legacy fallback when `category` is absent. */
function categoryOf(i: CalendarPlanItem): Category {
  if (i.category === "duplicate" || i.category === "overlap") return i.category;
  if (i.category === "clean") return "clean";
  return i.status === "conflict" ? "overlap" : "clean"; // legacy rows
}

/** First clashing title only (conflict_with may join several) — keep the note short. */
function firstConflict(s: string | null): string | null {
  if (!s) return null;
  return s.split(",")[0]?.trim() || null;
}

export function CalendarPlanCard({
  planId,
  initialItems,
  note,
  onResolved,
  onDiscard,
}: {
  planId: number;
  initialItems: CalendarPlanItem[];
  note: string | null;
  onResolved: (result: ApproveCalendarPlanResult) => void;
  onDiscard: () => void;
}) {
  const [items, setItems] = useState<CalendarPlanItem[]>(initialItems);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExisting, setShowExisting] = useState(false);

  // NEW = add-able (clean + overlap); EXISTING = already on the calendar (dup).
  const { toAdd, existing } = useMemo(() => {
    const toAdd: CalendarPlanItem[] = [];
    const existing: CalendarPlanItem[] = [];
    for (const i of items) {
      if (categoryOf(i) === "duplicate") existing.push(i);
      else toAdd.push(i);
    }
    return { toAdd, existing };
  }, [items]);

  const selectedCount = items.filter((i) => i.selected === 1).length;

  async function syncPatch(
    itemId: number,
    patch: { selected?: boolean; override_conflict?: boolean },
  ) {
    const before = items;
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              selected:
                patch.selected !== undefined
                  ? patch.selected
                    ? 1
                    : 0
                  : i.selected,
              override_conflict:
                patch.override_conflict !== undefined
                  ? patch.override_conflict
                    ? 1
                    : 0
                  : i.override_conflict,
            }
          : i,
      ),
    );
    try {
      await patchCalendarPlanItem(planId, itemId, patch);
    } catch (err) {
      setItems(before);
      setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    }
  }

  // Ticking a clashing item also confirms "add anyway" (override) so the
  // approve-time recheck creates it; for a clean item override is irrelevant.
  function setSelected(item: CalendarPlanItem, selected: boolean) {
    if (item.selected === (selected ? 1 : 0)) return;
    const patch: { selected: boolean; override_conflict?: boolean } = { selected };
    if (item.status === "conflict") patch.override_conflict = selected;
    void syncPatch(item.id, patch);
  }

  function setGroupSelected(group: CalendarPlanItem[], selected: boolean) {
    for (const i of group) {
      if (i.status === "created") continue;
      setSelected(i, selected);
    }
  }

  async function approve() {
    if (approving) return;
    setApproving(true);
    setError(null);
    try {
      const result = await approveCalendarPlan(planId);
      onResolved(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มลงปฏิทินไม่สำเร็จ");
    } finally {
      setApproving(false);
    }
  }

  function row(item: CalendarPlanItem, kind: Category) {
    const clash = kind === "overlap" ? firstConflict(item.conflict_with) : null;
    return (
      <li key={item.id} className={`si-pl-row${item.selected === 1 ? "" : " off"}`}>
        <input
          type="checkbox"
          className="si-pl-check"
          checked={item.selected === 1}
          disabled={item.status === "created"}
          onChange={(e) => setSelected(item, e.target.checked)}
          aria-label={`เลือก ${item.title}`}
        />
        <div className="si-pl-info">
          <span className="si-pl-title">{item.title}</span>
          <span className="si-pl-time">{fmt(item.starts_at)}</span>
          {clash && (
            <span className="si-pl-note">
              <AlertTriangle aria-hidden="true" />
              เวลาทับ {clash} · ติ๊กไว้ถ้าตารางตายตัว
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="si-card si-pl" role="group" aria-label="แผนเพิ่มกำหนดการลงปฏิทิน">
      <header className="si-head">
        <div className="si-head-title">
          <CalendarRange aria-hidden="true" />
          <span>เพิ่มลงปฏิทิน</span>
        </div>
        <span className="si-pl-sub">
          ใหม่ {toAdd.length} รายการ
          {existing.length > 0 ? ` · มีอยู่แล้ว ${existing.length} (ข้ามให้)` : ""}
        </span>
      </header>

      {note && <p className="si-note">{note}</p>}

      {toAdd.length > 1 && (
        <div className="si-pl-bulk">
          <button type="button" onClick={() => setGroupSelected(toAdd, true)}>
            เลือกทั้งหมด
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => setGroupSelected(toAdd, false)}>
            ล้าง
          </button>
        </div>
      )}

      <ul className="si-pl-list">{toAdd.map((i) => row(i, categoryOf(i)))}</ul>

      {existing.length > 0 && (
        <section className="si-pl-existing">
          <button
            type="button"
            className="si-pl-extoggle"
            aria-expanded={showExisting}
            onClick={() => setShowExisting((v) => !v)}
          >
            <ChevronDown
              aria-hidden="true"
              className={`si-pl-chev${showExisting ? " open" : ""}`}
            />
            มีอยู่แล้วในปฏิทิน {existing.length} รายการ — ข้ามให้
          </button>
          {showExisting && (
            <ul className="si-pl-list">{existing.map((i) => row(i, "duplicate"))}</ul>
          )}
        </section>
      )}

      {error && <p className="si-error">{error}</p>}

      <footer className="si-actions">
        <button
          type="button"
          className="si-btn-ghost"
          onClick={onDiscard}
          disabled={approving}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="si-btn-primary"
          onClick={approve}
          disabled={approving || selectedCount === 0}
        >
          {approving ? "กำลังเพิ่ม..." : `เพิ่ม ${selectedCount} รายการ`}
        </button>
      </footer>
      <p className="si-hint">ยังไม่ถูกสร้างจนกว่าจะกด “เพิ่ม”</p>
    </div>
  );
}
