import type { FastifyInstance } from "fastify";
import {
  fetchUnreadGmailMessages,
  isGmailEnabled,
} from "../services/gmail.js";
import { gmailListResponseSchema } from "../schemas/gmail.js";

/**
 * Gmail read routes (Step 17).
 *
 * GET /api/gmail/unread — up to GMAIL_MAX_RESULTS unread inbox messages.
 *
 * FAIL CLOSED: any disabled/config/auth/API error returns an empty list with
 * `available: false` so the dashboard degrades gracefully. There are no write
 * endpoints here; gmail.draft and gmail.send go through the approval executor.
 */
export async function gmailRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/gmail/unread", async () => {
    if (!isGmailEnabled()) {
      return gmailListResponseSchema.parse({ messages: [], available: false });
    }
    try {
      const messages = await fetchUnreadGmailMessages();
      return gmailListResponseSchema.parse({ messages, available: true });
    } catch {
      return gmailListResponseSchema.parse({ messages: [], available: false });
    }
  });
}
