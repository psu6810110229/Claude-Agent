import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { Task, TaskStatus } from "../../schemas/task.js";

/** All tasks, newest first. */
export function listTasks(): Task[] {
  return getDb()
    .prepare(
      "SELECT id, title, status, created_at, updated_at FROM task ORDER BY id DESC",
    )
    .all() as Task[];
}

export function getTaskById(id: number): Task | undefined {
  return getDb()
    .prepare(
      "SELECT id, title, status, created_at, updated_at FROM task WHERE id = ?",
    )
    .get(id) as Task | undefined;
}

export function createTask(title: string, status: TaskStatus = "open"): Task {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      "INSERT INTO task (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(title, status, ts, ts);
  return getTaskById(Number(info.lastInsertRowid))!;
}

/**
 * Patch title and/or status. `updated_at` is always refreshed in app code
 * (per project convention — no SQLite triggers). Returns undefined if missing.
 */
export function updateTask(
  id: number,
  fields: { title?: string; status?: TaskStatus },
): Task | undefined {
  const existing = getTaskById(id);
  if (!existing) return undefined;

  const next = {
    title: fields.title ?? existing.title,
    status: fields.status ?? existing.status,
    updated_at: nowIso(),
  };
  getDb()
    .prepare("UPDATE task SET title = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(next.title, next.status, next.updated_at, id);
  return getTaskById(id);
}

/** Soft-archive (status = 'archived'); never hard-deletes. */
export function archiveTask(id: number): Task | undefined {
  const existing = getTaskById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE task SET status = ?, updated_at = ? WHERE id = ?")
    .run("archived", nowIso(), id);
  return getTaskById(id);
}
