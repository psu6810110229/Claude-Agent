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

// --- Sprint 2: count + preview consistency -----------------------------------

/** Counter words → the source a numbered claim is about. Drive/Gmail/LINE. */
const COUNT_WORD_SOURCE: { source: EvidenceScope["source"]; words: string[] }[] = [
  {
    source: "google_drive",
    words: ["รูป", "ภาพ", "ไฟล์", "เอกสาร", "โฟลเดอร์", "file", "files", "image", "images", "photo", "photos", "doc", "docs"],
  },
  {
    source: "gmail",
    words: ["เมล", "อีเมล", "ฉบับ", "mail", "email", "emails"],
  },
  {
    source: "line_export",
    words: ["ข้อความ", "แชท", "message", "messages", "chat"],
  },
];

const THAI_DIGITS: Record<string, string> = {
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

function normalizeDigits(value: string): string {
  return value.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d);
}

interface CountClaim {
  value: number;
  /** Source the counter word names, or null when generic (อัน/รายการ). */
  source: EvidenceScope["source"] | null;
}

/**
 * Extract explicit "<number> <counter>" claims from the answer (e.g. "5 รูป",
 * "12 ฉบับ", "3 files"). Conservative: only number+counter adjacency, Thai or
 * Arabic digits. Generic counters (อัน/รายการ/item) carry a null source so they
 * compare against whatever single scope exists. Metadata only — no body parsing.
 */
export function extractCountClaims(answer: string): CountClaim[] {
  const text = normalizeDigits(answer.toLowerCase());
  const out: CountClaim[] = [];
  // number, optional spaces, then a counter word. The word class includes
  // combining marks (\p{M}) so Thai vowel signs (e.g. ู in "รูป") don't truncate
  // the token to its first consonant.
  const re = /(\d{1,6})\s*([\p{L}\p{M}]+)/gu;
  for (const match of text.matchAll(re)) {
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value)) continue;
    const word = match[2];
    let source: EvidenceScope["source"] | null = null;
    let matched = false;
    for (const { source: s, words } of COUNT_WORD_SOURCE) {
      if (words.some((w) => word.startsWith(w) || word.includes(w))) {
        source = s;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // generic counters that still denote "items in the set"
      if (!/^(อัน|ราย|รายการ|item|items|result|results)/.test(word)) continue;
    }
    out.push({ value, source });
  }
  return out;
}

interface AuthoritativeCount {
  source: EvidenceScope["source"];
  scopeId: string;
  /** True total before the preview cap. */
  total: number;
  /** How many ids are actually held/previewable. */
  shown: number;
  /** A limitation already explains the overflow (preview shows N of M). */
  overflowExplained: boolean;
}

function authoritativeCounts(scopes: readonly EvidenceScope[]): AuthoritativeCount[] {
  return scopes.map((s) => {
    const shown = s.item_ids.length;
    const total = typeof s.total_count === "number" ? s.total_count : shown;
    const overflowExplained = s.limitations.some((l) => /\bof\b|\/|จาก|ทั้งหมด/.test(l));
    return { source: s.source, scopeId: s.id, total, shown, overflowExplained };
  });
}

/**
 * Sprint 2 — the answer's stated counts, the preview total, and the evidence
 * count must describe one set. This is the audit's headline case: the answer
 * says 5 but the preview ships 30 with nothing explaining the gap.
 *
 *  - claim > authoritative total → BLOCK. The answer asserts more items than the
 *    evidence holds; that is a fabricated count, not a repairable display glitch.
 *  - claim < total with the overflow UNEXPLAINED → repairable. The answer is about
 *    a smaller set than the preview advertises; clamp the preview to the evidence
 *    (or add an explicit "N of M") rather than show a larger, different set.
 *  - claim within {shown, total} or overflow explained → consistent.
 */
function checkCountPreview(input: ConsistencyInput): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const counts = authoritativeCounts(input.scopes);
  if (counts.length === 0) return findings;

  for (const claim of extractCountClaims(input.answer)) {
    const targets = claim.source
      ? counts.filter((c) => c.source === claim.source)
      : counts;
    // Only judge an unambiguous comparison: exactly one candidate evidence set.
    if (targets.length !== 1) continue;
    const t = targets[0];

    if (claim.value > t.total) {
      findings.push({
        code: "count_vs_evidence_mismatch",
        status: "block",
        detail: `answer claims ${claim.value} but scope "${t.scopeId}" holds ${t.total}`,
      });
      continue;
    }
    if (claim.value === t.total) continue; // answer == true total → consistent
    // claim < total. Fine ONLY when it is the shown subset AND a limitation
    // explains the gap ("preview shows 5 of 30"). Otherwise the preview will
    // render the larger total and contradict the answer → repair the preview.
    if (claim.value === t.shown && t.overflowExplained) continue;
    findings.push({
      code: "preview_overflow_unexplained",
      status: "repairable",
      detail: `answer claims ${claim.value} but preview total is ${t.total} for "${t.scopeId}" (overflow unexplained)`,
    });
  }

  return findings;
}

/**
 * Deterministic repair for `preview_overflow_unexplained` / inflated totals:
 * clamp each Drive preview's `totalItems` to the authoritative evidence count for
 * its source (and never below the items it actually shows). The evidence scope is
 * built from the SAME aligned preview the answer uses, so it is the source of
 * truth; a larger `totalItems` is the "+26" inflation the audit found. Returns a
 * new array; inputs untouched. Pure.
 */
export function repairPreviewCounts(
  previews: readonly ChatSourcePreview[],
  scopes: readonly EvidenceScope[],
): ChatSourcePreview[] {
  const totalBySource = new Map<EvidenceScope["source"], number>();
  for (const c of authoritativeCounts(scopes)) {
    // If several scopes share a source, keep the largest authoritative total.
    totalBySource.set(c.source, Math.max(totalBySource.get(c.source) ?? 0, c.total));
  }
  return previews.map((preview) => {
    if (preview.kind !== "drive") return preview;
    const authoritative = totalBySource.get("google_drive");
    if (authoritative === undefined) return preview;
    const current = preview.totalItems ?? preview.items.length;
    const clamped = Math.max(preview.items.length, Math.min(current, authoritative));
    if (clamped === current) return preview;
    return { ...preview, totalItems: clamped };
  });
}

// --- Sprint 3: source consistency across Drive/Gmail/LINE --------------------

/** Map a source-preview card to the evidence-scope source it represents. */
function previewSource(
  preview: ChatSourcePreview,
): Extract<EvidenceScope["source"], "google_drive" | "gmail"> {
  return preview.kind === "drive" ? "google_drive" : "gmail";
}

/** Previews that actually carry evidence (a found card with items). */
function shownPreviews(
  previews: readonly ChatSourcePreview[],
): ChatSourcePreview[] {
  return previews.filter((p) => p.items.length > 0);
}

/**
 * Sprint 3 — the source preview attached to an answer must come from the SAME
 * evidence the answer used. Two drifts the audit warns about:
 *
 *  - Bound turn, foreign preview: when the reference resolver bound this turn to
 *    ONE scope (reuse_scope + selected_source), a preview from a DIFFERENT source
 *    is an unintended mix → repairable (drop the foreign card; keep the bound one).
 *  - Orphan preview: a shown preview whose source has NO evidence scope this turn,
 *    while OTHER sources DO have scopes → cross-source contamination → block (don't
 *    show a card the answer's evidence never backed).
 *
 * Multiple sources WITHOUT a single-scope binding are left alone: a broad fresh
 * search may legitimately surface Drive + Gmail together.
 */
function checkSourceConsistency(input: ConsistencyInput): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const shown = shownPreviews(input.previews);
  if (shown.length === 0) return findings;

  const scopeSources = new Set(input.scopes.map((s) => s.source));
  const ref = input.reference;

  for (const preview of shown) {
    const src = previewSource(preview);

    // Bound to a single scope → foreign-source cards are an unintended mix.
    if (
      ref &&
      ref.kind === "reuse_scope" &&
      ref.selected_source &&
      src !== ref.selected_source
    ) {
      findings.push({
        code: "mixed_source_preview",
        status: "repairable",
        detail: `preview source ${src} differs from bound scope source ${ref.selected_source}`,
      });
      continue;
    }

    // Orphan card: its source has no scope, but the turn DID capture scopes from
    // other sources → contamination across connectors.
    if (!scopeSources.has(src) && scopeSources.size > 0) {
      findings.push({
        code: "source_mismatch",
        status: "block",
        detail: `preview source ${src} has no evidence scope (scopes: ${[...scopeSources].join(",")})`,
      });
    }
  }

  return findings;
}

/**
 * Deterministic repair for `mixed_source_preview`: when the turn is bound to a
 * single evidence source, drop preview cards from any other source so the answer
 * and its previews describe one set. Pure; returns a new array.
 */
export function filterPreviewsToSource(
  previews: readonly ChatSourcePreview[],
  source: EvidenceScope["source"],
): ChatSourcePreview[] {
  return previews.filter((p) => previewSource(p) === source);
}

// --- Sprint 4: action proposal consistency -----------------------------------

/**
 * Mutating / outward-facing actions that act ON an item the conversation points
 * at (an existing event, reminder, draft, or recipient). If the reference for the
 * turn is ambiguous, proposing one of these risks acting on the WRONG event/
 * thread/reminder — exactly what the audit warns about. NEW-item creates and pure
 * task edits are intentionally excluded: they do not resolve against prior
 * evidence the same way. The approval queue / dispatcher stays the system of
 * record — this gate only withholds an ambiguous proposal, it never executes.
 */
const WRITE_SENSITIVE_ACTIONS = new Set<AiAction["action_type"]>([
  "gmail.draft",
  "gmail.send",
  "google_event.update",
  "google_event.delete",
  "event.update",
  "event.archive",
  "reminder.update",
  "reminder.done",
  "reminder.archive",
]);

/**
 * True when an action acts on a conversation-referenced item and so must rest on
 * a resolved reference (see WRITE_SENSITIVE_ACTIONS). The chat pipeline uses this
 * to drop such a proposal before dispatch when the reference is ambiguous.
 */
export function isReferenceGatedAction(actionType: AiAction["action_type"]): boolean {
  return WRITE_SENSITIVE_ACTIONS.has(actionType);
}

/**
 * Sprint 4 — a write-sensitive proposal must rest on a RESOLVED reference. When
 * the resolver said the turn is ambiguous (`clarify`) or unsupported, the backend
 * must not let a Calendar/Gmail/Reminder mutation ride along on a guess:
 *
 *  - reference ambiguous (`clarify`)   → status clarify: ask which item first.
 *  - reference unsupported             → status block: the scope cannot resolve.
 *
 * Resolved references (`reuse_scope`/`fresh_search`) and turns with no reference
 * signal are left untouched — ordinary new-action turns proceed as before. No new
 * write path is introduced; this only gates what reaches the existing dispatcher.
 */
function checkActionConsistency(input: ConsistencyInput): ConsistencyFinding[] {
  const actions = input.proposedActions ?? [];
  const ref = input.reference;
  if (actions.length === 0 || !ref) return [];

  const sensitive = actions.filter((a) => WRITE_SENSITIVE_ACTIONS.has(a.action_type));
  if (sensitive.length === 0) return [];

  const types = [...new Set(sensitive.map((a) => a.action_type))].join(",");

  if (ref.kind === "clarify") {
    return [
      {
        code: "action_reference_ambiguous",
        status: "clarify",
        detail: `write-sensitive action(s) [${types}] proposed on an ambiguous reference (${ref.reason_code})`,
      },
    ];
  }
  if (ref.kind === "unsupported") {
    return [
      {
        code: "action_scope_unresolved",
        status: "block",
        detail: `write-sensitive action(s) [${types}] proposed but reference is unsupported`,
      },
    ];
  }
  return [];
}

/**
 * Verify that one turn's answer, previews, evidence scopes, and proposed actions
 * describe a single consistent evidence set. The single gate the chat pipeline
 * consults before returning a reply.
 *
 * Sprint 1 — scope metadata invariants. Sprint 2 — count/preview consistency.
 * Sprint 3 — cross-source preview consistency. Sprint 4 — action-proposal
 * consistency against the resolved reference.
 */
export function verifyTurnConsistency(input: ConsistencyInput): ConsistencyVerdict {
  const findings: ConsistencyFinding[] = [];
  findings.push(...checkScopeMetadata(input.scopes));
  findings.push(...checkCountPreview(input));
  findings.push(...checkSourceConsistency(input));
  findings.push(...checkActionConsistency(input));
  return decide(findings);
}
