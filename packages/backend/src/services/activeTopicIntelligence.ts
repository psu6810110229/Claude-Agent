/**
 * Active topic intelligence — Phase B, Step 22.
 *
 * Pure module: no DB, no IO, no model. All functions are deterministic.
 * Intentionally self-contained (no import from chat.ts) to avoid circular
 * dependency — chat.ts imports this module and vice-versa would cause an
 * ESM circular dep that can fail at runtime.
 *
 * TOPIC_STOPWORDS mirrors LINE_STOPWORDS in chat.ts exactly.
 */

import type { ActiveTopic } from "../schemas/activeTopic.js";

// ─── Stopwords (mirror LINE_STOPWORDS in chat.ts exactly) ─────────────────

const TOPIC_STOPWORDS = new Set<string>([
  // Thai
  "ใคร", "อะไร", "ที่ไหน", "เมื่อไหร่", "เมื่อไร", "ทำไม", "ยังไง", "อย่างไร",
  "ล่าสุด", "บ้าง", "ไหม", "มั้ย", "หรอ", "หรือ", "ที่", "ของ", "ใน", "กับ",
  "และ", "แล้ว", "เรื่อง", "ข้อความ", "line", "ไลน์", "คน", "มี", "ถาม", "พูด",
  "คุย", "ส่ง", "ช่วย", "ขอ", "ดู", "หา", "ให้", "ได้", "ครับ", "ค่ะ", "นะ",
  // English
  "the", "a", "an", "is", "are", "was", "were", "in", "on", "of", "to", "for",
  "and", "or", "who", "what", "when", "where", "why", "how", "latest", "recent",
  "any", "did", "does", "do", "ask", "asked", "about", "message", "chat", "me",
  "my", "i", "you", "show", "find", "tell",
]);

// ─── extractTopicKeywords ──────────────────────────────────────────────────

/**
 * Same logic as extractLineKeywords in chat.ts. Duplicated here to avoid a
 * circular ESM import (chat.ts will import this module).
 */
export function extractTopicKeywords(message: string): string[] {
  const tokens = message
    .toLowerCase()
    .split(/[\s,.!?;:"'()[\]{}<>/\\|@#$%^&*+=~`‘’“”]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !TOPIC_STOPWORDS.has(t));
  const out: string[] = [];
  for (const t of tokens) {
    if (!out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

// ─── Follow-up pattern lists ───────────────────────────────────────────────

const THAI_FOLLOWUP_PATTERNS: string[] = [
  "ถึงไหนแล้ว",
  "มีใครตอบยัง",
  "ตอบยัง",
  "เรื่องนั้น",
  "อันนั้น",
  "แล้วล่ะ",
  "ล่าสุดล่ะ",
  "อัปเดตไหม",
  "อัพเดทไหม",
  "ต่อจากเมื่อกี้",
  "เป็นไงบ้าง",
  "ยังไงต่อ",
];

const ENGLISH_FOLLOWUP_PATTERNS: string[] = [
  "any update",
  "did anyone answer",
  "what about that",
  "follow up on that",
  "what's the status",
  "any reply",
];

const ALL_FOLLOWUP_PATTERNS = [...THAI_FOLLOWUP_PATTERNS, ...ENGLISH_FOLLOWUP_PATTERNS];

// ─── Public constants ──────────────────────────────────────────────────────

/** Minimum score for a topic to count as a "strong" match. */
export const STRONG_SCORE = 3;

// ─── isShortFollowupQuestion ───────────────────────────────────────────────

/**
 * True when the message is short (≤ 6 tokens) AND contains a follow-up
 * pattern, or is one of the purely elliptical single-phrase follow-ups (which
 * are also in the pattern list, so the short+pattern check covers them).
 */
export function isShortFollowupQuestion(message: string): boolean {
  const trimmed = message.trim();
  const lowerMsg = trimmed.toLowerCase();
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 6) return false;
  return ALL_FOLLOWUP_PATTERNS.some((p) => lowerMsg.includes(p));
}

// ─── scoreActiveTopic ──────────────────────────────────────────────────────

/**
 * Deterministic relevance score for (message, topic) pair.
 * Score >= STRONG_SCORE = strong match.
 *
 * +3  title substring match (message contains title, or short title token in message)
 * +1  per overlapping keyword (cap +3)
 * +2  chat_filter name substring appears in message
 * <1  recency tiebreak (never alone yields strong)
 */
export function scoreActiveTopic(
  message: string,
  topic: ActiveTopic,
  _history?: string,
): number {
  const lowerMsg = message.toLowerCase();
  const lowerTitle = topic.title.toLowerCase();
  let score = 0;

  // Title match
  if (lowerMsg.includes(lowerTitle)) {
    score += 3;
  } else if (lowerTitle.length <= 20) {
    // Reverse: check if a message token is contained in a short title
    const msgTokens = lowerMsg.split(/\s+/).filter((t) => t.length >= 2);
    for (const tok of msgTokens) {
      if (lowerTitle.includes(tok)) {
        score += 3;
        break;
      }
    }
  }

  // Keyword overlap (cap at +3)
  const msgKeywords = extractTopicKeywords(message);
  const topicKwLower = topic.keywords.map((k) => k.toLowerCase());
  let kwHits = 0;
  for (const kw of msgKeywords) {
    if (topicKwLower.some((tk) => tk.includes(kw) || kw.includes(tk))) {
      kwHits++;
      if (kwHits >= 3) break;
    }
  }
  score += kwHits;

  // chat_filter mention
  if (topic.chat_filter) {
    if (lowerMsg.includes(topic.chat_filter.toLowerCase())) {
      score += 2;
    }
  }

  // Recency tiebreak: tiny value (<1) — never alone triggers STRONG_SCORE
  if (topic.updated_at) {
    const ageMs = Date.now() - new Date(topic.updated_at).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const recency = Math.max(0, 1 - ageMs / (30 * dayMs));
    score += recency * 0.9;
  }

  return score;
}

// ─── ActiveTopicResolution ────────────────────────────────────────────────

export type ActiveTopicResolution =
  | { kind: "none" }
  | { kind: "resolved"; topic: ActiveTopic; score: number; reason: string }
  | { kind: "ambiguous"; candidates: ActiveTopic[]; reason: string };

/**
 * Deterministic resolver: maps (message, active topics) → 0 | 1 | ambiguous.
 *
 * Rules (no guessing):
 *  - Score all topics. strong = score >= STRONG_SCORE.
 *  - 1 strong → resolved.
 *  - ≥2 strong → ambiguous (top 3 by score then priority).
 *  - 0 strong AND isShortFollowupQuestion(message):
 *    - 1 active topic total → resolved (elliptical attachment).
 *    - ≥2 active topics → ambiguous.
 *    - else → none.
 *  - otherwise → none.
 */
export function resolveActiveTopicForMessage(
  message: string,
  topics: ActiveTopic[],
  _history?: string,
): ActiveTopicResolution {
  if (topics.length === 0) return { kind: "none" };

  const scored = topics.map((t) => ({
    topic: t,
    score: scoreActiveTopic(message, t, _history),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.topic.priority - a.topic.priority;
  });

  const strong = scored.filter((s) => s.score >= STRONG_SCORE);

  if (strong.length === 1) {
    return {
      kind: "resolved",
      topic: strong[0].topic,
      score: strong[0].score,
      reason: `title/keyword score ${strong[0].score.toFixed(1)} >= ${STRONG_SCORE}`,
    };
  }

  if (strong.length >= 2) {
    return {
      kind: "ambiguous",
      candidates: strong.slice(0, 3).map((s) => s.topic),
      reason: `${strong.length} topics scored strong`,
    };
  }

  // Elliptical follow-up path
  if (isShortFollowupQuestion(message)) {
    if (topics.length === 1) {
      return {
        kind: "resolved",
        topic: topics[0],
        score: scored[0].score,
        reason: "elliptical follow-up with single active topic",
      };
    }
    return {
      kind: "ambiguous",
      candidates: scored.slice(0, 3).map((s) => s.topic),
      reason: "elliptical follow-up with multiple active topics",
    };
  }

  return { kind: "none" };
}
