"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, RotateCw, X } from "lucide-react";
import {
  ApiError,
  approveApproval,
  listApprovalsWithConflicts,
  rejectApproval,
} from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Empty } from "@/components/States";
import { useToast } from "@/components/ToastProvider";
import {
  humanLabel,
  summarizePayload,
  summarizePayloadDetail,
} from "@/lib/actionDisplay";
import type { Approval, ApprovalConflict } from "@/lib/types";

const CLASH_LABEL: Record<ApprovalConflict["kind"], string> = {
  overlap: "ทับเวลากับ",
  no_buffer: "ชิดกันเกินไปกับ",
  tight_travel: "เวลาเดินทางไม่พอจาก",
};

function ConflictWarning({ conflicts }: { conflicts: ApprovalConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="approval-clash" role="alert">
      <AlertTriangle aria-hidden="true" strokeWidth={1.9} />
      <span>
        {conflicts
          .map((c) => `${CLASH_LABEL[c.kind] ?? "ชนกับ"} “${c.withTitle}”`)
          .join(", ")}{" "}
        — ตรวจก่อนอนุมัติ
      </span>
    </div>
  );
}

type ApprovalDecision = "approve" | "reject";
type ApprovalColumnKey = "pending" | "approved" | "attention" | "rejected";

const BOARD_COLUMNS: ReadonlyArray<{
  key: ApprovalColumnKey;
  title: string;
  description: string;
}> = [
  {
    key: "pending",
    title: "Pending",
    description: "Ready for a decision",
  },
  {
    key: "approved",
    title: "Approved / Done",
    description: "Completed or approved work",
  },
  {
    key: "attention",
    title: "Needs Attention",
    description: "Failed or unclear proposals",
  },
  {
    key: "rejected",
    title: "Rejected",
    description: "Declined proposals",
  },
];

function ApprovalsSkeleton() {
  return (
    <div className="approvals-board" aria-label="Loading approvals">
      {BOARD_COLUMNS.map((column) => (
        <section className="approval-column" key={column.key}>
          <div className="approval-column-head">
            <span className="skel" style={{ width: 98, height: 18 }} />
            <span className="skel" style={{ width: 28, height: 23 }} />
          </div>
          <div className="approval-column-body">
            {[1, 2].map((i) => (
              <div className="approval-board-card" key={i}>
                <div className="approval-card-top">
                  <span className="skel" style={{ width: 76, height: 23 }} />
                  <span className="skel" style={{ width: 64, height: 13 }} />
                </div>
                <span className="skel" style={{ width: "80%", height: 18 }} />
                <span className="skel" style={{ width: "100%", height: 14 }} />
                <span className="skel" style={{ width: "58%", height: 14 }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ApprovalsPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } =
    useData("/api/approvals", listApprovalsWithConflicts);

  const approvals = data?.approvals;
  const conflicts = data?.conflicts ?? {};

  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const columns = useMemo(() => groupApprovals(approvals ?? []), [approvals]);

  async function run(approval: Approval, decision: ApprovalDecision) {
    setBusyId(approval.id);
    setActionError(null);
    try {
      if (decision === "approve") {
        await approveApproval(approval.id);
      } else {
        await rejectApproval(approval.id);
      }
      reload();
      notify({
        kind: decision === "approve" ? "success" : "info",
        title: decision === "approve" ? "Approved" : "Rejected",
        description:
          decision === "approve"
            ? "The approved action finished or updated its execution state."
            : "The proposal was removed from the pending queue.",
      });
    } catch (err) {
      reload();
      const message = err instanceof ApiError ? err.message : String(err);
      setActionError(message);
      notify({
        kind: "error",
        title:
          decision === "approve" && approval.execution_status === "failed"
            ? "Retry failed"
            : "Approval failed",
        description: message,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Safety Gate</p>
          <h2>Approvals</h2>
          <p className="lede">Review proposed actions before execution.</p>
        </div>
      </header>

      <div className="stack">
        {actionError && (
          <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />
        )}

        {loading && <ApprovalsSkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {approvals && approvals.length === 0 && (
          <Empty
            label="ไม่มีรายการรออนุมัติ"
            hint="เมื่อ Friday เสนอการกระทำที่ต้องอนุมัติ รายการจะปรากฏที่นี่ให้คุณตรวจก่อนดำเนินการ"
          />
        )}

        {approvals && approvals.length > 0 && (
          <div className="approvals-board">
            {BOARD_COLUMNS.map((column) => (
              <ApprovalColumn
                approvals={columns[column.key]}
                busyId={busyId}
                column={column}
                conflicts={conflicts}
                key={column.key}
                run={run}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ApprovalColumn({
  approvals,
  busyId,
  column,
  conflicts,
  run,
}: {
  approvals: Approval[];
  busyId: number | null;
  column: (typeof BOARD_COLUMNS)[number];
  conflicts: Record<number, ApprovalConflict[]>;
  run: (approval: Approval, decision: ApprovalDecision) => Promise<void>;
}) {
  return (
    <section
      className={`approval-column ${column.key}${
        approvals.length === 0 ? " empty" : ""
      }`}
    >
      <div className="approval-column-head">
        <div>
          <h3>{column.title}</h3>
          <p>{column.description}</p>
        </div>
        <span className="approval-count">{approvals.length}</span>
      </div>
      <div className="approval-column-body">
        {approvals.length === 0 ? (
          <div className="approval-column-empty">Clear</div>
        ) : (
          approvals.map((approval) => (
            <ApprovalCard
              approval={approval}
              busy={busyId === approval.id}
              conflicts={conflicts[approval.id] ?? []}
              key={approval.id}
              run={run}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ApprovalCard({
  approval,
  busy,
  conflicts,
  run,
}: {
  approval: Approval;
  busy: boolean;
  conflicts: ApprovalConflict[];
  run: (approval: Approval, decision: ApprovalDecision) => Promise<void>;
}) {
  const pending = approval.status === "pending";
  const summary = summarizePayload(approval);
  const detail = summarizePayloadDetail(approval);
  const executionNote = approvalExecutionMessage(approval);
  const failed = approval.execution_status === "failed";
  const primaryLabel = failed ? "Retry" : "Approve";
  const PrimaryIcon = failed ? RotateCw : Check;

  return (
    <article className={`approval-board-card ${failed ? "failed" : ""}`}>
      <div className="approval-card-top">
        <div className="approval-badges">
          <span className={`badge ${approval.status}`}>{approval.status}</span>
          {approval.execution_status !== "not_started" && (
            <span className={`badge ${approval.execution_status}`}>
              {approval.execution_status === "succeeded"
                ? "done"
                : approval.execution_status}
            </span>
          )}
        </div>
        <span className="ts">{formatTs(approval.created_at)}</span>
      </div>

      <div className="approval-card-main">
        <strong className="item-title">{humanLabel(approval.action_type)}</strong>
        <p className="approval-summary">
          {summary ?? "Payload summary unavailable"}
        </p>
        {detail && <p className="approval-summary secondary">{detail}</p>}
        {executionNote && (
          <p className={`approval-execution ${failed ? "failed" : ""}`}>
            {executionNote}
          </p>
        )}
      </div>

      {pending && <ConflictWarning conflicts={conflicts} />}

      <div className="approval-origin">
        <span>Source: approval queue</span>
        <span>Action #{approval.id}</span>
      </div>

      {pending && (
        <div className="approval-card-actions">
          <button
            type="button"
            className="primary"
            onClick={() => run(approval, "approve")}
            disabled={busy}
          >
            <PrimaryIcon aria-hidden="true" strokeWidth={1.9} />
            {busy ? "Working" : primaryLabel}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => run(approval, "reject")}
            disabled={busy}
          >
            <X aria-hidden="true" strokeWidth={1.9} />
            Reject
          </button>
        </div>
      )}

      {approval.payload != null && (
        <details className="payload-details">
          <summary>
            <span>Payload details</span>
            <span className="item-meta">{approval.action_type}</span>
          </summary>
          <pre className="payload">{JSON.stringify(approval.payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}

function groupApprovals(
  approvals: Approval[],
): Record<ApprovalColumnKey, Approval[]> {
  return approvals.reduce<Record<ApprovalColumnKey, Approval[]>>(
    (columns, approval) => {
      columns[getColumnKey(approval)].push(approval);
      return columns;
    },
    {
      pending: [],
      approved: [],
      attention: [],
      rejected: [],
    },
  );
}

function getColumnKey(approval: Approval): ApprovalColumnKey {
  if (approval.status === "rejected") return "rejected";
  if (approval.execution_status === "failed" || approval.payload == null) {
    return "attention";
  }
  if (approval.status === "approved" || approval.execution_status === "succeeded") {
    return "approved";
  }
  return "pending";
}

function approvalExecutionMessage(approval: Approval): string | null {
  if (approval.execution_status === "failed") {
    return approval.execution_error
      ? `Execution failed: ${approval.execution_error}`
      : "Execution failed. Retry approval or reject it.";
  }
  if (approval.execution_status === "succeeded") {
    const base = approval.result_summary ?? "Executed successfully.";
    return approval.undo_json ? `${base} · snapshot saved (undo available)` : base;
  }
  return null;
}
