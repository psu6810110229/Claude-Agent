/** Tiny shared loading / error / empty presentational helpers. */

export function Loading({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <div className="state loading" role="status">
      {label}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

/**
 * Empty state. `label` says what's missing; the optional `hint` teaches the
 * next move so an empty surface is never a dead end.
 */
export function Empty({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="state empty">
      <p className="state-title">{label}</p>
      {hint && <p className="state-hint">{hint}</p>}
    </div>
  );
}
