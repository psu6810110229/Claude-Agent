"use client";

import { useState } from "react";
import { Trash2, Clock, Bike } from "lucide-react";
import { listClassBlocks, getFreeSlots, deleteClassBlock, ApiError } from "@/lib/api";
import { useData } from "@/lib/useData";
import { ErrorBanner } from "@/components/States";
import { WeekHourGrid, type GridBlock } from "@/components/WeekHourGrid";
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

export default function SchedulePage() {
  const { data, loading, error, reload } = useData("/api/schedule", loadSchedule);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(id: number) {
    if (busyId) return;
    setBusyId(id);
    try {
      await deleteClassBlock(id);
      await reload();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

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
            ในแชตเพื่อเพิ่มได้
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
              <h3>คาบเรียนต่อสัปดาห์</h3>
              <WeekHourGrid
                blocks={gridBlocks}
                highlightWeekday={todayWeekday}
                emptyHint="ยังไม่มีตารางเรียน — แนบรูปหรือ PDF ตารางในหน้าแชตเพื่อให้ Friday อ่านให้"
                renderChipExtra={(b) => (
                  <button
                    type="button"
                    className="whg-del"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void remove(b.id as number);
                    }}
                    disabled={busyId === b.id}
                    aria-label={`ลบ ${b.title}`}
                    title="ลบ"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              />
            </section>
          </>
        )}
      </div>
    </>
  );
}
