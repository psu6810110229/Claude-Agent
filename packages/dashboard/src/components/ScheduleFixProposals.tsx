"use client";

/**
 * Tier 2 — AI-proposed schedule fixes. A button asks the backend to PROPOSE
 * reschedules for the current Tier 1 findings (POST /api/calendar/fix-proposals).
 * Each proposal is already queued as a PENDING approval; this card surfaces the
 * AI's human-readable reason + the proposed new time and lets the user approve or
 * reject right here (reusing the normal approval queue). Nothing auto-executes.
 */
import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import {
  ApiError,
  approveApproval,
  proposeScheduleFixes,
  rejectApproval,
} from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/Button";
import type { ScheduleFindingKind, ScheduleFixProposal } from "@/lib/types";

const KIND_LABELS: Record<ScheduleFindingKind, string> = {
  overlap: "เวลาชนกัน",
  tight_travel: "เวลาเดินทางไม่พอ",
  no_buffer: "ประชุมติดกันไม่มีพัก",
  long_streak: "งานต่อเนื่องยาวไม่มีพัก",
  overloaded_day: "วันแน่นเกินไป",
  after_hours: "นอกเวลางาน",
  weekend: "วันหยุดสุดสัปดาห์",
  protected_day: "วันที่กันไว้",
};

function findingLabel(kind: string | null): string | null {
  if (!kind) return null;
  return (KIND_LABELS as Record<string, string>)[kind] ?? null;
}

function bangkokWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(ms));
}

/** New proposed slot in Bangkok, e.g. "อา. 22 มิ.ย. 10:30 – 11:30". */
function proposedSlot(p: ScheduleFixProposal): string | null {
  const start = bangkokWhen(p.payload.starts_at);
  if (!start) return null;
  const endIso = p.payload.ends_at;
  if (!endIso) return start;
  const endTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(Date.parse(endIso)));
  return `${start} – ${endTime}`;
}

type Phase = "idle" | "loading" | "done";

export function ScheduleFixProposals() {
  const { notify } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposals, setProposals] = useState<ScheduleFixProposal[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function generate() {
    setPhase("loading");
    setNotes(null);
    try {
      const res = await proposeScheduleFixes();
      setAvailable(res.available);
      setProposals(res.proposals);
      setNotes(res.notes ?? null);
      setPhase("done");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      setPhase("idle");
      notify({ kind: "error", title: "เสนอวิธีจัดไม่สำเร็จ", description: message });
    }
  }

  async function decide(p: ScheduleFixProposal, decision: "approve" | "reject") {
    setBusyId(p.approvalId);
    try {
      if (decision === "approve") await approveApproval(p.approvalId);
      else await rejectApproval(p.approvalId);
      // Remove the decided card; the approval lives on in the Approvals queue.
      setProposals((prev) => prev.filter((x) => x.approvalId !== p.approvalId));
      notify({
        kind: decision === "approve" ? "success" : "info",
        title: decision === "approve" ? "ปรับตารางแล้ว" : "ไม่ใช้ข้อเสนอนี้",
        description:
          decision === "approve"
            ? "อัปเดตเวลาในปฏิทินให้แล้ว"
            : "นำข้อเสนอออกจากคิวรออนุมัติแล้ว",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      notify({ kind: "error", title: "ทำรายการไม่สำเร็จ", description: message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fix-wrap">
      <div className="fix-head">
        <Button
          variant="primary"
          className="fix-trigger"
          onClick={generate}
          loading={phase === "loading"}
          iconLeading={<Sparkles aria-hidden="true" strokeWidth={1.9} />}
        >
          {phase === "loading"
            ? "กำลังคิดวิธีจัด…"
            : phase === "done"
              ? "เสนอใหม่อีกครั้ง"
              : "ให้ Friday เสนอวิธีจัดตาราง"}
        </Button>
        <span className="fix-hint">ข้อเสนอทุกอันต้องกดอนุมัติก่อน ไม่ปรับเองอัตโนมัติ</span>
      </div>

      {phase === "done" && !available && (
        <div className="state">เชื่อมต่อ Google Calendar เพื่อให้ Friday ช่วยจัดตาราง</div>
      )}

      {phase === "done" && available && proposals.length === 0 && (
        <div className="state">
          {notes ?? "ตอนนี้ยังไม่มีวิธีจัดที่ลงตัวให้เสนอ ลองปรับเองได้"}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="fix-list">
          {proposals.map((p) => {
            const kind = findingLabel(p.findingKind);
            const slot = proposedSlot(p);
            const busy = busyId === p.approvalId;
            return (
              <article className="fix-card" key={p.approvalId}>
                <div className="fix-card-body">
                  <div className="fix-card-head">
                    {p.eventTitle && (
                      <span className="fix-event">{p.eventTitle}</span>
                    )}
                    {kind && <span className="badge sev-medium">{kind}</span>}
                  </div>
                  <p className="fix-reason">{p.reason}</p>
                  {slot && (
                    <p className="fix-slot">
                      เวลาใหม่: <strong>{slot}</strong>
                    </p>
                  )}
                </div>
                <div className="approval-card-actions">
                  <Button
                    variant="primary"
                    onClick={() => decide(p, "approve")}
                    loading={busy}
                    iconLeading={<Check aria-hidden="true" strokeWidth={1.9} />}
                  >
                    {busy ? "กำลังทำ" : "อนุมัติ"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => decide(p, "reject")}
                    disabled={busy}
                    iconLeading={<X aria-hidden="true" strokeWidth={1.9} />}
                  >
                    ไม่ใช้
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
