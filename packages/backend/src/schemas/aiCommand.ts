import { z } from "zod";
import { actionPayloadSchemas } from "./approval.js";
import { CLAUDE_MAX_ACTIONS } from "../config.js";

/**
 * Strict schema for the JSON Claude must return in AI command mode (Step 6).
 *
 * Each action is a discriminated union on `action_type`, and every payload is
 * validated by the SAME canonical `actionPayloadSchemas` used by the command
 * bar and the executor — there is exactly one source of truth. Any unknown
 * action type or malformed payload fails validation here, before anything is
 * queued, so an invalid AI response creates zero approvals.
 */
export const aiActionSchema = z.discriminatedUnion("action_type", [
  z.object({
    action_type: z.literal("task.create"),
    payload: actionPayloadSchemas["task.create"],
  }),
  z.object({
    action_type: z.literal("task.update"),
    payload: actionPayloadSchemas["task.update"],
  }),
  z.object({
    action_type: z.literal("task.archive"),
    payload: actionPayloadSchemas["task.archive"],
  }),
  z.object({
    action_type: z.literal("memory.write"),
    payload: actionPayloadSchemas["memory.write"],
  }),
]);
export type AiAction = z.infer<typeof aiActionSchema>;

/**
 * The full envelope. `actions` is capped at CLAUDE_MAX_ACTIONS; an empty array
 * is valid and means "no actionable proposals". `notes` is advisory only and is
 * never executed. `.strict()` rejects any unexpected top-level keys.
 */
export const aiOutputSchema = z
  .object({
    actions: z.array(aiActionSchema).max(CLAUDE_MAX_ACTIONS),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type AiOutput = z.infer<typeof aiOutputSchema>;
