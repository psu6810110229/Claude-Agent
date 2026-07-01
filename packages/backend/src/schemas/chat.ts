import { z } from "zod";
import { aiActionSchema } from "./aiCommand.js";
import { calendarBulkCreateActionSchema } from "./calendarPlan.js";
import { aiProviderIdSchema, aiProviderModeSchema } from "../services/aiProvider.js";
import {
  CLAUDE_MAX_ACTIONS,
  isAllowedGeminiModel,
  isAllowedPsuModel,
} from "../config.js";

/**
 * Chat actions = every executor action PLUS the chat-only `calendar.bulk_create`
 * staging action (a single action carrying a whole list of events). The bulk
 * action is peeled off in chat.ts and turned into a reviewable plan; it is never
 * dispatched through the executor, so it stays out of the shared aiActionSchema.
 */
export const chatActionSchema = z.union([
  aiActionSchema,
  calendarBulkCreateActionSchema,
]);
export type ChatAction = z.infer<typeof chatActionSchema>;

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
  // Optional per-turn Gemini model override. Validated against the runtime
  // allowlist so an unknown id is rejected rather than passed to the API.
  // Ignored unless the resolved provider is Gemini.
  geminiModel: z
    .string()
    .trim()
    .refine(isAllowedGeminiModel, { message: "ไม่รองรับโมเดลนี้" })
    .optional(),
  // Optional per-turn PSU model override (qwen / glm / gpt4o). Validated against
  // the runtime allowlist; ignored unless the resolved provider is a PSU model.
  psuModel: z
    .string()
    .trim()
    .refine(isAllowedPsuModel, { message: "ไม่รองรับโมเดลนี้" })
    .optional(),
  // Step 15 — opaque per-tab session id. Optional so guard-off and older clients
  // still work; the backend treats a missing id as unverified when the guard is on.
  sessionId: z.string().trim().min(8).max(128).optional(),
  // Chat doc attachments — opaque upload ids (from POST /api/attachments, kind
  // "doc") the user attached to this conversation. The backend re-reads + extracts
  // each per turn and injects its content. Capped; unknown/expired ids are skipped.
  attachmentIds: z
    .array(z.string().trim().regex(/^[0-9a-f-]{36}$/i))
    .max(4)
    .optional(),
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
    _analysis: z
      .string()
      .trim()
      .min(1)
      .max(2000),
    reply: z.string().trim().min(1).max(4000),
    // Detail-preserving spoken rendering of `reply` for TTS. Same Claude/Gemini
    // call produces both — no extra round trip. Capped to match `reply` (4000) so
    // a faithful spoken version is never truncated. Optional; on omission the
    // frontend falls back to speaking `reply` (fail-soft, esp. for Gemini).
    spoken: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .nullish()
      .transform((v) => v ?? undefined),
    // Step 15 — UX signal only: "private" when the user asked for the owner's
    // private specifics. Drives whether the verify panel shows; never changes
    // what data the model can see (redaction already ran). Fail-soft default
    // "normal" on omission (fail-open for UX only — keyword classifier backstops).
    sensitivity: z
      .enum(["private", "normal"])
      .nullish()
      .transform((v) => v ?? "normal"),
    actions: z.array(chatActionSchema).max(CLAUDE_MAX_ACTIONS).default([]),
    clarification: z
      .preprocess(
        // gpt-4o-mini (and occasionally other models) emit "clarification": ""
        // instead of omitting the key. An empty/whitespace value means "no
        // clarification" — coerce it to undefined so the strict min(1) below
        // only rejects genuinely malformed non-empty input.
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        z.string().trim().min(1).max(500).nullish(),
      )
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

/**
 * Step 15 — request schema for POST /api/chat/verify. The PIN/phrase is compared
 * only in identityVerifier and never logged. sessionId binds the unlock to one tab.
 */
export const chatVerifyRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  input: z.string().min(1).max(256),
});

/**
 * Strict schema for the idle FOLLOW-UP turn. The model may decline to speak by
 * returning `silent: true` (nothing useful to add) — then `reply` is optional.
 * Otherwise `reply` is a short, optional, low-pressure proactive suggestion.
 */
export const followupOutputSchema = z
  .object({
    silent: z.boolean().nullish().transform((v) => v ?? false),
    reply: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .nullish()
      .transform((v) => v ?? undefined),
    spoken: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .nullish()
      .transform((v) => v ?? undefined),
    actions: z.array(aiActionSchema).max(CLAUDE_MAX_ACTIONS).default([]),
    clarification: z
      .preprocess(
        // gpt-4o-mini (and occasionally other models) emit "clarification": ""
        // instead of omitting the key. An empty/whitespace value means "no
        // clarification" — coerce it to undefined so the strict min(1) below
        // only rejects genuinely malformed non-empty input.
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        z.string().trim().min(1).max(500).nullish(),
      )
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

export type FollowupOutput = z.infer<typeof followupOutputSchema>;
