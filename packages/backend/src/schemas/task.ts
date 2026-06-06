import { z } from "zod";

/** Allowed task statuses (validated by convention; no schema CHECK). */
export const taskStatusSchema = z.enum(["open", "done", "archived"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** A persisted task row as returned by the API. */
export const taskSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: taskStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskListResponseSchema = z.object({
  tasks: z.array(taskSchema),
});

/** POST /api/tasks body. */
export const createTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  status: taskStatusSchema.optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

/**
 * PATCH /api/tasks/:id body. At least one field required.
 * `archived` is intentionally NOT settable here — archiving has its own route.
 */
export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["open", "done"]).optional(),
  })
  .refine((v) => v.title !== undefined || v.status !== undefined, {
    message: "At least one of 'title' or 'status' must be provided",
  });
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;
