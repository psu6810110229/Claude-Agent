/**
 * Action registry.
 *
 * Single source of truth for action metadata: capability, human label, safety
 * policy, risk level, and intentional prompt exposure. Payload shapes still
 * live in `schemas/approval.ts` (`actionPayloadSchemas`) and execution still
 * lives in `services/executor.ts`; this registry describes the actions so the
 * backend, prompts, and dashboard can speak the same language.
 *
 * Invariant (guarded by `scripts/registry-smoke.ts`): the registry keys, the
 * `actionTypeSchema` enum, and `actionPayloadSchemas` keys are the same set.
 * Adding an action type without a registry entry (or vice versa) fails smoke.
 */

import { actionTypeSchema, type ActionType } from "../schemas/approval.js";

export type CapabilityId =
  | "tasks"
  | "memory.write"
  | "memory.facts"
  | "local.events"
  | "reminders"
  | "google.calendar.create"
  | "google.calendar.update"
  | "google.calendar.delete"
  | "gmail.draft"
  | "gmail.send"
  | "line.followup"
  | "active_topic";
export type ActionDomain =
  | "task"
  | "event"
  | "reminder"
  | "memory"
  | "google"
  | "gmail"
  | "line"
  | "active_topic";
export type RiskLevel = "low" | "medium" | "high";
export type ActionPolicy =
  | "approval-required"
  | "create-only"
  | "local-only"
  | "external-service"
  /** Irreversible/data-losing; always confirm-gated, never auto-executed (Step 14). */
  | "destructive"
  | "disabled";
export type PromptExposure = "allowed" | "hidden";

export interface CapabilityMeta {
  capability: CapabilityId;
  humanLabel: string;
  policies: readonly ActionPolicy[];
}

export interface ActionMeta {
  actionType: ActionType;
  capability: CapabilityId;
  domain: ActionDomain;
  /** Short human label for activity logs and UI fallback. */
  humanLabel: string;
  /** Prompt-facing payload contract. Kept here so exposure is intentional. */
  payloadShape: string;
  /** Coarse risk signal; outward or filing actions are medium today. */
  riskLevel: RiskLevel;
  /** Safety policy enforced by review, smoke tests, and executor guardrails. */
  policies: readonly ActionPolicy[];
  /** Whether AI prompt builders may expose this action. */
  promptExposure: PromptExposure;
}

export const capabilityRegistry: Record<CapabilityId, CapabilityMeta> = {
  tasks: {
    capability: "tasks",
    humanLabel: "Tasks",
    policies: ["approval-required", "local-only"],
  },
  "memory.write": {
    capability: "memory.write",
    humanLabel: "Memory write",
    policies: ["approval-required", "local-only"],
  },
  "memory.facts": {
    capability: "memory.facts",
    humanLabel: "Memory facts",
    policies: ["approval-required", "local-only"],
  },
  "local.events": {
    capability: "local.events",
    humanLabel: "Local events",
    policies: ["approval-required", "local-only"],
  },
  reminders: {
    capability: "reminders",
    humanLabel: "Reminders",
    policies: ["approval-required", "local-only"],
  },
  "google.calendar.create": {
    capability: "google.calendar.create",
    humanLabel: "Google Calendar create",
    policies: ["approval-required", "create-only", "external-service"],
  },
  "google.calendar.update": {
    capability: "google.calendar.update",
    humanLabel: "Google Calendar update",
    policies: ["approval-required", "external-service"],
  },
  "google.calendar.delete": {
    capability: "google.calendar.delete",
    humanLabel: "Google Calendar delete",
    policies: ["approval-required", "external-service", "destructive"],
  },
  "gmail.draft": {
    capability: "gmail.draft",
    humanLabel: "Create Gmail draft",
    policies: ["approval-required", "external-service"],
  },
  "gmail.send": {
    capability: "gmail.send",
    humanLabel: "Send Gmail email",
    policies: ["approval-required", "external-service", "destructive"],
  },
  "line.followup": {
    capability: "line.followup",
    humanLabel: "LINE follow-up watch",
    // Local-only: creating a watch writes a local DB row; it never sends/replies
    // to LINE and never triggers live LINE automation.
    policies: ["approval-required", "local-only"],
  },
  active_topic: {
    capability: "active_topic",
    humanLabel: "Active topic",
    // Local-only: creates a durable watch row only. Never reads live LINE,
    // never sends/replies to LINE or any external service.
    policies: ["approval-required", "local-only"],
  },
};

export const actionRegistry: Record<ActionType, ActionMeta> = {
  "task.create": {
    actionType: "task.create",
    capability: "tasks",
    domain: "task",
    humanLabel: "Create task",
    payloadShape: '{ "title": string, "status"?: "open" | "done" }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "task.update": {
    actionType: "task.update",
    capability: "tasks",
    domain: "task",
    humanLabel: "Update task",
    payloadShape:
      '{ "id": number, "title"?: string, "status"?: "open" | "done" }  (at least one of title/status)',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "task.archive": {
    actionType: "task.archive",
    capability: "tasks",
    domain: "task",
    humanLabel: "Archive task",
    payloadShape: '{ "id": number }',
    riskLevel: "medium",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "memory.write": {
    actionType: "memory.write",
    capability: "memory.write",
    domain: "memory",
    humanLabel: "Write memory",
    payloadShape:
      '{ "target": <memory target>, "mode": "append" | "replace", "content": string, "summary"?: string }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "event.create": {
    actionType: "event.create",
    capability: "local.events",
    domain: "event",
    humanLabel: "Create event",
    payloadShape:
      '{ "title": string, "starts_at": <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "event.update": {
    actionType: "event.update",
    capability: "local.events",
    domain: "event",
    humanLabel: "Update event",
    payloadShape:
      '{ "id": number, "title"?: string, "starts_at"?: <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string }  (at least one field)',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "event.archive": {
    actionType: "event.archive",
    capability: "local.events",
    domain: "event",
    humanLabel: "Archive event",
    payloadShape: '{ "id": number }',
    riskLevel: "medium",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "reminder.create": {
    actionType: "reminder.create",
    capability: "reminders",
    domain: "reminder",
    humanLabel: "Create reminder",
    payloadShape: '{ "title": string, "due_at": <ISO UTC>, "notes"?: string }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "reminder.update": {
    actionType: "reminder.update",
    capability: "reminders",
    domain: "reminder",
    humanLabel: "Update reminder",
    payloadShape:
      '{ "id": number, "title"?: string, "due_at"?: <ISO UTC>, "notes"?: string }  (at least one field)',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "reminder.done": {
    actionType: "reminder.done",
    capability: "reminders",
    domain: "reminder",
    humanLabel: "Mark reminder done",
    payloadShape: '{ "id": number }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "reminder.archive": {
    actionType: "reminder.archive",
    capability: "reminders",
    domain: "reminder",
    humanLabel: "Archive reminder",
    payloadShape: '{ "id": number }',
    riskLevel: "medium",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "google_event.create": {
    actionType: "google_event.create",
    capability: "google.calendar.create",
    domain: "google",
    humanLabel: "Create Google Calendar event",
    payloadShape:
      '{ "title": string, "starts_at": <ISO UTC>, "ends_at": <ISO UTC>, "location"?: string, "notes"?: string, "recurrence"?: string[] (iCal lines for a repeating event, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261031T000000Z"]; starts_at/ends_at are the FIRST occurrence; omit for a one-off) }',
    riskLevel: "medium",
    policies: ["approval-required", "create-only", "external-service"],
    promptExposure: "allowed",
  },
  "google_event.update": {
    actionType: "google_event.update",
    capability: "google.calendar.update",
    domain: "google",
    humanLabel: "Update Google Calendar event",
    payloadShape:
      '{ "id": string, "title"?: string, "starts_at"?: <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string, "scope"?: "instance"|"series" }  (id from the calendar read; at least one editable field. scope "series" edits the WHOLE recurring series, "instance" (default) only that one occurrence)',
    riskLevel: "medium",
    policies: ["approval-required", "external-service"],
    promptExposure: "allowed",
  },
  "google_event.delete": {
    actionType: "google_event.delete",
    capability: "google.calendar.delete",
    domain: "google",
    humanLabel: "Delete Google Calendar event",
    payloadShape:
      '{ "id": string, "scope"?: "instance"|"series" }  (id from the calendar read. scope "series" deletes the WHOLE recurring series, "instance" (default) only that one occurrence)',
    riskLevel: "high",
    policies: ["approval-required", "external-service", "destructive"],
    promptExposure: "allowed",
  },
  "fact.remember": {
    actionType: "fact.remember",
    capability: "memory.facts",
    domain: "memory",
    humanLabel: "Remember a fact",
    payloadShape:
      '{ "content": string (one sentence about the user), "keywords"?: string (lowercase recall tags, space-separated), "category"?: "identity"|"preference"|"relationship"|"routine"|"project"|"general", "pinned"?: boolean (true for core identity like the user\'s name) }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "fact.update": {
    actionType: "fact.update",
    capability: "memory.facts",
    domain: "memory",
    humanLabel: "Update a fact",
    payloadShape:
      '{ "id": number, "content"?: string, "keywords"?: string, "category"?: <category>, "pinned"?: boolean }  (id from the known facts list; at least one field)',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "fact.forget": {
    actionType: "fact.forget",
    capability: "memory.facts",
    domain: "memory",
    humanLabel: "Forget a fact",
    payloadShape: '{ "id": number }  (id from the known facts list)',
    riskLevel: "medium",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "gmail.draft": {
    actionType: "gmail.draft",
    capability: "gmail.draft",
    domain: "gmail",
    humanLabel: "Create Gmail draft",
    payloadShape:
      '{ "to": string (email address), "subject": string, "body": string (plain text), "cc"?: string, "bcc"?: string, "replyToMessageId"?: string (message id for threading) }',
    riskLevel: "low",
    policies: ["approval-required", "external-service"],
    promptExposure: "allowed",
  },
  "gmail.send": {
    actionType: "gmail.send",
    capability: "gmail.send",
    domain: "gmail",
    humanLabel: "Send Gmail email",
    payloadShape:
      '{ "to": string (email address), "subject": string, "body": string (plain text), "cc"?: string, "bcc"?: string, "replyToMessageId"?: string }',
    riskLevel: "high",
    policies: ["approval-required", "external-service", "destructive"],
    promptExposure: "allowed",
  },
  "line_followup.create": {
    actionType: "line_followup.create",
    capability: "line.followup",
    domain: "line",
    humanLabel: "Schedule LINE follow-up check",
    payloadShape:
      '{ "topic": string (short label of what to follow up on), "keywords": string[] (1-10 search terms over EXPORTED LINE text), "chat_filter"?: string (limit to one chat by name), "due_at": <ISO UTC> (when to run the check) }',
    riskLevel: "low",
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
  "active_topic.create": {
    actionType: "active_topic.create",
    capability: "active_topic",
    domain: "active_topic",
    humanLabel: "Track an active topic",
    payloadShape:
      '{ "title": string (short topic label, max 200 chars), "source": "line"|"calendar"|"mixed"|"general", "keywords": string[] (1-10 search terms), "chat_filter"?: string (LINE chat name filter, optional), "priority"?: number (0-100, default 50), "cooldown_minutes"?: number (1-1440, default 30) }',
    riskLevel: "low",
    // Local-only: creates one DB row. Never reads live LINE, never sends or
    // replies to LINE, and never writes any external service.
    policies: ["approval-required", "local-only"],
    promptExposure: "allowed",
  },
};

/** Canonical action-type list, sourced from the executor allowlist enum. */
export const ACTION_TYPES = actionTypeSchema.options as readonly ActionType[];

export function getActionMeta(actionType: ActionType): ActionMeta {
  return actionRegistry[actionType];
}

export function getPromptExposedActions(): readonly ActionMeta[] {
  return ACTION_TYPES.map((type) => actionRegistry[type]).filter(
    (meta) => meta.promptExposure === "allowed",
  );
}

export function buildAllowedActionsPrompt(): string {
  return getPromptExposedActions()
    .map(
      (meta) =>
        `- "${meta.actionType}" payload: ${meta.payloadShape}  [capability: ${meta.capability}; policy: ${meta.policies.join(", ")}; risk: ${meta.riskLevel}]`,
    )
    .join("\n");
}
