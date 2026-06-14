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
  AUTO_EXECUTE_ENABLED,
  AUTO_EXECUTE_DESTRUCTIVE_ENABLED,
} from "../config.js";

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
}

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
): Promise<DispatchResult> {
  const approval = createApproval(actionType, payload);

  if (!isAutoExecuteEnabled() || requiresConfirmation(actionType, payload)) {
    return { mode: "pending", approval };
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
    return { mode: "executed", approval: updated };
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
    return { mode: "failed", approval: updated };
  }
}
