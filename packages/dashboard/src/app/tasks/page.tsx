"use client";

import { useState } from "react";
import {
  ApiError,
  archiveTask,
  createTask,
  listTasks,
  updateTask,
} from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Empty } from "@/components/States";
import { CommandBar } from "@/components/CommandBar";
import { useToast } from "@/components/ToastProvider";
import type { Task } from "@/lib/types";

type ToastSuccess = {
  title: string;
  description?: string;
  kind?: "success" | "info" | "warning" | "error";
};

function TasksSkeleton() {
  return (
    <div className="panel">
      {[80, 60, 75, 50].map((w, i) => (
        <div className="row" key={i}>
          <span className="skel" style={{ width: 52, height: 22, flexShrink: 0 }} />
          <span className="skel" style={{ flex: 1, height: 15, margin: "0 8px" }} />
          <span className="skel" style={{ width: `${w}px`, height: 13, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

export default function TasksPage() {
  const { notify } = useToast();
  const { data: tasks, loading, error, reload } = useData("/api/tasks", listTasks);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, success?: ToastSuccess) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      if (success) notify({ kind: "success", ...success });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
      notify({
        kind: "error",
        title: "Action failed",
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    await run(async () => {
      await createTask(t);
      setTitle("");
    }, {
      title: "Created",
      description: t,
    });
  }

  function handleProposed() {
    reload();
    notify({
      kind: "warning",
      title: "มีงานรอ approve",
      description: "ตรวจ proposal ก่อนให้ระบบทำงานต่อ",
    });
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Work Queue</p>
          <h2>Tasks</h2>
          <p className="lede">Open, complete, edit, and archive local tasks.</p>
        </div>
      </header>

      <div className="section">
        <CommandBar onProposed={handleProposed} />
      </div>

      <form className="composer" onSubmit={onCreate}>
        <input
          placeholder="New task title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="primary"
          disabled={busy || title.trim() === ""}
        >
          Add
        </button>
      </form>

      {actionError && (
        <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />
      )}

      <div className="stack">
        {loading && <TasksSkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {tasks && tasks.length === 0 && <Empty label="No tasks yet." />}

        {tasks && tasks.length > 0 && (
          <div className="panel">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} busy={busy} run={run} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TaskRow({
  task,
  busy,
  run,
}: {
  task: Task;
  busy: boolean;
  run: (fn: () => Promise<unknown>, success?: ToastSuccess) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const archived = task.status === "archived";

  async function saveTitle() {
    const t = draft.trim();
    if (!t || t === task.title) {
      setEditing(false);
      return;
    }
    await run(() => updateTask(task.id, { title: t }), {
      title: "Edited",
      description: t,
    });
    setEditing(false);
  }

  function toggleStatus() {
    const next = task.status === "done" ? "open" : "done";
    return run(() => updateTask(task.id, { status: next }), {
      title: next === "done" ? "Done" : "Reopened",
      description: task.title,
    });
  }

  return (
    <div className="row">
      <span className={`badge ${task.status}`}>{task.status}</span>

      {editing ? (
        <input
          className="grow"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveTitle();
            if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          disabled={busy}
        />
      ) : (
        <span className="grow item-title">{task.title}</span>
      )}

      <span className="ts">{formatTs(task.updated_at)}</span>

      {!archived && !editing && (
        <div className="row-actions">
          <button type="button" onClick={toggleStatus} disabled={busy}>
            {task.status === "done" ? "Reopen" : "Done"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            Edit
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              run(() => archiveTask(task.id), {
                title: "Deleted",
                description: task.title,
              })
            }
            disabled={busy}
          >
            Archive
          </button>
        </div>
      )}

      {editing && (
        <div className="row-actions">
          <button
            type="button"
            className="primary"
            onClick={saveTitle}
            disabled={busy}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(task.title);
              setEditing(false);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
