"use client";

/**
 * Schedule health card (Tier 1 conflict/gap detection). Renders the read-only
 * findings from GET /api/calendar/health: overlaps, tight gaps, overloaded days,
 * after-hours/weekend work — severity-ranked. PROPOSES NOTHING; it only
 * surfaces what the deterministic backend analyzer found. Fail-closed: when the
 * calendar is unavailable it shows a quiet note rather than an error.
 */
import { getCalendarHealth } from "@/lib/api";
import { useData } from "@/lib/useData";
import type {
  ScheduleFinding,
  ScheduleFindingKind,
  ScheduleSeverity,
} from "@/lib/types";

const KIND_LABELS: Record<ScheduleFindingKind, string> = {
  overlap: "เวลาชนกัน",
  tight_travel: "เวลาเดินทางไม่พอ",
  no_buffer: "ประชุมติดกันไม่มีพัก",
  long_streak: "งานต่อเนื่องยาวไม่มีพัก",
  overloaded_day: "วันแน่นเกินไป",
  after_hours: "นอกเวลางาน",
  weekend: "วันหยุดสุดสัปดาห์",
};

const SEVERITY_LABELS: Record<ScheduleSeverity, string> = {
  high: "ควรจัดการ",
  medium: "ควรดู",
  low: "ข้อสังเกต",
};

function bangkokDay(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

function bangkokTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}

/** When the finding spans a window, show "วันที่ HH:MM–HH:MM"; per-day spans just the date. */
function whenLabel(f: ScheduleFinding): string {
  const day = bangkokDay(f.startUtc);
  if (f.kind === "overloaded_day") return day;
  const start = bangkokTime(f.startUtc);
  const end = bangkokTime(f.endUtc);
  return start === end ? `${day} ${start}` : `${day} ${start}–${end}`;
}

function FindingRow({ f }: { f: ScheduleFinding }) {
  const titles = f.titles.filter(Boolean);
  return (
    <div className={`health-row sev-${f.severity}`}>
      <span className="health-dot" aria-hidden="true" />
      <span className="health-body">
        <span className="health-head">
          <span className="health-kind">{KIND_LABELS[f.kind]}</span>
          <span className="health-when">{whenLabel(f)}</span>
        </span>
        {titles.length > 0 && (
          <span className="health-titles">{titles.join(" · ")}</span>
        )}
        <span className="health-detail">{f.detail}</span>
      </span>
      <span className={`badge sev-${f.severity}`}>
        {SEVERITY_LABELS[f.severity]}
      </span>
    </div>
  );
}

export function ScheduleHealth() {
  const { data, loading } = useData("/api/calendar/health", getCalendarHealth);

  if (loading && !data) {
    return (
      <div className="health-card">
        {[0, 1].map((i) => (
          <div className="row" key={i} style={{ marginBottom: 8 }}>
            <span className="skel" style={{ width: 10, height: 10, flexShrink: 0 }} />
            <span className="skel" style={{ flex: 1, height: 13, margin: "0 8px" }} />
            <span className="skel" style={{ width: 56, height: 13, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    );
  }

  // Fail-closed: calendar unreachable/disabled.
  if (!data || !data.available) {
    return (
      <div className="state">
        เชื่อมต่อ Google Calendar เพื่อตรวจสุขภาพตาราง
      </div>
    );
  }

  if (data.findings.length === 0) {
    return (
      <div className="health-clear">
        <span className="health-dot" aria-hidden="true" />
        ตารางดูโล่ง ไม่พบเวลาชนหรือช่วงที่แน่นเกินไป
      </div>
    );
  }

  return (
    <div className="health-card">
      {data.findings.map((f, i) => (
        <FindingRow key={`${f.kind}-${f.startUtc}-${i}`} f={f} />
      ))}
    </div>
  );
}
