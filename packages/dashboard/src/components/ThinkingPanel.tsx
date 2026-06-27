"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui";

export function ThinkingPanel({
  text,
  active,
  done,
  onStop,
}: {
  text: string;
  active: boolean;
  done: boolean;
  onStop?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const hasText = text.trim().length > 0;
  const summary = summarizeThought(text);

  useEffect(() => {
    if (!hasText) setOpen(false);
  }, [hasText]);

  if (!active && !hasText) return null;

  return (
    <section
      className={`thinking-panel${done ? " done" : ""}`}
      aria-label="ความคิดของโมเดล"
    >
      <div className="thinking-panel-head">
        <button
          type="button"
          className="thinking-panel-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="thinking-orb" aria-hidden="true" />
          <span className="thinking-panel-title">
            {done ? "คิดเสร็จแล้ว" : "กำลังคิด"}
          </span>
          <span className="thinking-panel-meta">
            {hasText ? summary : "รอสัญญาณจากโมเดล"}
          </span>
          <ChevronDown
            className={`thinking-panel-chevron${open ? " open" : ""}`}
            aria-hidden="true"
            strokeWidth={2}
          />
        </button>
        {active && onStop && (
          <Button
            variant="ghost"
            size="sm"
            className="thinking-stop"
            onClick={onStop}
          >
            หยุด
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="thinking-panel-body"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          >
            <div className="thinking-panel-scroll" aria-live="polite">
              {hasText ? (
                reduceMotion ? (
                  text
                ) : (
                  text.split(/\r?\n/).map((line, i) => (
                    // Keyed by index so already-shown lines stay put while each
                    // newly-streamed line fades in once on mount.
                    <span key={i} className="rt-line rt-pline">
                      {line.length > 0 ? line : " "}
                    </span>
                  ))
                )
              ) : (
                "กำลังรอโมเดลเริ่มส่งความคิด"
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function summarizeThought(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[`*_>#-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .find((line) => line.length > 0);

  if (!firstLine) return "รอสัญญาณจากโมเดล";
  return firstLine.length > 96
    ? `${firstLine.slice(0, 93).trimEnd()}...`
    : firstLine;
}
