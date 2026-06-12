"use client";

import { useState } from "react";
import {
  ApiError,
  approveApproval,
  listApprovals,
  rejectApproval,
} from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Empty } from "@/components/States";
import { useToast } from "@/components/ToastProvider";
import { humanLabel, summarizePayload } from "@/lib/actionDisplay";
import type { Approval } from "@/lib/types";

function ApprovalsSkeleton() {
  return (
    <div className="stack">
      {[1, 2].map((i) => (
        <section className="panel approval-card" key={i}>
          <div className="row">
            <span className="skel" style={{ width: 62, height: 22, flexShrink: 0 }} />
            <span className="skel" style={{ flex: 1, height: 15, margin: "0 8px" }} />
            <span className="skel" style={{ width: 60, height: 13, flexShrink: 0 }} />
            <span className="skel" style={{ width: 72, height: 32, flexShrink: 0 }} />
            <span className="skel" style={{ width: 60, height: 32, flexShrink: 0 }} />
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ApprovalsPage() {
  const { notify } = useToast();
  const { data: approvals, loading, error, reload } =
    useData("/api/approvals", listApprovals);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, success: "approve" | "reject") {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      notify({
        kind: success === "approve" ? "success" : "info",
        title: success === "approve" ? "Approved" : "Rejected",
        description:
          success === "approve"
            ? "ดำเนินการที่อนุมัติแล้ว"
            : "ยกเลิกงานที่รออนุมัติแล้ว",
      });
    } catch (err) {
      reload();
      setActionError(err instanceof ApiError ? err.message : String(err));
      notify({
        kind: "error",
        title: "Approval failed",
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setBusy(false);
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
          <Empty label="No approvals in the queue." />
        )}

        {approvals?.map((a) => (
          <ApprovalCard key={a.id} approval={a} busy={busy} run={run} />
        ))}
      </div>
    </>
  );
}

function ApprovalCard({
  approval,
  busy,
  run,
}: {
  approval: Approval;
  busy: boolean;
  run: (fn: () => Promise<unknown>, success: "approve" | "reject") => Promise<void>;
}) {
  const pending = approval.status === "pending";
  const summary = summarizePayload(approval);
  const executionNote = approvalExecutionMessage(approval);
  const failed = approval.execution_status === "failed";
  return (
    <section className={`panel approval-card ${failed ? "failed" : ""}`}>
      <div className="row">
        <span className={`badge ${approval.status}`}>{approval.status}</span>
        {approval.execution_status !== "not_started" && (
          <span className={`badge ${approval.execution_status}`}>
            {approval.execution_status === "succeeded"
              ? "done"
              : approval.execution_status}
          </span>
        )}
        <span className="grow">
          <strong className="item-title">{humanLabel(approval.action_type)}</strong>
          {summary && <span className="item-meta">{summary}</span>}
          {executionNote && (
            <span className="item-meta execution-note">{executionNote}</span>
          )}
        </span>
        <span className="ts">{formatTs(approval.created_at)}</span>
        {pending && (
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => run(() => approveApproval(approval.id), "approve")}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => run(() => rejectApproval(approval.id), "reject")}
              disabled={busy}
            >
              Reject
            </button>
          </div>
        )}
      </div>
      {approval.payload != null && (
        <details className="payload-details">
          <summary>
            <span className="item-meta">{approval.action_type} · #{approval.id}</span>
          </summary>
          <pre className="payload">
            {JSON.stringify(approval.payload, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

function approvalExecutionMessage(approval: Approval): string | null {
  if (approval.execution_status === "failed") {
    return approval.execution_error
      ? `Execution failed: ${approval.execution_error}`
      : "Execution failed. Retry approval or reject it.";
  }
  if (approval.execution_status === "succeeded") {
    return approval.result_summary ?? "Executed successfully.";
  }
  return null;
}
