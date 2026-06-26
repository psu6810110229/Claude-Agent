"use client";

import { useState } from "react";
import { CalendarRange, Check, AlertTriangle } from "lucide-react";
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
 * The user selects which to create (all / some / none) and, for any item whose
 * time clashes with the calendar, ticks "create anyway" to add it regardless —
 * so a conflicting event is never silently dropped without the user's choice.
 */

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

  const selectedCount = items.filter((i) => i.selected === 1).length;
  const conflictCount = items.filter((i) => i.status === "conflict").length;
  // A selected, clashing item that has NOT been confirmed "create anyway" will be
  // skipped on approve — surface that so it is never a silent loss.
  const blockedCount = items.filter(
    (i) => i.selected === 1 && i.status === "conflict" && i.override_conflict !== 1,
  ).length;

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

  function setAllSelected(selected: boolean) {
    for (const i of items) {
      if (i.selected === (selected ? 1 : 0)) continue;
      void syncPatch(i.id, { selected });
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

  return (
    <div className="si-card" role="group" aria-label="แผนเพิ่มกำหนดการลงปฏิทิน">
      <header className="si-head">
        <div className="si-head-title">
          <CalendarRange aria-hidden="true" />
          <span>เพิ่มลงปฏิทิน (Google)</span>
          <span className="si-count">{items.length} รายการ</span>
        </div>
        <div className="si-view-toggle" role="group" aria-label="เลือก">
          <button type="button" onClick={() => setAllSelected(true)}>
            เลือกทั้งหมด
          </button>
          <button type="button" onClick={() => setAllSelected(false)}>
            ล้าง
          </button>
        </div>
      </header>

      {note && <p className="si-note">{note}</p>}

      <ul className="si-body" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item) => {
          const isConflict = item.status === "conflict";
          const created = item.status === "created";
          return (
            <li
              key={item.id}
              className="si-plan-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0",
                opacity: item.selected === 1 ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                checked={item.selected === 1}
                disabled={created}
                onChange={(e) => syncPatch(item.id, { selected: e.target.checked })}
                aria-label={`เลือก ${item.title}`}
              />
              <span style={{ flex: "1 1 12rem", minWidth: "12rem" }}>
                <strong>{item.title}</strong>
                <br />
                <span className="si-count">{fmt(item.starts_at)}</span>
              </span>
              {created && <Check aria-hidden="true" className="si-done-icon" />}
              {isConflict && !created && (
                <span
                  className="si-warn"
                  style={{ flexBasis: "100%", margin: 0 }}
                >
                  <AlertTriangle aria-hidden="true" />
                  เวลาทับ{item.conflict_with ? ` ${item.conflict_with}` : ""}
                  <label style={{ marginLeft: "0.5rem", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={item.override_conflict === 1}
                      onChange={(e) =>
                        syncPatch(item.id, { override_conflict: e.target.checked })
                      }
                    />{" "}
                    สร้างทับ
                  </label>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {blockedCount > 0 && (
        <p className="si-warn">
          <AlertTriangle aria-hidden="true" />
          {blockedCount} รายการเวลาทับและยังไม่ได้เลือก “สร้างทับ” — จะถูกข้ามและแจ้งให้ทราบ
        </p>
      )}
      {error && <p className="si-error">{error}</p>}

      <footer className="si-actions">
        <button
          type="button"
          className="si-btn-ghost"
          onClick={onDiscard}
          disabled={approving}
        >
          ไม่เอาเลย
        </button>
        <button
          type="button"
          className="si-btn-primary"
          onClick={approve}
          disabled={approving || selectedCount === 0}
        >
          {approving ? "กำลังเพิ่ม..." : `สร้าง ${selectedCount} รายการที่เลือก`}
        </button>
      </footer>
      <p className="si-hint">
        ยังไม่ถูกสร้างจนกว่าจะกด “สร้าง” · รายการที่เวลาทับจะถูกข้ามถ้าไม่เลือก “สร้างทับ”
      </p>
    </div>
  );
}
