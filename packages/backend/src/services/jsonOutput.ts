/**
 * Shared normalization for raw Claude stdout before strict JSON parsing
 * (Step 8 follow-up). Used by BOTH the brief pipeline and the AI command
 * pipeline so they behave identically.
 *
 * The live `claude -p` model sometimes wraps otherwise-valid JSON in a single
 * markdown code fence (```` ```json … ``` ```` or a bare ```` ``` … ``` ````),
 * even when told not to. This helper unwraps exactly that case and nothing more.
 *
 * Deliberately NARROW — it is normalization, not repair:
 * - Only trims surrounding whitespace and removes ONE outer code fence when the
 *   ENTIRE output is a single fenced block.
 * - Does NOT extract "first `{` to last `}`".
 * - Does NOT repair malformed JSON.
 * - Does NOT tolerate prose before or after the JSON (such output is returned
 *   unchanged, so `JSON.parse` still fails and the caller rejects it).
 *
 * Downstream parsing/validation (strict `JSON.parse` + Zod) is unchanged, so the
 * allowlist, action shapes, and fail-closed behavior are all preserved.
 */
export function unwrapJsonOutput(raw: string): string {
  const trimmed = raw.trim();

  // Fast path: not fenced at all.
  if (!trimmed.startsWith("```")) return trimmed;

  const lines = trimmed.split(/\r?\n/);

  // Need at least an opener line and a closer line.
  if (lines.length < 2) return trimmed;

  // Opener must be a pure fence line: ``` optionally followed by a language
  // label (e.g. ```json), with no backticks elsewhere on the line.
  const opener = /^```[^\n`]*$/.test(lines[0]);
  if (!opener) return trimmed;

  // Closer must be exactly ``` (allowing trailing whitespace). Anything after
  // the closing fence (trailing prose) means the last line is not a closer, so
  // we leave the output untouched and let strict parsing reject it.
  if (lines[lines.length - 1].trim() !== "```") return trimmed;

  // Unwrap: drop the opener and closer lines, return the inner content.
  return lines.slice(1, -1).join("\n").trim();
}
