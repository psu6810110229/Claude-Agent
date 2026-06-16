/**
 * LINE evidence builder — Phase B, Step 22.
 *
 * Builds a capped, snippet-safe evidence bundle for an active topic from the
 * ALREADY-INGESTED exported LINE files only (via `searchLineMessages`).
 * Never triggers live LINE, never logs message text, never writes to LINE.
 *
 * All evidence is sourced from locally exported .txt files; it is approximate
 * (Bangkok minute-granularity, no read/unread state) and may be stale if the
 * export has not been refreshed. Callers must reflect these limitations.
 */

import { searchLineMessages, isLineEnabled } from "./lineChat.js";
import type { LineMessage } from "../schemas/lineChat.js";
import type { ActiveTopic } from "../schemas/activeTopic.js";

// ─── Cap constants ─────────────────────────────────────────────────────────

export const SNIPPET_MAX_CHARS = 200;
export const EVIDENCE_MAX_LINES = 24;
export const EVIDENCE_MAX_CHATS = 6;
export const EVIDENCE_SCAN_CAP = 60;
export const MAX_CANDIDATE_QUESTIONS = 8;
export const MAX_CANDIDATE_ANSWERS = 8;

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface EvidenceMessage {
  chat: string;
  sender: string | null;
  text: string; // capped to SNIPPET_MAX_CHARS
  date: string; // Asia/Bangkok YYYY-MM-DD
  time: string; // Asia/Bangkok HH:mm
  atUtc: string; // ISO 8601 UTC (approximate)
  kind: "question" | "media" | "statement";
  isCandidateAnswer?: boolean;
}

export interface EvidenceStats {
  total: number;
  questions: number;
  candidateAnswers: number;
  chats: number;
  newestAtUtc: string | null;
}

export interface LineEvidence {
  available: boolean; // false ONLY when LINE disabled/error; NOT "no matches"
  topicId: number | null;
  messages: EvidenceMessage[]; // capped, newest-first
  candidateQuestions: EvidenceMessage[];
  candidateAnswers: EvidenceMessage[];
  stats: EvidenceStats;
  newestAtUtc: string | null;
  staleCaveat: boolean; // true when newest evidence is old or list was capped
}

// ─── Media / question markers ──────────────────────────────────────────────

const MEDIA_MARKERS = new Set([
  "Photos", "Photo", "Videos", "Video", "Stickers", "Sticker",
  "Voice message", "Files", "File", "Location", "Contact",
]);

const THAI_QUESTION_MARKERS = ["ไหม", "มั้ย", "หรอ", "หรือ", "กี่", "เมื่อไหร่", "ยังไง", "ทำไม"];
const ENGLISH_QUESTION_MARKERS = ["when", "where", "how", "did", "does", "can"];

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Classify a message's first line as media, question, or statement. */
export function inferLineMessageKind(
  text: string,
): "question" | "media" | "statement" {
  const firstLine = text.split("\n")[0].trim();
  // Media: exactly one of the marker tokens
  for (const marker of MEDIA_MARKERS) {
    if (firstLine === marker) return "media";
  }
  // Question: contains question marker or trailing ?
  if (firstLine.endsWith("?")) return "question";
  const lower = firstLine.toLowerCase();
  if (THAI_QUESTION_MARKERS.some((m) => lower.includes(m))) return "question";
  if (ENGLISH_QUESTION_MARKERS.some((m) => lower.includes(m))) return "question";
  return "statement";
}

function capSnippet(text: string): string {
  return text.length <= SNIPPET_MAX_CHARS
    ? text
    : text.slice(0, SNIPPET_MAX_CHARS - 1) + "…";
}

function toEvidenceMessage(
  m: LineMessage & { chat: string },
  kind?: "question" | "media" | "statement",
): EvidenceMessage {
  return {
    chat: m.chat,
    sender: m.sender,
    text: capSnippet(m.text),
    date: m.date,
    time: m.time,
    atUtc: m.atUtc,
    kind: kind ?? inferLineMessageKind(m.text),
  };
}

// ─── findLineMessagesSince ─────────────────────────────────────────────────

/** Wraps searchLineMessages, filters by sinceUtc and optional chatFilter. */
export function findLineMessagesSince(opts: {
  keywords: string[];
  chatFilter?: string | null;
  sinceUtc: string;
  cap: number;
}): (LineMessage & { chat: string })[] {
  const raw = searchLineMessages(opts.keywords, opts.cap);
  return raw.filter((m) => {
    if (m.atUtc <= opts.sinceUtc) return false;
    if (opts.chatFilter) {
      const cfLower = opts.chatFilter.toLowerCase();
      if (!m.chat.toLowerCase().includes(cfLower)) return false;
    }
    return true;
  });
}

// ─── findCandidateQuestions ────────────────────────────────────────────────

export function findCandidateQuestions(
  messages: EvidenceMessage[],
): EvidenceMessage[] {
  return messages
    .filter((m) => m.kind === "question")
    .slice(0, MAX_CANDIDATE_QUESTIONS);
}

// ─── findCandidateAnswers ─────────────────────────────────────────────────

const ANSWER_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * For each candidate question, find later non-system messages in the same chat
 * chronologically within 72h, preferring a different sender. Caps to
 * MAX_CANDIDATE_ANSWERS total.
 */
export function findCandidateAnswers(
  allMessages: EvidenceMessage[],
  questions: EvidenceMessage[],
): EvidenceMessage[] {
  const answers: EvidenceMessage[] = [];
  const seen = new Set<string>();

  for (const q of questions) {
    if (answers.length >= MAX_CANDIDATE_ANSWERS) break;
    const qTime = new Date(q.atUtc).getTime();

    // Find messages in same chat, after the question, within window
    const candidates = allMessages.filter((m) => {
      if (m.chat !== q.chat) return false;
      if (m.kind === "media") return false;
      const mTime = new Date(m.atUtc).getTime();
      if (mTime <= qTime) return false;
      if (mTime - qTime > ANSWER_WINDOW_MS) return false;
      return true;
    });

    // Prefer different sender
    const diffSender = candidates.filter((m) => m.sender !== q.sender);
    const pool = diffSender.length > 0 ? diffSender : candidates;

    for (const c of pool) {
      if (answers.length >= MAX_CANDIDATE_ANSWERS) break;
      const key = `${c.chat}|${c.atUtc}|${c.sender ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      answers.push({ ...c, isCandidateAnswer: true });
    }
  }

  return answers;
}

// ─── summarizeEvidenceStats ────────────────────────────────────────────────

export function summarizeEvidenceStats(evidence: LineEvidence): EvidenceStats {
  const chats = new Set(evidence.messages.map((m) => m.chat)).size;
  return {
    total: evidence.messages.length,
    questions: evidence.candidateQuestions.length,
    candidateAnswers: evidence.candidateAnswers.length,
    chats,
    newestAtUtc: evidence.newestAtUtc,
  };
}

// ─── makeEmptyLineEvidence ─────────────────────────────────────────────────

export function makeEmptyLineEvidence(
  available: boolean,
  topicId: number | null,
): LineEvidence {
  return {
    available,
    topicId,
    messages: [],
    candidateQuestions: [],
    candidateAnswers: [],
    stats: { total: 0, questions: 0, candidateAnswers: 0, chats: 0, newestAtUtc: null },
    newestAtUtc: null,
    staleCaveat: false,
  };
}

// ─── buildLineEvidenceForTopic ─────────────────────────────────────────────

/**
 * Main entry: build a capped evidence bundle for `topic` from exported LINE
 * files only. Fail-soft: returns empty evidence with `available:false` on LINE
 * disabled or any error. Never logs message text.
 */
export function buildLineEvidenceForTopic(
  topic: ActiveTopic,
  opts?: { sinceUtc?: string },
): LineEvidence {
  if (!isLineEnabled()) {
    return makeEmptyLineEvidence(false, topic.id);
  }

  try {
    const sinceUtc = opts?.sinceUtc ?? topic.baseline_at;

    const raw = findLineMessagesSince({
      keywords: topic.keywords,
      chatFilter: topic.chat_filter,
      sinceUtc,
      cap: EVIDENCE_SCAN_CAP,
    });

    // Deduplicate chats; cap to EVIDENCE_MAX_CHATS (keep most recent chats)
    const chatOrder: string[] = [];
    for (const m of raw) {
      if (!chatOrder.includes(m.chat)) chatOrder.push(m.chat);
    }
    const allowedChats = new Set(chatOrder.slice(0, EVIDENCE_MAX_CHATS));

    const filtered = raw.filter((m) => allowedChats.has(m.chat));
    const wasCapped = raw.length >= EVIDENCE_SCAN_CAP || filtered.length !== raw.length;

    // Convert to EvidenceMessage, cap to EVIDENCE_MAX_LINES
    const evidenceMsgs: EvidenceMessage[] = filtered
      .slice(0, EVIDENCE_MAX_LINES)
      .map((m) => toEvidenceMessage(m));

    const newestAtUtc =
      evidenceMsgs.length > 0 ? evidenceMsgs[0].atUtc : null;

    // Stale caveat: list was capped, or newest evidence is >48h ago
    let staleCaveat = wasCapped;
    if (!staleCaveat && newestAtUtc) {
      const ageMs = Date.now() - new Date(newestAtUtc).getTime();
      if (ageMs > 48 * 60 * 60 * 1000) staleCaveat = true;
    }

    const candidateQuestions = findCandidateQuestions(evidenceMsgs);
    const candidateAnswers = findCandidateAnswers(evidenceMsgs, candidateQuestions);

    const stats: EvidenceStats = {
      total: evidenceMsgs.length,
      questions: candidateQuestions.length,
      candidateAnswers: candidateAnswers.length,
      chats: allowedChats.size,
      newestAtUtc,
    };

    return {
      available: true,
      topicId: topic.id,
      messages: evidenceMsgs,
      candidateQuestions,
      candidateAnswers,
      stats,
      newestAtUtc,
      staleCaveat,
    };
  } catch {
    return makeEmptyLineEvidence(false, topic.id);
  }
}
