import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  actions_json: string | null;
  source_previews_json: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

/**
 * Append a message to the chat history. `actionsJson` is a JSON string
 * encoding the proposed approval ids+types for an assistant turn, or null.
 */
export function appendMessage(
  role: "user" | "assistant",
  content: string,
  actionsJson: string | null = null,
  sourcePreviewsJson: string | null = null,
): ChatMessage {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO chat_message (role, content, actions_json, source_previews_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(role, content, actionsJson, sourcePreviewsJson, ts, ts);
  return getDb()
    .prepare(
      `SELECT id, role, content, actions_json, source_previews_json, status, created_at, updated_at
       FROM chat_message WHERE id = ?`,
    )
    .get(Number(info.lastInsertRowid)) as ChatMessage;
}

/**
 * Soft-archive all active chat messages. Returns count archived. New chat
 * turns then start with empty history (zero recall tokens).
 */
export function archiveActiveMessages(): number {
  const info = getDb()
    .prepare(
      `UPDATE chat_message SET status = 'archived', updated_at = ?
       WHERE status = 'active'`,
    )
    .run(nowIso());
  return info.changes as number;
}

/**
 * Return the N most recent active messages in chronological order (oldest
 * first), suitable for feeding directly into a prompt as conversation history.
 */
export function listRecentMessages(limit: number): ChatMessage[] {
  return (
    getDb()
      .prepare(
        `SELECT id, role, content, actions_json, source_previews_json, status, created_at, updated_at
         FROM chat_message
         WHERE status = 'active'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as ChatMessage[]
  ).reverse();
}
