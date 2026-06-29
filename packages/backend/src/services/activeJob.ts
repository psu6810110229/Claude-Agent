import {
  appendActiveJobEvent,
  createActiveJob,
  getActiveJobById,
  listActiveJobEvents,
  listRecentActiveJobs,
  updateActiveJob,
} from "../db/repositories/activeJobRepo.js";
import { nowIso } from "../config.js";
import type {
  ActiveJob,
  ActiveJobEvidenceMetadata,
  ActiveJobProgress,
  ActiveJobProgressEvent,
  ActiveJobStatus,
  CreateActiveJobInput,
} from "../schemas/activeJob.js";
import {
  ACTIVE_JOB_METADATA_JSON_MAX_CHARS,
  ACTIVE_JOB_METADATA_STRING_MAX_CHARS,
  ACTIVE_JOB_PROGRESS_MAX_CHARS,
} from "../schemas/activeJob.js";

const TERMINAL: ReadonlySet<ActiveJobStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

const TRANSITIONS: Record<ActiveJobStatus, ReadonlySet<ActiveJobStatus>> = {
  queued: new Set(["understanding", "searching", "needs_user", "failed", "cancelled"]),
  understanding: new Set(["searching", "needs_user", "reporting", "done", "failed", "cancelled"]),
  searching: new Set(["verifying", "needs_user", "reporting", "done", "failed", "cancelled"]),
  verifying: new Set(["reporting", "needs_user", "done", "failed", "cancelled"]),
  needs_user: new Set(["understanding", "searching", "failed", "cancelled"]),
  reporting: new Set(["done", "failed", "cancelled"]),
  done: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

const SENSITIVE_METADATA_KEYS = new Set([
  "raw",
  "body",
  "text",
  "snippet",
  "snippets",
  "message",
  "messages",
  "content",
  "sender",
  "token",
  "secret",
  "password",
  "credential",
  "credentials",
  "authorization",
  "api_key",
  "apikey",
]);

export class ActiveJobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActiveJobTransitionError";
  }
}

function capString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .replace(/\bya29\.[0-9A-Za-z._-]+\b/g, "[redacted]")
    .replace(/\bsk-[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[0-9A-Za-z_]{20,}\b/g, "[redacted]")
    .replace(
      /\b(token|secret|password|credential|authorization)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    );
}

export function sanitizeActiveJobProgress(progress: string): string {
  const cleaned = redactSecrets(progress.replace(/\s+/g, " ").trim());
  return capString(cleaned || "อัปเดตความคืบหน้า", ACTIVE_JOB_PROGRESS_MAX_CHARS);
}

export function sanitizeActiveJobMetadata(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === "boolean" || typeof input === "number") return input;
  if (typeof input === "string") {
    return capString(
      redactSecrets(input.replace(/\s+/g, " ").trim()),
      ACTIVE_JOB_METADATA_STRING_MAX_CHARS,
    );
  }
  if (Array.isArray(input)) {
    if (depth >= 4) return "[truncated]";
    return input.slice(0, 20).map((item) => sanitizeActiveJobMetadata(item, depth + 1));
  }
  if (typeof input === "object") {
    if (depth >= 4) return "[truncated]";
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input).slice(0, 50)) {
      const safeKey = capString(key, 80);
      if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
        out[safeKey] = "[redacted]";
      } else {
        out[safeKey] = sanitizeActiveJobMetadata(value, depth + 1);
      }
    }
    return out;
  }
  return String(input);
}

function encodeMetadata(metadata: unknown): string | null {
  if (metadata === undefined || metadata === null) return null;
  const json = JSON.stringify(sanitizeActiveJobMetadata(metadata));
  if (json.length <= ACTIVE_JOB_METADATA_JSON_MAX_CHARS) return json;
  return JSON.stringify({ truncated: true, original_json_chars: json.length });
}

function parseMetadata(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function requireJob(jobId: number): ActiveJob {
  const job = getActiveJobById(jobId);
  if (!job) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  return job;
}

function assertCanTransition(from: ActiveJobStatus, to: ActiveJobStatus): void {
  if (from === to) return;
  if (TERMINAL.has(from)) {
    throw new ActiveJobTransitionError(`active job is terminal (${from})`);
  }
  if (!TRANSITIONS[from].has(to)) {
    throw new ActiveJobTransitionError(`illegal active job transition ${from} -> ${to}`);
  }
}

function appendEvent(
  job: ActiveJob,
  event_type: "created" | "progress" | "evidence" | "status" | "clarification" | "result" | "error",
  progress: string,
  metadata?: unknown,
): void {
  appendActiveJobEvent({
    job_id: job.id,
    event_type,
    status: job.status,
    progress: sanitizeActiveJobProgress(progress),
    metadata_json: encodeMetadata(metadata),
  });
}

export function createJob(input: CreateActiveJobInput): ActiveJob {
  const job = createActiveJob(input);
  appendEvent(job, "created", "เริ่มงานแล้ว", {
    kind: input.kind,
    source: input.source ?? null,
    source_ref: input.source_ref ?? null,
  });
  return job;
}

export function transitionJob(
  jobId: number,
  nextStatus: ActiveJobStatus,
  progress?: string,
  metadata?: unknown,
): ActiveJob {
  const job = requireJob(jobId);
  assertCanTransition(job.status, nextStatus);
  const completed_at = TERMINAL.has(nextStatus) ? nowIso() : undefined;
  const updated = updateActiveJob(job.id, {
    status: nextStatus,
    ...(completed_at ? { completed_at } : {}),
  });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(
    updated,
    "status",
    progress ?? `สถานะงาน: ${nextStatus}`,
    metadata,
  );
  return updated;
}

export function appendProgress(
  jobId: number,
  progress: string,
  metadata?: unknown,
): ActiveJob {
  const job = requireJob(jobId);
  if (TERMINAL.has(job.status)) {
    throw new ActiveJobTransitionError(`active job is terminal (${job.status})`);
  }
  appendEvent(job, "progress", progress, metadata);
  return job;
}

export function attachEvidenceMetadata(
  jobId: number,
  evidence: ActiveJobEvidenceMetadata | Record<string, unknown>,
  progress = "บันทึก metadata หลักฐานแล้ว",
): ActiveJob {
  const job = requireJob(jobId);
  if (TERMINAL.has(job.status)) {
    throw new ActiveJobTransitionError(`active job is terminal (${job.status})`);
  }
  const metadataJson = encodeMetadata(evidence);
  const updated = updateActiveJob(job.id, { evidence_json: metadataJson });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(updated, "evidence", progress, evidence);
  return updated;
}

export function requestUserClarification(
  jobId: number,
  question: string,
  choices?: string[],
): ActiveJob {
  const job = requireJob(jobId);
  assertCanTransition(job.status, "needs_user");
  const clarification = sanitizeActiveJobProgress(question);
  const updated = updateActiveJob(job.id, {
    status: "needs_user",
    clarification,
  });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(updated, "clarification", clarification, { choices: choices ?? [] });
  return updated;
}

export function markDone(jobId: number, resultSummary?: string): ActiveJob {
  const job = requireJob(jobId);
  assertCanTransition(job.status, "done");
  const result = resultSummary
    ? sanitizeActiveJobProgress(resultSummary)
    : "งานเสร็จแล้ว";
  const updated = updateActiveJob(job.id, {
    status: "done",
    result_summary: result,
    completed_at: nowIso(),
  });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(updated, "result", result);
  return updated;
}

export function markFailed(jobId: number, error: string): ActiveJob {
  const job = requireJob(jobId);
  assertCanTransition(job.status, "failed");
  const safeError = sanitizeActiveJobProgress(error);
  const updated = updateActiveJob(job.id, {
    status: "failed",
    error: safeError,
    completed_at: nowIso(),
  });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(updated, "error", safeError);
  return updated;
}

export function cancelJob(jobId: number, reason = "ยกเลิกงานแล้ว"): ActiveJob {
  const job = requireJob(jobId);
  assertCanTransition(job.status, "cancelled");
  const safeReason = sanitizeActiveJobProgress(reason);
  const updated = updateActiveJob(job.id, {
    status: "cancelled",
    result_summary: safeReason,
    completed_at: nowIso(),
  });
  if (!updated) throw new ActiveJobTransitionError(`active job ${jobId} not found`);
  appendEvent(updated, "result", safeReason);
  return updated;
}

export function getRecentChatJobProgress(
  limit = 5,
  eventLimit = 6,
): ActiveJobProgress[] {
  return listRecentActiveJobs(limit).map((job) => {
    const milestones: ActiveJobProgressEvent[] = listActiveJobEvents(
      job.id,
      eventLimit,
    ).map((event) => ({
      id: event.id,
      event_type: event.event_type,
      status: event.status,
      message: event.progress,
      created_at: event.created_at,
      metadata: parseMetadata(event.metadata_json),
    }));
    return {
      job_id: job.id,
      kind: job.kind,
      title: job.title,
      status: job.status,
      source: job.source,
      source_ref: job.source_ref,
      result_summary: job.result_summary,
      error: job.error,
      clarification: job.clarification,
      evidence: parseMetadata(job.evidence_json),
      updated_at: job.updated_at,
      milestones,
    };
  });
}
