"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createMemoryProposal,
  getMemoryContent,
  listMemory,
} from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading, Empty } from "@/components/States";
import type {
  MemoryContent,
  MemoryEntry,
  MemoryTarget,
  MemoryWriteMode,
} from "@/lib/types";

const TARGETS: MemoryTarget[] = [
  "preferences",
  "routines",
  "projects",
  "decisions",
];

export default function MemoryPage() {
  const { data: entries, loading, error, reload } = useResource(listMemory);

  const [target, setTarget] = useState<MemoryTarget>("preferences");
  const [content, setContent] = useState<MemoryContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const loadContent = useCallback(async (t: MemoryTarget) => {
    setContentLoading(true);
    setContentError(null);
    try {
      setContent(await getMemoryContent(t));
    } catch (err) {
      setContent(null);
      setContentError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContent(target);
  }, [target, loadContent]);

  // --- Proposal form ---
  const [mode, setMode] = useState<MemoryWriteMode>("append");
  const [draft, setDraft] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onPropose(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const approval = await createMemoryProposal({
        target,
        mode,
        content: text,
        summary: summary.trim() || undefined,
      });
      setNotice(
        `Proposal #${approval.id} sent to the approval queue. ` +
          `Nothing is written until it is approved.`,
      );
      setDraft("");
      setSummary("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Memory</h2>
      <p className="muted">
        Durable context. Edits are <strong>proposed</strong> and applied only
        after approval — memory is never written directly.
      </p>

      {/* --- Indexed entries --- */}
      <h3>Entries</h3>
      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {entries && entries.length === 0 && (
        <Empty label="No memory written yet." />
      )}
      {entries && entries.length > 0 && (
        <div className="panel">
          {entries.map((entry: MemoryEntry) => (
            <div className="row" key={entry.id}>
              <span className="grow">
                <strong>{entry.slug}</strong>{" "}
                <span className="muted">{entry.path}</span>
                {entry.summary && <> — {entry.summary}</>}
              </span>
              <span className="ts">{formatTs(entry.updated_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* --- View file content --- */}
      <h3>View</h3>
      <div className="form-row">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as MemoryTarget)}
          disabled={busy}
        >
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {contentLoading && <Loading />}
      {contentError && (
        <ErrorBanner
          message={contentError}
          onRetry={() => void loadContent(target)}
        />
      )}
      {content && (
        <pre className="payload">
          {content.content ? content.content : "(empty file)"}
        </pre>
      )}

      {/* --- Propose an edit --- */}
      <h3>Propose edit</h3>
      {notice && <p className="muted">{notice}</p>}
      {formError && (
        <ErrorBanner message={formError} onRetry={() => setFormError(null)} />
      )}
      <form onSubmit={onPropose}>
        <div className="form-row">
          <label>
            Mode:{" "}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as MemoryWriteMode)}
              disabled={busy}
            >
              <option value="append">append</option>
              <option value="replace">replace</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <textarea
            placeholder={`New content for "${target}" (${mode})…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            maxLength={50000}
            disabled={busy}
            style={{ width: "100%" }}
          />
        </div>
        <div className="form-row">
          <input
            placeholder="Short summary (optional)"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || draft.trim() === ""}
          >
            Send to approvals
          </button>
        </div>
      </form>
    </>
  );
}
