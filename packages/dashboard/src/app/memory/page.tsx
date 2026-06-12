"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createMemoryProposal,
  getMemoryContent,
  listMemory,
} from "@/lib/api";
import { useData } from "@/lib/useData";
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

function EntriesSkeleton() {
  return (
    <div className="panel">
      {[1, 2, 3].map((i) => (
        <div className="row entry-row" key={i}>
          <span className="grow">
            <span className="entry-head">
              <span className="skel" style={{ display: "inline-block", width: 110, height: 15 }} />
              <span className="skel" style={{ display: "inline-block", width: 48, height: 12, marginLeft: 8 }} />
            </span>
            <span className="skel" style={{ display: "block", width: "68%", height: 12, marginTop: 5 }} />
            <span className="skel" style={{ display: "block", width: "48%", height: 12, marginTop: 3 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function MemoryPage() {
  const { data: entries, loading, error, reload } = useData("/api/memory", listMemory);

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
      <header className="page-header">
        <div>
          <p className="page-kicker">Durable Context</p>
          <h2>Memory</h2>
          <p className="lede">
            View approved memory and send proposed edits to the approval queue.
          </p>
        </div>
      </header>

      <div className="memory-grid">
        <div className="stack">
          <section className="section">
            <h3>Entries</h3>
            {loading && <EntriesSkeleton />}
            {error && <ErrorBanner message={error} onRetry={reload} />}
            {entries && entries.length === 0 && (
              <Empty label="No memory written yet." />
            )}
            {entries && entries.length > 0 && (
              <div className="panel">
                {entries.map((entry: MemoryEntry) => (
                  <div className="row entry-row" key={entry.id}>
                    <span className="grow">
                      <span className="entry-head">
                        <strong className="item-title">{entry.slug}</strong>
                        <span className="ts">{formatTs(entry.updated_at)}</span>
                      </span>
                      {entry.summary && (
                        <span className="entry-sub">{entry.summary}</span>
                      )}
                      <span className="entry-sub entry-path">{entry.path}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-header">
              <h3>View</h3>
              <span className="badge safety">read-only</span>
            </div>
            <div className="form-row">
              <label htmlFor="memory-target">Target</label>
              <select
                id="memory-target"
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
              <pre className="payload memory-content">
                {content.content ? content.content : "(empty file)"}
              </pre>
            )}
          </section>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Propose edit</h3>
              <p>Memory writes wait for approval before they are applied.</p>
            </div>
            <span className="badge safety">proposal-only</span>
          </div>
          <div className="panel-body">
            {notice && <div className="state">{notice}</div>}
            {formError && (
              <ErrorBanner
                message={formError}
                onRetry={() => setFormError(null)}
              />
            )}
            <form onSubmit={onPropose}>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="propose-target">Target</label>
                  <select
                    id="propose-target"
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

                <div className="field">
                  <label id="memory-mode-label">Mode</label>
                  <div
                    className="segmented"
                    role="radiogroup"
                    aria-labelledby="memory-mode-label"
                  >
                    {(["append", "replace"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={mode === m}
                        className={`segment${mode === m ? " active" : ""}`}
                        onClick={() => setMode(m)}
                        disabled={busy}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="propose-content">Content</label>
                <textarea
                  id="propose-content"
                  placeholder={
                    mode === "append"
                      ? `Lines to add to "${target}"...`
                      : `Replacement content for "${target}"...`
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  maxLength={50000}
                  disabled={busy}
                />
              </div>

              <div className="field">
                <label htmlFor="propose-summary">Summary (optional)</label>
                <input
                  id="propose-summary"
                  placeholder="Why this change?"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={200}
                  disabled={busy}
                />
              </div>

              <div className="card-footer">
                <span className="muted">
                  Queued as a pending approval — nothing is written until you
                  approve it.
                </span>
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || draft.trim() === ""}
                >
                  {busy ? "Sending…" : "Send to approvals"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
