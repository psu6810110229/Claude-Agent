"use client";

import { useState } from "react";
import { ApiError, runCommand } from "@/lib/api";
import type { CommandResult } from "@/lib/types";

/**
 * Deterministic command bar (Step 5). Every mutating command becomes a pending
 * approval — nothing executes from here. `onProposed` lets the host page
 * refresh (e.g. recent activity) after a proposal is queued.
 */
export function CommandBar({ onProposed }: { onProposed?: () => void }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await runCommand(text);
      setResult(res);
      if (res.kind === "proposal") {
        setInput("");
        onProposed?.();
      }
    } catch (err) {
      // Invalid commands return 4xx -> ApiError with the backend's message.
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: "1rem" }}>
      <form onSubmit={onSubmit} className="form-row">
        <input
          placeholder='Command… (try "help")'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          style={{ flexGrow: 1 }}
        />
        <button type="submit" className="primary" disabled={busy || input.trim() === ""}>
          Run
        </button>
      </form>

      <p className="muted">
        Commands only <strong>propose</strong> actions. Nothing runs until you
        approve it on the Approvals page.
      </p>

      {error && (
        <div className="error">
          <span>{error}</span>
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

      {result?.kind === "proposal" && (
        <p className="muted">
          Proposal #{result.approval.id} ({result.approval.action_type}) sent to
          the approval queue. Nothing is executed until it is approved.
        </p>
      )}
    </div>
  );
}
