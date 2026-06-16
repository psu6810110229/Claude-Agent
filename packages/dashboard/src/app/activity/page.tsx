"use client";

import {
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  MessageCircle,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

import { listActivity } from "@/lib/api";
import { useData } from "@/lib/useData";
import { formatTs } from "@/lib/format";
import {
  displayActivity,
  groupActivityByDay,
  type ActivitySource,
} from "@/lib/activityDisplay";
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

const SOURCE_ICONS: Record<ActivitySource, LucideIcon> = {
  Chat: MessageCircle,
  Approval: CheckCircle2,
  Calendar: CalendarDays,
  Task: ClipboardList,
  Reminder: CircleAlert,
  Memory: NotebookPen,
  System: Bot,
};

export default function ActivityPage() {
  const { data: activity, loading, error, reload } = useData(
    "/api/activity",
    () => listActivity(100),
  );
  const groups = activity ? groupActivityByDay(activity) : [];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit Trail</p>
          <h2>Activity</h2>
          <p className="lede">A readable timeline of recent Friday and Fran activity.</p>
        </div>
      </header>

      <div className="stack">
        {loading && <ActivitySkeleton />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {activity && activity.length === 0 && <Empty label="No activity yet." />}

        {groups.length > 0 && (
          <div className="activity-timeline">
            {groups.map((group) => (
              <section className="activity-day" key={group.label}>
                <h3>{group.label}</h3>
                <div className="panel">
                  {group.items.map((a) => {
                    const display = displayActivity(a);
                    const Icon = SOURCE_ICONS[display.source];

                    return (
                      <article className="activity-row" key={a.id}>
                        <span className={`activity-icon ${display.tone}`}>
                          <Icon size={17} strokeWidth={2.1} />
                        </span>
                        <div className="activity-main">
                          <div className="activity-line">
                            <span className="activity-title">{display.title}</span>
                            <span className={`badge ${display.source.toLowerCase()}`}>
                              {display.source}
                            </span>
                          </div>
                          {a.detail && <p className="activity-detail">{a.detail}</p>}
                          <details className="activity-debug">
                            <summary>Debug details</summary>
                            <dl>
                              <div>
                                <dt>ID</dt>
                                <dd>{a.id}</dd>
                              </div>
                              <div>
                                <dt>Event type</dt>
                                <dd>{a.event_type}</dd>
                              </div>
                              <div>
                                <dt>Created</dt>
                                <dd>{a.created_at}</dd>
                              </div>
                              <div>
                                <dt>Detail</dt>
                                <dd>{a.detail ?? "None"}</dd>
                              </div>
                            </dl>
                          </details>
                        </div>
                        <time className="ts" dateTime={a.created_at}>
                          {formatTs(a.created_at)}
                        </time>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
