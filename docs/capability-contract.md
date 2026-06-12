# Capability Contract

Claude_Agent stays local-first and approval-gated. Capabilities describe what
the product can do; actions are the exact executable commands that may run only
after approval.

## Current Capabilities

- `tasks`: local task create, update, archive.
- `memory.write`: whitelisted local memory write.
- `local.events`: secondary local event create, update, archive.
- `reminders`: local reminder create, update, done, archive.
- `google.calendar.create`: primary Google Calendar event creation only.

## Action Requirements

Every new action must have:

- Schema validation in `packages/backend/src/schemas/approval.ts`.
- Metadata in `packages/backend/src/services/actionRegistry.ts`.
- An executor branch in `packages/backend/src/services/executor.ts`.
- Human wording via `humanLabel` and `payloadShape`.
- Explicit `riskLevel`, `policies`, and `promptExposure`.
- Focused smoke coverage for risky policy or prompt exposure changes.

## Policy Rules

- Mutating actions must include `approval-required`.
- Local-only actions must include `local-only`.
- External service actions must include `external-service`.
- Create-only actions must include `create-only`.
- Disabled actions must never be prompt-exposed or executable.
- Google Calendar remains create-only: do not add update or delete actions.

## Prompt Exposure

Prompt exposure is intentional and registry-driven. Do not expose an action to
Claude just because a schema or executor branch exists. The prompt builders use
`buildAllowedActionsPrompt()` from the registry, and `npm run smoke:registry`
guards the current contract.
