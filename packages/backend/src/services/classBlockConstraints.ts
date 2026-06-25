import { listActiveClassBlocks } from "../db/repositories/classBlockRepo.js";
import type { ClassBlock } from "../schemas/classBlock.js";
import type { ScheduleConstraint } from "../schemas/scheduleConstraint.js";

/**
 * class_block → ScheduleConstraint bridge.
 *
 * Each active class block becomes ONE `recurring_block` constraint on its single
 * Bangkok weekday, carrying its term bounds. The existing resolver materializes
 * it into concrete daily windows and the availability/verifier engine treats it
 * exactly like a class block parsed from a fact — so cross-referencing classes
 * against the Google calendar and the free-slot finder work with zero extra
 * wiring. Pure apart from the DB read.
 */
export function classBlockToConstraint(b: ClassBlock): ScheduleConstraint {
  return {
    kind: "recurring_block",
    label: b.subject.slice(0, 60),
    weekdays: [b.weekday],
    startLocal: b.start_local,
    endLocal: b.end_local,
    source: `class_block#${b.id}`,
    raw: b.location ? `${b.subject} @ ${b.location}` : b.subject,
    activeFrom: b.active_from,
    activeUntil: b.active_until,
  };
}

/** Resolve all active class blocks as recurring-block constraints. */
export function resolveClassBlockConstraints(): ScheduleConstraint[] {
  return listActiveClassBlocks().map(classBlockToConstraint);
}
