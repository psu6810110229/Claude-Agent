import { z } from "zod";
import { aiActionSchema } from "./aiCommand.js";
import { aiProviderIdSchema, aiProviderModeSchema } from "../services/aiProvider.js";
import { CLAUDE_MAX_ACTIONS } from "../config.js";

/**
 * Request schema for POST /api/chat (Step 12; Roadmap 11 Phase 2/4).
 *
 * `mode` selects manual vs auto provider routing (default `manual`). In manual
 * mode `provider` is an optional explicit choice (`claude | gemini`); omitted ->
 * backend default (Claude); manual never silently falls back. In auto mode the
 * backend picks the provider transparently and `provider` is ignored.
 */
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  mode: aiProviderModeSchema.optional(),
  provider: aiProviderIdSchema.optional(),
});

/**
 * Optional query params for GET /api/chat/history.
 */
export const chatHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Strict schema for the JSON Claude must return in chat mode (Step 12).
 *
 * Like `aiOutputSchema` but with a required `reply` field — the natural-
 * language conversational response. `actions` is optional proposals that flow
 * into the approval queue; `reply` is always required so the conversation is
 * never empty. `.strict()` rejects any unexpected top-level keys.
 */
export const chatOutputSchema = z
  .object({
    reply: z.string().trim().min(1).max(4000),
    actions: z.array(aiActionSchema).max(CLAUDE_MAX_ACTIONS).default([]),
    clarification: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullish()
      .transform((v) => v ?? undefined),
    clarification_choices: z
      .array(z.string().trim().min(1).max(120))
      .max(4)
      .nullish()
      .transform((v) => v ?? undefined),
    notes: z
      .string()
      .max(2000)
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .strict();

export type ChatOutput = z.infer<typeof chatOutputSchema>;
