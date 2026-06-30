import type { ClassBlock } from "../schemas/classBlock.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";

/**
 * Phase 05 / Sprint 1 — Class/event reference matcher (contract).
 *
 * Given a short human reference to a class ("240-218", "circuit", "วงจรไฟฟ้า",
 * "เรียนวงจร") decide WHICH known class it points at: an active local class_block
 * or an existing Google Calendar event. The audit
 * (conversation-reference-audit.md) showed the gap is the operation planner —
 * the system already holds the timetable but had no deterministic way to bind a
 * terse class name to it, so a makeup/cancel request could not be grounded.
 *
 * Deterministic, pure, no IO. The caller supplies the candidate class_blocks and
 * calendar events; this only RANKS the match. When two distinct subjects match
 * with comparable strength the result is `ambiguous` so the planner asks the user
 * which class instead of guessing the wrong subject.
 *
 * PRIVACY: works on titles/codes/ids only — the same metadata the timetable and
 * calendar read projections already expose. No message bodies.
 */

export type ClassMatchKind = "class_block" | "google_event";

/** What in the reference produced the match (debug + confidence rationale). */
export type ClassMatchSignal = "course_code" | "title_exact" | "title_token";

export type ClassMatchConfidence = "low" | "medium" | "high";

export interface ClassMatchCandidate {
  kind: ClassMatchKind;
  /** class_block id (number→string) or Google event id. */
  id: string;
  /** Display subject/title — metadata only. */
  label: string;
  /** Course code extracted from the candidate, when it carries one. */
  code?: string;
  confidence: ClassMatchConfidence;
  signal: ClassMatchSignal;
  /** Stable subject key used to detect distinct-subject ambiguity. */
  subjectKey: string;
}

export type ClassMatchStatus = "matched" | "ambiguous" | "no_match";

export interface ClassMatchResult {
  status: ClassMatchStatus;
  /** Best candidate when status === "matched". */
  selected?: ClassMatchCandidate;
  /** Distinct-subject candidates when status === "ambiguous" (capped). */
  candidates: ClassMatchCandidate[];
  /** True total before the candidate cap, for transparency. */
  total_candidates: number;
}

export interface MatchClassReferenceInput {
  classBlocks?: readonly ClassBlock[];
  googleEvents?: readonly GoogleEvent[];
}

const MAX_CANDIDATES = 4;

const CONFIDENCE_RANK: Record<ClassMatchConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * A course code as used by the timetable: three digits, a dash, three digits
 * (e.g. "240-218"). The dash is optional in user text ("240218") so we normalize
 * both sides to digits-only before comparing.
 */
const COURSE_CODE_RE = /\b(\d{3})\s*[-–]?\s*(\d{3})\b/;

/** Tokens too generic to anchor a class match on their own. */
const STOPWORDS = new Set([
  "เรียน", "คาบ", "วิชา", "class", "course", "subject", "the", "a", "an",
  "วัน", "เวลา", "ออนไลน์", "online", "ห้อง", "room",
]);

function normalizeCode(value: string): string | undefined {
  const m = value.match(COURSE_CODE_RE);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}`;
}

/** Lowercase, collapse whitespace; keep Thai/Latin/digits for token matching. */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Split a label/reference into matchable tokens. Latin words split on
 * non-alphanumerics; Thai has no word spaces, so a contiguous Thai run is kept as
 * one token and matched by substring at compare time. Stopwords are dropped.
 */
function tokenize(value: string): string[] {
  const norm = normalizeText(value);
  const raw = norm
    .replace(/[\d]{3}\s*[-–]?\s*[\d]{3}/g, " ") // drop the code; matched separately
    .split(/[^a-z0-9ก-๙]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(raw)];
}

/** Stable key grouping candidates by subject (code if present, else label). */
function subjectKeyOf(code: string | undefined, label: string): string {
  return code ?? normalizeText(label);
}

interface CandidateSource {
  kind: ClassMatchKind;
  id: string;
  label: string;
}

function candidateSources(input: MatchClassReferenceInput): CandidateSource[] {
  const out: CandidateSource[] = [];
  for (const b of input.classBlocks ?? []) {
    out.push({ kind: "class_block", id: String(b.id), label: b.subject });
  }
  for (const e of input.googleEvents ?? []) {
    out.push({ kind: "google_event", id: e.id, label: e.title });
  }
  return out;
}

/**
 * Score one candidate against the reference. Course code is the strongest signal
 * (a code uniquely names a course); an exact normalized title match is high too;
 * a shared content token is a medium lead. Returns null when nothing matches.
 */
function scoreCandidate(
  src: CandidateSource,
  refCode: string | undefined,
  refTokens: readonly string[],
  refNorm: string,
): ClassMatchCandidate | null {
  const code = normalizeCode(src.label);
  const labelNorm = normalizeText(src.label);
  const subjectKey = subjectKeyOf(code, src.label);
  const base = { kind: src.kind, id: src.id, label: src.label, code, subjectKey };

  if (refCode && code && refCode === code) {
    return { ...base, confidence: "high", signal: "course_code" };
  }
  // Exact (either direction): reference is the whole subject, or vice-versa.
  if (refNorm && labelNorm && (labelNorm === refNorm || labelNorm.includes(refNorm) || refNorm.includes(labelNorm))) {
    // A bare generic reference shouldn't count as exact; require some length.
    if (refNorm.length >= 3) {
      return { ...base, confidence: "high", signal: "title_exact" };
    }
  }
  // Shared content token (Thai substring or Latin whole token).
  const labelTokens = tokenize(src.label);
  const shared = refTokens.some((rt) =>
    labelTokens.some((lt) => lt === rt || lt.includes(rt) || rt.includes(lt)),
  );
  if (shared) {
    return { ...base, confidence: "medium", signal: "title_token" };
  }
  return null;
}

function rankCandidate(c: ClassMatchCandidate): number {
  // course_code > title_exact > title_token, then class_block before google_event
  // (the local timetable is the canonical class definition).
  const signalRank = c.signal === "course_code" ? 3 : c.signal === "title_exact" ? 2 : 1;
  const kindRank = c.kind === "class_block" ? 1 : 0;
  return CONFIDENCE_RANK[c.confidence] * 10 + signalRank * 2 + kindRank;
}

/**
 * Resolve a class reference to a known class_block / calendar event.
 *
 * Algorithm:
 *  1. Extract the course code + content tokens from the reference.
 *  2. Score every candidate; keep matches.
 *  3. Collapse to ONE candidate per distinct subject (best-ranked wins) so two
 *     weekday rows of the same class don't look like two different classes.
 *  4. 0 subjects → no_match. 1 → matched. >1 → ambiguous (let the planner ask),
 *     UNLESS exactly one subject matched by course code while the others only
 *     matched a weak shared token — a code is decisive, so it wins outright.
 */
export function matchClassReference(
  reference: string,
  input: MatchClassReferenceInput,
): ClassMatchResult {
  const refNorm = normalizeText(reference ?? "");
  const refCode = normalizeCode(reference ?? "");
  const refTokens = tokenize(reference ?? "");

  if (!refNorm) {
    return { status: "no_match", candidates: [], total_candidates: 0 };
  }

  const scored: ClassMatchCandidate[] = [];
  for (const src of candidateSources(input)) {
    const c = scoreCandidate(src, refCode, refTokens, refNorm);
    if (c) scored.push(c);
  }

  if (scored.length === 0) {
    return { status: "no_match", candidates: [], total_candidates: 0 };
  }

  // Best candidate per distinct subject.
  const bySubject = new Map<string, ClassMatchCandidate>();
  for (const c of scored) {
    const prev = bySubject.get(c.subjectKey);
    if (!prev || rankCandidate(c) > rankCandidate(prev)) {
      bySubject.set(c.subjectKey, c);
    }
  }

  const subjects = [...bySubject.values()].sort((a, b) => rankCandidate(b) - rankCandidate(a));
  const total = subjects.length;

  if (total === 1) {
    return { status: "matched", selected: subjects[0], candidates: subjects, total_candidates: 1 };
  }

  // Decisive code: exactly one subject matched on course_code → it wins even when
  // weaker token matches exist for other subjects.
  const codeMatches = subjects.filter((s) => s.signal === "course_code");
  if (codeMatches.length === 1) {
    return {
      status: "matched",
      selected: codeMatches[0],
      candidates: [codeMatches[0]],
      total_candidates: total,
    };
  }

  return {
    status: "ambiguous",
    candidates: subjects.slice(0, MAX_CANDIDATES),
    total_candidates: total,
  };
}
