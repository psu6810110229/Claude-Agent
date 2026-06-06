import { z } from "zod";
import { approvalSchema } from "./approval.js";

/**
 * POST /api/command body. The raw command-bar string; all parsing is done
 * server-side and deterministically (see services/commandParser).
 */
export const commandRequestSchema = z.object({
  input: z.string().trim().min(1).max(2000),
});
export type CommandRequest = z.infer<typeof commandRequestSchema>;

/** `help` response — supported command examples. */
export const commandHelpResponseSchema = z.object({
  kind: z.literal("help"),
  examples: z.array(z.string()),
});

/** A command that produced an approval proposal (201). */
export const commandProposalResponseSchema = z.object({
  kind: z.literal("proposal"),
  approval: approvalSchema,
});

/** A rejected/invalid command (4xx). */
export const commandErrorResponseSchema = z.object({
  kind: z.literal("error"),
  error: z.string(),
});
