"use client";

/**
 * Schedule-preference editor (Tier 1 "C"). Tunes the deterministic
 * schedule-health thresholds: work hours, buffers, streak/overload limits, and
 * protected days. Pure config — no AI, no calendar writes. The backend clamps
 * and echoes the effective prefs, which we adopt as the new baseline on save.
 */
import { useEffect, useState } from "react";
import { ApiError, getSchedulePrefs, saveSchedulePrefs } from "@/lib/api";
import { useData } from "@/lib/useData";
import { ErrorBanner } from "@/components/States";
import { useToast } from "@/components/ToastProvider";
import type { SchedulePrefs } from "@/lib/types";

const DAY_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

interface NumField {
  key: keyof Omit<SchedulePrefs, "protectedDays">;
  label: string;
  min: number;
  max: number;
  suffix: string;
}

const NUM_FIELDS: NumField[] = [
  { key: "workStartHour", label: "เริ่มเวลางาน", min: 0, max: 23, suffix: "นาฬิกา" },
  { key: "workEndHour", label: "จบเวลางาน", min: 1, max: 24, suffix: "นาฬิกา" },
  { key: "minBufferMin", label: "พักขั้นต่ำระหว่างนัด", min: 0, max: 180, suffix: "นาที" },
  { key: "travelBufferMin", label: "เผื่อเวลาเดินทาง", min: 0, max: 240, suffix: "นาที" },
  { key: "streakHours", label: "งานต่อเนื่องนานสุด", min: 1, max: 12, suffix: "ชม." },
  { key: "overloadDayMin", label: "วันแน่นเมื่อเกิน", min: 60, max: 1440, suffix: "นาที/วัน" },
];

export function SchedulePrefsPanel() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useData(
    "/api/settings/schedule",
    getSchedulePrefs,
  );
  const [draft, setDraft] = useState<SchedulePrefs | null>(null);
  const [busy, setBusy] = useState(false);

  // Adopt server prefs as the editing baseline whenever they (re)load.
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (loading && !draft) {
    return (
      <div className="panel">
        <span className="skel" style={{ display: "block", width: "40%", height: 18, marginBottom: 14 }} />
        {[0, 1, 2].map((i) => (
          <div className="row" key={i} style={{ marginBottom: 10 }}>
            <span className="skel" style={{ flex: 1, height: 16 }} />
            <span className="skel" style={{ width: 90, height: 32, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!draft) return null;

  function setNum(key: NumField["key"], value: number) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleDay(day: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.protectedDays.includes(day);
      const protectedDays = has
        ? prev.protectedDays.filter((d) => d !== day)
        : [...prev.protectedDays, day].sort((a, b) => a - b);
      return { ...prev, protectedDays };
    });
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const effective = await saveSchedulePrefs(draft);
      setDraft(effective);
      void reload();
      notify({ kind: "success", title: "บันทึกแล้ว", description: "ตั้งค่าตาราง" });
    } catch (e) {
      notify({
        kind: "error",
        title: "บันทึกไม่สำเร็จ",
        description: e instanceof ApiError ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel sched-prefs">
      {NUM_FIELDS.map((f) => (
        <label className="sched-field" key={f.key}>
          <span className="sched-field-label">{f.label}</span>
          <span className="sched-field-input">
            <input
              type="number"
              min={f.min}
              max={f.max}
              value={draft[f.key]}
              onChange={(e) => setNum(f.key, Number(e.target.value))}
            />
            <span className="sched-field-suffix">{f.suffix}</span>
          </span>
        </label>
      ))}

      <div className="sched-field sched-days">
        <span className="sched-field-label">วันที่กันไว้ (ไม่อยากให้มีนัด)</span>
        <span className="sched-day-row">
          {DAY_LABELS.map((label, day) => {
            const active = draft.protectedDays.includes(day);
            return (
              <button
                type="button"
                key={day}
                className={`sched-day ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleDay(day)}
              >
                {label}
              </button>
            );
          })}
        </span>
      </div>

      <div className="sched-actions">
        <button type="button" className="primary" onClick={save} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
