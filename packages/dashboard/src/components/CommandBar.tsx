"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, runCommand } from "@/lib/api";
import type { Approval, CommandMode, CommandResult } from "@/lib/types";

/**
 * Command bar (Step 5 deterministic + Step 7 AI mode).
 *
 * Both modes are PROPOSAL-ONLY: every mutating intent becomes a pending
 * approval — nothing executes from here. AI mode just routes the input through
 * the Claude reasoning runtime (`mode: "ai"`); the approval gate is identical.
 * `onProposed` lets the host page refresh (e.g. recent activity) after a
 * proposal is queued.
 */
export function CommandBar({ onProposed }: { onProposed?: () => void }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<CommandMode>("deterministic");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  /** AI failures carry an HTTP status we map to a specific state below. */
  const [error, setError] = useState<{ message: string; status: number } | null>(
    null,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await runCommand(text, mode);
      setResult(res);
      if (res.kind === "proposal") {
        setInput("");
        onProposed?.();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, status: err.status });
      } else {
        setError({ message: String(err), status: -1 });
      }
    } finally {
      setBusy(false);
    }
  }

  // Both modes can queue approvals: deterministic returns one (`approval`), AI
  // returns a list (`approvals`). Normalise to a single array for rendering.
  const proposed: Approval[] =
    result?.kind === "proposal"
      ? result.approvals ?? (result.approval ? [result.approval] : [])
      : [];

  return (
    <div className="panel" style={{ marginBottom: "1rem" }}>
      <div className="form-row" role="radiogroup" aria-label="Command mode" style={{ marginBottom: "0.5rem" }}>
        <label>
          <input
            type="radio"
            name="command-mode"
            value="deterministic"
            checked={mode === "deterministic"}
            onChange={() => setMode("deterministic")}
            disabled={busy}
          />{" "}
          Deterministic
        </label>
        <label>
          <input
            type="radio"
            name="command-mode"
            value="ai"
            checked={mode === "ai"}
            onChange={() => setMode("ai")}
            disabled={busy}
          />{" "}
          AI
        </label>
      </div>

      <form onSubmit={onSubmit} className="form-row">
        <input
          placeholder={
            mode === "ai"
              ? "Describe what you want… (AI proposes actions)"
              : 'Command… (try "help")'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          style={{ flexGrow: 1 }}
        />
        <button type="submit" className="primary" disabled={busy || input.trim() === ""}>
          {busy ? "Working…" : "Run"}
        </button>
      </form>

      <p className="muted">
        {mode === "ai" ? (
          <>
            AI mode only <strong>proposes</strong> actions — it never executes
            them. Approve on the Approvals page.
          </>
        ) : (
          <>
            Commands only <strong>propose</strong> actions. Nothing runs until
            you approve it on the Approvals page.
          </>
        )}
      </p>

      {error && (
        <div className="error">
          <span>{aiErrorLabel(error.status, error.message)}</span>
        </div>
      )}

      {result?.kind === "help" && (
        <div>
          <strong>Supported commands</strong>
          <ul>
            {result.examples.map((ex) => (
              <li key={ex}>
                <code>{ex}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result?.kind === "none" && (
        <p className="muted">{result.message} Nothing was queued.</p>
      )}

      {proposed.length > 0 && (
        <div className="muted">
          <p>
            {proposed.length === 1 ? "Proposal" : `${proposed.length} proposals`}{" "}
            sent to the approval queue — nothing is executed until approved.
          </p>
          <ul>
            {proposed.map((a) => (
              <li key={a.id}>
                <Link href="/approvals">
                  #{a.id} ({a.action_type})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Map a command failure to a clear state. The backend distinguishes AI failure
 * modes by HTTP status (see api.ts / routes/command.ts); we surface the backend
 * message alongside a stable label so the cause is obvious.
 */
function aiErrorLabel(status: number, message: string): string {
  switch (status) {
    case 503:
      return `Claude is disabled. ${message}`;
    case 504:
      return `Claude timed out. ${message}`;
    case 502:
      return `Claude failed. ${message}`;
    case 400:
      return message; // invalid command (deterministic) or rejected AI output
    case 0:
      return message; // backend unreachable
    default:
      return message;
  }
}
