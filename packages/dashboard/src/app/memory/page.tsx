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
import { Button } from "@/components/ui";
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

const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  identity: "ตัวตน",
  preference: "ความชอบ",
  relationship: "ความสัมพันธ์",
  routine: "กิจวัตร",
  project: "โปรเจกต์",
  general: "ทั่วไป",
};

const TARGET_LABELS: Record<MemoryTarget, string> = {
  preferences: "ความชอบ",
  routines: "กิจวัตร",
  projects: "โปรเจกต์",
  decisions: "การตัดสินใจ",
};

const MODE_LABELS: Record<MemoryWriteMode, string> = {
  append: "เพิ่มต่อท้าย",
  replace: "แทนที่",
};

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
 * Step 16 — Known Facts: Friday's real, recallable memory. Listing + a "teach a
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
        <h3>ข้อมูลที่จดจำ</h3>
        <span className="badge safety">ความจำจริง</span>
      </div>
      <p className="lede">
        ข้อมูลถาวรที่ Friday จดจำเกี่ยวกับคุณ บันทึกอัตโนมัติจากแชต
        หรือสอนเพิ่มได้ที่นี่ การลบต้องได้รับการยืนยันจากคุณเสมอ
      </p>

      {notice && <div className="state">{notice}</div>}
      {formError && (
        <ErrorBanner message={formError} onRetry={() => setFormError(null)} />
      )}

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {facts && facts.length === 0 && (
        <Empty label="ยังไม่มีข้อมูล แชตกับ Friday หรือสอนข้อมูลด้านล่างได้เลย" />
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
                  {FACT_CATEGORY_LABELS[fact.category] ?? fact.category}
                  {fact.keywords ? ` · ${fact.keywords}` : ""}
                </span>
              </span>
              <Button
                variant="ghost"
                onClick={() => void onForget(fact)}
                disabled={busy}
                title="เสนอให้ลืมข้อมูลนี้ (ต้องยืนยัน)"
              >
                ลืม
              </Button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onTeach} style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="fact-content">สอนข้อมูลใหม่</label>
          <input
            id="fact-content"
            placeholder="เช่น แฟนของ Fran ชื่อ ..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={500}
            disabled={busy}
          />
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="fact-category">หมวดหมู่</label>
            <select
              id="fact-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as FactCategory)}
              disabled={busy}
            >
              {FACT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {FACT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fact-keywords">คีย์เวิร์ด (ไม่บังคับ)</label>
            <input
              id="fact-keywords"
              placeholder="แท็กสำหรับค้นหา คั่นด้วยช่องว่าง"
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
            ปักหมุด (จำเสมอ — สำหรับข้อมูลตัวตนหลัก)
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || content.trim() === ""}
          >
            {busy ? "กำลังบันทึก…" : "จดจำ"}
          </Button>
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
        `ส่งคำขอ #${approval.id} เข้าคิวอนุมัติแล้ว ` +
          `จะยังไม่มีการบันทึกจนกว่าจะได้รับอนุมัติ`,
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
          <p className="page-kicker">ความจำถาวร</p>
          <h2>ความจำ</h2>
          <p className="lede">
            ดูความจำที่อนุมัติแล้ว และส่งคำขอแก้ไขเข้าคิวอนุมัติ
          </p>
        </div>
      </header>

      <div className="memory-grid">
        <div className="stack">
          <KnownFacts />

          <section className="section">
            <h3>รายการ</h3>
            {loading && <EntriesSkeleton />}
            {error && <ErrorBanner message={error} onRetry={reload} />}
            {entries && entries.length === 0 && (
              <Empty label="ยังไม่มีความจำที่บันทึกไว้" />
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
              <h3>ดูข้อมูล</h3>
              <span className="badge safety">อ่านอย่างเดียว</span>
            </div>
            <div className="form-row">
              <label htmlFor="memory-target">เป้าหมาย</label>
              <select
                id="memory-target"
                value={target}
                onChange={(e) => setTarget(e.target.value as MemoryTarget)}
                disabled={busy}
              >
                {TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
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
                {content.content ? content.content : "(ไฟล์ว่าง)"}
              </pre>
            )}
          </section>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>เสนอแก้ไข</h3>
              <p>การเขียนความจำต้องรออนุมัติก่อนจึงจะมีผล</p>
            </div>
            <span className="badge safety">เสนอเท่านั้น</span>
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
                  <label htmlFor="propose-target">เป้าหมาย</label>
                  <select
                    id="propose-target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value as MemoryTarget)}
                    disabled={busy}
                  >
                    {TARGETS.map((t) => (
                      <option key={t} value={t}>
                        {TARGET_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label id="memory-mode-label">โหมด</label>
                  <div
                    className="segmented"
                    role="radiogroup"
                    aria-labelledby="memory-mode-label"
                  >
                    {(["append", "replace"] as const).map((m) => (
                      <Button
                        key={m}
                        role="radio"
                        aria-checked={mode === m}
                        className={`segment${mode === m ? " active" : ""}`}
                        variant={mode === m ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setMode(m)}
                        disabled={busy}
                      >
                        {MODE_LABELS[m]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="propose-content">เนื้อหา</label>
                <textarea
                  id="propose-content"
                  placeholder={
                    mode === "append"
                      ? `บรรทัดที่จะเพิ่มใน "${TARGET_LABELS[target]}"...`
                      : `เนื้อหาที่จะใช้แทนที่ "${TARGET_LABELS[target]}"...`
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  maxLength={50000}
                  disabled={busy}
                />
              </div>

              <div className="field">
                <label htmlFor="propose-summary">สรุป (ไม่บังคับ)</label>
                <input
                  id="propose-summary"
                  placeholder="ทำไมถึงแก้ไขนี้?"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={200}
                  disabled={busy}
                />
              </div>

              <div className="card-footer">
                <span className="muted">
                  เข้าคิวเป็นรายการรออนุมัติ — จะยังไม่มีการบันทึกจนกว่าคุณจะอนุมัติ
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || draft.trim() === ""}
                >
                  {busy ? "กำลังส่ง…" : "ส่งไปอนุมัติ"}
                </Button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
