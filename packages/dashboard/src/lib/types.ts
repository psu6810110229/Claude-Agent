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
