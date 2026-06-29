/* eslint-disable no-console */
import type { ScheduleConstraint } from "../src/schemas/scheduleConstraint.js";
import {
  classifyProposedActionTarget,
  hydrateScheduleConstraint,
} from "../src/services/scheduleTargetClassifier.js";
import { parseConstraintFromFact } from "../src/services/scheduleConstraints.js";
import { findConstraintViolations } from "../src/services/availabilityResolver.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS ${msg}`);
}

console.log("Running scoped schedule-rule smoke test...");

const now = new Date("2026-06-22T00:00:00.000Z");
const monday1630Bkk = "2026-06-22T09:30:00.000Z";

const co2Window: ScheduleConstraint = {
  kind: "protected_window",
  label: "ตู้ปลา: CO2",
  weekdays: [],
  startLocal: "15:00",
  endLocal: "17:00",
  source: "fact#901",
  raw: "ตู้ปลา CO2 15:00-17:00",
};

const classBlock: ScheduleConstraint = {
  kind: "recurring_block",
  label: "class",
  weekdays: [1],
  startLocal: "15:00",
  endLocal: "18:00",
  source: "class_block#1",
  raw: "class Monday 15:00-18:00",
};

const legacyAquarium = hydrateScheduleConstraint(co2Window);
assert(
  legacyAquarium.domain === "aquarium" &&
    legacyAquarium.applies_to?.join(",") === "aquarium.water_change" &&
    legacyAquarium.status === "active" &&
    legacyAquarium.source_ref === "fact#901",
  "legacy aquarium protected_window hydrates to aquarium-only active scope",
);

const parsed = parseConstraintFromFact({
  id: 902,
  content: "ตู้ปลา CO2 15:00-17:00",
  keywords: "",
  category: "routine",
  pinned: false,
  source: "test",
  created_at: "2026-06-20T00:00:00.000Z",
  updated_at: "2026-06-20T01:00:00.000Z",
});
assert(
  parsed?.domain === "aquarium" &&
    parsed.applies_to?.includes("aquarium.water_change") === true &&
    parsed.provenance_updated_at === "2026-06-20T01:00:00.000Z",
  "fact-derived protected_window carries semantic scope and provenance",
);

assert(
  classifyProposedActionTarget("google_event.create", {
    title: "นัดทั่วไป 15:00",
    starts_at: monday1630Bkk,
    ends_at: "2026-06-22T10:30:00.000Z",
  }) === "schedule.event",
  "normal appointment target stays schedule.event",
);

assert(
  classifyProposedActionTarget("reminder.create", {
    title: "เปลี่ยนน้ำตู้ปลา 15:00",
    due_at: monday1630Bkk,
  }) === "aquarium.water_change",
  "aquarium water-change target is classified deterministically",
);

const genericEventViolations = findConstraintViolations(
  {
    title: "นัดทั่วไป",
    startUtc: monday1630Bkk,
    endUtc: "2026-06-22T10:30:00.000Z",
  },
  [co2Window],
  now,
  undefined,
  "schedule.event",
);
assert(
  genericEventViolations.length === 0,
  "CO2 protected window does not block a generic event",
);

const waterChangeViolations = findConstraintViolations(
  { title: "เปลี่ยนน้ำตู้ปลา", startUtc: monday1630Bkk },
  [co2Window],
  now,
  undefined,
  "aquarium.water_change",
);
assert(
  waterChangeViolations.length >= 1,
  "CO2 protected window blocks aquarium water change",
);

const classViolations = findConstraintViolations(
  {
    title: "นัดทั่วไป",
    startUtc: monday1630Bkk,
    endUtc: "2026-06-22T10:30:00.000Z",
  },
  [classBlock],
  now,
  undefined,
  "schedule.event",
);
assert(
  classViolations.length >= 1,
  "recurring class block still blocks normal scheduling",
);

console.log("Scoped schedule-rule smoke test PASSED.");
