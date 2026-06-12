# Feature B — Agent Personality + Names

> Phase 1 (lowest risk, shipped first). See master doc: `docs/feature-jarvis-master.md`.

## Purpose

The 3 prompt builders hard-code one persona line ("You are the chief-of-staff reasoning engine
for a local-first personal agent") and know **no agent name and no user name**. This feature
gives the agent a configurable identity and lets it address the user by name with a chosen tone —
the cheapest, lowest-risk change that makes the agent feel personal. Shipped **first** (Phase 1)
because it improves every prompt and carries no architectural risk.

## Storage — new `profile` table (9th table)

Add to `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`, idempotent):

```sql
CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Allowed keys (validated in app, not DB): `agent_name`, `user_name`, `tone`, `persona`.

## Backend changes

### `db/repositories/profileRepo.ts` (new)

Follow `configRepo.ts` pattern. Functions:
- `getProfile(key): string | null`
- `setProfile(key, value): void` — `INSERT ... ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
- `getAllProfile(): Record<string, string>`

### `schemas/profile.ts` (new)

- `profileKeySchema = z.enum(["agent_name", "user_name", "tone", "persona"])`
- value `.trim().min(1).max(120)` (persona max larger, e.g. 1000)
- `profileUpdateSchema`, `profileResponseSchema`

### `routes/profile.ts` (new)

- `GET /api/profile` — returns all key/value pairs
- `PUT /api/profile` — validate key via `profileKeySchema`, call `setProfile`, `logActivity("profile.updated", <keys>)`
- Register in `server.ts`

### `services/persona.ts` (new)

`buildPersonaPreamble(profile: Record<string, string>): string`

Returns the prompt opening paragraph using agent name + user name + tone. **Sensible defaults when
unset** (agent "Agent", neutral tone, no user-name greeting) so behavior is unchanged until the
user actually sets values.

## Prompt threading

Replace the hard-coded opener in **all 3 prompt builders** with `buildPersonaPreamble(ctx.profile)`:

| File | Current hard-coded line |
|---|---|
| `services/chatPrompt.ts:91` | "You are the chief-of-staff reasoning engine..." |
| `services/chiefOfStaffPrompt.ts:30` | same |
| `services/briefPrompt.ts:117` | same |

- Add `profile: Record<string, string>` field to `ChatContext`, `CompactContext`, `BriefContext`.
- Load profile in context builders:
  - `services/chat.ts buildChatContext` → `getAllProfile()`
  - `services/aiCommand.ts buildContext` → `getAllProfile()`
  - `services/brief.ts buildBriefContext` → `getAllProfile()`

## Dashboard

- Settings page section (extend existing settings page or add `app/settings/page.tsx`) to
  view and edit `agent_name`, `user_name`, `tone`, `persona`.
- `lib/api.ts`: `getProfile()`, `updateProfile(key, value)`.
- `lib/types.ts`: profile key union + response types.

## Smoke — `scripts/smoke-step13b.ts`

1. Temp DB; profile CRUD via HTTP routes.
2. Drive a stubbed chat turn; capture the prompt passed to the stub invoker; assert it contains
   the agent name and user name that were set.
3. Assert unset profile → preamble uses defaults (no crash, no empty string).

## Files touched

**New:** `db/repositories/profileRepo.ts`, `schemas/profile.ts`, `routes/profile.ts`,
`services/persona.ts`, `scripts/smoke-step13b.ts`

**Edit:** `db/schema.sql`, `server.ts`, `services/chatPrompt.ts`, `services/chiefOfStaffPrompt.ts`,
`services/briefPrompt.ts`, `services/chat.ts`, `services/aiCommand.ts`, `services/brief.ts`,
smoke table lists (`smoke-test.ts` + `smoke-step12.ts`), dashboard settings + `lib/api.ts` +
`lib/types.ts`, both `package.json` (add `smoke:step13b` + missing `smoke:step12` in root)
