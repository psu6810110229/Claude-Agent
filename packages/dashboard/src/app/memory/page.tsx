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
                      <strong className="item-title">{entry.slug}</strong>
                      <span className="item-meta">{entry.path}</span>
                      {entry.summary && (
                        <span className="item-meta">{entry.summary}</span>
                      )}
                    </span>
                    <span className="ts">{formatTs(entry.updated_at)}</span>
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
              <div className="form-row">
                <label htmlFor="memory-mode">Mode</label>
                <select
                  id="memory-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as MemoryWriteMode)}
                  disabled={busy}
                >
                  <option value="append">append</option>
                  <option value="replace">replace</option>
                </select>
              </div>
              <div className="form-row">
                <textarea
                  placeholder={`New content for "${target}" (${mode})...`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  maxLength={50000}
                  disabled={busy}
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
          </div>
        </section>
      </div>
    </>
  );
}
