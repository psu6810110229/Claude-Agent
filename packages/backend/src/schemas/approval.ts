import { z } from "zod";
import { taskStatusSchema } from "./task.js";
import { memoryWritePayloadSchema } from "./memory.js";
import {
  createEventPayloadSchema,
  updateEventPayloadSchema,
  archiveEventPayloadSchema,
} from "./event.js";
import {
  createReminderPayloadSchema,
  updateReminderPayloadSchema,
  doneReminderPayloadSchema,
  archiveReminderPayloadSchema,
} from "./reminder.js";
import {
  createGoogleEventPayloadSchema,
  updateGoogleEventPayloadSchema,
  deleteGoogleEventPayloadSchema,
} from "./googleCalendar.js";
import {
  factRememberPayloadSchema,
  factUpdatePayloadSchema,
  factForgetPayloadSchema,
} from "./fact.js";
import {
  gmailDraftPayloadSchema,
  gmailSendPayloadSchema,
} from "./gmail.js";

/**
 * The ONLY action types the executor will run. Most are internal operations
 * against the local DB or the whitelisted memory files. The outward Google
 * Calendar actions (create/update/delete, Step 14) are approval-gated; delete
 * is additionally always confirm-gated and never auto-executed.
 */
export const actionTypeSchema = z.enum([
  "task.create",
  "task.update",
  "task.archive",
  "memory.write",
  "event.create",
  "event.update",
  "event.archive",
  "reminder.create",
  "reminder.update",
  "reminder.done",
  "reminder.archive",
  "google_event.create",
  "google_event.update",
  "google_event.delete",
  "fact.remember",
  "fact.update",
  "fact.forget",
  "gmail.draft",
  "gmail.send",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

/** Per-action payload validation (used at propose time and before execution). */
export const actionPayloadSchemas = {
  "task.create": z.object({
    title: z.string().trim().min(1).max(500),
    status: taskStatusSchema.optional(),
  }),
  "task.update": z
    .object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(500).optional(),
      status: z.enum(["open", "done"]).optional(),
    })
    .refine((v) => v.title !== undefined || v.status !== undefined, {
      message: "At least one of 'title' or 'status' must be provided",
    }),
  "task.archive": z.object({
    id: z.number().int().positive(),
  }),
  "memory.write": memoryWritePayloadSchema,
  "event.create": createEventPayloadSchema,
  "event.update": updateEventPayloadSchema,
  "event.archive": archiveEventPayloadSchema,
  "reminder.create": createReminderPayloadSchema,
  "reminder.update": updateReminderPayloadSchema,
  "reminder.done": doneReminderPayloadSchema,
  "reminder.archive": archiveReminderPayloadSchema,
  "google_event.create": createGoogleEventPayloadSchema,
  "google_event.update": updateGoogleEventPayloadSchema,
  "google_event.delete": deleteGoogleEventPayloadSchema,
  "fact.remember": factRememberPayloadSchema,
  "fact.update": factUpdatePayloadSchema,
  "fact.forget": factForgetPayloadSchema,
  "gmail.draft": gmailDraftPayloadSchema,
  "gmail.send": gmailSendPayloadSchema,
} as const;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const executionStatusSchema = z.enum([
  "not_started",
  "succeeded",
  "failed",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** A persisted approval row as returned by the API (payload parsed to object). */
export const approvalSchema = z.object({
  id: z.number().int().positive(),
  action_type: actionTypeSchema,
  payload: z.unknown().nullable(),
  status: approvalStatusSchema,
  execution_status: executionStatusSchema,
  executed_at: z.string().nullable(),
  execution_error: z.string().nullable(),
  result_summary: z.string().nullable(),
  /** Prior-state JSON snapshot for reversible undo (Step 14). Null otherwise. */
  undo_json: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalListResponseSchema = z.object({
  approvals: z.array(approvalSchema),
});

/** POST /api/approvals body — validated per action type via superRefine. */
export const createApprovalBodySchema = z
  .object({
    action_type: actionTypeSchema,
    payload: z.unknown(),
  })
  .superRefine((val, ctx) => {
    const schema = actionPayloadSchemas[val.action_type];
    const result = schema.safeParse(val.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", ...issue.path],
          message: issue.message,
        });
      }
    }
  });
export type CreateApprovalBody = z.infer<typeof createApprovalBodySchema>;
