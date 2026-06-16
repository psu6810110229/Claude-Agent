import type { Activity, ActivityEventType } from "./types";

export type ActivitySource =
  | "Chat"
  | "Approval"
  | "Calendar"
  | "Task"
  | "Reminder"
  | "Memory"
  | "System";

export type ActivityTone = "neutral" | "success" | "warning" | "danger";

export interface ActivityDisplay {
  title: string;
  source: ActivitySource;
  tone: ActivityTone;
}

export interface ActivityGroup {
  label: "Today" | "Yesterday" | "Older";
  items: Activity[];
}

const KNOWN_ACTIVITY: Partial<Record<ActivityEventType, ActivityDisplay>> = {
  "chat.message.received": {
    title: "Fran sent a message",
    source: "Chat",
    tone: "neutral",
  },
  "chat.message.replied": {
    title: "Friday replied",
    source: "Chat",
    tone: "success",
  },
  "chat.message.proposed": {
    title: "Friday requested action approval",
    source: "Chat",
    tone: "warning",
  },
  "chat.message.failed": {
    title: "Friday could not reply",
    source: "Chat",
    tone: "danger",
  },
  "chat.message.rejected": {
    title: "Friday reply was rejected",
    source: "Chat",
    tone: "danger",
  },
  "chat.session.reset": {
    title: "Chat history was reset",
    source: "Chat",
    tone: "neutral",
  },
  "command.received": {
    title: "Fran sent a command",
    source: "System",
    tone: "neutral",
  },
  "command.proposed": {
    title: "Command requested action approval",
    source: "Approval",
    tone: "warning",
  },
  "command.rejected": {
    title: "Command was rejected",
    source: "System",
    tone: "danger",
  },
  "ai.command.received": {
    title: "Fran sent an AI command",
    source: "System",
    tone: "neutral",
  },
  "ai.command.proposed": {
    title: "AI command requested action approval",
    source: "Approval",
    tone: "warning",
  },
  "ai.command.failed": {
    title: "AI command failed",
    source: "System",
    tone: "danger",
  },
  "ai.command.rejected": {
    title: "AI command was rejected",
    source: "System",
    tone: "danger",
  },
  "ai.command.clarification": {
    title: "Friday asked for clarification",
    source: "Chat",
    tone: "warning",
  },
  "brief.daily.requested": {
    title: "Daily Brief was requested",
    source: "System",
    tone: "neutral",
  },
  "brief.daily.generated": {
    title: "Daily Brief was generated",
    source: "System",
    tone: "success",
  },
  "brief.daily.proposed": {
    title: "Daily Brief requested action approval",
    source: "Approval",
    tone: "warning",
  },
  "brief.daily.failed": {
    title: "Daily Brief failed",
    source: "System",
    tone: "danger",
  },
  "brief.daily.rejected": {
    title: "Daily Brief was rejected",
    source: "System",
    tone: "danger",
  },
  "brief.evening.requested": {
    title: "Evening Review was requested",
    source: "System",
    tone: "neutral",
  },
  "brief.evening.generated": {
    title: "Evening Review was generated",
    source: "System",
    tone: "success",
  },
  "brief.evening.proposed": {
    title: "Evening Review requested action approval",
    source: "Approval",
    tone: "warning",
  },
  "brief.evening.failed": {
    title: "Evening Review failed",
    source: "System",
    tone: "danger",
  },
  "brief.evening.rejected": {
    title: "Evening Review was rejected",
    source: "System",
    tone: "danger",
  },
  "approval.create": {
    title: "Approval was queued",
    source: "Approval",
    tone: "warning",
  },
  "approval.approve": {
    title: "Fran approved an action",
    source: "Approval",
    tone: "success",
  },
  "approval.reject": {
    title: "Fran rejected an action",
    source: "Approval",
    tone: "neutral",
  },
  "approval.execute_succeeded": {
    title: "Action completed",
    source: "Approval",
    tone: "success",
  },
  "approval.execute_failed": {
    title: "Action failed",
    source: "Approval",
    tone: "danger",
  },
  "notification.fired": {
    title: "Notification was sent",
    source: "Reminder",
    tone: "warning",
  },
  "notification.desktop_failed": {
    title: "Desktop notification failed",
    source: "System",
    tone: "danger",
  },
  "scheduler.tick_error": {
    title: "Scheduler check failed",
    source: "System",
    tone: "danger",
  },
  "task.create": {
    title: "Task was created",
    source: "Task",
    tone: "success",
  },
  "task.update": {
    title: "Task was updated",
    source: "Task",
    tone: "neutral",
  },
  "task.archive": {
    title: "Task was archived",
    source: "Task",
    tone: "neutral",
  },
  "event.create": {
    title: "Local event was created",
    source: "Calendar",
    tone: "success",
  },
  "event.update": {
    title: "Local event was updated",
    source: "Calendar",
    tone: "neutral",
  },
  "event.archive": {
    title: "Local event was archived",
    source: "Calendar",
    tone: "neutral",
  },
  "google_event.create": {
    title: "Google Calendar event was created",
    source: "Calendar",
    tone: "success",
  },
  "reminder.create": {
    title: "Reminder was created",
    source: "Reminder",
    tone: "success",
  },
  "reminder.update": {
    title: "Reminder was updated",
    source: "Reminder",
    tone: "neutral",
  },
  "reminder.done": {
    title: "Reminder was marked done",
    source: "Reminder",
    tone: "success",
  },
  "reminder.archive": {
    title: "Reminder was archived",
    source: "Reminder",
    tone: "neutral",
  },
  "memory.write": {
    title: "Memory was saved",
    source: "Memory",
    tone: "success",
  },
};

export function displayActivity(activity: Activity): ActivityDisplay {
  const known = KNOWN_ACTIVITY[activity.event_type as ActivityEventType];
  if (known) return known;

  return {
    title: humanizeEventType(activity.event_type),
    source: sourceFromEventType(activity.event_type),
    tone: activity.event_type.includes("failed") ? "danger" : "neutral",
  };
}

export function groupActivityByDay(
  activity: Activity[],
  now = new Date(),
): ActivityGroup[] {
  const buckets: Record<ActivityGroup["label"], Activity[]> = {
    Today: [],
    Yesterday: [],
    Older: [],
  };
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  for (const item of activity) {
    const date = new Date(item.created_at);
    if (Number.isNaN(date.getTime())) {
      buckets.Older.push(item);
      continue;
    }

    const day = startOfLocalDay(date);
    if (day.getTime() === today.getTime()) buckets.Today.push(item);
    else if (day.getTime() === yesterday.getTime()) buckets.Yesterday.push(item);
    else buckets.Older.push(item);
  }

  return (["Today", "Yesterday", "Older"] as const)
    .map((label) => ({ label, items: buckets[label] }))
    .filter((group) => group.items.length > 0);
}

function sourceFromEventType(eventType: string): ActivitySource {
  if (eventType.startsWith("chat.")) return "Chat";
  if (eventType.startsWith("approval.")) return "Approval";
  if (eventType.startsWith("command.") || eventType.startsWith("ai.command.")) {
    return "System";
  }
  if (eventType.startsWith("brief.")) return "System";
  if (eventType.startsWith("notification.")) return "Reminder";
  if (eventType.startsWith("scheduler.")) return "System";
  if (eventType.startsWith("task.")) return "Task";
  if (eventType.startsWith("reminder.")) return "Reminder";
  if (eventType.startsWith("memory.")) return "Memory";
  if (eventType.startsWith("event.") || eventType.startsWith("google_event.")) {
    return "Calendar";
  }
  return "System";
}

function humanizeEventType(eventType: string): string {
  const words = eventType
    .replace(/[_\.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "Activity recorded";
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
