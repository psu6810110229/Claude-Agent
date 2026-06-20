import { analyzeSchedule, type ScheduleHealthOptions } from "./scheduleHealth.js";
import { getSchedulePrefs } from "./schedulePrefs.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";

/**
 * Deterministic create-time conflict detection.
 *
 * When a NEW Google event is about to be queued, we check it against the
 * existing calendar by reusing the Tier 1 analyzer (`analyzeSchedule`): the
 * proposed event is injected as a synthetic event and we keep only the findings
 * that (a) involve the new event and (b) are real time clashes — a hard
 * `overlap` or a too-tight buffer (`no_buffer` / `tight_travel`). NO AI. This is
 * what lets the backend WARN "this overlaps with X" and force a confirm instead
 * of silently auto-executing a clashing create.
 */

/** Synthetic id for the not-yet-created event inside the analyzer. */
const NEW_ID = "__pending_new__";

/** Finding kinds that count as a real scheduling clash for a new event. */
const CONFLICT_KINDS = new Set(["overlap", "tight_travel", "no_buffer"]);

export interface EventConflict {
  kind: "overlap" | "tight_travel" | "no_buffer";
  severity: "high" | "medium" | "low";
  /** Title of the EXISTING event the new one clashes with (display-only). */
  withTitle: string;
  /** Compact analyzer note, e.g. "overlap 30m" or "gap 5m". */
  detail: string;
  startUtc: string;
  endUtc: string;
}

/** The fields of a create payload we need to build the synthetic event. */
export interface CreateConflictInput {
  title: string;
  starts_at: string;
  ends_at: string;
  location?: string;
  notes?: string;
}

function synthEvent(payload: CreateConflictInput): GoogleEvent {
  return {
    id: NEW_ID,
    title: payload.title,
    start: payload.starts_at,
    end: payload.ends_at,
    allDay: false,
    location: payload.location ?? null,
    description: payload.notes ?? null,
    htmlLink: null,
    source: "google",
  };
}

/**
 * Pure conflict detection: inject the proposed event among `existingEvents` and
 * return the clashes that involve it. Order-independent; deterministic.
 */
export function findCreateConflicts(
  payload: CreateConflictInput,
  existingEvents: GoogleEvent[],
  options: ScheduleHealthOptions,
): EventConflict[] {
  // Drop any stale synthetic id and the same event id to avoid self-conflicts.
  const others = existingEvents.filter((e) => e.id !== NEW_ID);
  const { findings } = analyzeSchedule([...others, synthEvent(payload)], options);

  const out: EventConflict[] = [];
  for (const f of findings) {
    if (!CONFLICT_KINDS.has(f.kind)) continue;
    if (!f.eventIds.includes(NEW_ID)) continue;
    // Pairwise findings carry eventIds/titles aligned by index; the OTHER event
    // is the one that is not the synthetic new event.
    const otherIdx = f.eventIds.findIndex((id) => id !== NEW_ID);
    const withTitle = otherIdx >= 0 ? f.titles[otherIdx] ?? "" : "";
    out.push({
      kind: f.kind as EventConflict["kind"],
      severity: f.severity,
      withTitle,
      detail: f.detail,
      startUtc: f.startUtc,
      endUtc: f.endUtc,
    });
  }
  return out;
}

/** A create-payload → conflicts checker (async; reads the live calendar). */
export type CreateConflictChecker = (
  payload: CreateConflictInput,
) => Promise<EventConflict[]>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a checker that fetches the calendar around the proposed event's day
 * (±1 day so cross-midnight buffers are seen) and detects clashes against the
 * current schedule prefs. FAILS CLOSED: any fetch/parse error yields `[]` (no
 * warning, unchanged behaviour) rather than blocking the create.
 */
export function makeCreateConflictChecker(
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): CreateConflictChecker {
  return async (payload: CreateConflictInput): Promise<EventConflict[]> => {
    const startMs = Date.parse(payload.starts_at);
    const endMs = Date.parse(payload.ends_at);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];
    try {
      const minIso = new Date(startMs - DAY_MS).toISOString();
      const maxIso = new Date(endMs + DAY_MS).toISOString();
      const events = await fetchGoogle(minIso, maxIso);
      return findCreateConflicts(payload, events, getSchedulePrefs());
    } catch {
      return [];
    }
  };
}
