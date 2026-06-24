import { listActiveFacts } from "../db/repositories/factRepo.js";
import { FACT_RECALL_CAP } from "../config.js";
import { parseConstraintFromFact } from "./scheduleConstraints.js";
import type { MemoryFact } from "../schemas/fact.js";

/**
 * Max schedule-block facts force-recalled on a scheduling-intent turn (§4 — keep
 * the boost from flooding the prompt; pinned + keyword matches still win the rest).
 */
const SCHEDULE_BOOST_CAP = 3;

/** A clock time anywhere in the text (HH:MM or HH.MM). */
const SCHEDULE_TIME_RE = /\d{1,2}[:.]\d{2}/;

/**
 * "Schedule-like" fact: a routine fact carrying clock times. Catches real-world
 * timetables stored as a weekly table with single start-times ("จันทร์ (08:00 …),
 * อังคาร (09:00 …)") that DON'T parse into HH:MM–HH:MM windows and so never become
 * a recurring_block. We still must surface these so the model sees the schedule.
 */
export function isScheduleLikeFact(fact: MemoryFact): boolean {
  return fact.category === "routine" && SCHEDULE_TIME_RE.test(fact.content ?? "");
}

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
  schedulingIntent: boolean = false,
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

  // Pinned always win the first slots.
  const out = [...pinned];

  // §4 — schedule-fact boost: on a scheduling-intent turn, force-recall recurring
  // CLASS blocks even when they share no keyword with the message, so the schedule
  // never silently drops. Gated by the SAME parser that builds constraints: a fact
  // qualifies ONLY if it parses to a `recurring_block` (an explicit HH:MM–HH:MM
  // window + class signal). A single-time routine ("feed cat 08:00") has no window
  // range → parses to null → never boosted, so the context can't bloat. protected
  // windows (tank) are NOT boosted here — they already ride the sticky constraints
  // channel. Sub-capped so they can never evict pinned/keyword facts.
  if (schedulingIntent) {
    let boosted = 0;
    for (const f of rest) {
      if (boosted >= SCHEDULE_BOOST_CAP || out.length >= cap) break;
      if (out.some((o) => o.id === f.id)) continue;
      const c = parseConstraintFromFact(f);
      // Boost a clean recurring_block (HH:MM–HH:MM class) OR a schedule-like
      // routine fact (weekly table of single start-times) — the latter can't be a
      // constraint but MUST still reach the model so it can read the schedule.
      if ((c && c.kind === "recurring_block") || isScheduleLikeFact(f)) {
        out.push(f);
        boosted++;
      }
    }
  }

  // Fill the remainder with scored keyword matches (dedupe against boosted/pinned).
  for (const f of scored) {
    if (out.length >= cap) break;
    if (out.some((o) => o.id === f.id)) continue;
    out.push(f);
  }
  return out.slice(0, cap);
}
