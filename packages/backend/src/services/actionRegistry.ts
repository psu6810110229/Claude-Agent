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
  | "local.events"
  | "reminders"
  | "google.calendar.create";
export type ActionDomain = "task" | "event" | "reminder" | "memory" | "google";
export type RiskLevel = "low" | "medium" | "high";
export type ActionPolicy =
  | "approval-required"
  | "create-only"
  | "local-only"
  | "external-service"
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
      '{ "title": string, "starts_at": <ISO UTC>, "ends_at": <ISO UTC>, "location"?: string, "notes"?: string }',
    riskLevel: "medium",
    policies: ["approval-required", "create-only", "external-service"],
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
