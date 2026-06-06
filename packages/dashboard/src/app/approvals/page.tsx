"use client";

import { useState } from "react";
import {
  ApiError,
  approveApproval,
  listApprovals,
  rejectApproval,
} from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading, Empty } from "@/components/States";
import type { Approval } from "@/lib/types";

export default function ApprovalsPage() {
  const { data: approvals, loading, error, reload } =
    useResource(listApprovals);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Approvals</h2>

      {actionError && (
        <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />
      )}

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {approvals && approvals.length === 0 && (
        <Empty label="No approvals in the queue." />
      )}

      {approvals?.map((a) => (
        <ApprovalCard key={a.id} approval={a} busy={busy} run={run} />
      ))}
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
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const pending = approval.status === "pending";
  return (
    <div className="panel">
      <div className="row">
        <span className={`badge ${approval.status}`}>{approval.status}</span>
        <span className="grow">
          <strong>{approval.action_type}</strong>{" "}
          <span className="muted">#{approval.id}</span>
        </span>
        <span className="ts">{formatTs(approval.created_at)}</span>
        {pending && (
          <>
            <button
              className="primary"
              onClick={() => run(() => approveApproval(approval.id))}
              disabled={busy}
            >
              Approve
            </button>
            <button
              className="danger"
              onClick={() => run(() => rejectApproval(approval.id))}
              disabled={busy}
            >
              Reject
            </button>
          </>
        )}
      </div>
      {approval.payload != null && (
        <pre className="payload">
          {JSON.stringify(approval.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
