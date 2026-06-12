"use client";

import { useState } from "react";
import { ArrowUp, Mic, Sparkles } from "lucide-react";

/**
 * Floating capsule input (72px). Mic is a placeholder - voice is out of scope.
 */
export function JarvisInput({
  onSubmit,
  onFocusChange,
  disabled = false,
}: {
  onSubmit: (text: string) => void | Promise<void>;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    void onSubmit(trimmed);
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
      <button
        type="button"
        className="ji-mic"
        disabled
        title="Voice input coming soon"
        aria-label="Voice input (coming soon)"
      >
        <Mic strokeWidth={1.7} />
      </button>
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
