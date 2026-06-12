/**
 * Action registry (Sprint 2).
 *
 * Single source of truth for action METADATA — domain, human label, risk
 * level, whether the action reaches an outward service, and whether the chat /
 * brief reasoning runtime may propose it. Payload SHAPES still live in
 * `schemas/approval.ts` (`actionPayloadSchemas`) and execution still lives in
 * `services/executor.ts`; this registry only describes the actions so backend,
 * prompts, and (mirrored) the dashboard speak the same language.
 *
 * Invariant (guarded by `scripts/registry-smoke.ts`): the registry keys, the
 * `actionTypeSchema` enum, and `actionPayloadSchemas` keys are the SAME set.
 * Adding an action type without a registry entry (or vice versa) fails the
 * smoke — preventing "UI knows it, backend can't run it" drift.
 */

import { actionTypeSchema, type ActionType } from "../schemas/approval.js";

export type ActionDomain = "task" | "event" | "reminder" | "memory" | "google";
export type RiskLevel = "low" | "medium";

export interface ActionMeta {
  actionType: ActionType;
  domain: ActionDomain;
  /** Short human label (English) for activity logs / UI fallback. */
  humanLabel: string;
  /** Coarse risk signal; outward/destructive-ish actions are "medium". */
  riskLevel: RiskLevel;
  /** True when the action touches an external service (not local DB/files). */
  outward: boolean;
  /** True when the chat / brief reasoning runtime may propose this action. */
  allowedInChat: boolean;
}

export const actionRegistry: Record<ActionType, ActionMeta> = {
  "task.create": {
    actionType: "task.create",
    domain: "task",
    humanLabel: "Create task",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "task.update": {
    actionType: "task.update",
    domain: "task",
    humanLabel: "Update task",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "task.archive": {
    actionType: "task.archive",
    domain: "task",
    humanLabel: "Archive task",
    riskLevel: "medium",
    outward: false,
    allowedInChat: true,
  },
  "memory.write": {
    actionType: "memory.write",
    domain: "memory",
    humanLabel: "Write memory",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "event.create": {
    actionType: "event.create",
    domain: "event",
    humanLabel: "Create event",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "event.update": {
    actionType: "event.update",
    domain: "event",
    humanLabel: "Update event",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "event.archive": {
    actionType: "event.archive",
    domain: "event",
    humanLabel: "Archive event",
    riskLevel: "medium",
    outward: false,
    allowedInChat: true,
  },
  "reminder.create": {
    actionType: "reminder.create",
    domain: "reminder",
    humanLabel: "Create reminder",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "reminder.update": {
    actionType: "reminder.update",
    domain: "reminder",
    humanLabel: "Update reminder",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "reminder.done": {
    actionType: "reminder.done",
    domain: "reminder",
    humanLabel: "Mark reminder done",
    riskLevel: "low",
    outward: false,
    allowedInChat: true,
  },
  "reminder.archive": {
    actionType: "reminder.archive",
    domain: "reminder",
    humanLabel: "Archive reminder",
    riskLevel: "medium",
    outward: false,
    allowedInChat: true,
  },
  "google_event.create": {
    actionType: "google_event.create",
    domain: "google",
    humanLabel: "Create Google Calendar event",
    riskLevel: "medium",
    outward: true,
    allowedInChat: true,
  },
};

/** Canonical action-type list, sourced from the executor allowlist enum. */
export const ACTION_TYPES = actionTypeSchema.options as readonly ActionType[];

export function getActionMeta(actionType: ActionType): ActionMeta {
  return actionRegistry[actionType];
}
