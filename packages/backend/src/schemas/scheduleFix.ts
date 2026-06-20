import { z } from "zod";
import { updateGoogleEventPayloadSchema } from "./googleCalendar.js";

/**
 * Tier 2 — AI-proposed schedule fixes (proposal-only, approval-gated).
 *
 * The AI reads Tier 1 findings + schedule prefs + recalled facts and returns
 * concrete reschedule proposals. Each proposal is a `google_event.update`
 * payload (the SAME canonical schema the executor validates) plus a
 * human-readable `reason`. The backend, not the AI, decides what happens: every
 * proposal becomes a PENDING approval the user must confirm. The AI never
 * executes and there is no auto-reschedule.
 */

/** Cap on proposals accepted from a single run (anything more is rejected). */
export const SCHEDULE_FIX_MAX_PROPOSALS = 8;

/**
 * One reschedule proposal as returned by the AI. `payload` is validated by the
 * canonical `google_event.update` schema, so a fabricated/incomplete payload
 * fails here before anything is queued. `finding_ref` is an optional index into
 * the findings array the model was given, linking the fix to the issue it
 * addresses (display-only; never trusted for execution).
 */
export const scheduleFixAiProposalSchema = z.object({
  payload: updateGoogleEventPayloadSchema,
  reason: z.string().trim().min(1).max(500),
  finding_ref: z
    .number()
    .int()
    .min(0)
    .nullish()
    .transform((v) => v ?? undefined),
});

/** Strict envelope the AI must return. Empty `proposals` is valid (nothing to fix). */
export const scheduleFixAiOutputSchema = z
  .object({
    proposals: z
      .array(scheduleFixAiProposalSchema)
      .max(SCHEDULE_FIX_MAX_PROPOSALS),
    notes: z
      .string()
      .max(2000)
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .strict();
export type ScheduleFixAiOutput = z.infer<typeof scheduleFixAiOutputSchema>;

/**
 * One proposal as surfaced by the route — AFTER it has been queued as a pending
 * approval. `approvalId` is the row the user approves/rejects through the normal
 * approval queue; `reason`/`findingKind`/`eventTitle` are display context.
 */
export const scheduleFixProposalSchema = z.object({
  approvalId: z.number().int().positive(),
  actionType: z.literal("google_event.update"),
  payload: updateGoogleEventPayloadSchema,
  reason: z.string(),
  /** Kind of the Tier 1 finding this fix addresses, when the model linked one. */
  findingKind: z.string().nullable(),
  /** Current title of the targeted event (display-only; from the read events). */
  eventTitle: z.string().nullable(),
});
export type ScheduleFixProposal = z.infer<typeof scheduleFixProposalSchema>;

/**
 * Route response. `available` mirrors the calendar fetch (fail closed). When the
 * calendar is available but the AI could not produce usable proposals, the route
 * still returns `available: true` with an empty `proposals` list and an optional
 * `notes` line — it never errors.
 */
export const scheduleFixResponseSchema = z.object({
  available: z.boolean(),
  proposals: z.array(scheduleFixProposalSchema),
  notes: z.string().optional(),
});
export type ScheduleFixResponse = z.infer<typeof scheduleFixResponseSchema>;
