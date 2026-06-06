import { z } from "zod";
import { approvalSchema } from "./approval.js";

/**
 * POST /api/command body. The raw command-bar string. `mode` selects the path:
 * - "deterministic" (default): pure server-side parsing (Step 5), no LLM.
 * - "ai": Claude reasoning runtime (Step 6) — proposal-only, approval-gated.
 * Either way, nothing executes here; mutating intents become pending approvals.
 */
export const commandRequestSchema = z.object({
  input: z.string().trim().min(1).max(2000),
  mode: z.enum(["deterministic", "ai"]).default("deterministic"),
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

/** An AI command that produced one or more approval proposals (201). */
export const commandAiProposalResponseSchema = z.object({
  kind: z.literal("proposal"),
  approvals: z.array(approvalSchema),
});

/** A valid AI command that produced no actionable proposals (200). */
export const commandNoneResponseSchema = z.object({
  kind: z.literal("none"),
  message: z.string(),
});

/** A rejected/invalid/failed command (4xx/5xx). */
export const commandErrorResponseSchema = z.object({
  kind: z.literal("error"),
  error: z.string(),
});
