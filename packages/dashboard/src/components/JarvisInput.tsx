"use client";

import { useState } from "react";
import { ArrowUp, ChevronDown, Moon, Sparkles, Sun } from "lucide-react";
import { GEMINI_MODEL_OPTIONS, type ProviderChoice, type BriefType } from "@/lib/types";

const PROVIDER_OPTIONS: { id: ProviderChoice; label: string; title: string }[] = [
  { id: "auto", label: "อัตโนมัติ", title: "ให้ระบบเลือกผู้ให้บริการที่เหมาะกับงาน" },
  { id: "claude", label: "Claude", title: "ใช้ Claude เสมอ" },
  { id: "gemini", label: "Gemini", title: "ใช้ Gemini เสมอ" },
];

/**
 * Floating capsule input (72px). Mic is a placeholder - voice is out of scope.
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
}) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    void onSubmit(trimmed);
  }

  function runBrief(type: BriefType) {
    if (!onBrief || disabled || briefBusy) return;
    setMenuOpen(false);
    void onBrief(type);
  }

  return (
    <form className="jarvis-input" onSubmit={handleSubmit}>
      <span className="ji-icon" aria-hidden="true">
        <Sparkles strokeWidth={1.7} />
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder="ถาม Friday ได้ทุกเรื่อง..."
        aria-label="ถาม Friday"
        disabled={disabled}
        autoFocus
      />
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
            className="ji-menu-toggle"
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
              {onProviderChange && (
                <div className="ji-menu-provider" role="group" aria-label="AI provider">
                  {PROVIDER_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      className={provider === opt.id ? "active" : ""}
                      aria-pressed={provider === opt.id}
                      disabled={disabled}
                      onClick={() => onProviderChange(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
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
      <button
        type="submit"
        className="ji-send"
        disabled={disabled || text.trim() === ""}
        aria-label="ส่ง"
      >
        <ArrowUp strokeWidth={2} />
      </button>
    </form>
  );
}
