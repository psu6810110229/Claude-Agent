"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  CalendarPlus,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  GEMINI_MODEL_OPTIONS,
  type ProviderChoice,
  type BriefType,
  type StagedAttachment,
} from "@/lib/types";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const PROVIDER_OPTIONS: { id: ProviderChoice; label: string; title: string }[] = [
  { id: "auto", label: "อัตโนมัติ", title: "ให้ระบบเลือกโมเดลที่เหมาะกับงาน" },
  { id: "claude", label: "Claude", title: "ใช้ Claude เสมอ" },
  { id: "gemini", label: "Gemini", title: "ใช้ Gemini เสมอ" },
  { id: "qwen", label: "Qwen", title: "ใช้ Qwen สำหรับงานคิดลึก" },
  { id: "glm", label: "GLM", title: "ใช้ GLM เป็นตัวเลือกสำรอง" },
  { id: "gpt4o", label: "GPT-4o", title: "ใช้ GPT-4o สำหรับคุยเล่น ไม่ใช้กับงานตารางหรืองานสำคัญ" },
];

/**
 * Claude-style composer: rounded-rectangle card with an auto-resizing
 * multiline textarea on top and a bottom toolbar (tools left, send right).
 * Mic/voice input stays out of scope; the mute toggle controls TTS output.
 */
export function JarvisInput({
  onSubmit,
  onBrief,
  onFocusChange,
  disabled = false,
  briefBusy = null,
  provider = "claude",
  onProviderChange,
  geminiModel,
  onGeminiModelChange,
  muted = false,
  onToggleMute,
  onAttach,
  attachments = [],
  onRemoveAttachment,
  onMakeTimetable,
  attachBusy = false,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  onBrief?: (type: BriefType) => void | Promise<void>;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
  briefBusy?: BriefType | null;
  provider?: ProviderChoice;
  onProviderChange?: (provider: ProviderChoice) => void;
  geminiModel?: string;
  onGeminiModelChange?: (model: string) => void;
  muted?: boolean;
  onToggleMute?: () => void;
  /** Called with a dropped/selected image or PDF — STAGES it (not sent until send). */
  onAttach?: (file: File) => void | Promise<void>;
  /** Files staged in the composer, shown as removable chips above the textarea. */
  attachments?: StagedAttachment[];
  /** Remove a staged attachment by id. */
  onRemoveAttachment?: (id: string) => void;
  /** Turn a staged file into a class timetable (explicit, separate from send). */
  onMakeTimetable?: (att: StagedAttachment) => void;
  /** True while an attachment is being uploaded/parsed (disables the button). */
  attachBusy?: boolean;
}) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [unifiedMenuOpen, setUnifiedMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [unifiedPos, setUnifiedPos] = useState<{ left: number; bottom: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const unifiedMenuId = useId();

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const unifiedButtonRef = useRef<HTMLButtonElement>(null);
  const unifiedMenuWrapRef = useRef<HTMLDivElement>(null);
  const unifiedMenuRef = useRef<HTMLDivElement>(null);

  // The menu is portaled to <body> so its backdrop-filter can sample the page
  // behind it; nested inside the composer's own backdrop-filter it renders flat.
  // Anchor its bottom-left to the trigger's top-left, and keep it pinned on
  // scroll/resize.
  useLayoutEffect(() => {
    if (!unifiedMenuOpen) return;
    function place() {
      const el = unifiedMenuWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setUnifiedPos({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [unifiedMenuOpen]);

  // Auto-resize: grow with content up to ~40vh, then scroll inside.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [text]);

  // Click outside to close menus
  useEffect(() => {
    function handleOuterClick(e: MouseEvent) {
      if (menuOpen && menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (
        unifiedMenuOpen &&
        unifiedMenuWrapRef.current &&
        !unifiedMenuWrapRef.current.contains(e.target as Node) &&
        unifiedMenuRef.current &&
        !unifiedMenuRef.current.contains(e.target as Node)
      ) {
        setUnifiedMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (unifiedMenuOpen) {
        setUnifiedMenuOpen(false);
        unifiedButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleOuterClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOuterClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, unifiedMenuOpen]);

  useEffect(() => {
    if (!unifiedMenuOpen) return;
    const raf = requestAnimationFrame(() => {
      const target =
        unifiedMenuRef.current?.querySelector<HTMLElement>(
          '[aria-pressed="true"], [role="menuitem"], button:not(:disabled)',
        ) ?? unifiedMenuRef.current;
      target?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [unifiedMenuOpen]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    void onSubmit(trimmed);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function pickFile(file: File | null | undefined) {
    if (!file || !onAttach || disabled || attachBusy) return;
    void onAttach(file);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function runBrief(type: BriefType) {
    if (!onBrief || disabled || briefBusy) return;
    setMenuOpen(false);
    void onBrief(type);
  }

  return (
    <form
      className={`jarvis-input${dragging ? " dragging" : ""}`}
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
      onSubmit={handleSubmit}
      onDragOver={(e) => {
        if (!onAttach) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (!onAttach) return;
        e.preventDefault();
        setDragging(false);
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      {onAttach && (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      )}
      {attachments.length > 0 && (
        <div className="ji-attachments" role="list" aria-label="ไฟล์ที่แนบ">
          {attachments.map((att) => (
            <div className="ji-attach-chip" role="listitem" key={att.id}>
              {att.kind === "pdf" ? (
                <FileText className="ji-attach-icon" aria-hidden="true" />
              ) : (
                <ImageIcon className="ji-attach-icon" aria-hidden="true" />
              )}
              <span className="ji-attach-name" title={att.name}>
                {att.name}
              </span>
              {onMakeTimetable && (
                <button
                  type="button"
                  className="ji-attach-action"
                  onClick={() => onMakeTimetable(att)}
                  disabled={disabled || attachBusy}
                  title="ทำเป็นตารางเรียน"
                >
                  <CalendarPlus strokeWidth={1.8} aria-hidden="true" />
                  <span>ตาราง</span>
                </button>
              )}
              {onRemoveAttachment && (
                <button
                  type="button"
                  className="ji-attach-remove"
                  onClick={() => onRemoveAttachment(att.id)}
                  disabled={attachBusy}
                  title="เอาออก"
                  aria-label={`เอา ${att.name} ออก`}
                >
                  <X strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        className="ji-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder="ถาม Friday"
        aria-label="ถาม Friday"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        spellCheck={false}
        disabled={disabled}
        rows={1}
        autoFocus
      />

      <div className="ji-toolbar">
        <div className="ji-tools">
          {onAttach && (
            <button
              type="button"
              className="ji-tool ji-attach"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || attachBusy}
              title="แนบรูปหรือ PDF (ตารางเรียน หรือเอกสารให้ถามได้)"
              aria-label="แนบรูปหรือ PDF"
            >
              <Paperclip strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
          {onProviderChange && (
            <div className="ji-unified-wrap" ref={unifiedMenuWrapRef}>
              <button
                ref={unifiedButtonRef}
                type="button"
                className="ji-unified-btn"
                disabled={disabled}
                onClick={() => setUnifiedMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-controls={unifiedMenuOpen ? unifiedMenuId : undefined}
                aria-expanded={unifiedMenuOpen}
              >
                <span className="ji-unified-label">
                  {provider === "gemini" && geminiModel
                    ? `Gemini (${GEMINI_MODEL_OPTIONS.find((m) => m.id === geminiModel)?.label ?? "Flash"})`
                    : PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? "AI"}
                </span>
                <ChevronDown strokeWidth={2} className={`ji-unified-chevron ${unifiedMenuOpen ? "open" : ""}`} />
              </button>

              {typeof document !== "undefined" && createPortal(
                <AnimatePresence>
                  {unifiedMenuOpen && (
                  <motion.div
                    id={unifiedMenuId}
                    ref={unifiedMenuRef}
                    className="ji-custom-menu unified-menu"
                    style={{
                      position: "fixed",
                      left: unifiedPos?.left ?? 0,
                      bottom: unifiedPos?.bottom ?? 0,
                    }}
                    tabIndex={-1}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
                    role="menu"
                    aria-label="ตัวเลือก AI"
                  >
                    <div className="ji-menu-section-title">AI Provider</div>
                    <div
                      className="ji-provider in-menu"
                      role="group"
                      aria-label="ผู้ให้บริการ AI"
                    >
                      {PROVIDER_OPTIONS.map((opt) => {
                        const isActive = provider === opt.id;
                        return (
                          <button
                            type="button"
                            key={opt.id}
                            className={isActive ? "active" : ""}
                            aria-pressed={isActive}
                            title={opt.title}
                            onClick={() => onProviderChange(opt.id)}
                          >
                            {isActive && <span className="provider-highlight" aria-hidden="true" />}
                            <span className="provider-label">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <AnimatePresence mode="popLayout">
                      {provider === "gemini" && onGeminiModelChange && (
                        <motion.div
                          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={reduceMotion ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
                          transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="ji-menu-divider" />
                          <div className="ji-menu-section-title">Gemini Model</div>
                          {GEMINI_MODEL_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              role="menuitem"
                              className={geminiModel === opt.id ? "active" : ""}
                              onClick={() => {
                                onGeminiModelChange(opt.id);
                                setUnifiedMenuOpen(false);
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                  )}
                </AnimatePresence>,
                document.body
              )}
            </div>
          )}

          {onToggleMute && (
            <button
              type="button"
              className={`ji-tool ji-mute${muted ? " active" : ""}`}
              onClick={onToggleMute}
              title={muted ? "เปิดเสียง" : "ปิดเสียง"}
              aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"}
              aria-pressed={muted}
            >
              {muted ? (
                <VolumeX strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Volume2 strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <motion.button
          type="submit"
          className="ji-send"
          disabled={disabled || text.trim() === ""}
          aria-label="ส่ง"
          whileHover={
            reduceMotion || disabled || text.trim() === ""
              ? {}
              : { scale: 1.05 }
          }
          whileTap={
            reduceMotion || disabled || text.trim() === ""
              ? {}
              : { scale: 0.94 }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", bounce: 0.4, duration: 0.4 }
          }
        >
          <ArrowUp strokeWidth={2} />
        </motion.button>
      </div>
    </form>
  );
}

