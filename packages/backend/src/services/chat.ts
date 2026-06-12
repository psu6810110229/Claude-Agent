import { listTasks } from "../db/repositories/taskRepo.js";
import { listMemoryEntries } from "../db/repositories/memoryRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import {
  appendMessage,
  listRecentMessages,
} from "../db/repositories/chatRepo.js";
import {
  createApproval,
  listRecentApprovalOutcomes,
} from "../db/repositories/approvalRepo.js";
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
import type { Approval } from "../schemas/approval.js";
import {
  CLAUDE_BRIEF_TIMEOUT_MS,
  CLAUDE_CONTEXT_TASK_CAP,
  BRIEF_EVENT_CAP,
  BRIEF_REMINDER_CAP,
  CHAT_HISTORY_LIMIT,
  nowIso,
} from "../config.js";

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
      approvals: Approval[];
      clarification?: string;
      clarificationChoices?: string[];
      notes?: string;
    }
  | { kind: "rejected"; message: string; detail?: string }
  | { kind: "failed"; reason: string; message: string; userMessage: string };

function chatFailureMessage(reason: string): string {
  if (reason === "disabled") {
    return "ผมยังช่วยคิดด้วย AI ไม่ได้ครับ โหมด AI ยังไม่พร้อมใช้งาน เปิดใช้งานแล้วลองใหม่ได้";
  }
  if (reason === "timeout") {
    return "ผมยังตอบรายการนี้ไม่สำเร็จครับ ระบบใช้เวลานานเกินไป ลองส่งใหม่แบบสั้นลงได้";
  }
  return "ผมยังทำรายการนี้ให้ไม่สำเร็จครับ ลองส่งใหม่อีกครั้งได้";
}

const invalidOutputMessage =
  "ผมยังตอบรายการนี้ให้ครบไม่ได้ครับ รูปแบบคำตอบไม่พร้อมใช้งาน ลองส่งใหม่อีกครั้งได้";

/** Build compact recall context for a chat turn. */
async function buildChatContext(
  message: string,
  fetchGoogle: GoogleEventsFetcher,
): Promise<ChatContext> {
  const openTasks = listTasks()
    .filter((t) => t.status === "open")
    .slice(0, CLAUDE_CONTEXT_TASK_CAP)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120) }));

  const memorySummaries = listMemoryEntries().map((m) => ({
    slug: m.slug,
    summary: m.summary,
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

  const { todayStartUtc, todayEndUtc, upcomingEndUtc } = agendaBounds(now);
  let googleEvents: ChatContext["googleEvents"] = [];
  try {
    const [gToday, gUpcoming] = await Promise.all([
      fetchGoogle(todayStartUtc, todayEndUtc),
      fetchGoogle(todayEndUtc, upcomingEndUtc),
    ]);
    googleEvents = [
      ...gToday.map((e) => ({ e, bucket: "today" as const })),
      ...gUpcoming.map((e) => ({ e, bucket: "upcoming" as const })),
    ]
      .slice(0, BRIEF_EVENT_CAP)
      .map(({ e, bucket }) => ({
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

  return {
    message,
    openTasks,
    memorySummaries,
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
    googleEvents,
    events,
    reminders,
    approvalOutcomes,
    history,
  };
}

export async function runChat(
  message: string,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): Promise<ChatResult> {
  // 1. Build context (reads history BEFORE this turn, so history is prior turns).
  const ctx = await buildChatContext(message, fetchGoogle);

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

  // 5. Valid: each action becomes a pending approval.
  const approvals: Approval[] = check.data.actions.map((action: AiAction) =>
    createApproval(action.action_type, action.payload),
  );

  // 6. Persist the exchange (user + assistant). Only reaches here on success,
  //    so history never contains failed/rejected attempts.
  appendMessage("user", message);
  const actionsJson =
    approvals.length > 0
      ? JSON.stringify(
          approvals.map((a) => ({ id: a.id, action_type: a.action_type })),
        )
      : null;
  appendMessage("assistant", check.data.reply, actionsJson);

  return {
    kind: "replied",
    reply: check.data.reply,
    approvals,
    clarification: check.data.clarification,
    clarificationChoices: check.data.clarification_choices,
    notes: check.data.notes,
  };
}
