import { BANGKOK_OFFSET_MS } from "../config.js";
import {
  analyzeSchedule,
  DEFAULT_SCHEDULE_HEALTH_OPTIONS,
  type ScheduleHealthOptions,
  type Severity,
} from "./scheduleHealth.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";
import type { ScheduleConstraint } from "../schemas/scheduleConstraint.js";

/**
 * Step 27 / Sprint 3 — unified availability/conflict resolver (RC1, RC5).
 *
 * ONE deterministic pass that answers "what clashes?" across ALL schedule
 * sources — Google events + local events + reminders + Sprint-2 constraints —
 * instead of the model free-handing it over raw lists. Reuses the Tier-1
 * `analyzeSchedule` interval engine: every source is normalized to a synthetic
 * GoogleEvent (constraints are materialized into concrete daily windows over a
 * short horizon), the union is analyzed, and only real time clashes are kept.
 *
 * No AI. Pure apart from the inputs. The model only narrates the result; the
 * Sprint-4 verifier/gate enforces it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead constraint windows are materialized (Bangkok days from now). */
const HORIZON_DAYS = 8;

/** Id prefixes so a finding's side can be classified back to its source. */
const PREFIX = {
  google: "google:",
  local: "local:",
  reminder: "reminder:",
  constraint: "constraint:",
} as const;

/** Finding kinds that count as a real scheduling clash (mirrors eventConflicts). */
const CLASH_KINDS = new Set(["overlap", "tight_travel", "no_buffer"]);

export interface AvailabilityClash {
  kind: "overlap" | "tight_travel" | "no_buffer";
  severity: Severity;
  startUtc: string;
  endUtc: string;
  /** Compact analyzer note, e.g. "overlap 0m" / "gap 5m". */
  detail: string;
  /** Display labels of both sides (id-aligned with the analyzer titles). */
  labels: string[];
  /** True when at least one side is a tank window / class block constraint. */
  involvesConstraint: boolean;
  /** True when at least one side is a real event/reminder (not a constraint). */
  involvesRealItem: boolean;
}

export interface AvailabilityReport {
  clashes: AvailabilityClash[];
  /** Count of materialized constraint windows considered (transparency/debug). */
  constraintWindows: number;
}

/** Local (secondary) event shape the resolver needs. */
export interface LocalEventInput {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
}

/** Reminder shape the resolver needs (a single due instant → a point). */
export interface ReminderInput {
  id: number;
  title: string;
  due_at: string;
}

export interface AvailabilitySources {
  /** Raw Google events (must carry `end`); all-day are skipped by the analyzer. */
  googleEvents: GoogleEvent[];
  localEvents: LocalEventInput[];
  reminders: ReminderInput[];
  constraints: ScheduleConstraint[];
}

function synth(
  id: string,
  title: string,
  startIso: string,
  endIso: string,
  location: string | null = null,
): GoogleEvent {
  return {
    id,
    title,
    start: startIso,
    end: endIso,
    allDay: false,
    location,
    description: null,
    htmlLink: null,
    source: "google",
  };
}

/**
 * Materialize each weekly/daily constraint into concrete dated windows across a
 * short horizon so the interval engine can clash them against real items. A
 * constraint with empty `weekdays` applies every day; otherwise only on matching
 * Bangkok weekdays. Times are Bangkok-local → converted to UTC (local − 7h).
 */
export function materializeConstraints(
  constraints: ScheduleConstraint[],
  now: Date,
  horizonDays: number = HORIZON_DAYS,
): GoogleEvent[] {
  if (constraints.length === 0) return [];
  const out: GoogleEvent[] = [];
  const startB = new Date(now.getTime() + BANGKOK_OFFSET_MS);

  for (let i = 0; i < horizonDays; i++) {
    // A UTC-fielded date that represents the Bangkok CALENDAR day i days out.
    const d = new Date(
      Date.UTC(
        startB.getUTCFullYear(),
        startB.getUTCMonth(),
        startB.getUTCDate() + i,
      ),
    );
    const dow = d.getUTCDay();
    for (const c of constraints) {
      if (c.weekdays.length > 0 && !c.weekdays.includes(dow)) continue;
      const [sh, sm] = c.startLocal.split(":").map(Number);
      const [eh, em] = c.endLocal.split(":").map(Number);
      const startMs =
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm) -
        BANGKOK_OFFSET_MS;
      const endMs =
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh, em) -
        BANGKOK_OFFSET_MS;
      if (endMs <= startMs) continue; // skip malformed windows
      out.push(
        synth(
          `${PREFIX.constraint}${c.source}`,
          `${c.label} [${c.kind}]`,
          new Date(startMs).toISOString(),
          new Date(endMs).toISOString(),
        ),
      );
    }
  }
  return out;
}

function isConstraintId(id: string): boolean {
  return id.startsWith(PREFIX.constraint);
}

/**
 * Resolve the clash landscape across all sources in one pass. Deterministic and
 * order-independent. Constraint-vs-constraint overlaps (the user's own rules
 * overlapping each other) are dropped — only clashes touching a real item are
 * surfaced. FAILS SOFT is the caller's job; this is pure.
 */
export function resolveAvailability(
  sources: AvailabilitySources,
  now: Date,
  options: ScheduleHealthOptions = DEFAULT_SCHEDULE_HEALTH_OPTIONS,
): AvailabilityReport {
  const constraintEvents = materializeConstraints(sources.constraints, now);

  const normalized: GoogleEvent[] = [
    ...sources.googleEvents.map((e) =>
      e.id.startsWith(PREFIX.google) ? e : { ...e, id: `${PREFIX.google}${e.id}` },
    ),
    ...sources.localEvents.map((e) =>
      synth(
        `${PREFIX.local}${e.id}`,
        e.title,
        e.starts_at,
        e.ends_at ?? e.starts_at,
      ),
    ),
    ...sources.reminders.map((r) =>
      synth(`${PREFIX.reminder}${r.id}`, r.title, r.due_at, r.due_at),
    ),
    ...constraintEvents,
  ];

  const { findings } = analyzeSchedule(normalized, options);

  const clashes: AvailabilityClash[] = [];
  for (const f of findings) {
    if (!CLASH_KINDS.has(f.kind)) continue;
    const constraintSides = f.eventIds.filter(isConstraintId).length;
    const involvesConstraint = constraintSides > 0;
    const involvesRealItem = constraintSides < f.eventIds.length;
    // Drop the user's own rules overlapping each other — not an actionable clash.
    if (!involvesRealItem) continue;
    clashes.push({
      kind: f.kind as AvailabilityClash["kind"],
      severity: f.severity,
      startUtc: f.startUtc,
      endUtc: f.endUtc,
      detail: f.detail,
      labels: f.titles,
      involvesConstraint,
      involvesRealItem,
    });
  }

  return { clashes, constraintWindows: constraintEvents.length };
}
