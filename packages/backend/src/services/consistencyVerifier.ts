import type { EvidenceScope } from "./evidenceScope.js";
import type { ChatSourcePreview } from "./chat.js";
import type { ReferenceDecision } from "./referenceResolver.js";
import type { AiAction } from "../schemas/aiCommand.js";

/**
 * Phase 04 — Deterministic Consistency Verifier (contract).
 *
 * One gate, run AFTER the answer + previews + evidence scopes for a turn are
 * assembled and BEFORE the response is returned to the user. It asks a single
 * question: do the answer, the source preview, the evidence scope, and any
 * proposed action all describe the SAME evidence set? The audit
 * (conversation-reference-audit.md) showed the system can answer correctly while
 * shipping a preview from a different/larger set ("+26 ภาพ"): nothing checked that
 * the count in the answer and the count in the preview were one set.
 *
 * Deterministic, pure, no IO. It does NOT call a model and does NOT try to parse
 * every natural-language nuance — it checks metadata first (ids, counts, sources)
 * because that is where the real drift was observed.
 *
 * PRIVACY: works on metadata only — ids, counts, sources, short labels, reason
 * codes. Never message bodies, snippets, emails, secrets, or DB rows. `detail`
 * strings on findings carry counts/ids/codes only.
 *
 * Sprint 1 — contract + scope metadata invariants. Sprints 2–4 add count/preview,
 * cross-source, and action-proposal checks on top of the same gate.
 */

/**
 * What the gate decides for the turn:
 *  - `pass`       — answer/preview/scope/action are consistent; ship as-is.
 *  - `repairable` — a deterministic fix exists (e.g. drop an out-of-scope preview
 *                   id, correct a stale total); apply the repair, then ship.
 *  - `clarify`    — the reference is genuinely ambiguous; ask the user which set
 *                   they mean instead of guessing (mirrors ReferenceDecision).
 *  - `block`      — internally inconsistent and not safely repairable; withhold the
 *                   mismatched preview/action rather than show a wrong set.
 */
export type ConsistencyStatus = "pass" | "repairable" | "clarify" | "block";

export type ConsistencyReasonCode =
  | "consistent"
  // Sprint 1 — scope metadata invariants
  | "duplicate_scope_id"
  | "preview_ids_not_in_scope"
  | "total_below_item_count"
  // reserved for later sprints (declared now so the contract is stable)
  | "count_vs_evidence_mismatch"
  | "preview_overflow_unexplained"
  | "source_mismatch"
  | "mixed_source_preview"
  | "action_reference_ambiguous"
  | "action_scope_unresolved";

/** Severity order, worst-first. The turn verdict takes the worst finding. */
const STATUS_RANK: Record<ConsistencyStatus, number> = {
  block: 3,
  clarify: 2,
  repairable: 1,
  pass: 0,
};

export interface ConsistencyFinding {
  code: ConsistencyReasonCode;
  status: ConsistencyStatus;
  /** Metadata-only debug detail (counts/ids/sources). Never a message body. */
  detail: string;
}

export interface ConsistencyVerdict {
  status: ConsistencyStatus;
  /** Reason code of the worst finding (or "consistent" when nothing fired). */
  reason_code: ConsistencyReasonCode;
  findings: ConsistencyFinding[];
}

export interface ConsistencyInput {
  /** The answer text about to be sent (reply). Metadata extraction only. */
  answer: string;
  /** The aligned source previews attached to the answer. */
  previews: readonly ChatSourcePreview[];
  /** The evidence scopes built for THIS turn (same set the answer is aligned to). */
  scopes: readonly EvidenceScope[];
  /** The reference resolver verdict for this turn, if any. */
  reference?: ReferenceDecision | null;
  /** Proposed actions for this turn (pre-dispatch). */
  proposedActions?: readonly AiAction[];
}

const PASS: ConsistencyVerdict = {
  status: "pass",
  reason_code: "consistent",
  findings: [],
};

/**
 * Reduce findings to a single verdict: worst status wins, and its first finding
 * supplies the primary reason code. No findings → pass.
 */
function decide(findings: ConsistencyFinding[]): ConsistencyVerdict {
  if (findings.length === 0) return PASS;
  let worst = findings[0];
  for (const f of findings) {
    if (STATUS_RANK[f.status] > STATUS_RANK[worst.status]) worst = f;
  }
  return { status: worst.status, reason_code: worst.code, findings };
}

/**
 * Sprint 1 — scope metadata invariants. These are STRUCTURAL guarantees the
 * scope builders are supposed to uphold; checking them at the gate catches a bad
 * builder before its mismatch reaches the user.
 *
 *  - scope ids must be unique within the turn (a follow-up binds by id; a dup id
 *    makes "which set" undecidable).
 *  - preview_item_ids must be a subset of item_ids (you cannot preview an item the
 *    scope does not contain) → repairable: drop the stray preview ids.
 *  - total_count, when present, must be >= the number of held item ids (the total
 *    is the true count before the preview cap, so it can only be larger or equal)
 *    → repairable: clamp the total up to the held count.
 */
function checkScopeMetadata(scopes: readonly EvidenceScope[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const seenIds = new Set<string>();

  for (const scope of scopes) {
    if (seenIds.has(scope.id)) {
      findings.push({
        code: "duplicate_scope_id",
        status: "block",
        detail: `scope id "${scope.id}" appears more than once this turn`,
      });
    } else {
      seenIds.add(scope.id);
    }

    const itemIdSet = new Set(scope.item_ids);
    const strayPreviewIds = scope.preview_item_ids.filter((id) => !itemIdSet.has(id));
    if (strayPreviewIds.length > 0) {
      findings.push({
        code: "preview_ids_not_in_scope",
        status: "repairable",
        detail: `scope "${scope.id}" has ${strayPreviewIds.length} preview id(s) not in item_ids`,
      });
    }

    if (
      typeof scope.total_count === "number" &&
      scope.total_count < scope.item_ids.length
    ) {
      findings.push({
        code: "total_below_item_count",
        status: "repairable",
        detail: `scope "${scope.id}" total_count ${scope.total_count} < ${scope.item_ids.length} held ids`,
      });
    }
  }

  return findings;
}

/**
 * Verify that one turn's answer, previews, evidence scopes, and proposed actions
 * describe a single consistent evidence set. The single gate the chat pipeline
 * consults before returning a reply.
 *
 * Sprint 1 runs scope metadata invariants only. Later sprints append count/
 * preview, cross-source, and action-proposal findings to the same list.
 */
export function verifyTurnConsistency(input: ConsistencyInput): ConsistencyVerdict {
  const findings: ConsistencyFinding[] = [];
  findings.push(...checkScopeMetadata(input.scopes));
  return decide(findings);
}
