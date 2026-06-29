import type { ActionType, Approval } from "../schemas/approval.js";
import {
  createApproval,
  markApprovalExecutionSucceeded,
  markApprovalExecutionFailed,
} from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { executeAction, ExecutorError } from "./executor.js";
import { getActionMeta } from "./actionRegistry.js";
import {
  makeCreateConflictChecker,
  type CreateConflictChecker,
  type CreateConflictInput,
  type EventConflict,
} from "./eventConflicts.js";
import {
  findConstraintViolations,
  type ConstraintViolation,
  type ProposedItem,
} from "./availabilityResolver.js";
import { resolveScheduleConstraints } from "./scheduleConstraints.js";
import { getSchedulePrefs } from "./schedulePrefs.js";
import {
  AUTO_EXECUTE_ENABLED,
  AUTO_EXECUTE_DESTRUCTIVE_ENABLED,
} from "../config.js";
import type { ScheduleTargetTag } from "../schemas/scheduleConstraint.js";
import { classifyProposedActionTarget } from "./scheduleTargetClassifier.js";

/**
 * Whether auto-execute is on. A runtime DB override (Settings page, key
 * `auto_execute_enabled`) wins; otherwise falls back to the env-var default.
 * Read per-dispatch so the Settings toggle takes effect without a restart.
 */
export function isAutoExecuteEnabled(): boolean {
  const dbValue = getConfigBool("auto_execute_enabled");
  if (dbValue !== null) return dbValue;
  return AUTO_EXECUTE_ENABLED;
}

/**
 * Whether RECOVERABLE destructive actions may auto-execute. Runtime DB override
 * (Settings key `auto_execute_destructive_enabled`) wins; else env default.
 * Read per-dispatch so the Settings toggle takes effect without a restart.
 */
export function isAutoExecuteDestructiveEnabled(): boolean {
  const dbValue = getConfigBool("auto_execute_destructive_enabled");
  if (dbValue !== null) return dbValue;
  return AUTO_EXECUTE_DESTRUCTIVE_ENABLED;
}

/**
 * Destructive actions that are RECOVERABLE (executor snapshots prior state into
 * `undo_json`) and therefore eligible to auto-execute when both auto-execute and
 * the destructive-auto-execute toggle are on. Deliberately narrow: archive +
 * memory-replace are excluded and always stay confirm-gated.
 */
const RECOVERABLE_DESTRUCTIVE_TYPES: ReadonlySet<ActionType> =
  new Set<ActionType>(["google_event.delete"]);

/**
 * Step 14 — action dispatcher.
 *
 * Single chokepoint that turns a *proposed* action into either an executed
 * action or a pending approval. Every proposal still creates an approval row
 * (the audit trail). The decision is deterministic:
 *
 *   - Auto-execute OFF .................... stays pending (legacy behaviour).
 *   - Action requires confirmation ........ stays pending (must be confirmed).
 *   - Otherwise ........................... executes now; reports the REAL
 *                                            executor outcome (never fakes it).
 *
 * Execution still goes through `executeAction` (the single execution gate) and
 * the same `mark...` repo functions the manual approve route uses, so an
 * auto-executed row is indistinguishable from a hand-approved one in storage.
 */

export type DispatchMode = "executed" | "failed" | "pending";

export interface DispatchResult {
  mode: DispatchMode;
  approval: Approval;
  /**
   * Create-time scheduling clashes detected for this action (empty for non-create
   * actions or when none were found). A non-empty list forces the action to stay
   * pending so the user is warned and confirms before it lands on the calendar.
   */
  conflicts: EventConflict[];
  /**
   * Step 27 / Sprint 4 (RC7) — protected-window / class-block violations for a
   * timed reminder/event create or update. A non-empty list forces the action to
   * stay pending (held for confirm) so a constraint-violating write is never
   * auto-executed and reported as done. Empty for untimed/non-applicable actions.
   */
  constraintViolations: ConstraintViolation[];
}

/** Action types whose proposed time is gated against sticky constraints. */
const CONSTRAINT_GATED_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "reminder.create",
  "reminder.update",
  "event.create",
  "event.update",
  "google_event.create",
  "google_event.update",
]);

/**
 * Pull the proposed time interval out of a payload for the constraint gate.
 * Returns null when the action carries no concrete start time (e.g. a
 * title/notes-only update) — nothing to validate against a window.
 */
function extractProposedItem(
  actionType: ActionType,
  payload: unknown,
): ProposedItem | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const title = typeof p.title === "string" ? p.title : "รายการ";
  if (actionType === "reminder.create" || actionType === "reminder.update") {
    const due = p.due_at;
    if (typeof due !== "string") return null;
    return { title, startUtc: due };
  }
  // event / google_event create + update
  const start = p.starts_at;
  if (typeof start !== "string") return null;
  const end = typeof p.ends_at === "string" ? p.ends_at : null;
  return { title, startUtc: start, endUtc: end };
}

/** A proposed-time → constraint-violations checker (reads facts; pure thereafter). */
export type ConstraintChecker = (
  item: ProposedItem,
  target: ScheduleTargetTag | null,
) => ConstraintViolation[];

/**
 * Default constraint checker: resolves the sticky tank/class constraints from
 * facts and tests the proposed time against them. FAILS CLOSED to `[]` (no hold,
 * unchanged behaviour) on any error so a fact/parse problem never blocks a write.
 */
const defaultConstraintChecker: ConstraintChecker = (item, target) => {
  try {
    return findConstraintViolations(
      item,
      resolveScheduleConstraints(),
      new Date(),
      getSchedulePrefs(),
      target,
    );
  } catch {
    return [];
  }
};

/**
 * Default create-conflict checker (reads the live calendar via the real Google
 * fetcher). Built once; tests inject their own via the dispatch options. Fails
 * closed to `[]` so a calendar error never blocks a create.
 */
const defaultCreateConflictChecker: CreateConflictChecker =
  makeCreateConflictChecker();

/**
 * Local-DB archives are reversible-ish but treated as confirm-required. Fact
 * edits/forgets are the "replace/forget ยืนยัน" case (Step 16): editing or
 * removing an existing memory always needs an explicit confirm, even with
 * auto-execute on. `fact.remember` (append a new fact) is NOT here, so it
 * auto-executes when auto-execute is on.
 */
const ALWAYS_CONFIRM_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "task.archive",
  "event.archive",
  "reminder.archive",
  "fact.update",
  "fact.forget",
  // Sent email cannot be recalled — always require explicit confirm regardless
  // of auto-execute setting. gmail.draft is NOT here and may auto-execute.
  "gmail.send",
]);

/**
 * Whether an action must be explicitly confirmed and therefore must NOT be
 * auto-executed. Destructive (data-losing/irreversible) or archive actions, and
 * memory writes that replace (vs append) existing content.
 */
export function requiresConfirmation(
  actionType: ActionType,
  payload: unknown,
): boolean {
  if (getActionMeta(actionType).policies.includes("destructive")) {
    // Recoverable destructive (e.g. google_event.delete) may auto-execute when
    // the opt-in toggle is on; it still snapshots undo_json for recovery.
    if (
      isAutoExecuteDestructiveEnabled() &&
      RECOVERABLE_DESTRUCTIVE_TYPES.has(actionType)
    ) {
      return false;
    }
    return true;
  }
  if (ALWAYS_CONFIRM_TYPES.has(actionType)) return true;
  if (
    actionType === "memory.write" &&
    typeof payload === "object" &&
    payload !== null &&
    (payload as { mode?: unknown }).mode === "replace"
  ) {
    return true;
  }
  return false;
}

/**
 * Dispatch one proposed action. Never throws for an execution failure: a bad
 * action is recorded as failed (and reported truthfully) so one failure can't
 * abort a whole proposal batch.
 */
export async function dispatchProposedAction(
  actionType: ActionType,
  payload: unknown,
  source: string,
  opts: {
    conflictChecker?: CreateConflictChecker;
    constraintChecker?: ConstraintChecker;
  } = {},
): Promise<DispatchResult> {
  // Create-time conflict detection: for a NEW Google event, check it against the
  // live calendar. A real clash (overlap / too-tight buffer) forces a confirm so
  // the create can never auto-execute silently over an existing commitment.
  // Computed even when already pending so the warning can be surfaced. Fails
  // closed to [] (no warning, unchanged behaviour).
  let conflicts: EventConflict[] = [];
  if (actionType === "google_event.create") {
    const checker = opts.conflictChecker ?? defaultCreateConflictChecker;
    try {
      conflicts = await checker(payload as CreateConflictInput);
    } catch {
      conflicts = [];
    }
  }

  // Step 27 / Sprint 4 — constraint gate (RC7): a timed reminder/event create or
  // update whose time falls inside a protected window (tank) or recurring block
  // (class) is HELD for confirm — same hold mechanism as the Google-event clash —
  // so a constraint-violating write is never auto-executed and reported as done.
  let constraintViolations: ConstraintViolation[] = [];
  if (CONSTRAINT_GATED_TYPES.has(actionType)) {
    const item = extractProposedItem(actionType, payload);
    if (item) {
      const checker = opts.constraintChecker ?? defaultConstraintChecker;
      const target = classifyProposedActionTarget(actionType, payload);
      try {
        constraintViolations = checker(item, target);
      } catch {
        constraintViolations = [];
      }
    }
  }

  const approval = createApproval(actionType, payload);

  const mustConfirm =
    requiresConfirmation(actionType, payload) ||
    conflicts.length > 0 ||
    constraintViolations.length > 0;
  if (!isAutoExecuteEnabled() || mustConfirm) {
    if (conflicts.length > 0 || constraintViolations.length > 0) {
      logActivity(
        "action.conflict_held",
        `approval #${approval.id} (${actionType}) from ${source}: ${conflicts.length} clash(es), ${constraintViolations.length} constraint-violation(s) — held for confirm`,
      );
    }
    return { mode: "pending", approval, conflicts, constraintViolations };
  }

  try {
    const result = await executeAction(actionType, approval.payload);
    const updated =
      markApprovalExecutionSucceeded(
        approval.id,
        result.summary,
        result.undoJson ?? null,
      ) ?? approval;
    logActivity(
      "action.auto_executed",
      `approval #${approval.id} (${actionType}) from ${source}: ${result.summary}`,
    );
    return { mode: "executed", approval: updated, conflicts, constraintViolations };
  } catch (err) {
    const message =
      err instanceof ExecutorError || err instanceof Error
        ? err.message
        : String(err);
    const updated =
      markApprovalExecutionFailed(approval.id, message) ?? approval;
    logActivity(
      "action.auto_failed",
      `approval #${approval.id} (${actionType}) from ${source}: ${message}`,
    );
    return { mode: "failed", approval: updated, conflicts, constraintViolations };
  }
}
