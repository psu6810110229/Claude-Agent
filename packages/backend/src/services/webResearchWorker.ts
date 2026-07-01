import {
  readOnlyWorkerEvidenceBundleSchema,
  readOnlyWorkerInputSchema,
  type ReadOnlyWorkerEvidenceBundle,
  type ReadOnlyWorkerInput,
} from "../schemas/worker.js";
import { verifyWorkerEvidenceBundle } from "./workerVerifier.js";

const WEB_CLAIM_MAX_CHARS = 500;
const WEB_TITLE_MAX_CHARS = 160;
const WEB_CLAIM_LIMIT = 12;

export interface WebResearchHit {
  url: string;
  title: string;
  snippet?: string;
  published_at?: string | null;
  fetched_at?: string;
}

export interface WebResearchClaim {
  claim: string;
  url: string;
  source: string;
  fetched_at: string;
  confidence: "high" | "medium" | "low";
}

export interface WebResearchResult {
  bundle: ReadOnlyWorkerEvidenceBundle;
  claims: WebResearchClaim[];
  summary: string;
}

export interface WebResearchWorkerDeps {
  now?: () => Date;
  search?: (query: string, limit: number) => Promise<WebResearchHit[]>;
  fetchUrl?: (url: string) => Promise<WebResearchHit>;
}

function cap(value: string, maxChars: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function isoNow(deps?: WebResearchWorkerDeps): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function sourceFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function newestAt(hits: WebResearchHit[], fetchedAt: string): string | null {
  let maxMs = Number.NEGATIVE_INFINITY;
  let maxValue: string | null = null;
  for (const hit of hits) {
    const candidate = hit.published_at ?? hit.fetched_at ?? fetchedAt;
    const ms = Date.parse(candidate);
    if (!Number.isFinite(ms)) continue;
    if (ms > maxMs) {
      maxMs = ms;
      maxValue = new Date(ms).toISOString();
    }
  }
  return maxValue;
}

function sourceRef(input: ReadOnlyWorkerInput): string {
  if (input.source_ref) return input.source_ref;
  if (input.query) return `query:${input.query}`;
  return "web";
}

function toClaim(
  hit: WebResearchHit,
  fetchedAt: string,
): WebResearchClaim | null {
  const source = sourceFromUrl(hit.url);
  if (!source) return null;
  const fetched = hit.fetched_at ?? fetchedAt;
  if (!Number.isFinite(Date.parse(fetched))) return null;
  const claim = cap(hit.snippet || hit.title, WEB_CLAIM_MAX_CHARS);
  if (!claim) return null;
  return {
    claim,
    url: hit.url,
    source,
    fetched_at: new Date(Date.parse(fetched)).toISOString(),
    confidence: "medium",
  };
}

function makeBundle(input: ReadOnlyWorkerInput, patch: {
  fetched_at: string;
  newest_at: string | null;
  capped: boolean;
  partial: boolean;
  confidence: "high" | "medium" | "low";
  limitations: string[];
}): ReadOnlyWorkerEvidenceBundle {
  return readOnlyWorkerEvidenceBundleSchema.parse({
    job_id: input.job_id,
    worker_id: input.worker_id,
    source: "web",
    source_ref: sourceRef(input),
    fetched_at: patch.fetched_at,
    newest_at: patch.newest_at,
    stale: false,
    capped: patch.capped,
    partial: patch.partial,
    confidence: patch.confidence,
    limitations: patch.limitations,
  });
}

async function defaultFetchUrl(url: string): Promise<WebResearchHit> {
  const source = sourceFromUrl(url);
  if (!source) throw new Error("unsupported URL");
  const res = await fetch(url);
  const text = await res.text();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] ?? source;
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return {
    url,
    title: cap(title, WEB_TITLE_MAX_CHARS),
    snippet: cap(plain, WEB_CLAIM_MAX_CHARS),
    fetched_at: new Date().toISOString(),
  };
}

async function defaultSearch(
  query: string,
  _limit: number,
  deps?: WebResearchWorkerDeps,
): Promise<WebResearchHit[]> {
  const asUrl = sourceFromUrl(query) ? query : null;
  if (!asUrl) {
    throw new Error("web research requires an injected search provider or explicit URL");
  }
  const fetcher = deps?.fetchUrl ?? defaultFetchUrl;
  return [await fetcher(asUrl)];
}

export async function runWebResearchWorker(
  rawInput: unknown,
  deps?: WebResearchWorkerDeps,
): Promise<WebResearchResult> {
  const input = readOnlyWorkerInputSchema.parse(rawInput);
  if (input.source !== "web") {
    throw new Error(`web research worker cannot handle ${input.source}`);
  }

  const fetchedAt = isoNow(deps);
  const limit = input.limit ?? 5;
  const query = input.query ?? input.source_ref ?? "";
  if (!query.trim()) {
    const bundle = makeBundle(input, {
      fetched_at: fetchedAt,
      newest_at: null,
      capped: false,
      partial: true,
      confidence: "low",
      limitations: ["missing web query or URL", "read-only web research"],
    });
    return {
      bundle,
      claims: [],
      summary: summarizeWebResearchResult({ bundle, claims: [], summary: "" }),
    };
  }

  try {
    const rawHits = deps?.search
      ? await deps.search(query, limit)
      : await defaultSearch(query, limit, deps);
    const hits = rawHits.slice(0, limit);
    const claims = hits
      .map((hit) => toClaim(hit, fetchedAt))
      .filter((claim): claim is WebResearchClaim => claim !== null)
      .slice(0, WEB_CLAIM_LIMIT);
    const partial = claims.length !== hits.length;
    const bundle = makeBundle(input, {
      fetched_at: fetchedAt,
      newest_at: newestAt(hits, fetchedAt),
      capped: rawHits.length >= limit,
      partial,
      confidence: claims.length > 0 && !partial ? "medium" : "low",
      limitations: [
        "web read-only",
        "every claim includes url/source/fetched_at",
        "no autonomous browsing-to-action",
        ...(partial ? ["some web hits were unverifiable"] : []),
      ],
    });
    return {
      bundle,
      claims,
      summary: summarizeWebResearchResult({ bundle, claims, summary: "" }),
    };
  } catch {
    const bundle = makeBundle(input, {
      fetched_at: fetchedAt,
      newest_at: null,
      capped: false,
      partial: true,
      confidence: "low",
      limitations: ["web research unavailable or failed", "read-only web research"],
    });
    return {
      bundle,
      claims: [],
      summary: summarizeWebResearchResult({ bundle, claims: [], summary: "" }),
    };
  }
}

export function summarizeWebResearchResult(result: WebResearchResult): string {
  const verdict = verifyWorkerEvidenceBundle(result.bundle);
  if (!verdict.accepted || result.claims.length === 0) {
    return "No verified web evidence is available.";
  }
  const caveats = [
    verdict.stale ? "stale" : null,
    verdict.capped ? "capped" : null,
    verdict.partial ? "partial" : null,
  ].filter((item): item is string => item !== null);
  const caveatText = caveats.length > 0 ? ` (${caveats.join(", ")})` : "";
  return `Verified web evidence: ${result.claims.length} source-backed claim(s)${caveatText}.`;
}
