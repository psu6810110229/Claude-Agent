import {
  actionPayloadSchemas,
  type ActionType,
} from "../schemas/approval.js";
import type { MemoryWritePayload } from "../schemas/memory.js";
import type { CreateGoogleEventPayload } from "../schemas/googleCalendar.js";
import { createTask, updateTask, archiveTask } from "../db/repositories/taskRepo.js";
import { writeMemory } from "./memoryStore.js";
import { upsertMemoryEntry } from "../db/repositories/memoryRepo.js";
import {
  createEvent,
  updateEvent,
  archiveEvent,
} from "../db/repositories/eventRepo.js";
import {
  createReminder,
  updateReminder,
  archiveReminder,
} from "../db/repositories/reminderRepo.js";
import {
  createGoogleCalendarEvent,
  GoogleCalendarError,
} from "./googleCalendar.js";

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
export async function executeAction(
  actionType: ActionType,
  payload: unknown,
): Promise<ExecutionResult> {
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
    case "event.create": {
      const data = parsed.data as {
        title: string;
        starts_at: string;
        ends_at?: string;
        location?: string;
        notes?: string;
      };
      const event = createEvent(data);
      return { summary: `created event #${event.id}` };
    }
    case "event.update": {
      const data = parsed.data as {
        id: number;
        title?: string;
        starts_at?: string;
        ends_at?: string;
        location?: string;
        notes?: string;
      };
      const { id, ...fields } = data;
      const event = updateEvent(id, fields);
      if (!event) throw new ExecutorError(`event #${id} not found`);
      return { summary: `updated event #${event.id}` };
    }
    case "event.archive": {
      const data = parsed.data as { id: number };
      const event = archiveEvent(data.id);
      if (!event) throw new ExecutorError(`event #${data.id} not found`);
      return { summary: `archived event #${event.id}` };
    }
    case "reminder.create": {
      const data = parsed.data as {
        title: string;
        due_at: string;
        notes?: string;
      };
      const reminder = createReminder(data);
      return { summary: `created reminder #${reminder.id}` };
    }
    case "reminder.update": {
      const data = parsed.data as {
        id: number;
        title?: string;
        due_at?: string;
        notes?: string;
      };
      const { id, ...fields } = data;
      const reminder = updateReminder(id, fields);
      if (!reminder) throw new ExecutorError(`reminder #${id} not found`);
      return { summary: `updated reminder #${reminder.id}` };
    }
    case "reminder.archive": {
      const data = parsed.data as { id: number };
      const reminder = archiveReminder(data.id);
      if (!reminder) throw new ExecutorError(`reminder #${data.id} not found`);
      return { summary: `archived reminder #${reminder.id}` };
    }
    case "google_event.create": {
      const data = parsed.data as CreateGoogleEventPayload;
      try {
        const event = await createGoogleCalendarEvent(data);
        return { summary: `created Google Calendar event ${event.id}` };
      } catch (err) {
        if (err instanceof GoogleCalendarError) {
          throw new ExecutorError(err.message);
        }
        throw err;
      }
    }
  }
}
