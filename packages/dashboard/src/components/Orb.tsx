"use client";

import { motion, useReducedMotion } from "framer-motion";

export type OrbState = "idle" | "thinking";
export type OrbVariant = "hero" | "compact" | "avatar";

/**
 * The visual heart of the interface: a floating, breathing liquid-glass orb.
 * Pure CSS layers (conic + radial gradients, blur) animated slowly; the
 * `state` prop nudges pace and brightness so it reads as alive, never blinking.
 */
export function Orb({
  state = "idle",
  variant = "hero",
}: {
  state?: OrbState;
  variant?: OrbVariant;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={`orb-wrap orb-${variant}`}
      data-state={state}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 60, damping: 16, mass: 1.1 }
      }
      aria-hidden="true"
    >
      <div className="orb-halo" />
      <div className="orb">
        <div className="orb-rim" />
        <div className="orb-layer swirl" />
        <div className="orb-layer veil" />
        <div className="orb-layer caustic" />
        <div className="orb-layer core" />
        <div className="orb-sheen" />
        <div className="orb-highlight" />
        <div className="orb-particles">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={`op op-${i + 1}`} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
