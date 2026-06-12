"use client";

import { listActivity } from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Empty } from "@/components/States";

function ActivitySkeleton() {
  return (
    <div className="panel">
      {[140, 110, 165, 95, 130, 120].map((w, i) => (
        <div className="row" key={i}>
          <span className="skel" style={{ width: w, height: 22, flexShrink: 0 }} />
          <span className="skel" style={{ flex: 1, height: 13, margin: "0 8px" }} />
          <span className="skel" style={{ width: 55, height: 13, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const { data: activity, loading, error, reload } = useData(
    "/api/activity",
    () => listActivity(100),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit Trail</p>
          <h2>Activity</h2>
          <p className="lede">Recent local agent and dashboard events.</p>
        </div>
      </header>

      <div className="stack">
        {loading && <ActivitySkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {activity && activity.length === 0 && <Empty label="No activity yet." />}

        {activity && activity.length > 0 && (
          <div className="panel">
            {activity.map((a) => (
              <div className="row" key={a.id}>
                <span className="badge">{a.event_type}</span>
                <span className="grow">{a.detail ?? ""}</span>
                <span className="ts">{formatTs(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
