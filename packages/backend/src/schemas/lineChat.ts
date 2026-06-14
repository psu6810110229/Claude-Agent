import { z } from "zod";

/**
 * LINE connector schemas (Step 20) — READ-ONLY.
 *
 * Projection of a parsed LINE chat-export message and chat summary. There are
 * NO write payloads: the LINE connector never mutates anything. `atUtc` is an
 * APPROXIMATE UTC instant — LINE exports carry only minute-granularity local
 * (Asia/Bangkok) wall-clock time with no seconds and no timezone marker.
 */

export const lineMessageSchema = z.object({
  /** Chat-local date in Asia/Bangkok, YYYY-MM-DD. */
  date: z.string(),
  /** Asia/Bangkok wall-clock time, HH:mm (no seconds in the export). */
  time: z.string(),
  /** Approximate UTC instant (Bangkok time − 7h), ISO 8601. */
  atUtc: z.string(),
  /** Display name of the sender, or null for sender-less system lines. */
  sender: z.string().nullable(),
  /** Message text or media placeholder ("Photos", "Stickers", a URL, …). */
  text: z.string(),
  /** True for LINE system notices (joined/left, calls, unsent, …). */
  system: z.boolean(),
});
export type LineMessage = z.infer<typeof lineMessageSchema>;

export const lineChatSummarySchema = z.object({
  /** Stable id = the export filename. */
  id: z.string(),
  /** Human chat name derived from the filename. */
  name: z.string(),
  /** Number of parsed messages in the export. */
  messageCount: z.number(),
  /** Approximate UTC instant of the last message, or null when empty. */
  lastMessageAt: z.string().nullable(),
});
export type LineChatSummary = z.infer<typeof lineChatSummarySchema>;

export const lineChatsResponseSchema = z.object({
  available: z.boolean(),
  chats: z.array(lineChatSummarySchema),
});
export type LineChatsResponse = z.infer<typeof lineChatsResponseSchema>;

export const lineMessagesResponseSchema = z.object({
  available: z.boolean(),
  messages: z.array(lineMessageSchema),
});
export type LineMessagesResponse = z.infer<typeof lineMessagesResponseSchema>;
