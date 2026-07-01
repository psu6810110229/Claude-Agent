import type {
  CompactEvidenceScope,
  EvidenceScopeSource,
} from "./evidenceScope.js";

/**
 * Phase 03 — Conversation Reference Resolver (contract).
 *
 * Given the CURRENT user turn plus the recent evidence scopes (what prior
 * answers actually retrieved), decide whether this turn should reuse the same
 * evidence set, run a fresh source search, ask the user which set they mean, or
 * be treated as unsupported. This is the single decision the Source Router and
 * the (future) verifier both consult — see conversation-reference-audit.md.
 *
 * Sprint 2 — rule-first resolution. Cheap deterministic rules catch the common
 * cases (short follow-ups, pronouns, explicit new searches); anything genuinely
 * ambiguous falls back to `fresh_search` (unchanged behavior) so we never block a
 * real search. No model call here.
 *
 * PRIVACY: works on metadata-only scopes + the raw message. It returns ids,
 * counts, reason codes, and short labels — never message bodies.
 */

export type ReferenceDecisionKind =
  | "reuse_scope"
  | "fresh_search"
  | "clarify"
  | "unsupported";

/**
 * Debug-readable reason for the decision. Logged as a code (no private content)
 * so reference drift can be diagnosed from metadata alone.
 */
export type ReferenceReasonCode =
  | "no_recent_scope"
  | "not_a_reference"
  | "short_followup"
  | "pronoun_reference"
  | "single_dominant_scope"
  | "multiple_candidate_scopes"
  | "explicit_new_search"
  | "source_mismatch"
  | "unsupported_reference";

export type ReferenceConfidence = "low" | "medium" | "high";

export interface ReferenceDecision {
  kind: ReferenceDecisionKind;
  confidence: ReferenceConfidence;
  reason_code: ReferenceReasonCode;
  /** Scope to reuse (kind === "reuse_scope"). */
  selected_scope_id?: string;
  /** Source of the selected scope, so the router can gate the matching search. */
  selected_source?: EvidenceScopeSource;
  /** Ambiguous candidates (kind === "clarify"), newest-first, capped. */
  candidate_scope_ids?: string[];
  /** Short, metadata-only notes for debug/prompt (e.g. scope labels). */
  limitations: string[];
}

export interface ResolveReferenceOptions {
  /** Recent evidence scopes, newest-first (as produced by collectRecentScopes). */
  recentScopes?: readonly CompactEvidenceScope[];
}

// --- Rule vocab (lowercased substring match; Thai has no word spaces) ---------

// A short follow-up about the SAME set: count / repeat / re-check phrasing.
const FOLLOWUP_MARKERS = [
  // counts
  "กี่รูป", "กี่ภาพ", "กี่ไฟล์", "กี่อัน", "กี่ฉบับ", "กี่คน", "กี่เมล",
  "กี่อีเมล", "มีกี่", "จำนวน", "how many", "how much",
  // repeat / re-check
  "อะไรนะ", "ว่าไง", "ว่าไงนะ", "อีกที", "เช็คอีกที", "ดูอีกที", "ซ้ำ",
  "say again", "again", "what was that",
  // who (gmail/line follow-up)
  "ใครตอบ", "ใครส่ง", "จากใคร", "who replied", "who sent",
];

// Pointer / pronoun referring to a member of the prior set.
const PRONOUN_MARKERS = [
  "อันนั้น", "อันนี้", "อันแรก", "อันสุดท้าย", "อันที่", "ตัวแรก", "ตัวนั้น",
  "ตัวนี้", "ฉบับแรก", "ล่าสุดว่าไง", "that one", "this one", "first one",
  "last one", "the first", "the last",
];

// Explicit intent to run a NEW search — must win over follow-up markers so a real
// search is never suppressed. Phrased specifically to avoid catching "อีกที".
const EXPLICIT_NEW_SEARCH_MARKERS = [
  "ค้นใหม่", "ค้นหาใหม่", "หาใหม่", "ลองค้น", "ลองหา", "หาเพิ่ม", "หาอีกที",
  "อีกโฟลเดอร์", "โฟลเดอร์อื่น", "ที่อื่น", "search again", "new search",
  "search for", "look again",
];

// Source affinity: which connector a bare follow-up names, if any.
const SOURCE_AFFINITY: { source: EvidenceScopeSource; markers: string[] }[] = [
  {
    source: "google_drive",
    markers: ["รูป", "ภาพ", "ไฟล์", "file", "ไดร์ฟ", "ไดรฟ์", "drive", "โฟลเดอร์", "folder", "เอกสาร", "doc"],
  },
  { source: "gmail", markers: ["เมล", "อีเมล", "mail", "email", "gmail", "ฉบับ"] },
  { source: "line_export", markers: ["ไลน์", "line", "แชท", "chat"] },
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function detectSourceAffinity(message: string): EvidenceScopeSource | null {
  const m = message.toLowerCase();
  for (const { source, markers } of SOURCE_AFFINITY) {
    if (includesAny(m, markers)) return source;
  }
  return null;
}

function decisionFor(scope: CompactEvidenceScope, code: ReferenceReasonCode): ReferenceDecision {
  return {
    kind: "reuse_scope",
    confidence: scope.confidence,
    reason_code: code,
    selected_scope_id: scope.id,
    selected_source: scope.source,
    limitations: scope.limitations.slice(0, 3),
  };
}

/**
 * Resolve what the current turn references.
 *
 * Rule order (first match wins):
 *  1. explicit new-search phrasing → fresh_search (never suppress a real search)
 *  2. not a follow-up/pronoun      → fresh_search (normal behavior unchanged)
 *  3. no recent scopes to bind     → fresh_search
 *  4. named source with matching scope(s):
 *       1 → reuse; >1 → clarify; 0 → fresh_search (source_mismatch)
 *  5. bare follow-up, no named source:
 *       1 scope → reuse; >1 → reuse NEWEST (the last answer is the referent)
 */
export function resolveReference(
  message: string,
  opts: ResolveReferenceOptions = {},
): ReferenceDecision {
  const m = (message ?? "").toLowerCase();
  const scopes = opts.recentScopes ?? [];

  // 1. Explicit new search wins outright.
  if (includesAny(m, EXPLICIT_NEW_SEARCH_MARKERS)) {
    return {
      kind: "fresh_search",
      confidence: "high",
      reason_code: "explicit_new_search",
      limitations: [],
    };
  }

  const isFollowup = includesAny(m, FOLLOWUP_MARKERS);
  const isPronoun = includesAny(m, PRONOUN_MARKERS);

  // 2. Nothing reference-like → leave the normal source flow alone.
  if (!isFollowup && !isPronoun) {
    return {
      kind: "fresh_search",
      confidence: "low",
      reason_code: "not_a_reference",
      limitations: [],
    };
  }

  const baseCode: ReferenceReasonCode = isPronoun ? "pronoun_reference" : "short_followup";

  // 3. A follow-up but nothing bound yet → fall through to a fresh search.
  if (scopes.length === 0) {
    return {
      kind: "fresh_search",
      confidence: "low",
      reason_code: "no_recent_scope",
      limitations: [],
    };
  }

  const affinity = detectSourceAffinity(m);

  // 4. The follow-up names a source.
  if (affinity) {
    const matching = scopes.filter((s) => s.source === affinity);
    if (matching.length === 1) {
      return decisionFor(matching[0], "single_dominant_scope");
    }
    if (matching.length > 1) {
      return {
        kind: "clarify",
        confidence: "low",
        reason_code: "multiple_candidate_scopes",
        candidate_scope_ids: matching.slice(0, 4).map((s) => s.id),
        selected_source: affinity,
        limitations: matching
          .slice(0, 4)
          .map((s) => s.label ?? s.query ?? s.id)
          .filter((l): l is string => Boolean(l)),
      };
    }
    // Named a source we never retrieved this conversation → search it fresh.
    return {
      kind: "fresh_search",
      confidence: "low",
      reason_code: "source_mismatch",
      selected_source: affinity,
      limitations: [],
    };
  }

  // 5. Bare follow-up: the most recent answer is the natural referent.
  if (scopes.length === 1) {
    return decisionFor(scopes[0], baseCode);
  }
  // Multiple recent scopes, no named source → bind the newest (scopes are
  // newest-first). A bare "กี่อัน" refers to the last thing shown.
  const newest = scopes[0];
  return {
    kind: "reuse_scope",
    confidence: newest.confidence === "high" ? "medium" : "low",
    reason_code: baseCode,
    selected_scope_id: newest.id,
    selected_source: newest.source,
    limitations: newest.limitations.slice(0, 3),
  };
}
