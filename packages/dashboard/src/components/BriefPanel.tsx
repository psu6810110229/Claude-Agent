"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, generateDailyBrief, generateEveningBrief } from "@/lib/api";
import type { BriefResult, BriefType } from "@/lib/types";

/**
 * Daily Brief / Evening Review panel (Step 8).
 *
 * Briefs are PROPOSAL-ONLY and AI-gated: clicking a button asks the backend to
 * generate a summary from local data and queue any suggested changes as pending
 * approvals — nothing executes here. The summary is shown inline; queued
 * approvals link to the Approvals page. `onProposed` lets the host page refresh
 * after approvals are queued.
 */
export function BriefPanel({ onProposed }: { onProposed?: () => void }) {
  const [busy, setBusy] = useState<BriefType | null>(null);
  const [result, setResult] = useState<BriefResult | null>(null);
  /** AI failures carry an HTTP status we map to a specific state below. */
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
    <div className="panel" style={{ marginBottom: "1rem" }}>
      <div className="form-row">
        <button
          type="button"
          className="primary"
          disabled={busy !== null}
          onClick={() => run("daily")}
        >
          {busy === "daily" ? "Generating…" : "Generate Daily Brief"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("evening")}
        >
          {busy === "evening" ? "Generating…" : "Generate Evening Review"}
        </button>
      </div>

      <p className="muted">
        Briefs only <strong>propose</strong> actions — they never execute. Any
        suggested change is queued for you to approve.
      </p>

      {error && (
        <div className="error">
          <span>{briefErrorLabel(error.status, error.message)}</span>
        </div>
      )}

      {result && (
        <div>
          <strong>
            {result.type === "daily" ? "Daily Brief" : "Evening Review"}
          </strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.summary}</p>
          {result.notes && <p className="muted">{result.notes}</p>}

          {result.approvals.length > 0 ? (
            <div className="muted">
              <p>
                {result.approvals.length === 1
                  ? "1 proposal"
                  : `${result.approvals.length} proposals`}{" "}
                queued for approval — nothing runs until you approve it.
              </p>
              <ul>
                {result.approvals.map((a) => (
                  <li key={a.id}>
                    <Link href="/approvals">
                      #{a.id} ({a.action_type})
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted">No changes were proposed.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Map a brief failure to a clear state. The backend distinguishes AI failure
 * modes by HTTP status (see api.ts / routes/briefs.ts); mirrors CommandBar.
 */
function briefErrorLabel(status: number, message: string): string {
  switch (status) {
    case 503:
      return `Claude is disabled. ${message}`;
    case 504:
      return `The brief timed out before Claude finished. Try generating it again. (${message})`;
    case 502:
      return `Claude failed. ${message}`;
    case 400:
      return message; // rejected invalid brief output
    case 0:
      return message; // backend unreachable
    default:
      return message;
  }
}
