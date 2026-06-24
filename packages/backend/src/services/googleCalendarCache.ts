import type { GoogleEvent } from "../schemas/googleCalendar.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import { agendaBounds } from "./agenda.js";
import {
  GCAL_CACHE_ENABLED,
  GCAL_CACHE_TTL_TODAY_MS,
  GCAL_CACHE_TTL_UPCOMING_MS,
  GCAL_CACHE_MIN_FRESH_MS,
} from "../config.js";

/**
 * Google Calendar cache (S2) — see docs/google-calendar-cache-plan.md.
 *
 * In-process, outbound-only SWR cache around `realGoogleEventsFetcher`. It only
 * changes WHEN we fetch, never WHAT is rendered. Three cooperating behaviors:
 *
 *   L1 SWR    : fresh → cache; stale → cache now + one background revalidate.
 *   L2 fresh  : `primeFresh` forces a synchronous refetch (scheduling turns),
 *               gated by MIN_FRESH so a burst of turns reuses the cache.
 *   L3 invalid: `invalidate` clears entries after Friday's own write-through.
 *
 * Fail-soft everywhere: a failed refetch keeps the last good entry; only a cold
 * miss with no cache propagates the error (caller already treats that as `[]`).
 */

interface Entry {
  events: GoogleEvent[];
  fetchedAt: number; // Date.now() of last successful fetch
  inflight?: Promise<GoogleEvent[]>; // dedupe concurrent revalidate
}

function key(timeMinIso: string, timeMaxIso: string): string {
  return `${timeMinIso}|${timeMaxIso}`;
}

/** TTL for a window: "today" (min ≈ today's start) is short, else "upcoming". */
function ttlFor(timeMinIso: string): number {
  const isToday = timeMinIso === agendaBounds(new Date()).todayStartUtc;
  return isToday ? GCAL_CACHE_TTL_TODAY_MS : GCAL_CACHE_TTL_UPCOMING_MS;
}

export interface GoogleCache {
  /** SWR read (drop-in `GoogleEventsFetcher`). */
  fetch: GoogleEventsFetcher;
  /** L2: force a synchronous refetch (MIN_FRESH-gated), fail-soft. */
  primeFresh: (timeMinIso: string, timeMaxIso: string) => Promise<GoogleEvent[]>;
  /** L3: drop cached windows (all, or those matching `predicate`). */
  invalidate: (predicate?: (cacheKey: string) => boolean) => void;
  /** Test helper: wipe everything. */
  clear: () => void;
}

/**
 * Build a cache over an injectable inner fetcher. The default export wires it to
 * `realGoogleEventsFetcher`; tests pass a counting stub (no real Google call).
 */
export function createGoogleCache(inner: GoogleEventsFetcher): GoogleCache {
  const map = new Map<string, Entry>();

  // Background/forced refetch with single-flight dedupe. On success: store. On
  // failure: keep the old entry, log count/ts only (never bodies). Resolves to
  // the freshest events available (new on success, old on fail-soft).
  function revalidate(
    timeMinIso: string,
    timeMaxIso: string,
  ): Promise<GoogleEvent[]> {
    const k = key(timeMinIso, timeMaxIso);
    const existing = map.get(k);
    if (existing?.inflight) return existing.inflight;

    const p = inner(timeMinIso, timeMaxIso)
      .then((events) => {
        map.set(k, { events, fetchedAt: Date.now() });
        return events;
      })
      .catch((err) => {
        const prev = map.get(k);
        // Fail-soft only for a REAL prior success. A placeholder (fetchedAt===0)
        // from a cold miss is not stale data — drop it and propagate so the
        // caller treats it as `[]`.
        if (prev && prev.fetchedAt !== 0) {
          delete prev.inflight;
          console.warn(
            `[gcal-cache] revalidate failed, serving stale (${prev.events.length} events, age ${
              Date.now() - prev.fetchedAt
            }ms)`,
          );
          return prev.events;
        }
        if (prev) map.delete(k); // clear the failed cold-miss placeholder
        throw err; // cold miss + failure → propagate (caller treats as []).
      });

    if (existing) {
      existing.inflight = p;
    } else {
      // No prior entry: record the in-flight promise so concurrent cold reads
      // dedupe onto it. fetchedAt=0 marks "never succeeded".
      map.set(k, { events: [], fetchedAt: 0, inflight: p });
    }
    return p;
  }

  const fetch: GoogleEventsFetcher = async (timeMinIso, timeMaxIso) => {
    if (!GCAL_CACHE_ENABLED) return inner(timeMinIso, timeMaxIso);

    const k = key(timeMinIso, timeMaxIso);
    const entry = map.get(k);

    // Cold miss (no prior success) → await a real fetch.
    if (!entry || entry.fetchedAt === 0) {
      return revalidate(timeMinIso, timeMaxIso);
    }

    const age = Date.now() - entry.fetchedAt;
    if (age < ttlFor(timeMinIso)) return entry.events; // [L1 hit]

    // [L1 SWR] stale: return cache now, kick a background revalidate. Detach the
    // promise (errors handled inside revalidate) so the read returns instantly.
    void revalidate(timeMinIso, timeMaxIso).catch(() => {});
    return entry.events;
  };

  const primeFresh = async (
    timeMinIso: string,
    timeMaxIso: string,
  ): Promise<GoogleEvent[]> => {
    if (!GCAL_CACHE_ENABLED) return inner(timeMinIso, timeMaxIso);

    const entry = map.get(key(timeMinIso, timeMaxIso));
    // Burst protection: a very recent success is treated as fresh enough.
    if (entry && entry.fetchedAt !== 0) {
      const age = Date.now() - entry.fetchedAt;
      if (age <= GCAL_CACHE_MIN_FRESH_MS) return entry.events;
    }
    return revalidate(timeMinIso, timeMaxIso);
  };

  const invalidate = (predicate?: (cacheKey: string) => boolean): void => {
    if (!predicate) {
      map.clear();
      return;
    }
    for (const k of [...map.keys()]) {
      if (predicate(k)) map.delete(k);
    }
  };

  const clear = (): void => map.clear();

  return { fetch, primeFresh, invalidate, clear };
}

const defaultCache = createGoogleCache(realGoogleEventsFetcher);

/** Default SWR fetcher (drop-in for `realGoogleEventsFetcher`). */
export const cachedGoogleEventsFetcher: GoogleEventsFetcher = defaultCache.fetch;
/** L2 force-fresh for scheduling-intent turns. */
export const primeFresh = defaultCache.primeFresh;
/** L3 write-through invalidation (called by the executor after a mutation). */
export const invalidateGoogleCache = defaultCache.invalidate;
