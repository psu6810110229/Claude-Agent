"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import type { OrbState } from "./Orb";

/**
 * Aurora Membrane core for the hero orb. A <canvas> draws flowing aurora
 * ribbons + drifting inner particles in a flow loop; the surrounding glass
 * shell (rim, sheen, highlight, halo) stays as CSS layers above it. Only the
 * large hero variant mounts this — chat avatars keep the cheap CSS stack.
 *
 * "Breathing entity": a single slow respiration value drives ribbon amplitude,
 * core glow, particle speed and ribbon brightness, so the whole field inhales
 * and exhales together. idle = calm blue→violet; alert = faster, amber bleed.
 */

type Palette = {
  ribbons: [string, string][];
  core: string; // "r,g,b"
  period: number; // breath seconds
  ampBase: number; // ribbon amplitude as fraction of R
  speed: number; // ribbon drift speed
  bright: number; // overall intensity multiplier
  nodes: string[]; // tints for the wandering pulse hotspots
};

const PALETTES: Record<"idle" | "alert", Palette> = {
  idle: {
    // Opal: orange-dominant, saturated, into violet/blue.
    ribbons: [
      ["#ff6a1e", "#a25cf0"],
      ["#ff7e2a", "#e85f18"],
      ["#ff8a3a", "#3f7fe8"],
    ],
    core: "255,200,140",
    period: 7.2,
    ampBase: 0.15,
    speed: 0.16,
    bright: 1.5,
    nodes: ["#ff7416", "#ff9e2a", "#d24fd6", "#3f7fe8", "#ff5a1e"],
  },
  alert: {
    ribbons: [
      ["#ffd98a", "#ff9f0a"],
      ["#ffb14d", "#a78bfa"],
      ["#ffe2ad", "#7cb8ff"],
    ],
    core: "255,242,214",
    period: 3.6,
    ampBase: 0.2,
    speed: 0.3,
    bright: 1.55,
    nodes: ["#ffd98a", "#ffe7c0", "#ffcf6a", "#ffdca0", "#ffe2ad"],
  },
};

export function OrbCanvas({ state }: { state: OrbState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  useEffect(() => {
    if (!canvasRef.current) return;
    // Concrete non-null handles: control-flow narrowing is not preserved
    // inside the rAF/resize closures, so the declared types must be non-null.
    const canvas: HTMLCanvasElement = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g: CanvasRenderingContext2D = ctx;

    const parent = canvas.parentElement;
    let cssW = 0;
    let cssH = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Wandering pulse hotspots: each breathes on its own period/phase and
    // drifts, so the orb never brightens uniformly — it shimmers unevenly.
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      fx: (Math.random() * 2 - 1) * 0.52,
      fy: (Math.random() * 2 - 1) * 0.52,
      period: 1.5 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
      seed: Math.random() * Math.PI * 2,
      drift: 0.06 + Math.random() * 0.13,
      size: 0.2 + Math.random() * 0.32, // varied blob size → uneven glow
      gain: 0.7 + Math.random() * 0.6, // per-node intensity variety
      hue: i,
    }));

    // Phase seeds for the morphing outline harmonics.
    const blobSeed = [0, 1, 2, 3].map(() => Math.random() * Math.PI * 2);

    function resize() {
      const box: HTMLElement = parent ?? canvas;
      cssW = box.clientWidth || 150;
      cssH = box.clientHeight || 150;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resize())
        : null;
    if (ro && parent) ro.observe(parent);

    function draw(t: number) {
      const w = cssW;
      const h = cssH;
      const cx = w / 2;
      const cy = h / 2;
      const R = w / 2;
      const p = stateRef.current === "alert" ? PALETTES.alert : PALETTES.idle;

      g.clearRect(0, 0, w, h);
      g.save();

      // organic, slowly morphing outline — not a perfect circle
      const blob = new Path2D();
      const BSTEP = 64;
      const baseR = R * 0.94;
      for (let s = 0; s <= BSTEP; s++) {
        const th = (s / BSTEP) * Math.PI * 2;
        const rr =
          baseR *
          (1 +
            0.0105 * Math.sin(th * 2 + t * 0.75 + blobSeed[0]) +
            0.0063 * Math.sin(th * 3 - t * 0.57 + blobSeed[1]) +
            0.00315 * Math.sin(th * 5 + t * 0.93 + blobSeed[2]) +
            0.0021 * Math.sin(th * 7 - t * 0.45 + blobSeed[3]));
        const x = cx + Math.cos(th) * rr;
        const y = cy + Math.sin(th) * rr;
        if (s === 0) blob.moveTo(x, y);
        else blob.lineTo(x, y);
      }
      blob.closePath();

      // membrane base: exact small-orb opal — orange → violet → blue (158deg)
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      const base = g.createLinearGradient(
        cx + R * 0.22,
        cy - R,
        cx - R * 0.22,
        cy + R
      );
      base.addColorStop(0, "#ff6a1e");
      base.addColorStop(0.44, "#de3ba2");
      base.addColorStop(1, "#2f5fea");
      g.filter = "saturate(1.45)";
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      g.filter = "none";

      // warm highlight — off-centre so the body isn't symmetric
      const hx = cx - R * 0.18;
      const hy = cy - R * 0.46;
      const hi = g.createRadialGradient(hx, hy, 0, hx, hy, R * 0.66);
      hi.addColorStop(0, "rgba(255,232,205,0.08)");
      hi.addColorStop(1, "rgba(255,232,205,0)");
      g.fillStyle = hi;
      g.fillRect(0, 0, w, h);

      // soft shine spots — gentle additive light that breathes and drifts,
      // so the body is alive and uneven but never dark or muddy
      g.globalCompositeOperation = "lighter";
      for (const nd of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / nd.period + nd.phase);
        const nx = cx + (nd.fx + Math.sin(t * 0.375 + nd.seed) * nd.drift) * R;
        const ny = cy + (nd.fy + Math.cos(t * 0.315 + nd.seed) * nd.drift) * R;
        const rad = R * (nd.size + 0.06 * pulse);
        const ng = g.createRadialGradient(nx, ny, 0, nx, ny, rad);
        ng.addColorStop(0, p.nodes[nd.hue % p.nodes.length]);
        ng.addColorStop(1, "rgba(0,0,0,0)");
        // floor keeps each spot present; pulse only breathes its intensity
        g.globalAlpha = (0.18 + 0.14 * pulse) * nd.gain;
        g.fillStyle = ng;
        g.fillRect(0, 0, w, h);
      }

      // smooth shine fade — the blurred outline is the ONLY edge (no hard clip,
      // so no thin bright ring); content fades gently into the background.
      // globalAlpha MUST be 1 here or the mask thins the whole orb to ~30%.
      g.globalCompositeOperation = "destination-in";
      g.globalAlpha = 1;
      g.filter = `blur(${(R * 0.05).toFixed(2)}px)`;
      g.fillStyle = "#000";
      g.fill(blob);
      g.filter = "none";
      g.globalCompositeOperation = "source-over";

      g.restore();
    }

    let raf = 0;
    let t0 = 0;

    if (reduceMotion) {
      // single calm static frame, no loop
      draw(1.8);
      return () => {
        if (ro) ro.disconnect();
      };
    }

    function frame(now: number) {
      if (!t0) t0 = now;
      const t = (now - t0) / 1000;
      draw(t);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} className="orb-canvas" aria-hidden="true" />;
}
