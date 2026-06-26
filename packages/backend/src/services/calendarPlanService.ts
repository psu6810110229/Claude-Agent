import {
  createCalendarPlan,
  getCalendarPlanById,
  listCalendarPlanItems,
  setCalendarPlanItemStatus,
  setCalendarPlanStatus,
  type CreateCalendarPlanItemInput,
} from "../db/repositories/calendarPlanRepo.js";
import {
  createApproval,
  markApprovalExecutionFailed,
  markApprovalExecutionSucceeded,
} from "../db/repositories/approvalRepo.js";
import { executeAction, ExecutorError } from "./executor.js";
import {
  findCreateConflicts,
  type CreateConflictInput,
  type EventConflict,
} from "./eventConflicts.js";
import { getSchedulePrefs } from "./schedulePrefs.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";
import type {
  CalendarBulkCreatePayload,
  CalendarPlan,
  CalendarPlanItem,
} from "../schemas/calendarPlan.js";

/**
 * Calendar bulk-create plan orchestration — keeps the route thin and the rules
 * testable. Building the plan runs a per-item conflict scan against the live
 * calendar; approving it dispatches each SELECTED, non-blocked item as a real
 * google_event.create write (with an audit approval row, exactly like the manual
 * approve route). A clash is never silently dropped: a conflicting item is only
 * created when the user explicitly set "create anyway", otherwise it is reported
 * back as skipped so the user always knows it was not added.
 */

export class CalendarPlanError extends Error {
  constructor(
    public readonly code: "not-found" | "not-pending",
    message: string,
  ) {
    super(message);
    this.name = "CalendarPlanError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Collapse one item's clashes into a display snapshot (null when none). */
function snapshotConflict(
  conflicts: EventConflict[],
): { with: string | null; detail: string | null } | null {
  if (conflicts.length === 0) return null;
  const titles = Array.from(
    new Set(conflicts.map((c) => c.withTitle).filter((t) => t.length > 0)),
  );
  const detail = conflicts.map((c) => c.detail).join("; ");
  return { with: titles.join(", ") || null, detail: detail || null };
}

/**
 * Fetch the live calendar ONCE over the union range of all items (±1 day for
 * cross-midnight buffers) so conflict detection is one round trip, not N. Fails
 * closed to [] (no warnings) on any calendar error — unchanged-behaviour safety.
 */
async function fetchWindowFor(
  items: { starts_at: string; ends_at: string }[],
  fetchGoogle: GoogleEventsFetcher,
): Promise<GoogleEvent[]> {
  const starts = items.map((i) => Date.parse(i.starts_at)).filter((n) => !Number.isNaN(n));
  const ends = items.map((i) => Date.parse(i.ends_at)).filter((n) => !Number.isNaN(n));
  if (starts.length === 0 || ends.length === 0) return [];
  const minIso = new Date(Math.min(...starts) - DAY_MS).toISOString();
  const maxIso = new Date(Math.max(...ends) + DAY_MS).toISOString();
  try {
    return await fetchGoogle(minIso, maxIso);
  } catch {
    return [];
  }
}

/** Conflicts for one proposed item against the prefetched calendar window. */
function conflictsFor(
  item: CreateConflictInput,
  windowEvents: GoogleEvent[],
): EventConflict[] {
  try {
    return findCreateConflicts(item, windowEvents, getSchedulePrefs());
  } catch {
    return [];
  }
}

/**
 * Build a staging plan from a bulk-create payload: scan each item for a clash
 * with the live calendar, then persist the plan + items. Writes NOTHING to
 * Google. Returns the plan and its items for the review card.
 */
export async function buildCalendarPlan(
  payload: CalendarBulkCreatePayload,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): Promise<{ plan: CalendarPlan; items: CalendarPlanItem[] }> {
  const windowEvents = await fetchWindowFor(payload.items, fetchGoogle);
  const itemInputs: CreateCalendarPlanItemInput[] = payload.items.map((it) => {
    const conflicts = conflictsFor(it, windowEvents);
    const snap = snapshotConflict(conflicts);
    return {
      title: it.title,
      starts_at: it.starts_at,
      ends_at: it.ends_at,
      location: it.location ?? null,
      notes: it.notes ?? null,
      conflict_with: snap?.with ?? null,
      conflict_detail: snap?.detail ?? null,
      status: snap ? "conflict" : "ready",
    };
  });
  return createCalendarPlan(payload.note, itemInputs);
}

export interface ApproveCalendarPlanResult {
  /** Items created on Google (with their result summary). */
  created: { id: number; title: string }[];
  /** Selected items NOT created because of a clash and no "create anyway". */
  skippedConflict: { id: number; title: string; conflict_with: string | null }[];
  /** Items the user had deselected. */
  rejected: number;
  /** Items whose Google create failed (with the real error). */
  failed: { id: number; title: string; error: string }[];
}

/**
 * Approve a pending plan. For each item:
 *  - deselected            -> rejected (skip).
 *  - clash + no override    -> skipped (reported; NEVER silently dropped).
 *  - otherwise              -> google_event.create via the executor.
 * Conflicts are RE-CHECKED here (authority), so an item whose time the user
 * edited to avoid a clash is created without needing the override.
 */
export async function approveCalendarPlan(
  planId: number,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): Promise<ApproveCalendarPlanResult> {
  const plan = getCalendarPlanById(planId);
  if (!plan) throw new CalendarPlanError("not-found", "ไม่พบแผนปฏิทิน");
  if (plan.status !== "pending") {
    throw new CalendarPlanError("not-pending", "แผนนี้ถูกดำเนินการไปแล้ว");
  }

  const items = listCalendarPlanItems(planId);
  const selected = items.filter((i) => i.selected === 1);
  const windowEvents = await fetchWindowFor(selected, fetchGoogle);

  const result: ApproveCalendarPlanResult = {
    created: [],
    skippedConflict: [],
    rejected: 0,
    failed: [],
  };

  for (const item of items) {
    if (item.selected !== 1) {
      setCalendarPlanItemStatus(item.id, "rejected");
      result.rejected++;
      continue;
    }
    const payload: CreateConflictInput = {
      title: item.title,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      location: item.location ?? undefined,
      notes: item.notes ?? undefined,
    };
    const conflicts = conflictsFor(payload, windowEvents);
    if (conflicts.length > 0 && item.override_conflict !== 1) {
      setCalendarPlanItemStatus(item.id, "skipped");
      result.skippedConflict.push({
        id: item.id,
        title: item.title,
        conflict_with: snapshotConflict(conflicts)?.with ?? item.conflict_with,
      });
      continue;
    }
    // Execute the create with an audit approval row — same path the manual
    // approve route uses, so a plan-created event is indistinguishable in storage.
    const approval = createApproval("google_event.create", {
      title: item.title,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      ...(item.location ? { location: item.location } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    });
    try {
      const exec = await executeAction("google_event.create", approval.payload);
      markApprovalExecutionSucceeded(approval.id, exec.summary, exec.undoJson ?? null);
      setCalendarPlanItemStatus(item.id, "created");
      result.created.push({ id: item.id, title: item.title });
    } catch (err) {
      const message =
        err instanceof ExecutorError || err instanceof Error
          ? err.message
          : String(err);
      markApprovalExecutionFailed(approval.id, message);
      // Leave the item non-terminal so a transient failure can be retried.
      result.failed.push({ id: item.id, title: item.title, error: message });
    }
  }

  // Finalize the plan only when nothing is left to retry.
  if (result.failed.length === 0) {
    setCalendarPlanStatus(planId, "approved");
  }
  return result;
}

/** Discard a pending plan (user chose "ไม่เอาเลย"). Idempotent-ish guard. */
export function discardCalendarPlan(planId: number): void {
  const plan = getCalendarPlanById(planId);
  if (!plan) throw new CalendarPlanError("not-found", "ไม่พบแผนปฏิทิน");
  if (plan.status !== "pending") {
    throw new CalendarPlanError("not-pending", "แผนนี้ถูกดำเนินการไปแล้ว");
  }
  for (const item of listCalendarPlanItems(planId)) {
    if (item.status === "ready" || item.status === "conflict") {
      setCalendarPlanItemStatus(item.id, "rejected");
    }
  }
  setCalendarPlanStatus(planId, "discarded");
}
