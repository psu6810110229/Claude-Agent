"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Info,
  X,
} from "lucide-react";

type ToastKind = "success" | "info" | "warning" | "error";

interface ToastInput {
  title: string;
  description?: string;
  kind?: ToastKind;
  durationMs?: number;
}

interface Toast extends Required<Omit<ToastInput, "description">> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  notify: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION_MS = 4200;
// Errors stay until the user dismisses them so a failure is never missed.
const PERSIST = Number.POSITIVE_INFINITY;

interface TimerState {
  handle: number;
  startedAt: number;
  remaining: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, TimerState>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer.handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // Pause a running timer (hover/focus) by banking the remaining time.
  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer || !Number.isFinite(timer.remaining)) return;
    window.clearTimeout(timer.handle);
    timer.remaining -= Date.now() - timer.startedAt;
  }, []);

  // Resume a paused timer with whatever time was left.
  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (!timer || !Number.isFinite(timer.remaining)) return;
      timer.startedAt = Date.now();
      timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
    },
    [dismiss],
  );

  const notify = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const kind = input.kind ?? "info";
      const durationMs =
        input.durationMs ?? (kind === "error" ? PERSIST : DEFAULT_DURATION_MS);
      const toast: Toast = {
        id,
        title: input.title,
        description: input.description,
        kind,
        durationMs,
      };

      setToasts((prev) => [toast, ...prev].slice(0, 4));
      if (Number.isFinite(durationMs)) {
        timers.current.set(id, {
          handle: window.setTimeout(() => dismiss(id), durationMs),
          startedAt: Date.now(),
          remaining: durationMs,
        });
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => window.clearTimeout(t.handle));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  const renderToast = (toast: Toast) => (
    <ToastCard
      key={toast.id}
      toast={toast}
      onDismiss={dismiss}
      onPause={pause}
      onResume={resume}
    />
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        Two live regions sharing one viewport. Each toast lives in exactly one
        region, so a screen reader announces it once — never twice. Errors go to
        the assertive region (urgent); everything else stays polite.
      */}
      <div className="toast-viewport">
        <div
          className="toast-stack"
          aria-live="assertive"
          aria-relevant="additions"
        >
          {toasts.filter((t) => t.kind === "error").map(renderToast)}
        </div>
        <div
          className="toast-stack"
          aria-live="polite"
          aria-relevant="additions"
        >
          {toasts.filter((t) => t.kind !== "error").map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}

function ToastCard({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}) {
  const Icon =
    toast.kind === "success"
      ? CheckCircle2
      : toast.kind === "warning"
        ? Clock3
        : toast.kind === "error"
          ? AlertCircle
          : Info;

  const hold = () => onPause(toast.id);
  const release = () => onResume(toast.id);

  return (
    // Pause the auto-dismiss timer while the card is hovered or holds focus so
    // a toast is never read/acted on as it slides away. Persistent (error)
    // toasts have no timer, so these are no-ops for them.
    <div
      className={`toast-card ${toast.kind}`}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocusCapture={hold}
      onBlurCapture={release}
    >
      <div className="toast-icon">
        <Icon aria-hidden="true" strokeWidth={1.9} />
      </div>
      <div className="toast-copy">
        <strong>{toast.title}</strong>
        {toast.description && <span>{toast.description}</span>}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="ปิดการแจ้งเตือน"
      >
        <X aria-hidden="true" strokeWidth={1.8} />
      </button>
    </div>
  );
}
