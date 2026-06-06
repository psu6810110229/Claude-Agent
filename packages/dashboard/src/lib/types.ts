/**
 * Types hand-mirrored from the backend Zod schemas (packages/backend/src/schemas).
 * Kept in sync manually for now; a shared types package is a later step.
 */

export type TaskStatus = "open" | "done" | "archived";

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

/** PATCH /api/tasks/:id — `archived` is intentionally not settable here. */
export interface UpdateTaskBody {
  title?: string;
  status?: "open" | "done";
}

export type ActionType =
  | "task.create"
  | "task.update"
  | "task.archive"
  | "memory.write";

// --- Memory ---------------------------------------------------------------

export type MemoryTarget =
  | "preferences"
  | "routines"
  | "projects"
  | "decisions";

export type MemoryWriteMode = "append" | "replace";

export interface MemoryEntry {
  id: number;
  slug: string;
  path: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryContent {
  target: MemoryTarget;
  path: string;
  exists: boolean;
  content: string;
}

/** POST /api/memory/proposals body. */
export interface CreateMemoryProposalBody {
  target: MemoryTarget;
  mode: MemoryWriteMode;
  content: string;
  summary?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: number;
  action_type: ActionType;
  payload: unknown;
  status: ApprovalStatus;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  event_type: string;
  detail: string | null;
  created_at: string;
}

// --- Command bar ----------------------------------------------------------

/** POST /api/command — which path the backend should take. */
export type CommandMode = "deterministic" | "ai";

/**
 * POST /api/command result (2xx shapes). Error responses arrive as 4xx/5xx and
 * are surfaced via ApiError by the client, so callers handle them in a catch
 * block rather than as a returned value.
 *
 * - `help`     — deterministic mode help listing.
 * - `proposal` — deterministic mode: exactly one queued approval (`approval`).
 *                AI mode: zero-or-more queued approvals (`approvals`). The two
 *                paths use different field names, so both are optional here and
 *                the consumer reads whichever is present.
 * - `none`     — AI mode produced valid output but no actionable proposals.
 */
export type CommandResult =
  | { kind: "help"; examples: string[] }
  | { kind: "proposal"; approval?: Approval; approvals?: Approval[] }
  | { kind: "none"; message: string };
