"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-run the loader (e.g. after a mutation). */
  reload: () => void;
}

/** Minimal client-side fetch-on-mount hook with loading/error/reload. */
export function useResource<T>(loader: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // loader identity is owned by the caller; re-run only on explicit reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const cancel = run();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return { data, loading, error, reload };
}
