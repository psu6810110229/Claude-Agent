# Roadmap 11: Gemini Provider & Agent Orchestration

## Status

Ready to plan after 00-08 completion. Roadmap 09 is kept as a regression checklist, not an implementation blocker.

This roadmap starts the post-09 AI provider track. It must preserve the existing local-first, approval-gated architecture.

## Goal

Add Gemini as an optional AI provider and prepare JARVIS for future multi-step agent workflows without making the system fragile or too strict to be useful.

The first useful result is not full autonomy. The first useful result is:

- Claude still works exactly as before.
- Gemini can be introduced behind the same proposal contract.
- Manual provider choice is explicit.
- Auto provider choice is transparent.
- All write actions still pass through backend validation and approval.

## Non-Goals

Do not add these in this roadmap unless a later task explicitly asks for them:

- new external connectors such as Gmail, Google Drive, Notion, or filesystem scanning
- Google Calendar update/delete
- direct write routes that bypass approval
- autonomous free-form tool loops
- live Gemini calls in automated tests
- committed secrets, API keys, tokens, `.env`, or credential files

## Architecture Direction

The backend remains the orchestrator.

AI providers are workers:

- Claude provider: existing `claude -p` proposal runtime.
- Gemini provider: future API-based proposal runtime.
- Auto selector: backend policy that picks a provider and records the reason.

The backend owns:

- request/session state
- provider selection
- prompt context limits
- schema validation
- action allowlist and capability policy
- approval queue
- execution results
- activity/audit trail

## Provider Contract

Create one provider interface before adding Gemini-specific behavior.

```ts
type AiProviderId = "claude" | "gemini";
type AiProviderMode = "manual" | "auto";

type ProviderSelection = {
  mode: AiProviderMode;
  requestedProvider?: AiProviderId;
  selectedProvider: AiProviderId;
  selectedModel?: string;
  reason: string;
};

type ProposalResult = {
  provider: AiProviderId;
  model?: string;
  text: string;
  actions: unknown[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};
```

The exact implementation can differ, but the rule is fixed: Claude and Gemini must return into the same validated proposal path.

## Phase 1: Provider Abstraction

Scope:

- Move the existing Claude invocation behind a provider interface.
- Keep default behavior as Claude.
- Add provider metadata to internal results where useful.
- Add stubbed provider tests.

Do not:

- call Gemini
- add secrets
- change approval behavior
- change dashboard behavior except where required by type flow

Expected files:

- `packages/backend/src/services/aiProvider.ts` or similar
- existing Claude invoker service
- chat/AI command service that currently calls Claude directly
- focused smoke or unit-style script if the repo pattern supports it

Acceptance:

- existing AI proposal flow still works with Claude
- invalid provider result fails closed
- action validation and approval creation are unchanged

## Phase 2: Manual Provider Selection

Scope:

- Add request-level provider selection: `claude | gemini`.
- Gemini may initially return a clear disabled/config-missing response until Phase 3.
- Dashboard shows the selected provider.
- No fallback in Manual mode unless the user explicitly retries with another provider.

Acceptance:

- choosing Claude uses Claude only
- choosing Gemini without config does not pretend success
- UI does not hide which provider was requested

## Phase 3: Gemini Provider

Scope:

- Add Gemini API provider using environment configuration.
- Keep secrets out of git.
- Map Gemini output into the same proposal schema.
- Validate JSON/action payloads through the same Zod path.
- Keep all write actions approval-gated.

Config rule:

- missing Gemini config should disable Gemini cleanly
- no automated test should call the live Gemini API

Acceptance:

- Gemini can produce the same allowed action proposals as Claude
- malformed Gemini output does not create false approvals
- provider/model is recorded in result metadata or activity where appropriate

## Phase 4: Transparent Auto Selection

Scope:

- Add `auto` provider mode.
- Start with simple deterministic rules.
- Always record and expose the selection reason.
- Never switch providers silently.

Suggested first policy:

- use Gemini Flash for low-risk summarize/rewrite/proposal tasks when configured
- use Claude for complex reasoning or when Gemini is unavailable
- ask or show retry when fallback would change provider after a failure

Acceptance:

- Auto result includes selected provider, model, and reason
- rate limit/config errors do not create false success
- fallback is visible to the user or requires explicit retry

## Phase 5: AgentRun / AgentStep Foundation

Scope:

- Add lightweight data model or in-memory structure for future multi-step workflows.
- Do not build full autonomous planning yet.
- Each step must have a kind, status, allowed capability scope, provider metadata if AI was used, and result summary.

Example future workflow:

1. read tasks this month using backend
2. filter P0 tasks deterministically
3. summarize delivery pattern with Gemini
4. produce recommendations with Claude or Gemini
5. propose follow-up actions through approval queue

Step statuses:

- `pending`
- `running`
- `completed`
- `needs_approval`
- `needs_user_input`
- `failed`
- `blocked`

Acceptance:

- backend owns step transitions
- AI can propose, but backend validates and decides
- no free-form model-driven execution loop

## Safeguards

Required from the start:

- provider allowlist
- action allowlist
- capability policy from `docs/capability-contract.md`
- Zod validation for provider output
- max retries per provider call
- max AI calls for any multi-step run
- compact prompt context only
- no database, memory, log, secret, or credential dumps
- explicit failed/blocked states

Recommended initial budgets:

- max provider calls per single chat command: 1
- max retry on invalid provider JSON: 1
- max provider calls for early AgentRun workflows: 3
- max AgentSteps for early workflows: 5

## User Visibility

Manual mode:

- show requested provider
- do not fallback silently

Auto mode:

- show selected provider and reason
- show fallback reason before or with retry

Future activity examples:

- `ai.provider.selected`
- `ai.provider.fallback_requested`
- `agent.step.completed`
- `agent.step.failed`

## Testing Plan

Use stubbed providers only.

Focused tests should cover:

- Claude provider path still creates valid proposals
- Gemini stub returns valid proposals through the same schema
- Manual Claude never calls Gemini
- Manual Gemini never calls Claude
- Auto records selected provider and reason
- invalid provider output fails closed
- provider error does not create false approval or false success activity
- write actions still require approval regardless of provider

Do not call:

- live Claude binary from automated tests
- live Gemini API from automated tests
- real Google APIs from automated tests

## First Implementation Slice

The first code slice should be Phase 1 only.

Smallest safe target:

1. introduce provider types and interface
2. wrap existing Claude invocation as `claudeProvider`
3. route current AI proposal flow through provider selection with default `claude`
4. add a stub provider test or smoke check
5. do not change user-facing behavior yet

Only after Phase 1 is stable should the dashboard/provider selector be added.

## Decisions And Remaining Questions

Decided:

- First Gemini default: Gemini 3.5 Flash.
- Provider choice should live on each chat request first. A longer session preference can be added later after the UX feels right.

Still UX-led:

- How much provider metadata should appear in the main chat versus activity/debug details? Start from the user experience: show enough to make Manual/Auto choices trustworthy, but do not clutter every message.
- Should Auto mode ask before fallback on any error, or only on provider change after partial progress? Prioritize UX first: fallback must never be silent, but the exact ask-vs-notify behavior should be designed in the UI flow.

## Build Before Commit

For docs-only changes:

```bash
git diff --check
```

For Phase 1 backend changes:

```bash
npm run build
npm run ai-smoke
```

If dashboard provider controls are added later:

```bash
npm run build:dashboard
```
