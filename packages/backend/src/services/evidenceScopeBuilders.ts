import type { ChatSourcePreview } from "./chat.js";
import { buildEvidenceScope, type EvidenceScope } from "./evidenceScope.js";

/**
 * Phase 02 — turn the displayed source previews (the actual evidence shown to the
 * user) into structured EvidenceScopes. Building from the SAME previews that the
 * answer is aligned to is the audit's core fix: answer, preview, and scope all
 * describe one evidence set, so a follow-up can reuse it instead of re-searching.
 *
 * Sprint 2 covers Drive. Sprint 3 adds Gmail and LINE.
 */

/**
 * Minimal LINE focus shape (subset of ChatContext.lineFocusedChat). LINE exports
 * carry no stable per-message ids, so the chat IDENTITY is the anchor and the
 * coverage count is the total — NEVER any message text (privacy hard rule).
 */
export interface LineFocusForScope {
  chat: string;
  shown?: number;
  coverage?: { count: number } | null;
}

function slug(value: string, max = 48): string {
  const s = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return s || "set";
}

function buildDriveScope(
  preview: Extract<ChatSourcePreview, { kind: "drive" }>,
): EvidenceScope | null {
  const items = preview.items;
  if (items.length === 0) return null;

  const itemIds = items.map((i) => i.id).filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return null;

  const parentIds = Array.from(
    new Set(
      items
        .map((i) => i.folderId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const folderNames = Array.from(
    new Set(
      items
        .map((i) => i.folderName)
        .filter((n): n is string => Boolean(n)),
    ),
  );

  // A single shared parent folder is a strong anchor → bind as a folder scope so
  // "มีกี่รูป" resolves against THAT folder; otherwise it's a query result set.
  const isFolder = parentIds.length === 1;
  const total = preview.totalItems ?? itemIds.length;

  const limitations: string[] = [];
  if (total > itemIds.length) {
    limitations.push(`preview shows ${itemIds.length} of ${total} matches`);
  }
  if (!isFolder) {
    // Drive keyword search has no recency horizon and spans scopes — flag it so
    // the resolver treats a bare result set as weaker than a folder anchor.
    limitations.push("drive search has no recency horizon");
  }

  return buildEvidenceScope({
    id: isFolder ? `drive:folder:${parentIds[0]}` : `drive:result:${slug(preview.query)}`,
    source: "google_drive",
    scope_type: isFolder ? "folder" : "result_set",
    label: isFolder ? folderNames[0] ?? preview.query : preview.query,
    query: preview.query,
    item_ids: itemIds,
    parent_ids: parentIds,
    // The shown items ARE the preview — answer and preview share this set.
    preview_item_ids: itemIds,
    total_count: total,
    confidence: isFolder ? "high" : "medium",
    limitations,
  });
}

function buildGmailScope(
  preview: Extract<ChatSourcePreview, { kind: "gmail" }>,
): EvidenceScope | null {
  const itemIds = preview.items
    .map((i) => i.id)
    .filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return null;

  // A focused Gmail read is a QUERY result set of messages, not one thread — we
  // hold message ids + the query so "กี่ฉบับ" / "อันแรกจากใคร" reuse this set.
  return buildEvidenceScope({
    id: `gmail:result:${slug(preview.query)}`,
    source: "gmail",
    scope_type: "result_set",
    label: preview.query,
    query: preview.query,
    item_ids: itemIds,
    preview_item_ids: itemIds,
    total_count: itemIds.length,
    confidence: "medium",
    limitations: ["gmail focused read is query-based, not a single thread"],
  });
}

function buildLineScope(focus: LineFocusForScope): EvidenceScope | null {
  const chat = focus.chat?.trim();
  if (!chat) return null;
  const total = focus.coverage?.count ?? focus.shown;

  // Metadata only: chat identity + counts. No message ids exist in the export and
  // no text/snippets ever enter a scope.
  return buildEvidenceScope({
    id: `line:chat:${slug(chat)}`,
    source: "line_export",
    scope_type: "chat",
    label: chat,
    total_count: typeof total === "number" ? total : undefined,
    confidence: "high",
    limitations: [
      "line export has no per-message ids",
      "export-based, not live; no read/unread state",
    ],
  });
}

/**
 * Build the evidence scopes for one assistant turn. Drive/Gmail come from the
 * aligned previews (same evidence the answer uses); LINE comes from the focused
 * chat context (no preview card exists for LINE). Fail-soft: a bad source is
 * skipped, never throws.
 */
export function buildTurnEvidenceScopes(
  previews: readonly ChatSourcePreview[],
  opts: { lineFocusedChat?: LineFocusForScope | null } = {},
): EvidenceScope[] {
  const scopes: EvidenceScope[] = [];
  for (const preview of previews) {
    try {
      if (preview.kind === "drive") {
        const scope = buildDriveScope(preview);
        if (scope) scopes.push(scope);
      } else if (preview.kind === "gmail") {
        const scope = buildGmailScope(preview);
        if (scope) scopes.push(scope);
      }
    } catch {
      // never let scope-building block a successful reply
    }
  }
  if (opts.lineFocusedChat) {
    try {
      const scope = buildLineScope(opts.lineFocusedChat);
      if (scope) scopes.push(scope);
    } catch {
      // ignore — LINE scope is best-effort
    }
  }
  return scopes;
}
