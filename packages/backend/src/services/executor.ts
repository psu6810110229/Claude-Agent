import {
  actionPayloadSchemas,
  type ActionType,
} from "../schemas/approval.js";
import type { MemoryWritePayload } from "../schemas/memory.js";
import { createTask, updateTask, archiveTask } from "../db/repositories/taskRepo.js";
import { writeMemory } from "./memoryStore.js";
import { upsertMemoryEntry } from "../db/repositories/memoryRepo.js";

/** Thrown when an approval cannot be executed (bad payload or unknown target). */
export class ExecutorError extends Error {}

export interface ExecutionResult {
  /** Human-readable summary for the activity log. */
  summary: string;
}

/**
 * Executes one approved internal action. This is the approval boundary: only
 * the action types in `actionPayloadSchemas` can run, and each payload is
 * re-validated here before touching the DB. No outward/destructive actions.
 */
export function executeAction(
  actionType: ActionType,
  payload: unknown,
): ExecutionResult {
  const parsed = actionPayloadSchemas[actionType].safeParse(payload);
  if (!parsed.success) {
    throw new ExecutorError(
      `Invalid payload for ${actionType}: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }

  switch (actionType) {
    case "task.create": {
      const data = parsed.data as { title: string; status?: "open" | "done" | "archived" };
      const task = createTask(data.title, data.status);
      return { summary: `created task #${task.id}` };
    }
    case "task.update": {
      const data = parsed.data as {
        id: number;
        title?: string;
        status?: "open" | "done";
      };
      const task = updateTask(data.id, { title: data.title, status: data.status });
      if (!task) throw new ExecutorError(`task #${data.id} not found`);
      return { summary: `updated task #${task.id}` };
    }
    case "task.archive": {
      const data = parsed.data as { id: number };
      const task = archiveTask(data.id);
      if (!task) throw new ExecutorError(`task #${data.id} not found`);
      return { summary: `archived task #${task.id}` };
    }
    case "memory.write": {
      const data = parsed.data as MemoryWritePayload;
      // Confined to the whitelisted memory file for this target.
      const relPath = writeMemory(data.target, data.mode, data.content);
      upsertMemoryEntry(data.target, relPath, data.summary ?? null);
      return { summary: `${data.mode} memory '${data.target}' (${relPath})` };
    }
  }
}
