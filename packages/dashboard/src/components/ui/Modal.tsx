/**
 * Modal / Sheet — overlay surfaces with a11y baked in once.
 *
 * Modal = centered glass dialog on the size scale (sm/md/lg). On phones it
 *         drops to a bottom sheet (full width, rounded top) so a 520px dialog
 *         never overflows a 360px viewport.
 * Sheet = edge drawer (right / left / bottom) for side panels and pickers.
 *
 * Both share one controller (`useOverlayA11y`) that handles the four things
 * every hand-rolled modal in this repo got wrong or skipped:
 *   - scroll lock (with scrollbar-width compensation, ref-counted for stacks)
 *   - Esc to close
 *   - focus trap (Tab / Shift+Tab wrap) + initial focus + focus restore
 *   - render through a portal to <body> so stacking context can't clip it
 *
 * Visuals derive from the Liquid Glass tokens (--modal-*, --z-modal*,
 * --glass*, --radius-lg) — same frosted look as `.jarvis-dialog`, just
 * generalized and composable.
 */

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

export type ModalSize = "sm" | "md" | "lg";
export type SheetSide = "right" | "left" | "bottom";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Scroll lock — ref-counted so stacked overlays don't fight over body */
/* ------------------------------------------------------------------ */

let scrollLockCount = 0;
let savedBodyOverflow = "";
let savedBodyPaddingRight = "";

function lockScroll() {
  if (scrollLockCount === 0 && typeof document !== "undefined") {
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    savedBodyOverflow = body.style.overflow;
    savedBodyPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    // Compensate the removed scrollbar so layout doesn't jump.
    if (scrollbar > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbar}px`;
    }
  }
  scrollLockCount += 1;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0 && typeof document !== "undefined") {
    document.body.style.overflow = savedBodyOverflow;
    document.body.style.paddingRight = savedBodyPaddingRight;
  }
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/* ------------------------------------------------------------------ */
/* useOverlayA11y — the shared controller                              */
/* ------------------------------------------------------------------ */

interface OverlayA11yOptions {
  open: boolean;
  onClose: () => void;
  closeOnEsc?: boolean;
  /** Element to focus on open; defaults to first focusable, else the panel. */
  initialFocusRef?: Ref<HTMLElement> | { current: HTMLElement | null };
}

function useOverlayA11y({
  open,
  onClose,
  closeOnEsc = true,
  initialFocusRef,
}: OverlayA11yOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-binding listeners every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Mount guard for the portal (no document during SSR).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Scroll lock for the lifetime of the open overlay.
  useEffect(() => {
    if (!open) return;
    lockScroll();
    return unlockScroll;
  }, [open]);

  // Focus management: capture prior focus, move into the panel, restore on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const initial =
      initialFocusRef && "current" in initialFocusRef
        ? initialFocusRef.current
        : null;
    const target =
      initial ?? (panel ? getFocusable(panel)[0] ?? panel : null);
    // Defer so the element exists and the enter animation has a frame.
    const raf = requestAnimationFrame(() => target?.focus());
    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused?.focus?.();
    };
    // initialFocusRef is a stable ref object in practice; exclude to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc to close + Tab focus trap.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, closeOnEsc]);

  return { panelRef, mounted };
}

/* ------------------------------------------------------------------ */
/* Shared overlay shell                                                */
/* ------------------------------------------------------------------ */

interface OverlayShellProps {
  open: boolean;
  onClose: () => void;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  /** Accessible name when no `aria-labelledby` (e.g. no visible title). */
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  panelClassName: string;
  initialFocusRef?: { current: HTMLElement | null };
  children: ReactNode;
}

const OverlayShell = forwardRef<HTMLDivElement, OverlayShellProps>(
  function OverlayShell(
    {
      open,
      onClose,
      closeOnEsc,
      closeOnBackdrop = true,
      ariaLabel,
      labelledBy,
      describedBy,
      panelClassName,
      initialFocusRef,
      children,
    },
    _ref,
  ) {
    const { panelRef, mounted } = useOverlayA11y({
      open,
      onClose,
      closeOnEsc,
      initialFocusRef,
    });

    // Track whether the press started on the backdrop — a drag that ends on the
    // backdrop (text selection inside the panel) must not close the overlay.
    const backdropPressRef = useRef(false);

    if (!open || !mounted) return null;

    return createPortal(
      <div
        className="ui-overlay"
        onMouseDown={(e) => {
          backdropPressRef.current = e.target === e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (
            closeOnBackdrop &&
            backdropPressRef.current &&
            e.target === e.currentTarget
          ) {
            onClose();
          }
          backdropPressRef.current = false;
        }}
      >
        <div
          ref={panelRef}
          className={panelClassName}
          role="dialog"
          aria-modal="true"
          aria-label={labelledBy ? undefined : ariaLabel}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  },
);

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  /** Renders a header with this title + a close button. */
  title?: ReactNode;
  /** Optional sub-text under the title. */
  description?: ReactNode;
  /** Footer region — usually a `<Cluster justify="end">` of Buttons. */
  footer?: ReactNode;
  /** Accessible name when `title` is omitted. */
  ariaLabel?: string;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  /** Hide the default header close button (still closes via Esc/backdrop). */
  hideClose?: boolean;
  initialFocusRef?: { current: HTMLElement | null };
  className?: string;
  children?: ReactNode;
}

export function Modal({
  open,
  onClose,
  size = "md",
  title,
  description,
  footer,
  ariaLabel,
  closeOnEsc = true,
  closeOnBackdrop = true,
  hideClose = false,
  initialFocusRef,
  className,
  children,
}: ModalProps) {
  const baseId = useId();
  const titleId = title ? `${baseId}-title` : undefined;
  const descId = description ? `${baseId}-desc` : undefined;

  return (
    <OverlayShell
      open={open}
      onClose={onClose}
      closeOnEsc={closeOnEsc}
      closeOnBackdrop={closeOnBackdrop}
      ariaLabel={ariaLabel}
      labelledBy={titleId}
      describedBy={descId}
      initialFocusRef={initialFocusRef}
      panelClassName={cx("ui-modal", `ui-modal-${size}`, className)}
    >
      {(title || !hideClose) && (
        <div className="ui-modal-header">
          <div className="ui-modal-heading">
            {title && (
              <h2 id={titleId} className="ui-modal-title">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="ui-modal-desc">
                {description}
              </p>
            )}
          </div>
          {!hideClose && (
            <button
              type="button"
              className="ui-modal-close"
              aria-label="ปิด"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {children != null && <div className="ui-modal-body">{children}</div>}
      {footer && <div className="ui-modal-footer">{footer}</div>}
    </OverlayShell>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet — edge drawer                                                 */
/* ------------------------------------------------------------------ */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: SheetSide;
  size?: ModalSize;
  title?: ReactNode;
  ariaLabel?: string;
  footer?: ReactNode;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  hideClose?: boolean;
  initialFocusRef?: { current: HTMLElement | null };
  className?: string;
  children?: ReactNode;
}

export function Sheet({
  open,
  onClose,
  side = "right",
  size = "md",
  title,
  ariaLabel,
  footer,
  closeOnEsc = true,
  closeOnBackdrop = true,
  hideClose = false,
  initialFocusRef,
  className,
  children,
}: SheetProps) {
  const baseId = useId();
  const titleId = title ? `${baseId}-title` : undefined;

  return (
    <OverlayShell
      open={open}
      onClose={onClose}
      closeOnEsc={closeOnEsc}
      closeOnBackdrop={closeOnBackdrop}
      ariaLabel={ariaLabel}
      labelledBy={titleId}
      initialFocusRef={initialFocusRef}
      panelClassName={cx(
        "ui-sheet",
        `ui-sheet-${side}`,
        `ui-sheet-${size}`,
        className,
      )}
    >
      {(title || !hideClose) && (
        <div className="ui-modal-header">
          {title ? (
            <h2 id={titleId} className="ui-modal-title">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {!hideClose && (
            <button
              type="button"
              className="ui-modal-close"
              aria-label="ปิด"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {children != null && <div className="ui-modal-body">{children}</div>}
      {footer && <div className="ui-modal-footer">{footer}</div>}
    </OverlayShell>
  );
}
