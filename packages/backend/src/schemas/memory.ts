import { z } from "zod";

/**
 * The ONLY memory targets that can be read or written. Each maps to a single
 * fixed file under MEMORY_DIR (see services/memoryStore). This enum is the path
 * boundary: there are no free-form paths and nothing can escape the memory root.
 */
export const memoryTargetSchema = z.enum([
  "preferences",
  "routines",
  "projects",
  "decisions",
]);
export type MemoryTarget = z.infer<typeof memoryTargetSchema>;

/** How an approved write is applied to the target file. */
export const memoryWriteModeSchema = z.enum(["append", "replace"]);
export type MemoryWriteMode = z.infer<typeof memoryWriteModeSchema>;

/** Max memory content per write (safety cap; local single-user MVP). */
export const MEMORY_CONTENT_MAX = 50_000;

/**
 * Payload for the `memory.write` approval action. Re-validated at propose time
 * and again in the executor before any file is touched. No path field exists —
 * the file is derived solely from `target`.
 */
export const memoryWritePayloadSchema = z.object({
  target: memoryTargetSchema,
  mode: memoryWriteModeSchema,
  content: z.string().min(1).max(MEMORY_CONTENT_MAX),
  summary: z.string().trim().max(200).optional(),
});
export type MemoryWritePayload = z.infer<typeof memoryWritePayloadSchema>;

/** A row from `memory_index` as returned by the API. */
export const memoryEntrySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  path: z.string(),
  summary: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const memoryListResponseSchema = z.object({
  entries: z.array(memoryEntrySchema),
});

/** GET /api/memory/:target/content response. */
export const memoryContentResponseSchema = z.object({
  target: memoryTargetSchema,
  path: z.string(),
  exists: z.boolean(),
  content: z.string(),
});
export type MemoryContentResponse = z.infer<typeof memoryContentResponseSchema>;

/** :target route param, gated by the whitelist enum. */
export const memoryTargetParamSchema = z.object({
  target: memoryTargetSchema,
});

/**
 * POST /api/memory/proposals body. Same shape as the write payload; the route
 * forwards it to the approval queue as a `memory.write` action.
 */
export const createMemoryProposalBodySchema = memoryWritePayloadSchema;
export type CreateMemoryProposalBody = z.infer<
  typeof createMemoryProposalBodySchema
>;
