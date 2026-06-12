"use client";

import useSWR from "swr";
import { ApiError } from "./api";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** SWR-backed fetch hook. Cache hit → instant; cache miss → loading: true. */
export function useData<T>(key: string, fetcher: () => Promise<T>): Resource<T> {
  const { data, error, isLoading, mutate } = useSWR<T>(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  return {
    data: data ?? null,
    loading: isLoading,
    error: error
      ? error instanceof ApiError
        ? error.message
        : String(error)
      : null,
    reload: () => { void mutate(); },
  };
}
