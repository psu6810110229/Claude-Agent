import { listActiveFacts } from "../db/repositories/factRepo.js";
import { FACT_RECALL_CAP } from "../config.js";
import type { MemoryFact } from "../schemas/fact.js";

/**
 * Step 16 — deterministic fact recall. Given the user's message, pick the most
 * relevant facts to inject into the prompt:
 *   - ALL pinned facts are always included (core identity like the user's name).
 *   - Remaining facts are scored by keyword/content overlap with the message and
 *     the top-scoring ones fill the rest of the cap.
 * Pure (apart from the DB read); no embeddings — keeps it cheap and testable.
 */

/** Lowercase word tokens, length >= 2, deduped. Thai + Latin friendly enough. */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

/** Overlap score between the message tokens and a fact's keywords + content. */
function scoreFact(fact: MemoryFact, msgTokens: Set<string>): number {
  const factTokens = tokenize(`${fact.keywords} ${fact.content}`);
  let score = 0;
  for (const t of factTokens) {
    if (msgTokens.has(t)) score += 1;
  }
  return score;
}

/**
 * Recall up to `cap` facts for `message`. Pinned facts first (always), then the
 * highest-scoring unpinned matches. When the message has no overlap with any
 * unpinned fact, only the pinned facts (plus nothing else) come back — recall
 * never floods the prompt with irrelevant facts.
 */
export function recallFacts(
  message: string,
  cap: number = FACT_RECALL_CAP,
): MemoryFact[] {
  const all = listActiveFacts();
  const pinned = all.filter((f) => f.pinned);
  const rest = all.filter((f) => !f.pinned);

  const msgTokens = tokenize(message);
  const scored = rest
    .map((f) => ({ fact: f, score: scoreFact(f, msgTokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.fact);

  // Pinned always win the first slots; fill the remainder with scored matches.
  const out = [...pinned];
  for (const f of scored) {
    if (out.length >= cap) break;
    out.push(f);
  }
  return out.slice(0, cap);
}
