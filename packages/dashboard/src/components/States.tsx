/** Tiny shared loading / error / empty presentational helpers. */

export function Loading({ label = "Loading..." }: { label?: string }) {
  return <div className="state loading">{label}</div>;
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="state">{label}</div>;
}
