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
  capabilityRegistry,
  actionRegistry,
  ACTION_TYPES,
  buildAllowedActionsPrompt,
  getActionMeta,
  getPromptExposedActions,
} from "../src/services/actionRegistry.js";
import { aiActionSchema } from "../src/schemas/aiCommand.js";
import { buildChiefOfStaffPrompt } from "../src/services/chiefOfStaffPrompt.js";
import { buildChatPrompt } from "../src/services/chatPrompt.js";
import { buildBriefPrompt } from "../src/services/briefPrompt.js";

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
  assert(
    Object.hasOwn(capabilityRegistry, meta.capability),
    `known capability for action: ${type}`,
  );
  assert(
    meta.policies.includes("approval-required"),
    `approval-required policy: ${type}`,
  );
  assert(
    typeof meta.payloadShape === "string" && meta.payloadShape.length > 0,
    `prompt payload shape present: ${type}`,
  );
}

// The external-service actions are exactly the Google Calendar writes (Step 14
// added update/delete) plus the Gmail writes (Step 17 draft/send). No other
// capability reaches an external service.
const external = actionTypeSchema.options.filter((t) =>
  getActionMeta(t).policies.includes("external-service"),
);
assert(
  JSON.stringify([...external].sort()) ===
    JSON.stringify([
      "gmail.draft",
      "gmail.send",
      "google_event.create",
      "google_event.delete",
      "google_event.update",
    ]),
  "external-service actions are exactly the Google Calendar + Gmail writes",
);
assert(
  getActionMeta("google_event.create").policies.includes("create-only"),
  "google_event.create keeps create-only policy",
);
// Delete is the destructive Google write; it must never be create-only and must
// carry the destructive policy (always confirm-gated, never auto-executed).
assert(
  getActionMeta("google_event.delete").policies.includes("destructive") &&
    !getActionMeta("google_event.delete").policies.includes("create-only"),
  "google_event.delete is destructive and not create-only",
);
assert(
  !getActionMeta("google_event.update").policies.includes("create-only"),
  "google_event.update is not create-only",
);

const reminderDone = aiActionSchema.safeParse({
  action_type: "reminder.done",
  payload: { id: 1 },
});
assert(reminderDone.success, "aiActionSchema accepts reminder.done");

const promptExposed = getPromptExposedActions().map((a) => a.actionType);
assert(
  JSON.stringify(promptExposed) === JSON.stringify([...ACTION_TYPES]),
  "all current executable actions are intentionally prompt-exposed",
);
assert(
  !getPromptExposedActions().some((a) => a.policies.includes("disabled")),
  "disabled actions are not prompt-exposed",
);

const allowedActionsPrompt = buildAllowedActionsPrompt();
for (const type of ACTION_TYPES) {
  assert(
    allowedActionsPrompt.includes(`"${type}"`),
    `allowed action prompt includes ${type}`,
  );
}

const chiefPrompt = buildChiefOfStaffPrompt({
  input: "registry smoke",
  openTasks: [],
  memoryTargets: ["preferences", "routines", "projects", "decisions"],
  nowUtc: "2026-06-12T00:00:00.000Z",
  nowBangkok: "2026-06-12 07:00",
});
const chatPrompt = buildChatPrompt({
  message: "registry smoke",
  openTasks: [],
  memorySummaries: [],
  facts: [],
  nowUtc: "2026-06-12T00:00:00.000Z",
  nowBangkok: "2026-06-12 07:00",
  googleEvents: [],
  events: [],
  reminders: [],
  gmailUnread: [],
  contacts: [],
  contactsStatus: "disabled",
  recentDriveFiles: [],
  lineChats: [],
  lineMessages: [],
  lineMatches: [],
  approvalOutcomes: [],
  history: [],
  autoExecute: false,
  autoExecuteDestructive: false,
});
const briefPrompt = buildBriefPrompt("daily", {
  openTasks: [],
  pendingApprovalCount: 0,
  pendingApprovals: [],
  recentActivity: [],
  memorySummaries: [],
  nowUtc: "2026-06-12T00:00:00.000Z",
  nowBangkok: "2026-06-12 07:00",
  googleEvents: [],
  events: [],
  reminders: [],
});
for (const prompt of [chiefPrompt, chatPrompt, briefPrompt]) {
  assert(prompt.includes('"reminder.done"'), "prompt includes reminder.done");
  // Step 14: Google update/delete are now prompt-exposed allowlist actions.
  assert(
    prompt.includes("google_event.update"),
    "prompt includes google update",
  );
  assert(
    prompt.includes("google_event.delete"),
    "prompt includes google delete",
  );
}

console.log("Sprint 2 registry smoke: ALL PASS");
