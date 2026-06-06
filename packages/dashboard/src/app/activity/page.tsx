"use client";

import { listActivity } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading, Empty } from "@/components/States";

export default function ActivityPage() {
  const { data: activity, loading, error, reload } = useResource(() =>
    listActivity(100),
  );

  return (
    <>
      <h2>Activity</h2>

      {loading && <Loading />}
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
    </>
  );
}
