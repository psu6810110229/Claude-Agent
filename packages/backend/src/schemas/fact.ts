import { z } from "zod";
import { FACT_CONTENT_MAX } from "../config.js";

/**
 * Step 16 — real memory (fact store).
 *
 * A `memory_fact` is a single durable statement about the user (name,
 * preference, relationship, routine, project). Unlike the 4 markdown memory
 * files (summaries-only invariant), fact CONTENT is recalled directly into the
 * prompt. These schemas validate the three approval-gated fact actions at
 * propose time and again in the executor.
 */

/** Coarse category used for grouping + light recall weighting. */
export const factCategorySchema = z.enum([
  "identity",
  "preference",
  "relationship",
  "routine",
  "project",
  "general",
]);
export type FactCategory = z.infer<typeof factCategorySchema>;

/**
 * `fact.remember` payload — append a NEW fact. Non-destructive, so it may
 * auto-execute when auto-execute is on (the append-like case). `keywords` are
 * extra lowercase recall tags; `content` words are already indexed for recall.
 */
export const factRememberPayloadSchema = z.object({
  content: z.string().trim().min(1).max(FACT_CONTENT_MAX),
  keywords: z.string().trim().max(200).optional(),
  category: factCategorySchema.optional(),
  pinned: z.boolean().optional(),
});
export type FactRememberPayload = z.infer<typeof factRememberPayloadSchema>;

/**
 * `fact.update` payload — edit an existing fact by id. Replace-like, so it is
 * always confirm-gated (never auto-executed); the executor snapshots the prior
 * row into `undo_json` so the edit is recoverable.
 */
export const factUpdatePayloadSchema = z
  .object({
    id: z.number().int().positive(),
    content: z.string().trim().min(1).max(FACT_CONTENT_MAX).optional(),
    keywords: z.string().trim().max(200).optional(),
    category: factCategorySchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.content !== undefined ||
      v.keywords !== undefined ||
      v.category !== undefined ||
      v.pinned !== undefined,
    { message: "At least one field to update must be provided" },
  );
export type FactUpdatePayload = z.infer<typeof factUpdatePayloadSchema>;

/**
 * `fact.forget` payload — soft-archive a fact by id. Always confirm-gated;
 * never hard-deleted (recoverable via the snapshot the executor stores).
 */
export const factForgetPayloadSchema = z.object({
  id: z.number().int().positive(),
});
export type FactForgetPayload = z.infer<typeof factForgetPayloadSchema>;

/** A `memory_fact` row as returned by the API. */
export const memoryFactSchema = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  keywords: z.string(),
  category: factCategorySchema,
  pinned: z.boolean(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoryFact = z.infer<typeof memoryFactSchema>;

export const factListResponseSchema = z.object({
  facts: z.array(memoryFactSchema),
});

/**
 * POST /api/facts/proposals body — a manual "teach a fact" from the dashboard.
 * Same shape as the remember payload; the route forwards it to the dispatcher
 * as a `fact.remember` action.
 */
export const createFactProposalBodySchema = factRememberPayloadSchema;
export type CreateFactProposalBody = z.infer<typeof createFactProposalBodySchema>;
