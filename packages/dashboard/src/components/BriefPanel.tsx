"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, generateDailyBrief, generateEveningBrief, speak } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import type { BriefResult, BriefType } from "@/lib/types";

/**
 * Daily Brief / Evening Review panel.
 *
 * Briefs are proposal-only and AI-gated. Clicking a button asks the backend to
 * generate a summary and queue any suggested changes as pending approvals.
 */
export function BriefPanel({ onProposed }: { onProposed?: () => void }) {
  const [busy, setBusy] = useState<BriefType | null>(null);
  const [result, setResult] = useState<BriefResult | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(
    null,
  );

  async function run(type: BriefType) {
    setBusy(type);
    setError(null);
    setResult(null);
    try {
      const res =
        type === "daily"
          ? await generateDailyBrief()
          : await generateEveningBrief();
      setResult(res);
      if (res.approvals.length > 0) onProposed?.();
      if (typeof window !== "undefined" && localStorage.getItem("jarvis.muted") !== "true") {
        void speak(res.summary);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, status: err.status });
      } else {
        setError({ message: String(err), status: -1 });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel brief-panel">
      <div className="panel-head">
        <div>
          <h3>Briefs</h3>
          <p>Daily planning and evening review summaries.</p>
        </div>
        <span className="badge safety">approval-gated</span>
      </div>

      <div className="panel-body">
        <div className="form-row">
          <Button
            variant="primary"
            loading={busy === "daily"}
            disabled={busy !== null}
            onClick={() => run("daily")}
          >
            Daily Brief
          </Button>
          <Button
            variant="secondary"
            loading={busy === "evening"}
            disabled={busy !== null}
            onClick={() => run("evening")}
          >
            Evening Review
          </Button>
        </div>

        <p className="muted">
          Briefs only <strong>propose</strong> actions. Suggested changes wait
          in the approval queue.
        </p>

        {error && (
          <div className="error">
            <span>{briefErrorLabel(error.status, error.message)}</span>
          </div>
        )}

        {result && (
          <div className="state">
            <strong>
              {result.type === "daily" ? "Daily Brief" : "Evening Review"}
            </strong>
            <p className="brief-summary">{result.summary}</p>
            {result.notes && <p className="muted">{result.notes}</p>}

            {result.approvals.length > 0 ? (
              <>
                <p className="muted">
                  {result.approvals.length === 1
                    ? "1 proposal"
                    : `${result.approvals.length} proposals`}{" "}
                  queued for approval.
                </p>
                <ul className="proposal-list">
                  {result.approvals.map((a) => (
                    <li key={a.id}>
                      <Link href="/approvals">
                        #{a.id} ({a.action_type})
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No changes were proposed.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function briefErrorLabel(status: number, message: string): string {
  switch (status) {
    case 503:
      return `Claude is disabled. ${message}`;
    case 504:
      return `The brief timed out before Claude finished. Try generating it again. (${message})`;
    case 502:
      return `Claude failed. ${message}`;
    case 400:
      return message;
    case 0:
      return message;
    default:
      return message;
  }
}
