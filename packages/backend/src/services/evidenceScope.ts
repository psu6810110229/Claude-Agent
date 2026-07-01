import { z } from "zod";
import { nowIso } from "../config.js";

/**
 * Phase 02 — Evidence Scope Store (metadata-only).
 *
 * An EvidenceScope is the structured, machine-readable record of WHAT a single
 * assistant turn actually retrieved: which source, which item ids, which folder/
 * thread/chat it came from, how many there were, and which ids were shown in the
 * preview. It exists so a short follow-up ("มีกี่รูป", "อะไรนะ", "เช็คอีกที") can
 * be bound to the SAME evidence the previous answer used, instead of triggering a
 * fresh source search (the root cause in conversation-reference-audit.md).
 *
 * PRIVACY (hard rule): scopes are metadata-only. They carry ids, counts, public
 * search terms, and short labels — never message bodies, LINE snippets, email
 * bodies, secrets, tokens, or DB dumps. The caps + redaction here are the code
 * guarantee, not a convention. See `buildEvidenceScope`.
 */

export const EvidenceScopeSourceSchema = z.enum([
  "google_drive",
  "gmail",
  "line_export",
  "google_calendar",
  "local_reminder",
  "google_contacts",
  "mixed",
]);

export type EvidenceScopeSource = z.infer<typeof EvidenceScopeSourceSchema>;

export const EvidenceScopeTypeSchema = z.enum([
  "result_set",
  "folder",
  "thread",
  "chat",
  "event_set",
  "reminder_set",
  "contact_set",
]);

export type EvidenceScopeType = z.infer<typeof EvidenceScopeTypeSchema>;

export const EvidenceScopeConfidenceSchema = z.enum(["low", "medium", "high"]);

// Caps keep the scope small (prompt budget + privacy). Bodies never enter a
// scope, so these only bound id/label/limitation lists.
export const SCOPE_CAPS = {
  itemIds: 60,
  parentIds: 24,
  previewIds: 24,
  query: 200,
  label: 120,
  limitations: 8,
  limitationLen: 200,
  perTurn: 6,
} as const;

export const EvidenceScopeSchema = z
  .object({
    /** Stable id for this scope within the turn (e.g. "drive:abc123"). */
    id: z.string().min(1),
    source: EvidenceScopeSourceSchema,
    scope_type: EvidenceScopeTypeSchema,
    /** Short human label (folder/chat/query). Metadata only, never a body. */
    label: z.string().min(1).max(SCOPE_CAPS.label).optional(),
    /** Public search terms used to retrieve the set. Not message content. */
    query: z.string().min(1).max(SCOPE_CAPS.query).optional(),
    item_ids: z.array(z.string().min(1)).max(SCOPE_CAPS.itemIds).default([]),
    parent_ids: z.array(z.string().min(1)).max(SCOPE_CAPS.parentIds).default([]),
    preview_item_ids: z
      .array(z.string().min(1))
      .max(SCOPE_CAPS.previewIds)
      .default([]),
    /** True total before any prompt/preview cap (so "+26" can be reconciled). */
    total_count: z.number().int().nonnegative().optional(),
    fetched_at: z.string().datetime(),
    confidence: EvidenceScopeConfidenceSchema,
    limitations: z
      .array(z.string().min(1).max(SCOPE_CAPS.limitationLen))
      .max(SCOPE_CAPS.limitations)
      .default([]),
  })
  .strict();

export type EvidenceScope = z.infer<typeof EvidenceScopeSchema>;

function dedupeCap(values: readonly string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function clampText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > max ? compact.slice(0, max) : compact;
}

export interface EvidenceScopeInput {
  id: string;
  source: EvidenceScopeSource;
  scope_type: EvidenceScopeType;
  label?: string;
  query?: string;
  item_ids?: readonly string[];
  parent_ids?: readonly string[];
  preview_item_ids?: readonly string[];
  total_count?: number;
  confidence: z.infer<typeof EvidenceScopeConfidenceSchema>;
  limitations?: readonly string[];
  /** ISO timestamp; defaults to now. Injectable for deterministic tests. */
  fetched_at?: string;
}

/**
 * Build a validated, capped, metadata-only scope. Strips empties, dedupes ids,
 * truncates label/query/limitations, and rejects anything that fails the schema
 * (e.g. a non-id slipping through). Throws on invalid input by design — a bad
 * scope must never be silently persisted.
 */
export function buildEvidenceScope(input: EvidenceScopeInput): EvidenceScope {
  const candidate = {
    id: input.id.trim(),
    source: input.source,
    scope_type: input.scope_type,
    label: clampText(input.label, SCOPE_CAPS.label),
    query: clampText(input.query, SCOPE_CAPS.query),
    item_ids: dedupeCap(input.item_ids ?? [], SCOPE_CAPS.itemIds),
    parent_ids: dedupeCap(input.parent_ids ?? [], SCOPE_CAPS.parentIds),
    preview_item_ids: dedupeCap(
      input.preview_item_ids ?? [],
      SCOPE_CAPS.previewIds,
    ),
    total_count:
      typeof input.total_count === "number" && input.total_count >= 0
        ? Math.trunc(input.total_count)
        : undefined,
    fetched_at: input.fetched_at ?? nowIso(),
    confidence: input.confidence,
    limitations: dedupeCap(
      (input.limitations ?? []).map((l) =>
        clampText(l, SCOPE_CAPS.limitationLen) ?? "",
      ),
      SCOPE_CAPS.limitations,
    ),
  };
  return EvidenceScopeSchema.parse(candidate);
}

/**
 * Serialize a turn's scopes for persistence. Caps the count per turn and drops
 * scopes that fail validation rather than throwing (persistence must never block
 * a successful reply). Returns null when there is nothing safe to store.
 */
export function serializeEvidenceScopes(
  scopes: readonly EvidenceScope[],
): string | null {
  const safe: EvidenceScope[] = [];
  for (const scope of scopes.slice(0, SCOPE_CAPS.perTurn)) {
    const parsed = EvidenceScopeSchema.safeParse(scope);
    if (parsed.success) safe.push(parsed.data);
  }
  return safe.length > 0 ? JSON.stringify(safe) : null;
}

/** Max scopes fed back into a prompt — keeps recall token cost bounded. */
export const RECENT_SCOPE_PROMPT_CAP = 4;

/**
 * Compact, prompt-facing projection of a scope. Drops the full id list (the
 * model only needs counts to answer "มีกี่รูป") but keeps the anchor (id/source/
 * label) so a follow-up can be bound back to the full scope on the next turn.
 */
export interface CompactEvidenceScope {
  id: string;
  source: EvidenceScopeSource;
  scope_type: EvidenceScopeType;
  label?: string;
  query?: string;
  total_count?: number;
  item_count: number;
  preview_item_ids: string[];
  confidence: z.infer<typeof EvidenceScopeConfidenceSchema>;
  fetched_at: string;
  limitations: string[];
}

export function toCompactScope(scope: EvidenceScope): CompactEvidenceScope {
  return {
    id: scope.id,
    source: scope.source,
    scope_type: scope.scope_type,
    label: scope.label,
    query: scope.query,
    total_count: scope.total_count,
    item_count: scope.item_ids.length,
    preview_item_ids: scope.preview_item_ids,
    confidence: scope.confidence,
    fetched_at: scope.fetched_at,
    limitations: scope.limitations,
  };
}

/**
 * Collect the most recent scopes across a set of persisted-scope JSON blobs
 * (oldest-first, e.g. chat history rows). Returns newest-first, deduped by scope
 * id (newest wins), capped. Fail-soft per blob.
 */
export function collectRecentScopes(
  scopeJsonsOldestFirst: readonly (string | null)[],
  cap: number = RECENT_SCOPE_PROMPT_CAP,
): CompactEvidenceScope[] {
  const out: CompactEvidenceScope[] = [];
  const seen = new Set<string>();
  for (let i = scopeJsonsOldestFirst.length - 1; i >= 0; i--) {
    for (const scope of parseEvidenceScopes(scopeJsonsOldestFirst[i])) {
      if (seen.has(scope.id)) continue;
      seen.add(scope.id);
      out.push(toCompactScope(scope));
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * Parse persisted scopes back to typed values. Fail-soft: any malformed JSON or
 * invalid entry yields [] / is dropped, never throws.
 */
export function parseEvidenceScopes(json: string | null): EvidenceScope[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: EvidenceScope[] = [];
  for (const entry of raw) {
    const parsed = EvidenceScopeSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
