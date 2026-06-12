"use client";

import { useState } from "react";
import { ArrowUp, Mic, Sparkles } from "lucide-react";

/**
 * Floating capsule input (72px). Submits hand the message to the chat page,
 * which auto-sends it. Mic is a placeholder — voice is out of scope.
 */
export function JarvisInput({
  onSubmit,
  onFocusChange,
}: {
  onSubmit: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
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
        disabled={text.trim() === ""}
        aria-label="Send"
      >
        <ArrowUp strokeWidth={2} />
      </button>
    </form>
  );
}
