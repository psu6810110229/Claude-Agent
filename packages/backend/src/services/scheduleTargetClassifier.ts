import type { ActionType } from "../schemas/approval.js";
import type {
  ScheduleConstraint,
  ScheduleConstraintDomain,
  ScheduleTargetTag,
} from "../schemas/scheduleConstraint.js";

export const ALL_SCHEDULE_TARGETS: readonly ScheduleTargetTag[] = [
  "schedule.event",
  "schedule.reminder",
  "aquarium.water_change",
];

const AQUARIUM_MARKERS = [
  "ตู้ปลา",
  "ปลา",
  "aquarium",
  "fish tank",
  "tank",
  "co2",
  "คาร์บอน",
];

const WATER_CHANGE_MARKERS = [
  "เปลี่ยนน้ำ",
  "ถ่ายน้ำ",
  "water change",
  "change water",
];

const REMINDER_MARKERS = ["เตือน", "remind", "reminder"];

function includesAny(lower: string, markers: readonly string[]): boolean {
  return markers.some((m) => lower.includes(m));
}

function textOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  return [p.title, p.notes, p.location]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

export function inferConstraintDomainFromText(
  kind: ScheduleConstraint["kind"],
  text: string,
): ScheduleConstraintDomain {
  if (kind === "recurring_block") return "schedule";
  const lower = text.toLowerCase();
  return includesAny(lower, AQUARIUM_MARKERS) ? "aquarium" : "general";
}

export function defaultAppliesToForDomain(
  kind: ScheduleConstraint["kind"],
  domain: ScheduleConstraintDomain,
): ScheduleTargetTag[] {
  if (kind === "recurring_block") return [...ALL_SCHEDULE_TARGETS];
  if (domain === "aquarium") return ["aquarium.water_change"];
  return [...ALL_SCHEDULE_TARGETS];
}

export function hydrateScheduleConstraint(
  c: ScheduleConstraint,
): ScheduleConstraint {
  const domain =
    c.domain ?? inferConstraintDomainFromText(c.kind, `${c.label} ${c.raw}`);
  const applies_to =
    c.applies_to && c.applies_to.length > 0
      ? c.applies_to
      : defaultAppliesToForDomain(c.kind, domain);
  return {
    ...c,
    domain,
    applies_to,
    status: c.status ?? "active",
    source_ref: c.source_ref ?? c.source,
  };
}

export function constraintAppliesToTarget(
  c: ScheduleConstraint,
  target: ScheduleTargetTag,
): boolean {
  const scoped = hydrateScheduleConstraint(c);
  if (scoped.status !== "active") return false;
  if (scoped.kind === "recurring_block") return true;
  return (scoped.applies_to ?? []).includes(target);
}

export function filterConstraintsForTarget(
  constraints: ScheduleConstraint[],
  target: ScheduleTargetTag | null | undefined,
): ScheduleConstraint[] {
  const active = constraints
    .map(hydrateScheduleConstraint)
    .filter((c) => c.status === "active");
  if (!target) return active;
  return active.filter((c) => constraintAppliesToTarget(c, target));
}

export function classifyTextScheduleTarget(
  text: string,
  fallback: ScheduleTargetTag = "schedule.event",
): ScheduleTargetTag {
  const lower = text.toLowerCase();
  if (
    includesAny(lower, AQUARIUM_MARKERS) &&
    includesAny(lower, WATER_CHANGE_MARKERS)
  ) {
    return "aquarium.water_change";
  }
  if (includesAny(lower, REMINDER_MARKERS)) return "schedule.reminder";
  return fallback;
}

export function classifyProposedActionTarget(
  actionType: ActionType,
  payload: unknown,
): ScheduleTargetTag | null {
  const fallback =
    actionType === "reminder.create" || actionType === "reminder.update"
      ? "schedule.reminder"
      : actionType === "event.create" ||
          actionType === "event.update" ||
          actionType === "google_event.create" ||
          actionType === "google_event.update"
        ? "schedule.event"
        : null;
  if (!fallback) return null;
  return classifyTextScheduleTarget(textOf(payload), fallback);
}
