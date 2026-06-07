# Claude_Agent — Project Instructions

> Future sessions: **read before planning or implementation.**

## Project purpose

**Local-first Personal Agent OS / personal AI secretary** on Windows PC. Plans to support tasks, schedule, reminders, memory, projects, notes, approved local files, Google Calendar, Notion, Gmail/Drive. Built incrementally, smallest usable foundation first.

## Approved architecture

- **Deterministic local backend is system of record.** Owns DB, approval queue, logs, scheduler hooks (later), connector boundaries (later).
- **Claude Code = reasoning runtime only** — later via controlled `claude -p` calls. **Claude proposes; backend executes only approved actions.**
- Claude Code is **not** persistent always-running process.
- Dashboard and backend are **separate packages in same repo**.

## Approved stack

- Node.js / TypeScript
- Fastify (local backend)
- Next.js / TypeScript (dashboard — later, not yet)
- SQLite via **better-sqlite3**
- Zod for API request/response validation
- Markdown files for human-readable memory
- npm workspaces
- UTC ISO 8601 timestamps everywhere
- Backend bound to **127.0.0.1 only**

## Safety principles

- Local-first. Safe by default.
- Read-only before write access.
- Explicit approval before any risky action.
- No destructive actions without confirmation.
- Approval queue is part of safety architecture, not later decoration.
- Don't over-engineer. Smallest usable foundation first.

## Timestamp & `updated_at` convention

- All timestamps: `TEXT` storing ISO 8601 UTC (e.g. `2026-06-06T12:00:00.000Z`), generated via `nowIso()` (`new Date().toISOString()`).
- `updated_at` maintained by **explicit app logic, not SQLite triggers.** Rationale: backend is deterministic system of record; timestamp behavior visible/testable in code; JS `toISOString()` guarantees exact UTC ISO format (SQLite `CURRENT_TIMESTAMP` would not).
- `activity_log` append-only, no `updated_at`.

## MVP scope (Step 1 — done)

- This `CLAUDE.md`
- Monorepo skeleton + root npm workspace
- Backend package only
- Fastify health check: `GET /api/health` → `{ status: "ok" }`
- SQLite schema: exactly four tables: `task`, `memory_index`, `approval`, `activity_log`
- DB init
- Smoke test: backend starts, health endpoint, DB exists, four tables exist
- Restrictive defaults (bind 127.0.0.1)

## Step 3 scope (done)

- `packages/dashboard` — Next.js + TypeScript (App Router) shell
- Pages: Today, Tasks, Approvals, Activity + shared layout/nav
- Typed API client (`src/lib/api.ts`) over existing backend routes; no backend/schema changes
- Browser → same-origin `/api/*`; Next `rewrites()` proxies to backend on `127.0.0.1:8787` (no CORS, no auth) — see `next.config.js`
- Client-side rendering, basic loading/error states
- Types hand-mirrored from backend Zod (`src/lib/types.ts`); shared types package deferred

## Step 6 scope (done) — Claude reasoning runtime (proposal-only)

- Claude reasoning runtime: **proposal-only**, **approval-gated**.
- `services/claudeClient.ts` — controlled `claude -p` via `execFile` (no shell), hard timeout, fails closed, drops `ANTHROPIC_API_KEY` from child env. Gated by `CLAUDE_AGENT_AI_ENABLED` (default off).
- `services/chiefOfStaffPrompt.ts` — compact context only (allowed action types, user input, capped open-task list, memory **target names only** — never DB dumps or memory file contents).
- `services/aiCommand.ts` — invoke → `unwrapJsonOutput` → strict `JSON.parse` → Zod validate (`schemas/aiCommand.ts`). `unwrapJsonOutput` (`services/jsonOutput.ts`, added in Step 8 follow-up) only trims whitespace and removes **single outer markdown code fence** (```` ```json ```` or bare ```` ``` ````) when entire output is fenced. Does **not** extract first-`{`-to-last-`}`, **not** repair malformed JSON, **not** tolerate prose before/after JSON (still fails parse). Zod validation and allowlist unchanged.
- `POST /api/command` gains `mode: "ai"`; valid actions become **pending** approvals via existing queue. Claude never executes and never bypasses approval. Allowlist: `task.create`, `task.update`, `task.archive`, `memory.write`.
- Activity events: `ai.command.received|proposed|rejected|failed`.
- `scripts/ai-smoke-test.ts` (`npm run ai-smoke`) verifies with **stubbed** invoker (real binary never called in tests).
- Dashboard AI toggle deferred to small follow-up step.

## Step 7 scope (done) — dashboard AI mode + manual live-Claude test

- Command bar gained **Deterministic / AI** mode toggle (`CommandBar.tsx`); Deterministic is default. AI mode sends `mode: "ai"` to `POST /api/command`.
- Result states surfaced distinctly: proposal(s) created (approval IDs link to Approvals page), no action (`none`), rejected invalid output (400), Claude disabled (503), timeout (504), failure (502). Map keys off `ApiError.status`.
- UI note: AI mode only **proposes**, never executes.
- **Backend logic, schemas, allowlist unchanged.** Allowlist: `task.create`, `task.update`, `task.archive`, `memory.write`.
- Client changes only: `lib/api.ts` (`runCommand(input, mode)`), `lib/types.ts` (`CommandMode`, extended `CommandResult` with AI `approvals[]` and `none`), `components/CommandBar.tsx`.
- `docs/manual-live-claude-test.md` documents enabling `CLAUDE_AGENT_AI_ENABLED=1`, running backend + dashboard, submitting safe AI command, verifying approval created but **not** executed.
- No new deps, no dashboard test runner; verification: `npm run build:dashboard` + manual doc. Live `claude` binary never called in smoke tests.

## Step 9 scope (done) — local events & reminders (proposal-only)

- Two new SQLite tables: `event` (title, starts_at, ends_at?, location?, notes?, status) and `reminder` (title, due_at, notes?, status). All datetimes ISO 8601 UTC `TEXT`; `updated_at` app-maintained; rows soft-archived (`status='archived'`), never hard-deleted.
- Six new **approval-gated** action types in single allowlist (`schemas/approval.ts` `actionPayloadSchemas` + `actionTypeSchema`): `event.create`, `event.update`, `event.archive`, `reminder.create`, `reminder.update`, `reminder.archive`. Datetime payloads require **ISO 8601 UTC ending in `Z`** (Zod `.datetime()`; offsets rejected). AI only **proposes** — nothing executes without approval; executor (`services/executor.ts`) is single execution gate.
- AI command bar (and Daily Brief) turns natural language → event/reminder proposals. Prompts (`chiefOfStaffPrompt.ts`, `briefPrompt.ts`) state user timezone **Asia/Bangkok (UTC+7)**, pass current time, instruct: interpret relative/local times in Bangkok, **output UTC**, ambiguous → propose nothing, ask for clarification.
- `services/agenda.ts` — pure, read-only Bangkok-aware bucketing (`agendaBounds`, `bucketEvents`, `bucketReminders`) into today / upcoming (7-day) / overdue. Used by brief context and mirrored client-side (`lib/agenda.ts`). **No scheduler, no notifications** — "overdue" computed on demand only.
- Read-only routes: `GET /api/events`, `GET /api/events/:id`, `GET /api/reminders`, `GET /api/reminders/:id` (exclude archived). **No write routes**; events/reminders created only via approval queue.
- Daily Brief context includes today + upcoming events and overdue/today/upcoming reminders (capped).
- Dashboard: Today page shows overdue reminders, today's events, reminders due today; new **Upcoming** page/nav shows next 7 days. Display only — creation flows through AI command bar → Approvals.
- Verification: `npm run build`, `npm run smoke` (**6** tables), `npm run ai-smoke`, `npm run brief-smoke`, `npm run build:dashboard`, `npm run smoke:step9` (stubbed invoker; agenda math, table existence, AI proposal → approve → stored, non-UTC datetime rejected, update/archive). Live `claude` never called in smoke tests.

## Step 10 scope (done) — Google Calendar connector

- Google Calendar via `googleapis` SDK. OAuth scope: `calendar.events` (event access only, not sharing/settings). App exposes **approval-gated create only** via `google_event.create`; **no Google update/delete action types**.
- Google Calendar = **primary** schedule source; local events/reminders (Step 9) = **secondary**. Backend owns connector boundary (chosen over MCP: runtime-bound, exposes write tools).
- `services/googleCalendar.ts` — OAuth2 client from gitignored client-secret + token files (refresh token), reads via `events.list`, creates via `events.insert` only after approval. **Fails closed** (disabled / missing creds / API error → throw), **never logs secrets/tokens**. Fetcher (`GoogleEventsFetcher`) injectable for tests.
- `schemas/googleCalendar.ts` — `googleEvent` / list response (`available` flag).
- Read routes `GET /api/calendar/today` and `GET /api/calendar/upcoming` (Bangkok-aware via `agendaBounds`, server-side time filtering). Both return `{ events, available }`, degrade to `available:false` on any error.
- Config (gated, **off by default**): `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_ID` (default `primary`), `GOOGLE_CALENDAR_CLIENT_SECRET_PATH`, `GOOGLE_CALENDAR_TOKEN_PATH` (both default under gitignored `data/`), `GOOGLE_CALENDAR_OAUTH_PORT`.
- `scripts/google-auth.ts` (`npm run google-auth`) — one-time loopback (`127.0.0.1`) OAuth consent; stores ONLY refresh token (0600).
- Daily Brief context includes Google today + upcoming events (primary). Prompts may propose `google_event.create` only; update/delete absent.
- Dashboard Today + Upcoming: Google events primary, local secondary; "not connected" when unavailable. Command bar AI can queue Google event proposal; Approvals executes after approval.
- AI **may summarize/recommend**, never executes; nothing bypasses approval queue. Live `claude` and real Google API never called in smoke tests.
- Verification: `npm run build`, `npm run smoke:step10` (stubbed fetcher: create-only allowlist, fail-closed-when-disabled, read routes, all-day normalization, brief includes Google events, error → `available:false`), `npm run smoke`, `npm run ai-smoke`, `npm run brief-smoke`, `npm run build:dashboard`.

## Out of scope (must NOT add without explicit approval)

- MCP
- External connectors **other than Step 10 Google Calendar connector**
- **Google Calendar update/delete access**; Google writes stay create-only, approval-gated
- Scheduler
- Voice
- Notion, Gmail, Google Drive
- Local filesystem scanning
- Authentication **beyond minimal OAuth for Google Calendar event access**

## Rules for future Claude Code sessions

1. Read this file before planning or implementation.
2. Implementation must stay **narrow and approval-based**. Don't expand scope silently.
3. Out-of-scope items stay out until user explicitly approves.
4. Risky, destructive, or outward-facing actions require **explicit user approval**.
5. Prefer small, reversible, verifiable changes.
6. Don't install packages, create/modify files, or run commands beyond what user approved for current step.

## Repo layout

```
Claude_Agent/
  CLAUDE.md
  package.json            # root npm workspace
  packages/
    backend/              # @claude-agent/backend (Fastify + SQLite)
      src/
        config.ts         # host/port/db path + nowIso()
        server.ts         # buildServer(): Fastify instance
        index.ts          # entrypoint: init DB + listen on 127.0.0.1
        db/               # connection, schema.sql, init
        routes/health.ts
        schemas/health.ts # Zod
      scripts/smoke-test.ts
      data/               # SQLite file (gitignored)
    dashboard/            # @claude-agent/dashboard (Next.js + TS)
      next.config.js      # rewrites() proxy /api/* -> backend 127.0.0.1:8787
      src/
        lib/              # api.ts (typed client), types.ts, useResource.ts, format.ts
        components/       # Nav, States
        app/              # layout + pages: / (Today), tasks, approvals, activity
```

## Key commands

- `npm install` — install workspace dependencies
- `npm run smoke` — run backend smoke test
- `npm run smoke:step10` — Step 10 Google Calendar smoke (stubbed; no network)
- `npm run google-auth` — one-time Google Calendar OAuth setup
- `npm run db:init` — initialize the SQLite database
- `npm run dev` — run backend in watch mode (127.0.0.1:8787)
- `npm run dev:dashboard` — run the dashboard (Next.js, :3000); requires backend running for `/api/*` to resolve
- `npm run build:dashboard` — production build of the dashboard
