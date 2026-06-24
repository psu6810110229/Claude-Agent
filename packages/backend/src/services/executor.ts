import {
  actionPayloadSchemas,
  type ActionType,
} from "../schemas/approval.js";
import type { MemoryWritePayload } from "../schemas/memory.js";
import type {
  CreateGoogleEventPayload,
  UpdateGoogleEventPayload,
  DeleteGoogleEventPayload,
} from "../schemas/googleCalendar.js";
import { createTask, updateTask, archiveTask } from "../db/repositories/taskRepo.js";
import { writeMemory } from "./memoryStore.js";
import { upsertMemoryEntry } from "../db/repositories/memoryRepo.js";
import {
  createFact,
  updateFact,
  archiveFact,
  getFact,
} from "../db/repositories/factRepo.js";
import type {
  FactRememberPayload,
  FactUpdatePayload,
  FactForgetPayload,
} from "../schemas/fact.js";
import {
  createEvent,
  updateEvent,
  archiveEvent,
} from "../db/repositories/eventRepo.js";
import {
  createReminder,
  updateReminder,
  completeReminder,
  archiveReminder,
} from "../db/repositories/reminderRepo.js";
import {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  GoogleCalendarError,
} from "./googleCalendar.js";
import { invalidateGoogleCache } from "./googleCalendarCache.js";
import {
  createGmailDraft,
  sendGmailEmail,
  GmailError,
} from "./gmail.js";
import type {
  GmailDraftPayload,
  GmailSendPayload,
} from "../schemas/gmail.js";
import { createLineFollowup } from "../db/repositories/lineFollowupRepo.js";
import type { CreateLineFollowupPayload } from "../schemas/lineFollowup.js";
import { createActiveTopic } from "../db/repositories/activeTopicRepo.js";
import type { CreateActiveTopicPayload } from "../schemas/activeTopic.js";
import { nowIso } from "../config.js";
import { getActionMeta } from "./actionRegistry.js";

/** Thrown when an approval cannot be executed (bad payload or unknown target). */
export class ExecutorError extends Error {}

export interface ExecutionResult {
  /** Human-readable summary for the activity log. */
  summary: string;
  /**
   * Prior-state JSON snapshot enabling undo, set only by reversible outward
   * actions (Google update/delete). Persisted as the approval's undo_json.
   */
  undoJson?: string | null;
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
  const meta = getActionMeta(actionType);
  if (
    !meta.policies.includes("approval-required") ||
    meta.policies.includes("disabled")
  ) {
    throw new ExecutorError(`Action ${actionType} is not executable`);
  }

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
    case "reminder.done": {
      const data = parsed.data as { id: number };
      const reminder = completeReminder(data.id);
      if (!reminder) throw new ExecutorError(`reminder #${data.id} not found`);
      return { summary: `completed reminder #${reminder.id}` };
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
        invalidateGoogleCache(); // [L3] write-through: next read reflects it
        return { summary: `created Google Calendar event ${event.id}` };
      } catch (err) {
        if (err instanceof GoogleCalendarError) {
          throw new ExecutorError(err.message);
        }
        throw err;
      }
    }
    case "google_event.update": {
      const data = parsed.data as UpdateGoogleEventPayload;
      try {
        const event = await updateGoogleCalendarEvent(data);
        invalidateGoogleCache(); // [L3] write-through
        return {
          summary: `updated Google Calendar event ${event.id}`,
          undoJson: JSON.stringify(event.undoSnapshot),
        };
      } catch (err) {
        if (err instanceof GoogleCalendarError) {
          throw new ExecutorError(err.message);
        }
        throw err;
      }
    }
    case "google_event.delete": {
      const data = parsed.data as DeleteGoogleEventPayload;
      try {
        const event = await deleteGoogleCalendarEvent(data);
        invalidateGoogleCache(); // [L3] write-through
        return {
          summary: `deleted Google Calendar event ${event.id}`,
          undoJson: JSON.stringify(event.undoSnapshot),
        };
      } catch (err) {
        if (err instanceof GoogleCalendarError) {
          throw new ExecutorError(err.message);
        }
        throw err;
      }
    }
    case "fact.remember": {
      const data = parsed.data as FactRememberPayload;
      // createFact dedupes an identical active fact (touches updated_at).
      const fact = createFact(data, "chat");
      return { summary: `remembered fact #${fact.id}` };
    }
    case "fact.update": {
      const data = parsed.data as FactUpdatePayload;
      const { id, ...fields } = data;
      const prior = getFact(id);
      if (!prior) throw new ExecutorError(`fact #${id} not found`);
      const fact = updateFact(id, fields);
      if (!fact) throw new ExecutorError(`fact #${id} not found`);
      // Snapshot prior state so the edit is recoverable (like google update).
      return {
        summary: `updated fact #${fact.id}`,
        undoJson: JSON.stringify(prior),
      };
    }
    case "fact.forget": {
      const data = parsed.data as FactForgetPayload;
      const prior = getFact(data.id);
      if (!prior) throw new ExecutorError(`fact #${data.id} not found`);
      const fact = archiveFact(data.id);
      if (!fact) throw new ExecutorError(`fact #${data.id} not found`);
      // Soft-archive only; snapshot enables restore.
      return {
        summary: `forgot fact #${fact.id}`,
        undoJson: JSON.stringify(prior),
      };
    }
    case "gmail.draft": {
      const data = parsed.data as GmailDraftPayload;
      try {
        const draft = await createGmailDraft(data);
        return { summary: `created Gmail draft ${draft.draftId} to ${data.to}` };
      } catch (err) {
        if (err instanceof GmailError) throw new ExecutorError(err.message);
        throw err;
      }
    }
    case "gmail.send": {
      const data = parsed.data as GmailSendPayload;
      try {
        const sent = await sendGmailEmail(data);
        return { summary: `sent Gmail email ${sent.messageId} to ${data.to}` };
      } catch (err) {
        if (err instanceof GmailError) throw new ExecutorError(err.message);
        throw err;
      }
    }
    case "line_followup.create": {
      const data = parsed.data as CreateLineFollowupPayload;
      // baseline_at is fixed to creation time so the scheduled check only ever
      // surfaces messages that arrive AFTER the user asked for the follow-up.
      // This writes a LOCAL row only — it never touches LINE.
      const watch = createLineFollowup({
        topic: data.topic,
        keywords: data.keywords,
        chat_filter: data.chat_filter ?? null,
        due_at: data.due_at,
        baseline_at: nowIso(),
      });
      return { summary: `created LINE follow-up watch #${watch.id}` };
    }
    case "active_topic.create": {
      const data = parsed.data as CreateActiveTopicPayload;
      // baseline_at set here (NOT trusted from model), created_from hardcoded
      // to "chat" for this code path. This writes a LOCAL row only — it never
      // reads live LINE, never sends/replies, never touches external services.
      const topic = createActiveTopic({
        title: data.title,
        source: data.source,
        keywords: data.keywords,
        chat_filter: data.chat_filter ?? null,
        priority: data.priority ?? 50,
        cooldown_minutes: data.cooldown_minutes ?? 30,
        baseline_at: nowIso(),
        created_from: "chat",
      });
      return { summary: `created active topic #${topic.id}` };
    }
  }
}
