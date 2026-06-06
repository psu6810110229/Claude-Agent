"use client";

import Link from "next/link";
import { listActivity, listTasks } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading } from "@/components/States";
import type { Activity, Task } from "@/lib/types";

async function loadToday(): Promise<{ tasks: Task[]; activity: Activity[] }> {
  const [tasks, activity] = await Promise.all([
    listTasks(),
    listActivity(10),
  ]);
  return { tasks, activity };
}

export default function TodayPage() {
  const { data, loading, error, reload } = useResource(loadToday);

  return (
    <>
      <h2>Today</h2>

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <>
          <Summary tasks={data.tasks} />

          <h3>Recent activity</h3>
          {data.activity.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <div className="panel">
              {data.activity.map((a) => (
                <div className="row" key={a.id}>
                  <span className="badge">{a.event_type}</span>
                  <span className="grow">{a.detail ?? ""}</span>
                  <span className="ts">{formatTs(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="muted">
            <Link href="/activity">View all activity →</Link>
          </p>
        </>
      )}
    </>
  );
}

function Summary({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => t.status === "open").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const archived = tasks.filter((t) => t.status === "archived").length;

  return (
    <div className="summary-grid">
      <Stat n={open} label="Open tasks" />
      <Stat n={done} label="Done" />
      <Stat n={archived} label="Archived" />
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{label}</div>
    </div>
  );
}
