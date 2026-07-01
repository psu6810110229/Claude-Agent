import type { CompactEvidenceScope } from "./evidenceScope.js";
import type { ReferenceDecision } from "./referenceResolver.js";

export const PROVIDER_EVIDENCE_PACK_VERSION = 1;

export const PROVIDER_EVIDENCE_PACK_LIMITS = {
  maxScopes: 4,
  maxPreviewIdsPerScope: 8,
  maxLimitationsPerScope: 3,
  maxLabelChars: 80,
  maxQueryChars: 120,
} as const;

export type ProviderEvidenceScope = {
  id: string;
  source: CompactEvidenceScope["source"];
  type: CompactEvidenceScope["scope_type"];
  label?: string;
  query?: string;
  total: number | null;
  held_ids: number;
  preview_ids: string[];
  confidence: CompactEvidenceScope["confidence"];
  fetched_at: string;
  limitations: string[];
};

export type ProviderEvidenceReference = {
  kind: ReferenceDecision["kind"];
  confidence: ReferenceDecision["confidence"];
  reason_code: ReferenceDecision["reason_code"];
  selected_scope_id?: string;
  selected_source?: ReferenceDecision["selected_source"];
  candidate_scope_ids: string[];
};

export type ProviderEvidencePack = {
  schema_version: typeof PROVIDER_EVIDENCE_PACK_VERSION;
  budget: {
    max_scopes: number;
    max_preview_ids_per_scope: number;
    history_policy: "prefer_pack_over_history_for_source_answers";
  };
  reference: ProviderEvidenceReference | null;
  scopes: ProviderEvidenceScope[];
  rules: string[];
};

function trimText(value: string | undefined, max: number): string | undefined {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > max ? compact.slice(0, max) : compact;
}

function packScope(scope: CompactEvidenceScope): ProviderEvidenceScope {
  return {
    id: scope.id,
    source: scope.source,
    type: scope.scope_type,
    label: trimText(scope.label, PROVIDER_EVIDENCE_PACK_LIMITS.maxLabelChars),
    query: trimText(scope.query, PROVIDER_EVIDENCE_PACK_LIMITS.maxQueryChars),
    total: typeof scope.total_count === "number" ? scope.total_count : null,
    held_ids: scope.item_count,
    preview_ids: scope.preview_item_ids.slice(
      0,
      PROVIDER_EVIDENCE_PACK_LIMITS.maxPreviewIdsPerScope,
    ),
    confidence: scope.confidence,
    fetched_at: scope.fetched_at,
    limitations: scope.limitations.slice(
      0,
      PROVIDER_EVIDENCE_PACK_LIMITS.maxLimitationsPerScope,
    ),
  };
}

function packReference(
  decision: ReferenceDecision | null | undefined,
): ProviderEvidenceReference | null {
  if (!decision) return null;
  return {
    kind: decision.kind,
    confidence: decision.confidence,
    reason_code: decision.reason_code,
    selected_scope_id: decision.selected_scope_id,
    selected_source: decision.selected_source,
    candidate_scope_ids: decision.candidate_scope_ids?.slice(0, 4) ?? [],
  };
}

function rulesFor(reference: ProviderEvidenceReference | null): string[] {
  const rules = [
    "Use this pack as the source of truth for source/count/preview-id answers.",
    "If this pack conflicts with conversation history, trust the pack.",
    "Do not invent source ids, counts, timestamps, or actions absent from the pack.",
  ];

  if (reference?.kind === "reuse_scope" && reference.selected_scope_id) {
    rules.push(
      `This turn is bound to scope ${reference.selected_scope_id}; do not run or imply a fresh search.`,
    );
  } else if (reference?.kind === "clarify") {
    rules.push(
      "This turn is ambiguous; ask one clarification and propose no write action.",
    );
  } else if (reference?.kind === "unsupported") {
    rules.push("The reference is unsupported; ask for a clearer target.");
  } else {
    rules.push("No prior scope is bound; a fresh source answer may be appropriate.");
  }

  return rules;
}

export function buildProviderEvidencePack(input: {
  recentScopes?: readonly CompactEvidenceScope[];
  referenceDecision?: ReferenceDecision | null;
}): ProviderEvidencePack {
  const reference = packReference(input.referenceDecision);
  const scopes = (input.recentScopes ?? [])
    .slice(0, PROVIDER_EVIDENCE_PACK_LIMITS.maxScopes)
    .map(packScope);

  return {
    schema_version: PROVIDER_EVIDENCE_PACK_VERSION,
    budget: {
      max_scopes: PROVIDER_EVIDENCE_PACK_LIMITS.maxScopes,
      max_preview_ids_per_scope:
        PROVIDER_EVIDENCE_PACK_LIMITS.maxPreviewIdsPerScope,
      history_policy: "prefer_pack_over_history_for_source_answers",
    },
    reference,
    scopes,
    rules: rulesFor(reference),
  };
}

export function formatProviderEvidencePack(pack: ProviderEvidencePack): string {
  return JSON.stringify(pack);
}
