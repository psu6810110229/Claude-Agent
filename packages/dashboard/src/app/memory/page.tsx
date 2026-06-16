"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createFactProposal,
  createMemoryProposal,
  forgetFact,
  getMemoryContent,
  listFacts,
  listMemory,
} from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading, Empty } from "@/components/States";
import type {
  FactCategory,
  MemoryContent,
  MemoryEntry,
  MemoryFact,
  MemoryTarget,
  MemoryWriteMode,
} from "@/lib/types";

const FACT_CATEGORIES: FactCategory[] = [
  "identity",
  "preference",
  "relationship",
  "routine",
  "project",
  "general",
];

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

/**
 * Step 16 — Known Facts: JARVIS's real, recallable memory. Listing + a "teach a
 * fact" form + a per-fact forget button. New facts may auto-save (when auto-
 * execute is on); forget always waits for confirmation in Approvals.
 */
function KnownFacts() {
  const { data: facts, loading, error, reload } = useData("/api/facts", listFacts);

  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [category, setCategory] = useState<FactCategory>("general");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onTeach(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const approval = await createFactProposal({
        content: text,
        keywords: keywords.trim() || undefined,
        category,
        pinned: pinned || undefined,
      });
      setNotice(
        approval.execution_status === "succeeded"
          ? "จำไว้ให้แล้วค่ะ ✅"
          : `ส่งเข้าคิวอนุมัติแล้ว (#${approval.id})`,
      );
      setContent("");
      setKeywords("");
      setPinned(false);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForget(fact: MemoryFact) {
    setFormError(null);
    setNotice(null);
    try {
      const approval = await forgetFact(fact.id);
      setNotice(
        approval.execution_status === "succeeded"
          ? "ลืมให้แล้วค่ะ"
          : `ส่งคำขอลืมเข้าคิวอนุมัติแล้ว (#${approval.id}) — รอยืนยัน`,
      );
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <h3>Known Facts</h3>
        <span className="badge safety">real memory</span>
      </div>
      <p className="lede">
        Durable facts JARVIS recalls about you. Captured automatically from chat,
        or teach one here. Forgetting always needs your confirmation.
      </p>

      {notice && <div className="state">{notice}</div>}
      {formError && (
        <ErrorBanner message={formError} onRetry={() => setFormError(null)} />
      )}

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {facts && facts.length === 0 && (
        <Empty label="No facts yet. Chat with JARVIS or teach one below." />
      )}
      {facts && facts.length > 0 && (
        <div className="panel">
          {facts.map((fact: MemoryFact) => (
            <div className="row entry-row" key={fact.id}>
              <span className="grow">
                <span className="entry-head">
                  <strong className="item-title">
                    {fact.pinned ? "★ " : ""}
                    {fact.content}
                  </strong>
                  <span className="ts">{formatTs(fact.updated_at)}</span>
                </span>
                <span className="entry-sub">
                  {fact.category}
                  {fact.keywords ? ` · ${fact.keywords}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => void onForget(fact)}
                disabled={busy}
                title="Propose forgetting this fact (needs confirmation)"
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onTeach} style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="fact-content">Teach a fact</label>
          <input
            id="fact-content"
            placeholder="e.g. Fan's girlfriend is named ..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={500}
            disabled={busy}
          />
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="fact-category">Category</label>
            <select
              id="fact-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as FactCategory)}
              disabled={busy}
            >
              {FACT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fact-keywords">Keywords (optional)</label>
            <input
              id="fact-keywords"
              placeholder="recall tags, space-separated"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              maxLength={200}
              disabled={busy}
            />
          </div>
        </div>
        <div className="card-footer">
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              disabled={busy}
            />
            Pin (always recall — for core identity)
          </label>
          <button
            type="submit"
            className="primary"
            disabled={busy || content.trim() === ""}
          >
            {busy ? "Saving…" : "Remember"}
          </button>
        </div>
      </form>
    </section>
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
          <KnownFacts />

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
