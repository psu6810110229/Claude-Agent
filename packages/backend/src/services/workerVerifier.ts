import {
  readOnlyWorkerEvidenceBundleSchema,
  type ReadOnlyWorkerEvidenceBundle,
} from "../schemas/worker.js";

export const WORKER_EVIDENCE_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export type WorkerEvidenceRejectReason =
  | "invalid_schema"
  | "missing_source"
  | "missing_fetched_at"
  | "unverifiable";

export interface WorkerEvidenceVerdict {
  accepted: boolean;
  bundle: ReadOnlyWorkerEvidenceBundle | null;
  confidence: "high" | "medium" | "low";
  stale: boolean;
  capped: boolean;
  partial: boolean;
  limitations: string[];
  rejectReason: WorkerEvidenceRejectReason | null;
  factSafe: boolean;
}

function uniqLimit(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function deriveRejectReason(output: unknown): WorkerEvidenceRejectReason {
  const obj =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : null;
  if (obj && !obj.source) return "missing_source";
  if (obj && !obj.fetched_at) return "missing_fetched_at";
  return "invalid_schema";
}

export function verifyWorkerEvidenceBundle(
  output: unknown,
  opts?: { nowIso?: string; staleAfterMs?: number },
): WorkerEvidenceVerdict {
  const parsed = readOnlyWorkerEvidenceBundleSchema.safeParse(output);
  if (!parsed.success) {
    return {
      accepted: false,
      bundle: null,
      confidence: "low",
      stale: true,
      capped: false,
      partial: true,
      limitations: ["worker output failed evidence-bundle validation"],
      rejectReason: deriveRejectReason(output),
      factSafe: false,
    };
  }

  const bundle = parsed.data;
  const nowMs = Date.parse(opts?.nowIso ?? new Date().toISOString());
  const fetchedMs = Date.parse(bundle.fetched_at);
  const newestMs = bundle.newest_at ? Date.parse(bundle.newest_at) : null;
  const staleAfterMs = opts?.staleAfterMs ?? WORKER_EVIDENCE_STALE_AFTER_MS;

  const computedStale =
    bundle.stale ||
    !Number.isFinite(fetchedMs) ||
    (Number.isFinite(nowMs) && nowMs - fetchedMs > staleAfterMs) ||
    (newestMs !== null && Number.isFinite(nowMs) && nowMs - newestMs > staleAfterMs);

  const limitations = uniqLimit(
    [
      ...bundle.limitations,
      ...(computedStale ? ["evidence is stale or may need refresh"] : []),
      ...(bundle.capped ? ["evidence was capped"] : []),
      ...(bundle.partial ? ["evidence is partial"] : []),
    ],
    12,
  );

  const factSafe = !computedStale && !bundle.partial && bundle.confidence !== "low";

  return {
    accepted: true,
    bundle: { ...bundle, stale: computedStale },
    confidence: bundle.confidence,
    stale: computedStale,
    capped: bundle.capped,
    partial: bundle.partial,
    limitations,
    rejectReason: null,
    factSafe,
  };
}
