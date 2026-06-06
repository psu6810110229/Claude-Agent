/**
 * Typed client for the local backend. All calls go to same-origin `/api/*`,
 * which Next proxies to the backend (see next.config.js). No CORS, no auth.
 */
import type { Activity, Approval, Task, UpdateTaskBody } from "./types";

/** Thrown for any non-2xx response; `message` carries the backend's error text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // Network/connection failure — usually the backend isn't running.
    throw new ApiError("Cannot reach the backend (is it running on :8787?)", 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Tasks ---------------------------------------------------------------

export async function listTasks(): Promise<Task[]> {
  const data = await request<{ tasks: Task[] }>("/api/tasks");
  return data.tasks;
}

export function createTask(
  title: string,
  status?: "open" | "done",
): Promise<Task> {
  return request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(status ? { title, status } : { title }),
  });
}

export function updateTask(id: number, body: UpdateTaskBody): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archiveTask(id: number): Promise<Task> {
  return request<Task>(`/api/tasks/${id}/archive`, { method: "POST" });
}

// --- Approvals -----------------------------------------------------------

export async function listApprovals(): Promise<Approval[]> {
  const data = await request<{ approvals: Approval[] }>("/api/approvals");
  return data.approvals;
}

export function approveApproval(id: number): Promise<Approval> {
  return request<Approval>(`/api/approvals/${id}/approve`, { method: "POST" });
}

export function rejectApproval(id: number): Promise<Approval> {
  return request<Approval>(`/api/approvals/${id}/reject`, { method: "POST" });
}

// --- Activity ------------------------------------------------------------

export async function listActivity(limit = 50): Promise<Activity[]> {
  const data = await request<{ activity: Activity[] }>(
    `/api/activity?limit=${limit}`,
  );
  return data.activity;
}
