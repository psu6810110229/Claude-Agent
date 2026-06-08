# Jarvis Upgrade — Master Doc

## Purpose

Step 12 left the agent **reactive**: it answers, proposes approval-gated actions, recalls
context, reads Google Calendar, fires reminder/event notifications. It is **not proactive** and
every action needs manual approval. This upgrade ("Jarvis") adds three capabilities to make it
feel like a real secretary:

- **A. Auto morning brief** — the scheduler calls Claude each morning and delivers a brief.
- **B. Agent personality + agent name + remembered user name** — identity threaded into prompts.
- **C. Memory reasoning** — the agent auto-learns stable user patterns.

## Locked decisions (from user)

| Feature | Decision |
|---|---|
| A delivery | **Store + notify**: persist brief to DB (chat thread + activity), create approvals from its actions (same as existing brief route), desktop-notify that a brief is ready. |
| B storage | **New `profile` table** (9th table). |
| C learning | **Auto-learn, no approval** for the patterns memory. |

## ⚠️ Architecture-boundary callouts

1. **A crosses an Out-of-scope item.** `CLAUDE.md` currently lists *"Auto-morning-brief scheduler
   (timer-driven Claude invocation)"* under **Out of scope**. This upgrade moves it in-scope →
   `CLAUDE.md` must be updated (Phase 0).
2. **C breaks the core invariant** *"Claude proposes; backend executes only approved actions."*
   The user accepted this. We keep the violation **surgically narrow**:
   - the no-approval write path can write **only** the new `patterns` memory target,
   - **append-only** (never replace/delete),
   - **content-capped** per entry + **daily-count-capped**,
   - **every write logged** to `activity_log` as `memory.auto_learned`,
   - **user-clearable** from the dashboard.
   - Everything else (the `memory.write` action and all other action types) stays **100%
     approval-gated**.

## Phase order (lowest risk first; riskiest last)

| Phase | Content | Risk |
|---|---|---|
| 0 | Write these 4 docs; update `CLAUDE.md` scope + flags | none |
| 1 | **Feature B** — profile table + identity in prompts + settings UI | low |
| 2 | **Feature A** — shared brief-persist helper + scheduler→Claude | medium |
| 3 | **Feature C** — patterns target + auto-learn path + guardrails | high (gated, last) |

## Conventions to reuse (do not reinvent)

- **Repos**: plain exported fns, `getDb()` + `nowIso()`, `COLS` const, soft-archive, re-fetch
  after write. Templates: `db/repositories/taskRepo.ts`, `reminderRepo.ts`. Upsert template:
  `configRepo.ts` (`INSERT ... ON CONFLICT(key) DO UPDATE`).
- **Schemas**: Zod per entity; `.trim().min(1).max(N)`; `isoUtcDateTime` (`schemas/event.ts:12`);
  action allowlist = `schemas/approval.ts` (`actionTypeSchema` enum + `actionPayloadSchemas` map).
- **Routes**: `export async function xRoutes(app, opts?)`; inject-with-real-default
  (`opts.aiInvoker ?? realClaudeInvoker`); validate with `safeParse`; re-validate responses;
  register in `server.ts`. Templates: `routes/tasks.ts`, read-only `routes/reminders.ts`.
- **Config**: default-off flags `/^(1|true)$/i.test(process.env.X ?? "")`; numeric
  `Number(... ?? n)`; module-level consts (evaluated once on import — smoke tests set env BEFORE
  importing). DB-override pattern: `isGoogleCalendarEnabled()` in `services/googleCalendar.ts:62`.
- **Migrations**: none. Schema is `CREATE TABLE IF NOT EXISTS`, re-run idempotently by
  `db/init.ts initDb()`. Add new **tables** freely; avoid `ALTER` on existing tables.
- **Prompts**: 3 builders share a hard-coded persona line — `chatPrompt.ts:91`,
  `chiefOfStaffPrompt.ts:30`, `briefPrompt.ts:117`. **Invariant**: memory enters prompts as
  **summaries / target names only, never file contents**.
- **Brief pipeline**: `services/brief.ts runBrief(type, invoke, fetchGoogle)` returns
  `{summary, actions, notes}` and does **no DB writes**; `routes/briefs.ts handleBrief` does the
  approval-create + activity-log. Reuse via an extracted shared persist helper.
- **Smoke tests**: set env BEFORE dynamic `import()` of server/init/connection; stub Claude via
  `buildServer({ aiInvoker, calendarFetcher })`; temp DB + memory dir. Template:
  `scripts/smoke-step12.ts`. Live `claude` binary is never called in smoke tests.

## Cross-cutting changes

- **New config flags (all default off / safe):**
  - `CLAUDE_AGENT_AUTO_BRIEF_ENABLED` (bool, off)
  - `CLAUDE_AGENT_AUTO_BRIEF_HOUR` (number, default 7 — Bangkok local hour 0–23)
  - Reuses existing: `CLAUDE_AGENT_AI_ENABLED`, `CLAUDE_AGENT_SCHEDULER_ENABLED`,
    `CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED`.
- **npm scripts**: add `smoke:step13a|b|c` to BOTH `packages/backend/package.json` and root
  `package.json`. (Root currently even lacks `smoke:step12` — add it too.)
- **Table count**: update smoke `REQUIRED_TABLES` and the `smoke-step12.ts` expected-tables list
  to include `profile` (now **9 tables**).
- **`CLAUDE.md`**: add a "Step 13 scope" section; move auto-brief out of Out-of-scope; document
  the auto-learn exception to the approval invariant.

## Verification (end-to-end)

```
npm run build
npm run smoke            # 9 tables incl. profile
npm run smoke:step13b    # profile CRUD + persona threading
npm run smoke:step13a    # auto morning brief (stubbed Claude, dedup, persist+notify)
npm run smoke:step13c    # auto-learn patterns (guardrails)
npm run smoke:step12     # chat regression (still green)
npm run brief-smoke      # brief route unaffected by persist-helper refactor
npm run build:dashboard  # settings UI + memory/patterns view compile
```

Manual (opt-in, real Claude): set `CLAUDE_AGENT_AI_ENABLED=1`,
`CLAUDE_AGENT_SCHEDULER_ENABLED=1`, `CLAUDE_AGENT_AUTO_BRIEF_ENABLED=1`,
`CLAUDE_AGENT_AUTO_BRIEF_HOUR=<current hour>`; run backend; confirm one brief appears in Chat +
a desktop toast, approvals queued, and **no duplicate** on the next tick.

## Risks

- **C breaks the approval invariant** (accepted) — mitigated by the narrow patterns-only,
  append-only, capped, logged path; shipped last and behind a chat-output field.
- Scheduler tick becomes async — keep per-tick try/catch so a Claude failure never kills the
  interval (existing `scheduler.tick_error` pattern).
- Brief persist refactor touches the existing route — `brief-smoke` must stay green.
- No migration system — `profile` added via `CREATE TABLE IF NOT EXISTS` (safe).
