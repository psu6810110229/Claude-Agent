"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Moon,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { GEMINI_MODEL_OPTIONS, type ProviderChoice, type BriefType } from "@/lib/types";

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
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: grow with content up to ~40vh, then scroll inside.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [text]);

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
        placeholder="ถาม Friday ได้ทุกเรื่อง..."
        aria-label="ถาม Friday"
        disabled={disabled}
        rows={1}
        autoFocus
      />

      <div className="ji-toolbar">
        <div className="ji-tools">
          {onProviderChange && (
            <div
              className="ji-provider"
              role="group"
              aria-label="ผู้ให้บริการ AI"
              title="เลือกผู้ให้บริการ AI ที่จะตอบ"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  className={provider === opt.id ? "active" : ""}
                  aria-pressed={provider === opt.id}
                  title={opt.title}
                  disabled={disabled}
                  onClick={() => onProviderChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {provider === "gemini" && onGeminiModelChange && (
            <label className="ji-model" title="เลือกโมเดล Gemini ที่จะตอบ">
              <span className="sr-only">โมเดล Gemini</span>
              <select
                value={geminiModel ?? GEMINI_MODEL_OPTIONS[0].id}
                disabled={disabled}
                onChange={(e) => onGeminiModelChange(e.target.value)}
                aria-label="โมเดล Gemini"
              >
                {GEMINI_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {onBrief && (
            <div className="ji-menu-wrap">
              <button
                type="button"
                className="ji-tool ji-menu-toggle"
                disabled={disabled || briefBusy !== null}
                title="เมนูสรุป"
                aria-label="เมนูสรุป"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <ChevronDown strokeWidth={1.8} />
              </button>

              {menuOpen && (
                <div className="ji-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled || briefBusy !== null}
                    onClick={() => runBrief("daily")}
                  >
                    <Sun strokeWidth={1.7} />
                    สรุปเช้า
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled || briefBusy !== null}
                    onClick={() => runBrief("evening")}
                  >
                    <Moon strokeWidth={1.7} />
                    สรุปเย็น
                  </button>
                </div>
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

        <button
          type="submit"
          className="ji-send"
          disabled={disabled || text.trim() === ""}
          aria-label="ส่ง"
        >
          <ArrowUp strokeWidth={2} />
        </button>
      </div>
    </form>
  );
}
