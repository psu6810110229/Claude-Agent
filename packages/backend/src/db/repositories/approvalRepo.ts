import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  Approval,
  ActionType,
  ApprovalStatus,
  ExecutionStatus,
} from "../../schemas/approval.js";

/** Raw approval row as stored (payload is TEXT/JSON). */
interface ApprovalRow {
  id: number;
  action_type: ActionType;
  payload: string | null;
  status: ApprovalStatus;
  execution_status: ExecutionStatus;
  executed_at: string | null;
  execution_error: string | null;
  result_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** Parse the stored JSON payload into the API shape. */
function hydrate(row: ApprovalRow): Approval {
  return {
    ...row,
    payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
  };
}

export function listApprovals(): Approval[] {
  const rows = getDb()
    .prepare(
      `SELECT id, action_type, payload, status, execution_status, executed_at,
        execution_error, result_summary, created_at, updated_at
       FROM approval
       ORDER BY id DESC`,
    )
    .all() as ApprovalRow[];
  return rows.map(hydrate);
}

export function getApprovalById(id: number): Approval | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, action_type, payload, status, execution_status, executed_at,
        execution_error, result_summary, created_at, updated_at
       FROM approval
       WHERE id = ?`,
    )
    .get(id) as ApprovalRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function listRecentApprovalOutcomes(limit = 10): Approval[] {
  const rows = getDb()
    .prepare(
      `SELECT id, action_type, payload, status, execution_status, executed_at,
        execution_error, result_summary, created_at, updated_at
       FROM approval
       WHERE execution_status != 'not_started' OR status != 'pending'
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit) as ApprovalRow[];
  return rows.map(hydrate);
}

export function createApproval(
  actionType: ActionType,
  payload: unknown,
): Approval {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      "INSERT INTO approval (action_type, payload, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
    )
    .run(actionType, JSON.stringify(payload), ts, ts);
  return getApprovalById(Number(info.lastInsertRowid))!;
}

export function setApprovalStatus(
  id: number,
  status: ApprovalStatus,
): Approval | undefined {
  const existing = getApprovalById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE approval SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, nowIso(), id);
  return getApprovalById(id);
}

export function markApprovalExecutionSucceeded(
  id: number,
  resultSummary: string,
): Approval | undefined {
  const existing = getApprovalById(id);
  if (!existing) return undefined;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE approval
       SET status = 'approved',
           execution_status = 'succeeded',
           executed_at = ?,
           execution_error = NULL,
           result_summary = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(ts, resultSummary, ts, id);
  return getApprovalById(id);
}

export function markApprovalExecutionFailed(
  id: number,
  errorMessage: string,
): Approval | undefined {
  const existing = getApprovalById(id);
  if (!existing) return undefined;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE approval
       SET execution_status = 'failed',
           executed_at = ?,
           execution_error = ?,
           result_summary = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(ts, errorMessage, ts, id);
  return getApprovalById(id);
}
