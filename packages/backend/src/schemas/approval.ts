import { z } from "zod";
import { taskStatusSchema } from "./task.js";
import { memoryWritePayloadSchema } from "./memory.js";

/**
 * The ONLY action types the executor will run for now. All are safe, internal,
 * non-destructive operations against the local DB or the whitelisted memory
 * files. Outward/destructive actions are deliberately absent.
 */
export const actionTypeSchema = z.enum([
  "task.create",
  "task.update",
  "task.archive",
  "memory.write",
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
} as const;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** A persisted approval row as returned by the API (payload parsed to object). */
export const approvalSchema = z.object({
  id: z.number().int().positive(),
  action_type: actionTypeSchema,
  payload: z.unknown().nullable(),
  status: approvalStatusSchema,
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
