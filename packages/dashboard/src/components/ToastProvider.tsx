"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const toast: Toast = {
        id,
        title: input.title,
        description: input.description,
        kind: input.kind ?? "info",
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      };

      setToasts((prev) => [toast, ...prev].slice(0, 4));
      window.setTimeout(() => dismiss(id), toast.durationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
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
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const Icon =
    toast.kind === "success"
      ? CheckCircle2
      : toast.kind === "warning"
        ? Clock3
        : toast.kind === "error"
          ? AlertCircle
          : Info;

  return (
    <div className={`toast-card ${toast.kind}`} role="status">
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
        aria-label="Dismiss notification"
      >
        <X aria-hidden="true" strokeWidth={1.8} />
      </button>
    </div>
  );
}
