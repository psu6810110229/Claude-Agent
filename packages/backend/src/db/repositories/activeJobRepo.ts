import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  ActiveJob,
  ActiveJobEvent,
  ActiveJobEventType,
  ActiveJobStatus,
  CreateActiveJobInput,
} from "../../schemas/activeJob.js";

const JOB_COLS = [
  "id",
  "kind",
  "title",
  "status",
  "source",
  "source_ref",
  "result_summary",
  "error",
  "clarification",
  "evidence_json",
  "completed_at",
  "created_at",
  "updated_at",
].join(", ");

const EVENT_COLS = [
  "id",
  "job_id",
  "event_type",
  "status",
  "progress",
  "metadata_json",
  "created_at",
].join(", ");

export function createActiveJob(input: CreateActiveJobInput): ActiveJob {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO active_job
         (kind, title, status, source, source_ref, result_summary, error,
          clarification, evidence_json, completed_at, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      input.kind,
      input.title,
      input.source ?? null,
      input.source_ref ?? null,
      ts,
      ts,
    );
  return getActiveJobById(Number(info.lastInsertRowid))!;
}

export function getActiveJobById(id: number): ActiveJob | undefined {
  return getDb()
    .prepare(`SELECT ${JOB_COLS} FROM active_job WHERE id = ?`)
    .get(id) as ActiveJob | undefined;
}

export function listRecentActiveJobs(limit = 10): ActiveJob[] {
  return getDb()
    .prepare(`SELECT ${JOB_COLS} FROM active_job ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(limit) as ActiveJob[];
}

export function updateActiveJob(
  id: number,
  patch: {
    status?: ActiveJobStatus;
    result_summary?: string | null;
    error?: string | null;
    clarification?: string | null;
    evidence_json?: string | null;
    completed_at?: string | null;
  },
): ActiveJob | undefined {
  if (!getActiveJobById(id)) return undefined;

  const sets: string[] = ["updated_at = ?"];
  const params: (string | null | number)[] = [nowIso()];

  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if ("result_summary" in patch) {
    sets.push("result_summary = ?");
    params.push(patch.result_summary ?? null);
  }
  if ("error" in patch) {
    sets.push("error = ?");
    params.push(patch.error ?? null);
  }
  if ("clarification" in patch) {
    sets.push("clarification = ?");
    params.push(patch.clarification ?? null);
  }
  if ("evidence_json" in patch) {
    sets.push("evidence_json = ?");
    params.push(patch.evidence_json ?? null);
  }
  if ("completed_at" in patch) {
    sets.push("completed_at = ?");
    params.push(patch.completed_at ?? null);
  }

  params.push(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDb()
    .prepare(`UPDATE active_job SET ${sets.join(", ")} WHERE id = ?`)
    .run(...(params as any[]));
  return getActiveJobById(id);
}

export function appendActiveJobEvent(input: {
  job_id: number;
  event_type: ActiveJobEventType;
  status: ActiveJobStatus;
  progress: string;
  metadata_json?: string | null;
}): ActiveJobEvent {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO active_job_event
         (job_id, event_type, status, progress, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.job_id,
      input.event_type,
      input.status,
      input.progress,
      input.metadata_json ?? null,
      ts,
    );
  return getDb()
    .prepare(`SELECT ${EVENT_COLS} FROM active_job_event WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as ActiveJobEvent;
}

export function listActiveJobEvents(
  jobId: number,
  limit = 50,
): ActiveJobEvent[] {
  return getDb()
    .prepare(
      `SELECT ${EVENT_COLS} FROM active_job_event
       WHERE job_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(jobId, limit)
    .reverse() as ActiveJobEvent[];
}
