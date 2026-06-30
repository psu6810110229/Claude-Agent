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
 * This module is the OUTPUT CONTRACT only (Sprint 1). The rule-first logic lands
 * in Sprint 2; until then `resolveReference` returns a no-op `fresh_search` so
 * existing behavior is unchanged.
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

/**
 * Resolve what the current turn references. Sprint 1 stub: always `fresh_search`
 * so the Source Router behaves exactly as before until Sprint 2 supplies rules.
 */
export function resolveReference(
  _message: string,
  opts: ResolveReferenceOptions = {},
): ReferenceDecision {
  void opts;
  return {
    kind: "fresh_search",
    confidence: "low",
    reason_code: "not_a_reference",
    limitations: [],
  };
}
