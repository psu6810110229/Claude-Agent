"use client";

import { useState } from "react";
import { ArrowUp, ChevronDown, Moon, Sparkles, Sun } from "lucide-react";
import type { BriefType } from "@/lib/types";

/**
 * Floating capsule input (72px). Mic is a placeholder - voice is out of scope.
 */
export function JarvisInput({
  onSubmit,
  onBrief,
  onFocusChange,
  disabled = false,
  briefBusy = null,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  onBrief?: (type: BriefType) => void | Promise<void>;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
  briefBusy?: BriefType | null;
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
        placeholder="Ask J.A.R.V.I.S anything..."
        aria-label="Ask J.A.R.V.I.S anything"
        disabled={disabled}
        autoFocus
      />
      {onBrief && (
        <div className="ji-menu-wrap">
          <button
            type="button"
            className="ji-menu-toggle"
            disabled={disabled || briefBusy !== null}
            title="Brief actions"
            aria-label="Brief actions"
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
                Daily Brief
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={disabled || briefBusy !== null}
                onClick={() => runBrief("evening")}
              >
                <Moon strokeWidth={1.7} />
                Evening Brief
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="submit"
        className="ji-send"
        disabled={disabled || text.trim() === ""}
        aria-label="Send"
      >
        <ArrowUp strokeWidth={2} />
      </button>
    </form>
  );
}
