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
  const [open, setOpen] = useState(true);
  const reduceMotion = useReducedMotion() ?? false;
  const hasText = text.trim().length > 0;

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setOpen(false), 900);
    return () => window.clearTimeout(timer);
  }, [done]);

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
            {done ? "คิดเสร็จแล้ว" : "กำลังคิด…"}
          </span>
          <span className="thinking-panel-meta">
            {hasText ? "ดูความคิดสด" : "รอสัญญาณจากโมเดล"}
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
              {hasText ? text : "กำลังรอโมเดลเริ่มส่งความคิด"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
