import type { FastifyInstance } from "fastify";
import {
  isLineEnabled,
  listLineChats,
  getLineMessages,
  LineError,
} from "../services/lineChat.js";
import { LINE_MAX_RESULTS } from "../config.js";

/**
 * LINE routes (Step 20) — READ-ONLY.
 *
 * Fails closed: disabled / missing dir / parse errors return
 * { available: false, ... } — never expose error details or message content.
 */
export async function lineRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/line/chats", async (_req, reply) => {
    if (!isLineEnabled()) {
      return reply.send({ available: false, chats: [] });
    }
    try {
      return reply.send({ available: true, chats: listLineChats() });
    } catch (err) {
      if (err instanceof LineError) {
        app.log.warn({ reason: err.reason }, "LINE chats fetch failed");
      }
      return reply.send({ available: false, chats: [] });
    }
  });

  app.get<{ Querystring: { chat?: string; limit?: string } }>(
    "/api/line/messages",
    async (req, reply) => {
      if (!isLineEnabled()) {
        return reply.send({ available: false, messages: [] });
      }
      const chat = (req.query.chat ?? "").trim();
      if (!chat) {
        return reply.send({ available: false, messages: [] });
      }
      const limit = Number(req.query.limit ?? LINE_MAX_RESULTS) || LINE_MAX_RESULTS;
      try {
        return reply.send({
          available: true,
          messages: getLineMessages(chat, limit),
        });
      } catch (err) {
        if (err instanceof LineError) {
          app.log.warn({ reason: err.reason }, "LINE messages fetch failed");
        }
        return reply.send({ available: false, messages: [] });
      }
    },
  );
}
