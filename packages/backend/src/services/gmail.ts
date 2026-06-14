import { google } from "googleapis";
import { GMAIL_ENABLED, GMAIL_MAX_RESULTS } from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import {
  buildOAuthClient,
  GoogleCalendarError,
} from "./googleCalendar.js";
import {
  gmailMessageSchema,
  type GmailMessage,
  type GmailDraftPayload,
  type GmailSendPayload,
} from "../schemas/gmail.js";

/**
 * Gmail connector (Step 17).
 *
 * SAFETY BOUNDARIES — identical contract to googleCalendar.ts:
 * - Reads are fail-closed (disabled/config/auth/API error → empty list +
 *   available:false; never leaks error details).
 * - Writes (draft, send) are called only by the approval executor AFTER an
 *   approval has been actioned. gmail.send is always confirm-gated and never
 *   auto-executed.
 * - FAILS CLOSED. Any error throws GmailError; callers degrade gracefully.
 * - NEVER LOGS SECRETS. Reuses the same OAuth client + credentials as the
 *   Google Calendar connector.
 *
 * OAuth note: gmail.readonly + gmail.compose scopes are required. Existing
 * tokens only have calendar.events — users must re-run `npm run google-auth`
 * to get a fresh token with the expanded scopes.
 */

export type GmailFailureReason = "disabled" | "config" | "auth" | "api";

export class GmailError extends Error {
  constructor(
    public readonly reason: GmailFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

function gmailErrorDetail(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: { message?: string } | string } };
    errors?: Array<{ message?: string }>;
    message?: string;
  };
  const data = anyErr?.response?.data?.error;
  const fromBody = typeof data === "string" ? data : data?.message;
  const detail = fromBody ?? anyErr?.errors?.[0]?.message ?? anyErr?.message;
  return typeof detail === "string" && detail.trim() ? ` (${detail.trim()})` : "";
}

/** Whether the Gmail connector is enabled. DB config overrides the env-var. */
export function isGmailEnabled(): boolean {
  const dbValue = getConfigBool("gmail_enabled");
  if (dbValue !== null) return dbValue;
  return GMAIL_ENABLED;
}

/** Build an authenticated Gmail client. Throws GmailError on any config failure. */
function buildGmailClient() {
  try {
    const auth = buildOAuthClient();
    return google.gmail({ version: "v1", auth });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      throw new GmailError("config", err.message);
    }
    throw new GmailError("config", "Failed to build Gmail OAuth client.");
  }
}

/**
 * Parse message headers into a flat GmailMessage. Returns null when the
 * message lacks required fields (id, subject, from).
 */
function parseMessage(raw: {
  id?: string | null;
  threadId?: string | null;
  snippet?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  payload?: {
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
  } | null;
}): GmailMessage | null {
  if (!raw.id) return null;
  const headers = raw.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    "";
  const subject = header("Subject") || "(no subject)";
  const from = header("From") || "";
  const dateHeader = header("Date");
  let receivedAt = "";
  if (raw.internalDate) {
    receivedAt = new Date(Number(raw.internalDate)).toISOString();
  } else if (dateHeader) {
    try {
      receivedAt = new Date(dateHeader).toISOString();
    } catch {
      receivedAt = "";
    }
  }
  const unread = raw.labelIds?.includes("UNREAD") ?? false;
  return gmailMessageSchema.parse({
    id: raw.id,
    threadId: raw.threadId ?? raw.id,
    from,
    subject,
    snippet: raw.snippet ?? "",
    receivedAt,
    unread,
  });
}

/**
 * Fetch recent unread inbox messages. Fails closed on any error.
 * limit defaults to GMAIL_MAX_RESULTS (env-configurable, default 20).
 */
export async function fetchUnreadGmailMessages(
  limit: number = GMAIL_MAX_RESULTS,
): Promise<GmailMessage[]> {
  if (!isGmailEnabled()) {
    throw new GmailError("disabled", "Gmail is disabled.");
  }
  const gmail = buildGmailClient();
  let messageIds: string[];
  try {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox is:unread",
      maxResults: limit,
    });
    messageIds = (listRes.data.messages ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch (err) {
    if (err instanceof GmailError) throw err;
    throw new GmailError("api", `Failed to list Gmail messages.${gmailErrorDetail(err)}`);
  }
  if (messageIds.length === 0) return [];

  const fetched = await Promise.allSettled(
    messageIds.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      }),
    ),
  );

  const messages: GmailMessage[] = [];
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const parsed = parseMessage(result.value.data);
    if (parsed) messages.push(parsed);
  }
  return messages;
}

/**
 * Build a minimal RFC 2822 email string and base64url-encode it for the
 * Gmail API `raw` field. Handles To / Cc / Bcc / Subject / body (plain text).
 * Threading: when replyToMessageId is set we add In-Reply-To and References
 * headers so Gmail groups the message into the correct conversation.
 */
function buildRaw(
  payload: GmailDraftPayload | GmailSendPayload,
): string {
  const lines: string[] = [
    `To: ${payload.to}`,
    ...(payload.cc ? [`Cc: ${payload.cc}`] : []),
    ...(payload.bcc ? [`Bcc: ${payload.bcc}`] : []),
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    ...(payload.replyToMessageId
      ? [
          `In-Reply-To: <${payload.replyToMessageId}>`,
          `References: <${payload.replyToMessageId}>`,
        ]
      : []),
    "",
    payload.body,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface CreatedGmailDraft {
  draftId: string;
}

/**
 * Create a Gmail draft. Called only by the executor after a gmail.draft
 * approval is actioned. Safe to auto-execute: stays in Drafts until the user
 * manually sends it inside Gmail.
 */
export async function createGmailDraft(
  payload: GmailDraftPayload,
): Promise<CreatedGmailDraft> {
  if (!isGmailEnabled()) {
    throw new GmailError("disabled", "Gmail is disabled.");
  }
  const gmail = buildGmailClient();
  try {
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: buildRaw(payload) } },
    });
    const draftId = res.data.id;
    if (!draftId) {
      throw new GmailError("api", "Gmail returned a draft without an id.");
    }
    return { draftId };
  } catch (err) {
    if (err instanceof GmailError) throw err;
    throw new GmailError(
      "api",
      `Failed to create Gmail draft.${gmailErrorDetail(err)}`,
    );
  }
}

export interface SentGmailMessage {
  messageId: string;
}

/**
 * Send an email immediately. Called only by the executor after a gmail.send
 * approval has been explicitly confirmed by the user (always confirm-gated,
 * never auto-executed).
 */
export async function sendGmailEmail(
  payload: GmailSendPayload,
): Promise<SentGmailMessage> {
  if (!isGmailEnabled()) {
    throw new GmailError("disabled", "Gmail is disabled.");
  }
  const gmail = buildGmailClient();
  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: buildRaw(payload) },
    });
    const messageId = res.data.id;
    if (!messageId) {
      throw new GmailError("api", "Gmail returned a sent message without an id.");
    }
    return { messageId };
  } catch (err) {
    if (err instanceof GmailError) throw err;
    throw new GmailError(
      "api",
      `Failed to send Gmail email.${gmailErrorDetail(err)}`,
    );
  }
}
