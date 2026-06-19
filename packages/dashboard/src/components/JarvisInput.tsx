"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ChevronDown,
  Moon,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { GEMINI_MODEL_OPTIONS, type ProviderChoice, type BriefType } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";

const PROVIDER_OPTIONS: { id: ProviderChoice; label: string; title: string }[] = [
  { id: "auto", label: "อัตโนมัติ", title: "ให้ระบบเลือกผู้ให้บริการที่เหมาะกับงาน" },
  { id: "claude", label: "Claude", title: "ใช้ Claude เสมอ" },
  { id: "gemini", label: "Gemini", title: "ใช้ Gemini เสมอ" },
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
}) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [unifiedMenuOpen, setUnifiedMenuOpen] = useState(false);
  
  const [unifiedPos, setUnifiedPos] = useState<{ left: number; bottom: number } | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
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
    document.addEventListener("mousedown", handleOuterClick);
    return () => document.removeEventListener("mousedown", handleOuterClick);
  }, [menuOpen, unifiedMenuOpen]);

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
    <form className="jarvis-input" onSubmit={handleSubmit}>
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
        disabled={disabled}
        rows={1}
        autoFocus
      />

      <div className="ji-toolbar">
        <div className="ji-tools">
          {onProviderChange && (
            <div className="ji-unified-wrap" ref={unifiedMenuWrapRef}>
              <button
                type="button"
                className="ji-unified-btn"
                disabled={disabled}
                onClick={() => setUnifiedMenuOpen((o) => !o)}
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
                    ref={unifiedMenuRef}
                    className="ji-custom-menu unified-menu"
                    style={{
                      position: "fixed",
                      left: unifiedPos?.left ?? 0,
                      bottom: unifiedPos?.bottom ?? 0,
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    role="menu"
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
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
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
          whileHover={disabled || text.trim() === "" ? {} : { scale: 1.05 }}
          whileTap={disabled || text.trim() === "" ? {} : { scale: 0.94 }}
          transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}
        >
          <ArrowUp strokeWidth={2} />
        </motion.button>
      </div>
    </form>
  );
}

