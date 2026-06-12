"use client";

import { useEffect } from "react";
import { preload } from "swr";
import {
  getCalendarUpcoming,
  getChatHistory,
  getSettings,
  listActivity,
  listApprovals,
  listEvents,
  listMemory,
  listReminders,
  listTasks,
} from "@/lib/api";

/** Fires background SWR preloads for all data-fetching routes on layout mount. */
export function Prefetcher() {
  useEffect(() => {
    preload("/api/tasks",        listTasks);
    preload("/api/approvals",    listApprovals);
    preload("/api/activity",     () => listActivity(100));
    preload("/api/settings",     getSettings);
    preload("/api/memory",       listMemory);
    preload("/api/chat/history", () => getChatHistory(100));
    preload("/api/upcoming",     () =>
      Promise.all([getCalendarUpcoming(), listEvents(), listReminders()]).then(
        ([calendar, events, reminders]) => ({ calendar, events, reminders }),
      ),
    );
  }, []);

  return null;
}
