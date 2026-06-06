import { z } from "zod";
import { aiActionSchema } from "./aiCommand.js";
import { CLAUDE_MAX_ACTIONS } from "../config.js";

/**
 * Strict schema for the JSON Claude must return for a brief (Step 8).
 *
 * A brief is PROPOSAL-ONLY, exactly like AI command mode: the human-readable
 * `summary` is the primary product, and `actions` (if any) reuse the SAME
 * canonical `aiActionSchema` / `actionPayloadSchemas` as the command bar and the
 * executor — one source of truth. Any unknown action type, malformed payload, or
 * unexpected top-level key fails validation here, before anything is queued, so
 * an invalid brief response creates zero approvals. `actions` defaults to an
 * empty array (a brief with no proposals is valid).
 */
export const briefTypeSchema = z.enum(["daily", "evening"]);
export type BriefType = z.infer<typeof briefTypeSchema>;

export const briefOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    actions: z.array(aiActionSchema).max(CLAUDE_MAX_ACTIONS).default([]),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type BriefOutput = z.infer<typeof briefOutputSchema>;
