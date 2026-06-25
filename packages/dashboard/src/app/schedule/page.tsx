"use client";

import { useState } from "react";
import { Trash2, Clock, Bike, Plus, Pencil, Check, X } from "lucide-react";
import {
  listClassBlocks,
  getFreeSlots,
  createClassBlock,
  updateClassBlock,
  deleteClassBlock,
  ApiError,
  type ClassBlockInput,
} from "@/lib/api";
import { useData } from "@/lib/useData";
import { ErrorBanner } from "@/components/States";
import {
  WeekHourGrid,
  WEEKDAY_FULL_LABELS,
  type GridBlock,
} from "@/components/WeekHourGrid";
import type { ClassBlock, FreeSlotsResult } from "@/lib/types";

async function loadSchedule(): Promise<{
  blocks: ClassBlock[];
  free: FreeSlotsResult;
}> {
  const [blocks, free] = await Promise.all([
    listClassBlocks(),
    getFreeSlots().catch(() => ({ date: null, slots: [] }) as FreeSlotsResult),
  ]);
  return { blocks, free };
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fmtSlot(startUtc: string, endUtc: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  };
  const s = new Intl.DateTimeFormat("en-GB", opts).format(new Date(startUtc));
  const e = new Intl.DateTimeFormat("en-GB", opts).format(new Date(endUtc));
  return `${s}–${e}`;
}

// Weekday order shown in the form: Mon→Sun (matches the grid).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface FormState {
  id: number | null; // null = creating
  subject: string;
  weekday: number;
  start_local: string;
  end_local: string;
  location: string;
}

function blankForm(): FormState {
  return { id: null, subject: "", weekday: 1, start_local: "08:00", end_local: "09:00", location: "" };
}

export default function SchedulePage() {
  const { data, loading, error, reload } = useData("/api/schedule", loadSchedule);
  const [editMode, setEditMode] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function confirmRemove() {
    if (!pendingDelete || busyId) return;
    const id = pendingDelete.id;
    setBusyId(id);
    setDeleteError(null);
    try {
      await deleteClassBlock(id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  function openCreate() {
    setFormError(null);
    setForm(blankForm());
  }

  function openEdit(b: ClassBlock) {
    setFormError(null);
    setForm({
      id: b.id,
      subject: b.subject,
      weekday: b.weekday,
      start_local: b.start_local,
      end_local: b.end_local,
      location: b.location ?? "",
    });
  }

  async function saveForm() {
    if (!form || saving) return;
    if (!form.subject.trim()) {
      setFormError("ใส่ชื่อวิชาก่อน");
      return;
    }
    if (form.end_local <= form.start_local) {
      setFormError("เวลาเลิกต้องหลังเวลาเริ่ม");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload: ClassBlockInput = {
      subject: form.subject.trim(),
      weekday: form.weekday,
      start_local: form.start_local,
      end_local: form.end_local,
      location: form.location.trim() || null,
    };
    try {
      if (form.id === null) await createClassBlock(payload);
      else await updateClassBlock(form.id, payload);
      setForm(null);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const blocksById = new Map((data?.blocks ?? []).map((b) => [b.id, b]));
  const gridBlocks: GridBlock[] = (data?.blocks ?? []).map((b) => ({
    id: b.id,
    weekday: b.weekday,
    startMin: toMin(b.start_local),
    endMin: toMin(b.end_local),
    title: b.subject,
    subtitle: b.location,
  }));
  const todayWeekday = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }),
  ).getDay();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Schedule</p>
          <h2>ตารางเรียน</h2>
          <p className="lede">
            ตารางในเครื่อง (ไม่ขึ้น Google Calendar) — Friday ใช้เทียบหาเวลาว่างให้ แนบรูป/PDF
            ในแชตเพื่อเพิ่มได้ หรือกด “เพิ่มวิชา” เพื่อใส่เอง
          </p>
        </div>
      </header>

      <div className="stack">
        {loading && <div className="state">กำลังโหลด…</div>}
        {error && <ErrorBanner message={error} onRetry={reload} />}

        {data && (
          <>
            <section className="section">
              <h3>
                <Bike aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />
                เวลาว่างวันนี้
              </h3>
              {data.free.slots.length > 0 ? (
                <div className="sch-free-strip">
                  {data.free.slots.map((s) => (
                    <span className="sch-free-chip" key={s.startUtc}>
                      <Clock aria-hidden="true" />
                      {fmtSlot(s.startUtc, s.endUtc)}
                      <small>{Math.round(s.minutes / 60 * 10) / 10} ชม.</small>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="state">วันนี้ไม่มีช่วงว่างยาวพอในเวลากลางวัน</div>
              )}
            </section>

            <section className="section">
              <div className="sch-grid-head">
                <h3>คาบเรียนต่อสัปดาห์</h3>
                <div className="sch-grid-tools">
                  <button type="button" className="primary" onClick={openCreate}>
                    <Plus aria-hidden="true" /> เพิ่มวิชา
                  </button>
                  {gridBlocks.length > 0 && (
                    <button
                      type="button"
                      className={editMode ? "primary" : ""}
                      onClick={() => setEditMode((v) => !v)}
                      aria-pressed={editMode}
                    >
                      {editMode ? (
                        <>
                          <Check aria-hidden="true" /> เสร็จ
                        </>
                      ) : (
                        <>
                          <Pencil aria-hidden="true" /> แก้ไข
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {editMode && gridBlocks.length > 0 && (
                <p className="sch-edit-hint">แตะคาบเพื่อแก้ไข หรือกดถังขยะเพื่อลบ</p>
              )}
              <WeekHourGrid
                blocks={gridBlocks}
                highlightWeekday={todayWeekday}
                emptyHint="ยังไม่มีตารางเรียน — กด “เพิ่มวิชา” หรือแนบรูป/PDF ตารางในหน้าแชต"
                editable={editMode}
                onChipClick={
                  editMode
                    ? (id) => {
                        const b = blocksById.get(id as number);
                        if (b) openEdit(b);
                      }
                    : undefined
                }
                onDelete={(b) => {
                  setDeleteError(null);
                  setPendingDelete({ id: b.id as number, title: b.title });
                }}
              />
            </section>
          </>
        )}
      </div>

      {form && (
        <div
          className="jarvis-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setForm(null);
          }}
        >
          <section
            className="jarvis-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-title"
          >
            <div className="jarvis-dialog-orb" aria-hidden="true" />
            <div className="jarvis-dialog-copy">
              <p className="page-kicker">ตารางเรียน</p>
              <h3 id="form-title">{form.id === null ? "เพิ่มวิชา" : "แก้ไขวิชา"}</h3>
              <div className="sch-form">
                <label className="sch-field">
                  <span>ชื่อวิชา</span>
                  <input
                    type="text"
                    value={form.subject}
                    autoFocus
                    placeholder="เช่น 240-219 NETWORK ADMINISTRATOR"
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                </label>
                <label className="sch-field">
                  <span>วัน</span>
                  <select
                    value={form.weekday}
                    onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {WEEKDAY_FULL_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sch-field-row">
                  <label className="sch-field">
                    <span>เริ่ม</span>
                    <input
                      type="time"
                      value={form.start_local}
                      onChange={(e) => setForm({ ...form, start_local: e.target.value })}
                    />
                  </label>
                  <label className="sch-field">
                    <span>เลิก</span>
                    <input
                      type="time"
                      value={form.end_local}
                      onChange={(e) => setForm({ ...form, end_local: e.target.value })}
                    />
                  </label>
                </div>
                <label className="sch-field">
                  <span>สถานที่ (ไม่บังคับ)</span>
                  <input
                    type="text"
                    value={form.location}
                    placeholder="เช่น R200"
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </label>
              </div>
              {formError && <p className="si-error">{formError}</p>}
            </div>
            <div className="jarvis-dialog-actions">
              <button type="button" onClick={() => setForm(null)} disabled={saving}>
                <X aria-hidden="true" /> ยกเลิก
              </button>
              <button type="button" className="primary" onClick={saveForm} disabled={saving}>
                {saving ? "กำลังบันทึก..." : form.id === null ? "เพิ่ม" : "บันทึก"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingDelete && (
        <div
          className="jarvis-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busyId) setPendingDelete(null);
          }}
        >
          <section
            className="jarvis-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-title"
          >
            <div className="jarvis-dialog-orb" aria-hidden="true" />
            <div className="jarvis-dialog-copy">
              <p className="page-kicker">ตารางเรียน</p>
              <h3 id="del-title">ลบคาบเรียนนี้?</h3>
              <p>
                ลบ “{pendingDelete.title}” ออกจากตารางในเครื่อง — Friday จะไม่ใช้คาบนี้
                เทียบเวลาว่างอีก (เพิ่มกลับได้ด้วยการนำเข้าใหม่)
              </p>
              {deleteError && <p className="si-error">{deleteError}</p>}
            </div>
            <div className="jarvis-dialog-actions">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={busyId !== null}
                autoFocus
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary danger"
                onClick={confirmRemove}
                disabled={busyId !== null}
              >
                <Trash2 aria-hidden="true" />
                {busyId !== null ? "กำลังลบ..." : "ลบ"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
