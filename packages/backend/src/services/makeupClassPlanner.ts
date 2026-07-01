import { BANGKOK_OFFSET_MS } from "../config.js";
import type { ClassBlock } from "../schemas/classBlock.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";
import { aiActionSchema, type AiAction } from "../schemas/aiCommand.js";
import {
  buildOccurrenceForDate,
  resolveClassOccurrence,
  type ClassOccurrence,
} from "./classOccurrenceResolver.js";

/**
 * Phase 05 / Sprint 3 — Makeup-class operation planner (contract).
 *
 * Turns a class schedule-change intent ("งดเรียนวงจรอาทิตย์นี้ แล้วเรียนชด
 * วันที่ 9, 21, 25, 26 กค 19:00-21:00 และ 15:00-17:00") into an ordered, readable
 * operation plan: cancel the named occurrence(s) and create the makeup class
 * event(s). The audit's headline danger is the planner GUESSING a date↔time
 * mapping it was not given (4 dates + 2 time ranges has no unambiguous pairing),
 * so the gate here REFUSES to pair and asks instead.
 *
 * Deterministic, pure, no IO. It consumes already-structured intent (the model's
 * job is extraction; the backend's job is to validate + plan), resolves every
 * occurrence through the Sprint-2 resolver, and emits a plan OR a clarification.
 * Nothing here writes to Google — Sprint 4 stages the plan through approvals.
 *
 * PRIVACY: works on class subjects, dates, and times only — schedule metadata,
 * never message bodies.
 */

export interface MakeupTimeRange {
  /** Bangkok "HH:MM". */
  start_local: string;
  /** Bangkok "HH:MM"; must be after start_local. */
  end_local: string;
}

export interface CancellationRef {
  /** Explicit Bangkok date "YYYY-MM-DD" to cancel. */
  dateLocal?: string;
  /** OR a relative reference ("อาทิตย์นี้", "คาบหน้า") resolved via Sprint 2. */
  relativeRef?: string;
}

export interface MakeupClassIntent {
  /** Occurrences of the class to cancel / mark skipped. */
  cancellations?: CancellationRef[];
  /** Makeup dates "YYYY-MM-DD". */
  makeupDates?: string[];
  /** Makeup time ranges. See the mapping rule for how they pair with dates. */
  makeupTimeRanges?: MakeupTimeRange[];
  /** Makeup taught online (recorded in the event summary). */
  online?: boolean;
  /** Optional makeup location/notes override. */
  location?: string;
}

export interface PlanMakeupOptions {
  now: Date;
  /** The matched class (Sprint 1) — defines the subject and the weekly window. */
  block: ClassBlock;
  /** Live calendar events, so a cancel can target the real series instance. */
  googleEvents?: readonly GoogleEvent[];
}

export type MakeupOperationKind = "cancel" | "create_makeup";

export interface MakeupOperation {
  kind: MakeupOperationKind;
  dateLocal: string;
  startUtc: string;
  endUtc: string;
  /** Calendar event id to act on (cancel of a known live occurrence). */
  eventId?: string;
  online?: boolean;
  /** One-line, user-readable description (metadata only). */
  summary: string;
}

export type MakeupPlanStatus = "planned" | "needs_clarification" | "no_op";

export type MakeupClarificationCode =
  | "no_target_class"
  | "nothing_to_do"
  | "cancel_reference_unresolved"
  | "cancel_out_of_term"
  | "makeup_time_missing"
  | "makeup_time_invalid"
  | "makeup_date_time_mapping_ambiguous";

export interface MakeupClarification {
  code: MakeupClarificationCode;
  /** Metadata-only question/detail (counts, dates, times — never a body). */
  detail: string;
}

export interface MakeupPlan {
  status: MakeupPlanStatus;
  subject: string;
  operations: MakeupOperation[];
  /** Present when status === "needs_clarification". */
  clarification?: MakeupClarification;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function clarify(
  subject: string,
  code: MakeupClarificationCode,
  detail: string,
): MakeupPlan {
  return { status: "needs_clarification", subject, operations: [], clarification: { code, detail } };
}

/** UTC instant for a Bangkok "YYYY-MM-DD" + "HH:MM" (local − 7h). */
function bangkokToUtc(dateLocal: string, hhmm: string): string {
  const [y, mo, d] = dateLocal.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - BANGKOK_OFFSET_MS).toISOString();
}

/** "13:00–16:00". */
function timeLabel(r: MakeupTimeRange): string {
  return `${r.start_local}–${r.end_local}`;
}

/**
 * Pair makeup dates with time ranges. The ONLY unambiguous pairings:
 *  - one shared range → every date uses it;
 *  - equal counts     → zip date[i] with range[i].
 * Anything else (e.g. 4 dates, 2 ranges) has no defined mapping → null, which the
 * caller turns into a clarification instead of a guess.
 */
export function pairDatesWithRanges(
  dates: readonly string[],
  ranges: readonly MakeupTimeRange[],
): { dateLocal: string; range: MakeupTimeRange }[] | null {
  if (dates.length === 0 || ranges.length === 0) return null;
  if (ranges.length === 1) {
    return dates.map((dateLocal) => ({ dateLocal, range: ranges[0] }));
  }
  if (dates.length === ranges.length) {
    return dates.map((dateLocal, i) => ({ dateLocal, range: ranges[i] }));
  }
  return null;
}

/** Resolve ONE cancellation ref to a concrete occurrence (or an issue code). */
function resolveCancellation(
  ref: CancellationRef,
  opts: PlanMakeupOptions,
): { occurrence: ClassOccurrence } | { issue: MakeupClarificationCode; detail: string } {
  if (ref.dateLocal) {
    if (!YMD_RE.test(ref.dateLocal)) {
      return { issue: "cancel_reference_unresolved", detail: `invalid cancel date "${ref.dateLocal}"` };
    }
    const built = buildOccurrenceForDate(ref.dateLocal, opts.block);
    if (built.status === "out_of_term") {
      return { issue: "cancel_out_of_term", detail: `cancel date ${ref.dateLocal} is outside the class term` };
    }
    if (!built.occurrence) {
      return { issue: "cancel_reference_unresolved", detail: `could not resolve cancel date ${ref.dateLocal}` };
    }
    return { occurrence: bindIfPossible(built.occurrence, opts) };
  }
  if (ref.relativeRef) {
    const r = resolveClassOccurrence(ref.relativeRef, opts.block, {
      now: opts.now,
      googleEvents: opts.googleEvents,
    });
    if (r.status === "resolved" && r.occurrence) return { occurrence: r.occurrence };
    if (r.status === "out_of_term") {
      return { issue: "cancel_out_of_term", detail: "the referenced occurrence is outside the class term" };
    }
    return { issue: "cancel_reference_unresolved", detail: "could not resolve which class occurrence to cancel" };
  }
  return { issue: "cancel_reference_unresolved", detail: "a cancellation had no date or reference" };
}

/** Bind a block-built occurrence to a live calendar event when one overlaps. */
function bindIfPossible(occ: ClassOccurrence, opts: PlanMakeupOptions): ClassOccurrence {
  if (!opts.googleEvents?.length) return occ;
  const startMs = Date.parse(occ.startUtc);
  const endMs = Date.parse(occ.endUtc);
  for (const e of opts.googleEvents) {
    if (e.allDay || !e.end) continue;
    const es = Date.parse(e.start);
    const ee = Date.parse(e.end);
    if (Number.isNaN(es) || Number.isNaN(ee)) continue;
    if (es < endMs && ee > startMs) return { ...occ, source: "google_event", eventId: e.id };
  }
  return occ;
}

/**
 * Plan a class cancel + makeup. Order of checks (clarify on the FIRST problem so
 * the user gets one precise question, not a guess):
 *  1. no class matched → can't act.
 *  2. every cancellation ref must resolve to a concrete occurrence.
 *  3. makeup dates need at least one valid time range, and a defined date↔time
 *     mapping (the 4-dates/2-ranges case clarifies here).
 *  4. otherwise → a planned list of cancel + create_makeup operations.
 */
export function planMakeupClass(
  intent: MakeupClassIntent,
  opts: PlanMakeupOptions,
): MakeupPlan {
  const subject = opts.block?.subject?.trim();
  if (!subject) {
    return clarify("", "no_target_class", "no class was matched for this schedule change");
  }

  const cancellations = intent.cancellations ?? [];
  const makeupDates = (intent.makeupDates ?? []).filter((d) => YMD_RE.test(d));
  const ranges = intent.makeupTimeRanges ?? [];

  if (cancellations.length === 0 && makeupDates.length === 0) {
    return clarify(subject, "nothing_to_do", "no occurrence to cancel and no makeup date given");
  }

  const operations: MakeupOperation[] = [];

  // --- 2. Cancellations ---
  for (const ref of cancellations) {
    const resolved = resolveCancellation(ref, opts);
    if ("issue" in resolved) {
      return clarify(subject, resolved.issue, resolved.detail);
    }
    const occ = resolved.occurrence;
    operations.push({
      kind: "cancel",
      dateLocal: occ.dateLocal,
      startUtc: occ.startUtc,
      endUtc: occ.endUtc,
      eventId: occ.eventId,
      summary: `งดเรียน ${subject} ${occ.dateLocal} ${occ.startUtc.slice(11, 16)}Z`,
    });
  }

  // --- 3. Makeups ---
  if (makeupDates.length > 0) {
    if (ranges.length === 0) {
      return clarify(subject, "makeup_time_missing", `${makeupDates.length} makeup date(s) given but no time range`);
    }
    for (const r of ranges) {
      if (!(r.end_local > r.start_local)) {
        return clarify(subject, "makeup_time_invalid", `time range ${timeLabel(r)} is not start<end`);
      }
    }
    const paired = pairDatesWithRanges(makeupDates, ranges);
    if (!paired) {
      return clarify(
        subject,
        "makeup_date_time_mapping_ambiguous",
        `${makeupDates.length} makeup date(s) but ${ranges.length} time range(s) — mapping is undefined`,
      );
    }
    for (const { dateLocal, range } of paired) {
      operations.push({
        kind: "create_makeup",
        dateLocal,
        startUtc: bangkokToUtc(dateLocal, range.start_local),
        endUtc: bangkokToUtc(dateLocal, range.end_local),
        online: intent.online ?? false,
        summary: `เรียนชด ${subject}${intent.online ? " (ออนไลน์)" : ""} ${dateLocal} ${timeLabel(range)}`,
      });
    }
  }

  if (operations.length === 0) {
    return clarify(subject, "nothing_to_do", "nothing resolved into an operation");
  }
  return { status: "planned", subject, operations };
}

// --- Sprint 4: approval-gated staging ----------------------------------------

/** Why an operation could not be turned into a calendar proposal. */
export type UnstagedReason = "cancel_no_calendar_event";

export interface StagedMakeupPlan {
  /**
   * Calendar proposals for the EXISTING approval queue / dispatcher. These are
   * canonical AiActions (`google_event.create` / `google_event.delete`) — the
   * same shape chat already validates and queues; no new write path is added.
   */
  actions: AiAction[];
  /** One line per action, SAME order — what the user approves. action[i] ↔ summaries[i]. */
  actionSummaries: string[];
  /**
   * Operations that produced NO proposal (e.g. a cancel of a class that has no
   * live calendar event to delete). Reported, never silently dropped, and never
   * shown as an approvable action — so summaries match the staged actions exactly.
   */
  unstaged: { operation: MakeupOperation; reason: UnstagedReason }[];
}

export interface StageMakeupOptions {
  /** Recurring-edit scope for a cancel delete — "instance" only by default so a
   * one-week skip never removes the whole series. */
  cancelScope?: "instance" | "series";
}

/**
 * Map a PLANNED makeup plan to approval-gated calendar proposals. Pure: it builds
 * and VALIDATES each AiAction against the canonical action schema (so anything
 * malformed is rejected here, before it can reach the queue) but performs no IO
 * and dispatches nothing. The chat pipeline hands the returned actions to the
 * same approval path every other proposal uses; Google is written only on
 * approval, and a `google_event.delete` stays confirm-gated by the executor.
 *
 *  - create_makeup → google_event.create (online makeups carry location "ออนไลน์").
 *  - cancel WITH a bound event id → google_event.delete (instance scope) — recoverable
 *    delete behavior + auto-execute toggle remain the executor's call, unchanged.
 *  - cancel WITHOUT an event id → unstaged (nothing on Google to delete).
 *
 * Throws only if a built payload fails the canonical schema — a planning bug, not
 * user input — so a bad proposal can never be queued.
 */
export function stageMakeupPlan(
  plan: MakeupPlan,
  opts: StageMakeupOptions = {},
): StagedMakeupPlan {
  const actions: AiAction[] = [];
  const actionSummaries: string[] = [];
  const unstaged: StagedMakeupPlan["unstaged"] = [];
  if (plan.status !== "planned") return { actions, actionSummaries, unstaged };

  const scope = opts.cancelScope ?? "instance";

  for (const op of plan.operations) {
    if (op.kind === "create_makeup") {
      const action = aiActionSchema.parse({
        action_type: "google_event.create",
        payload: {
          title: `${plan.subject} (เรียนชด)`,
          starts_at: op.startUtc,
          ends_at: op.endUtc,
          ...(op.online ? { location: "ออนไลน์" } : {}),
        },
      });
      actions.push(action);
      actionSummaries.push(op.summary);
      continue;
    }
    // cancel
    if (!op.eventId) {
      unstaged.push({ operation: op, reason: "cancel_no_calendar_event" });
      continue;
    }
    const action = aiActionSchema.parse({
      action_type: "google_event.delete",
      payload: { id: op.eventId, scope },
    });
    actions.push(action);
    actionSummaries.push(op.summary);
  }

  return { actions, actionSummaries, unstaged };
}
