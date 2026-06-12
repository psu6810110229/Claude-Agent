/**
 * Sprint 2 registry smoke.
 *
 * Pure, no DB / no network / no Claude. Guards the core risk of the action
 * registry: drift between the executor allowlist (`actionTypeSchema` /
 * `actionPayloadSchemas`) and the metadata registry. If these three sets ever
 * disagree, the UI could surface an action the backend can't run (or vice
 * versa). This fails the build-time guard instead.
 */

import {
  actionTypeSchema,
  actionPayloadSchemas,
} from "../src/schemas/approval.js";
import {
  actionRegistry,
  ACTION_TYPES,
  getActionMeta,
} from "../src/services/actionRegistry.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

console.log("Sprint 2: action registry smoke");

const enumTypes = [...actionTypeSchema.options].sort();
const schemaTypes = Object.keys(actionPayloadSchemas).sort();
const registryTypes = Object.keys(actionRegistry).sort();

assert(
  JSON.stringify(enumTypes) === JSON.stringify(schemaTypes),
  "actionTypeSchema enum matches actionPayloadSchemas keys",
);
assert(
  JSON.stringify(enumTypes) === JSON.stringify(registryTypes),
  "actionTypeSchema enum matches actionRegistry keys",
);
assert(
  JSON.stringify([...ACTION_TYPES].sort()) === JSON.stringify(enumTypes),
  "exported ACTION_TYPES matches the enum",
);

for (const type of actionTypeSchema.options) {
  const meta = getActionMeta(type);
  assert(meta.actionType === type, `registry entry self-identifies: ${type}`);
  assert(
    typeof meta.humanLabel === "string" && meta.humanLabel.length > 0,
    `non-empty humanLabel: ${type}`,
  );
}

// The single outward action stays google_event.create (create-only invariant).
const outward = actionTypeSchema.options.filter((t) => getActionMeta(t).outward);
assert(
  outward.length === 1 && outward[0] === "google_event.create",
  "only google_event.create is marked outward",
);

console.log("Sprint 2 registry smoke: ALL PASS");
