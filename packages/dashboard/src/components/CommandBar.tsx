"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, runCommand } from "@/lib/api";
import type { Approval, CommandMode, CommandResult } from "@/lib/types";

/**
 * Command bar (Step 5 deterministic + Step 7 AI mode).
 *
 * Both modes are proposal-only: every mutating intent becomes a pending
 * approval. AI mode routes input through Claude, but the approval gate is the
 * same. `onProposed` lets the host page refresh after a proposal is queued.
 */
export function CommandBar({ onProposed }: { onProposed?: () => void }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<CommandMode>("deterministic");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
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

  const proposed: Approval[] =
    result?.kind === "proposal"
      ? result.approvals ?? (result.approval ? [result.approval] : [])
      : [];

  return (
    <section className="panel command-panel">
      <div className="panel-head">
        <div>
          <h3>Command Center</h3>
          <p>Queued for approval before anything runs.</p>
        </div>
        <span className="badge safety">proposal-only</span>
      </div>

      <div className="panel-body">
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Command mode"
        >
          <label
            className={`segment ${mode === "deterministic" ? "active" : ""}`}
          >
            <input
              className="sr-only"
              type="radio"
              name="command-mode"
              value="deterministic"
              checked={mode === "deterministic"}
              onChange={() => setMode("deterministic")}
              disabled={busy}
            />
            Deterministic
          </label>
          <label className={`segment ${mode === "ai" ? "active" : ""}`}>
            <input
              className="sr-only"
              type="radio"
              name="command-mode"
              value="ai"
              checked={mode === "ai"}
              onChange={() => setMode("ai")}
              disabled={busy}
            />
            AI
          </label>
        </div>

        <form onSubmit={onSubmit} className="composer">
          <input
            placeholder={
              mode === "ai"
                ? "Describe what you want... (AI proposes actions)"
                : 'Command... (try "help")'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || input.trim() === ""}
          >
            {busy ? "Working..." : "Run"}
          </button>
        </form>

        <p className="muted">
          {mode === "ai" ? (
            <>
              AI mode only <strong>proposes</strong> actions. Approve queued
              items on the Approvals page.
            </>
          ) : (
            <>
              Commands only <strong>propose</strong> actions. Nothing runs until
              you approve it.
            </>
          )}
        </p>

        {error && (
          <div className="error">
            <span>{aiErrorLabel(error.status, error.message)}</span>
          </div>
        )}

        {result?.kind === "help" && (
          <div className="state">
            <strong>Supported commands</strong>
            <ul className="proposal-list">
              {result.examples.map((ex) => (
                <li key={ex}>
                  <code>{ex}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result?.kind === "none" && (
          <div className="state">{result.message} Nothing was queued.</div>
        )}

        {proposed.length > 0 && (
          <div className="state">
            <strong>
              {proposed.length === 1
                ? "Proposal queued"
                : `${proposed.length} proposals queued`}
            </strong>
            <ul className="proposal-list">
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
    </section>
  );
}

function aiErrorLabel(status: number, message: string): string {
  switch (status) {
    case 503:
      return `Claude is disabled. ${message}`;
    case 504:
      return `Claude timed out. ${message}`;
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
