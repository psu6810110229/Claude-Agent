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
  /** Start/end of the EXISTING clashing event (UTC ISO) — drives the "already on
   *  calendar at HH:MM" line and the duplicate same-start check. Null if unknown. */
  existingStart: string | null;
  existingEnd: string | null;
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

/** Only a TRUE time overlap — no adjacency/buffer/travel. Used by the bulk plan
 *  so a timetable import isn't drowned in "ห่าง 5 นาที" / different-room noise. */
export const HARD_OVERLAP_ONLY: ReadonlySet<string> = new Set(["overlap"]);

/**
 * Pure conflict detection: inject the proposed event among `existingEvents` and
 * return the clashes that involve it. Order-independent; deterministic.
 * `allowedKinds` selects which finding kinds count (default: all three clash
 * kinds; pass HARD_OVERLAP_ONLY to keep only real time overlaps).
 */
export function findCreateConflicts(
  payload: CreateConflictInput,
  existingEvents: GoogleEvent[],
  options: ScheduleHealthOptions,
  allowedKinds: ReadonlySet<string> = CONFLICT_KINDS,
): EventConflict[] {
  // Drop any stale synthetic id and the same event id to avoid self-conflicts.
  const others = existingEvents.filter((e) => e.id !== NEW_ID);
  const { findings } = analyzeSchedule([...others, synthEvent(payload)], options);

  const out: EventConflict[] = [];
  for (const f of findings) {
    if (!allowedKinds.has(f.kind)) continue;
    if (!f.eventIds.includes(NEW_ID)) continue;
    // Pairwise findings carry eventIds/titles aligned by index; the OTHER event
    // is the one that is not the synthetic new event.
    const otherIdx = f.eventIds.findIndex((id) => id !== NEW_ID);
    const otherId = otherIdx >= 0 ? f.eventIds[otherIdx] : null;
    const withTitle = otherIdx >= 0 ? f.titles[otherIdx] ?? "" : "";
    const existing = otherId ? others.find((e) => e.id === otherId) ?? null : null;
    out.push({
      kind: f.kind as EventConflict["kind"],
      severity: f.severity,
      withTitle,
      detail: f.detail,
      startUtc: f.startUtc,
      endUtc: f.endUtc,
      existingStart: existing?.start ?? null,
      existingEnd: existing?.end ?? null,
    });
  }
  return out;
}

/** Triage category for a proposed item given its detected clashes. */
export type ConflictCategory = "clean" | "duplicate" | "overlap";

const DUP_START_TOLERANCE_MS = 15 * 60 * 1000;

/**
 * Normalise a title for a "same assignment" comparison: drop parenthetical
 * qualifiers ("(5%)", "(Stage 1: Insight)"), separators, and collapse space.
 * Two imports of the same deliverable under different naming collapse to equal.
 */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[[\](){}.,:;|/–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whitespace token set of a normalised title (drops empties). */
function tokenSet(norm: string): Set<string> {
  return new Set(norm.split(" ").filter((t) => t.length > 0));
}

/** Jaccard overlap of two token sets (0..1); 0 when either is empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Is this clash the SAME event already on the calendar (a re-import), not a
 * clash with a different subject? True when the titles match (equal after
 * normalising, or strong token overlap) AND — when the existing time is known —
 * the start lines up (re-imports keep the same start). Title-only match still
 * counts a duplicate when the existing start is unknown.
 */
function isLikelyDuplicate(
  item: { title: string; starts_at: string },
  c: EventConflict,
): boolean {
  const a = normTitle(item.title);
  const b = normTitle(c.withTitle);
  if (a.length === 0 || b.length === 0) return false;
  const titleMatch = a === b || jaccard(tokenSet(a), tokenSet(b)) >= 0.8;
  if (!titleMatch) return false;
  if (!c.existingStart) return true;
  const itemMs = Date.parse(item.starts_at);
  const existMs = Date.parse(c.existingStart);
  if (Number.isNaN(itemMs) || Number.isNaN(existMs)) return true;
  return Math.abs(itemMs - existMs) <= DUP_START_TOLERANCE_MS;
}

/**
 * Classify a proposed item: `clean` (no clash), `duplicate` (re-import of an
 * event already on the calendar — recommend skip), or `overlap` (clashes a
 * DIFFERENT event — user decides). A self-duplicate wins over a co-incident
 * overlap so a re-import is never mistaken for a fresh clash.
 */
export function classifyConflict(
  item: { title: string; starts_at: string },
  conflicts: EventConflict[],
): ConflictCategory {
  if (conflicts.length === 0) return "clean";
  return conflicts.some((c) => isLikelyDuplicate(item, c))
    ? "duplicate"
    : "overlap";
}

/** The one clash to surface for an item (the duplicate if any, else the first). */
export function primaryConflict(
  item: { title: string; starts_at: string },
  conflicts: EventConflict[],
): EventConflict | null {
  if (conflicts.length === 0) return null;
  return conflicts.find((c) => isLikelyDuplicate(item, c)) ?? conflicts[0];
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
