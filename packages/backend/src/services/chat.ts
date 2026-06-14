import { listTasks } from "../db/repositories/taskRepo.js";
import { listMemoryEntries } from "../db/repositories/memoryRepo.js";
import { recallFacts } from "./factRecall.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import {
  appendMessage,
  listRecentMessages,
} from "../db/repositories/chatRepo.js";
import { listRecentApprovalOutcomes } from "../db/repositories/approvalRepo.js";
import {
  dispatchProposedAction,
  isAutoExecuteEnabled,
  isAutoExecuteDestructiveEnabled,
  type DispatchResult,
} from "./actionDispatcher.js";
import { chatOutputSchema } from "../schemas/chat.js";
import type { AiAction } from "../schemas/aiCommand.js";
import { buildChatPrompt, type ChatContext } from "./chatPrompt.js";
import {
  agendaBounds,
  bangkokWallClock,
  bucketEvents,
  bucketReminders,
} from "./agenda.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import { GeminiError } from "./geminiClient.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import {
  fetchUnreadGmailMessages,
  isGmailEnabled,
} from "./gmail.js";
import {
  fetchGoogleContacts,
  isContactsEnabled,
} from "./googleContacts.js";
import { getRecentDriveFiles } from "./googleDrive.js";
import type { Approval } from "../schemas/approval.js";
import {
  CLAUDE_BRIEF_TIMEOUT_MS,
  CLAUDE_CONTEXT_TASK_CAP,
  BRIEF_EVENT_CAP,
  BRIEF_REMINDER_CAP,
  CHAT_GOOGLE_WINDOW_DAYS,
  CHAT_GOOGLE_EVENT_CAP,
  CHAT_HISTORY_LIMIT,
  nowIso,
} from "../config.js";
import { classifySensitivity } from "./privacyClassifier.js";
import { isGuardEnabled } from "./identityVerifier.js";

/**
 * Chat orchestration (Step 12). Proposal-only pipeline with conversation
 * history. Reads real local state (tasks/events/reminders/Google/memory
 * summaries) for recall; persists successful exchanges; routes any write
 * through the approval queue. Fails closed on every error path.
 *
 * Only successful exchanges are persisted: user message + assistant reply are
 * written together after a valid Claude response. A failed/disabled invocation
 * produces no DB writes, so failed attempts don't pollute history.
 */

export type ChatResult =
  | {
      kind: "replied";
      reply: string;
      spoken?: string;
      /** Deterministic, truthful outcome line posted AFTER the ack reply. */
      resultReport?: string;
      /** Short spoken form of resultReport for sequential TTS. */
      resultSpoken?: string;
      approvals: Approval[];
      clarification?: string;
      clarificationChoices?: string[];
      notes?: string;
      /** Step 15: true when guard on, requester unverified, and asked for private data. */
      verificationRequired?: boolean;
      /** Step 15: the challenge question to show in the verify panel. */

      /** Step 15: "private" if the user probed the owner's private specifics. */
      sensitivity?: "private" | "normal";
    }
  | { kind: "rejected"; message: string; detail?: string }
  | { kind: "failed"; reason: string; message: string; userMessage: string };

/**
 * Build a TRUTHFUL, deterministic outcome message from the real dispatch
 * results. The chat `reply` is only an acknowledgement (it is generated before
 * execution), so this is what actually tells the user whether the work
 * succeeded, failed (with the real error), or is awaiting their confirmation.
 * Returns null when there were no actions (pure Q&A — nothing to report).
 */
function buildActionReport(
  dispatched: DispatchResult[],
): { text: string; spoken: string } | null {
  if (dispatched.length === 0) return null;

  const executed = dispatched.filter((d) => d.mode === "executed");
  const failed = dispatched.filter((d) => d.mode === "failed");
  const pending = dispatched.filter((d) => d.mode === "pending");

  const lines: string[] = [];
  if (executed.length > 0) {
    lines.push(
      executed.length === 1
        ? "✅ เรียบร้อยครับ ผมจัดการให้แล้ว"
        : `✅ เรียบร้อยครับ ผมจัดการให้แล้ว ${executed.length} รายการ`,
    );
  }
  for (const f of failed) {
    const reason = f.approval.execution_error?.trim();
    lines.push(
      reason
        ? `⚠️ มีรายการที่ทำไม่สำเร็จครับ: ${reason}`
        : "⚠️ มีรายการที่ทำไม่สำเร็จครับ ลองอีกครั้งได้",
    );
  }
  if (pending.length > 0) {
    lines.push(
      `📝 อีก ${pending.length} รายการผมเตรียมไว้ให้แล้ว รอคุณกดยืนยันนะครับ`,
    );
  }
  if (lines.length === 0) return null;

  // Spoken: drop emoji + raw error detail; keep the gist for voice.
  // Memory updates are intentionally NOT spoken (user asked not to hear
  // "เรียบร้อยแล้วครับ" for a memory write / silently remembering a fact) — the
  // ✅ text line above still shows.
  const SILENT_TYPES = new Set(["memory.write", "fact.remember"]);
  const executedSpeakable = executed.filter(
    (d) => !SILENT_TYPES.has(d.approval.action_type),
  );
  const spokenParts: string[] = [];
  if (executedSpeakable.length > 0) spokenParts.push("เรียบร้อยแล้วครับ");
  if (failed.length > 0) spokenParts.push("มีบางรายการทำไม่สำเร็จครับ");
  if (pending.length > 0) spokenParts.push("อีกบางรายการรอคุณยืนยันครับ");

  return { text: lines.join("\n"), spoken: spokenParts.join(" ") };
}

function chatFailureMessage(reason: string): string {
  if (reason === "disabled") {
    return "ผมยังช่วยคิดด้วย AI ไม่ได้ครับ โหมด AI ยังไม่พร้อมใช้งาน เปิดใช้งานแล้วลองใหม่ได้";
  }
  if (reason === "timeout") {
    return "ผมยังตอบรายการนี้ไม่สำเร็จครับ ระบบใช้เวลานานเกินไป ลองส่งใหม่แบบสั้นลงได้";
  }
  if (reason === "rate-limit") {
    return "Gemini ใช้โควต้าครบชั่วคราวครับ ลองใหม่ภายหลังหรือสลับไปใช้ Claude ได้";
  }
  return "ผมยังตอบข้อความนี้ไม่สำเร็จครับ ลองส่งใหม่อีกครั้งได้";
}

const invalidOutputMessage =
  "ผมยังตอบข้อความนี้ให้ครบไม่ได้ครับ รูปแบบคำตอบไม่พร้อมใช้งาน ลองส่งใหม่อีกครั้งได้";

/** Build compact recall context for a chat turn. Exported for the idle follow-up. */
export async function buildChatContext(
  message: string,
  fetchGoogle: GoogleEventsFetcher,
  verified: boolean = true,
): Promise<ChatContext> {
  const openTasks = listTasks()
    .filter((t) => t.status === "open")
    .slice(0, CLAUDE_CONTEXT_TASK_CAP)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120) }));

  const memorySummaries = listMemoryEntries().map((m) => ({
    slug: m.slug,
    summary: m.summary,
  }));

  // Step 16 — real memory: pick the facts most relevant to this message.
  const facts = recallFacts(message).map((f) => ({
    id: f.id,
    content: f.content,
    category: f.category,
    pinned: f.pinned,
  }));

  const now = new Date();
  const eb = bucketEvents(listEvents(), now);
  const events = [...eb.today, ...eb.upcoming]
    .slice(0, BRIEF_EVENT_CAP)
    .map((e) => ({
      id: e.id,
      starts_at: e.starts_at,
      title: e.title.slice(0, 120),
    }));

  const rb = bucketReminders(listReminders(), now);
  const reminders = [
    ...rb.overdue.map((r) => ({ r, bucket: "overdue" as const })),
    ...rb.today.map((r) => ({ r, bucket: "today" as const })),
    ...rb.upcoming.map((r) => ({ r, bucket: "upcoming" as const })),
  ]
    .slice(0, BRIEF_REMINDER_CAP)
    .map(({ r, bucket }) => ({
      id: r.id,
      due_at: r.due_at,
      title: r.title.slice(0, 120),
      bucket,
    }));

  const approvalOutcomes = listRecentApprovalOutcomes(10).map((a) => ({
    id: a.id,
    action_type: a.action_type,
    status: a.status,
    execution_status: a.execution_status,
    summary: a.result_summary,
    error: a.execution_error,
    updated_at: a.updated_at,
  }));

  // Google recall uses a WIDE window so the model can target far-future events
  // (e.g. semester dates months out) by their REAL id instead of fabricating one.
  const { todayStartUtc, todayEndUtc } = agendaBounds(now);
  const { upcomingEndUtc: wideEndUtc } = agendaBounds(
    now,
    CHAT_GOOGLE_WINDOW_DAYS,
  );
  let googleEvents: ChatContext["googleEvents"] = [];
  try {
    const [gToday, gUpcoming] = await Promise.all([
      fetchGoogle(todayStartUtc, todayEndUtc),
      fetchGoogle(todayEndUtc, wideEndUtc),
    ]);
    googleEvents = [
      ...gToday.map((e) => ({ e, bucket: "today" as const })),
      ...gUpcoming.map((e) => ({ e, bucket: "upcoming" as const })),
    ]
      .slice(0, CHAT_GOOGLE_EVENT_CAP)
      .map(({ e, bucket }) => ({
        id: e.id,
        start: e.start,
        title: e.title.slice(0, 120),
        allDay: e.allDay,
        bucket,
      }));
  } catch {
    googleEvents = [];
  }

  // Fetch history AFTER the user message is persisted (caller handles that),
  // so `listRecentMessages` already includes this turn in the history for the
  // next invocation — but for THIS turn we read history BEFORE appending.
  const history = listRecentMessages(CHAT_HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Step 17 — Gmail unread (capped at 5; fail gracefully when disabled/error).
  let gmailUnread: ChatContext["gmailUnread"] = [];
  if (isGmailEnabled()) {
    try {
      const msgs = await fetchUnreadGmailMessages(5);
      gmailUnread = msgs.map((m) => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
      }));
    } catch {
      gmailUnread = [];
    }
  }

  // Step 18 — Google Contacts (capped at 50 for prompt; fail gracefully).
  let contacts: ChatContext["contacts"] = [];
  if (isContactsEnabled()) {
    try {
      const all = await fetchGoogleContacts(50);
      contacts = all.map((c) => ({ name: c.name, email: c.email }));
    } catch {
      contacts = [];
    }
  }

  // Step 19 — Recent Drive files for AI awareness (capped at 10; fail silently).
  const recentDriveFiles = await getRecentDriveFiles(10);

  const GENERIC_BUSY = "ไม่ว่าง (รายละเอียดส่วนตัว)";
  const GENERIC_TASK = "งานส่วนตัว";
  const GENERIC_REMINDER = "เตือนความจำส่วนตัว";

  // §7 HARD redaction gate: when unverified, private strings never reach the prompt.
  // This is the real security boundary — not the model's behaviour.
  if (!verified) {
    return {
      message,
      nowUtc: nowIso(),
      nowBangkok: bangkokWallClock(now),
      openTasks: openTasks.map((t) => ({ id: t.id, title: GENERIC_TASK })),
      memorySummaries: [],
      facts: [],
      googleEvents: googleEvents.map((e) => ({ ...e, title: GENERIC_BUSY })),
      events: events.map((e) => ({ ...e, title: GENERIC_BUSY })),
      reminders: reminders.map((r) => ({ ...r, title: GENERIC_REMINDER })),
      approvalOutcomes: [],
      history: [],
      gmailUnread: [],
      contacts: [],
      recentDriveFiles: [],
      autoExecute: isAutoExecuteEnabled(),
      autoExecuteDestructive: isAutoExecuteDestructiveEnabled(),
      restricted: true,
    };
  }

  return {
    message,
    openTasks,
    memorySummaries,
    facts,
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
    googleEvents,
    events,
    reminders,
    approvalOutcomes,
    history,
    gmailUnread,
    contacts,
    recentDriveFiles,
    autoExecute: isAutoExecuteEnabled(),
    autoExecuteDestructive: isAutoExecuteDestructiveEnabled(),
    restricted: false,
  };
}

export async function runChat(
  message: string,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
  opts: { verified?: boolean; sessionId?: string; originalMessage?: string } = {},
): Promise<ChatResult> {
  const verified = opts.verified ?? true;
  const kw = classifySensitivity(message);

  // 1. Build context (reads history BEFORE this turn, so history is prior turns).
  const ctx = await buildChatContext(message, fetchGoogle, verified);

  // 2. Invoke Claude. Any spawn/timeout/disabled error fails closed.
  let raw: string;
  try {
    raw = await invoke(ctx.message.length > 0 ? buildChatPrompt(ctx) : "", {
      timeoutMs: CLAUDE_BRIEF_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ClaudeError || err instanceof GeminiError) {
      return {
        kind: "failed",
        reason: err.reason,
        message: err.message,
        userMessage: chatFailureMessage(err.reason),
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "failed",
      reason: "spawn",
      message: msg,
      userMessage: chatFailureMessage("spawn"),
    };
  }

  // 3. Normalize + strict JSON parse. No repair; prose still fails.
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    const snippet = raw.slice(0, 300).replace(/\n/g, "\\n");
    return {
      kind: "rejected",
      message: invalidOutputMessage,
      detail: `Claude output was not valid JSON. Raw(300): ${snippet}`,
    };
  }

  // 4. Validate against strict schema.
  const check = chatOutputSchema.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      kind: "rejected",
      message: invalidOutputMessage,
      detail: `Claude output failed validation: ${detail}`,
    };
  }

  // 5. Valid: each action is dispatched — auto-executed when eligible, else a
  //    pending approval. Unverified requesters: skip dispatch entirely (defense
  //    in depth — prompt also instructs the model not to propose writes for guests).
  const dispatched: DispatchResult[] = verified
    ? await Promise.all(
        check.data.actions.map((action: AiAction) =>
          dispatchProposedAction(action.action_type, action.payload, "chat"),
        ),
      )
    : [];
  const approvals: Approval[] = dispatched.map((d) => d.approval);

  // 6. Persist the exchange (user + assistant). Only reaches here on success,
  //    so history never contains failed/rejected attempts.
  appendMessage("user", opts.originalMessage ?? message);
  const actionsJson =
    approvals.length > 0
      ? JSON.stringify(
          approvals.map((a) => ({ id: a.id, action_type: a.action_type })),
        )
      : null;
  // The reply is an ACK (written before execution). Attach the action buttons to
  // it, then append the TRUE outcome as a second assistant message so reporting
  // is never faked — it reflects the real executor result.
  appendMessage("assistant", check.data.reply, actionsJson);
  const report = buildActionReport(dispatched);
  if (report) appendMessage("assistant", report.text);

  const modelPrivate = check.data.sensitivity === "private";
  const verificationRequired =
    isGuardEnabled() && !verified && (kw.private || modelPrivate);

  return {
    kind: "replied",
    reply: check.data.reply,
    spoken: check.data.spoken,
    resultReport: report?.text,
    resultSpoken: report?.spoken,
    approvals,
    clarification: check.data.clarification,
    clarificationChoices: check.data.clarification_choices,
    notes: check.data.notes,
    verificationRequired: verificationRequired || undefined,

    sensitivity: check.data.sensitivity,
  };
}
