import { z } from "zod";

/**
 * Gmail integration schemas (Step 17).
 *
 * Read projection for inbox display, plus approval payloads for the two write
 * actions: gmail.draft (creates a draft — non-destructive, auto-executable) and
 * gmail.send (sends immediately — irreversible, always confirm-gated).
 */

export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: z.string(),
  unread: z.boolean(),
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;

export const gmailListResponseSchema = z.object({
  messages: z.array(gmailMessageSchema),
  available: z.boolean(),
});
export type GmailListResponse = z.infer<typeof gmailListResponseSchema>;

/**
 * gmail.draft payload. Creates a saved draft — safe to auto-execute because
 * it never leaves Gmail's drafts folder until the user manually sends it.
 */
export const gmailDraftPayloadSchema = z.object({
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50_000),
  cc: z.string().trim().max(500).optional(),
  bcc: z.string().trim().max(500).optional(),
  /** Message-ID to reply to — threads the draft in the correct conversation. */
  replyToMessageId: z.string().trim().optional(),
});
export type GmailDraftPayload = z.infer<typeof gmailDraftPayloadSchema>;

/**
 * gmail.send payload. Sends the email immediately — always confirm-gated,
 * never auto-executed, because sent mail cannot be recalled (>30 s window).
 */
export const gmailSendPayloadSchema = z.object({
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50_000),
  cc: z.string().trim().max(500).optional(),
  bcc: z.string().trim().max(500).optional(),
  replyToMessageId: z.string().trim().optional(),
});
export type GmailSendPayload = z.infer<typeof gmailSendPayloadSchema>;
