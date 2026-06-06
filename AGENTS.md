# Claude_Agent Project Instructions for Codex

## Purpose

Claude_Agent is a local-first Personal Agent OS / personal AI secretary for a Windows PC. The project is being built incrementally, with the smallest usable foundation first, to support tasks, schedule, reminders, memory, projects, notes, approved local files, and Google Calendar as the primary schedule source.

Future connectors or capabilities must be added only when explicitly requested.

## Current Architecture

- The deterministic local backend is the system of record. It owns the database, approval queue, logs, connector boundaries, and any future scheduler hooks.
- AI/Claude is a proposal-only reasoning runtime. It may suggest approved action payloads, but the backend validates them and executes only actions that pass through the approval queue.
- Claude Code is not a persistent process. When enabled, the backend calls `claude -p` in a controlled way.
- Backend and dashboard are separate packages in one npm workspace.
- The backend binds to `127.0.0.1` only.
- The dashboard uses same-origin `/api/*`; Next.js rewrites requests to the backend on `127.0.0.1:8787`.
- Google Calendar is the primary schedule source. It supports read routes and approval-gated create-only writes; local events/reminders are secondary unless the user says otherwise.

## Stack

- Node.js and TypeScript
- Fastify backend
- Next.js App Router dashboard
- SQLite with `better-sqlite3`
- Zod for request/response/action validation
- Markdown files for human-readable memory
- npm workspaces
- UTC ISO 8601 timestamps stored as `TEXT`

## Key Commands

Run commands only when they are relevant to the current request and approved by the user.

- `npm install` - install workspace dependencies; do not run unless explicitly asked.
- `npm run smoke` - backend smoke test.
- `npm run smoke:step10` - Google Calendar read/create smoke test with stubbed fetcher; no real network/API call.
- `npm run ai-smoke` - AI proposal smoke test with stubbed invoker.
- `npm run brief-smoke` - Daily Brief smoke test.
- `npm run db:init` - initialize the SQLite database.
- `npm run dev` - run backend in watch mode on `127.0.0.1:8787`.
- `npm run dev:dashboard` - run dashboard on `:3000`; backend must also be running.
- `npm run build` - build the workspace.
- `npm run build:dashboard` - production build of the dashboard.
- `npm run google-auth` - one-time Google Calendar OAuth setup for Calendar event access.

## Safety Rules

- Read `AGENTS.md` first in future Codex sessions.
- Keep the project local-first and safe by default.
- Use read-only access before write access.
- Ask before destructive, risky, outward-facing, or scope-expanding actions.
- Do not silently expand scope.
- Preserve the approval-gated architecture.
- AI/Claude must propose only; the backend executes only approved actions.
- Do not bypass the approval queue or add direct write routes for approved-action domains.
- Keep Google Calendar writes create-only and approval-gated.
- Do not add Google Calendar update/delete actions.
- Do not bypass the approval queue for Google Calendar writes.
- Do not read or modify secrets, tokens, `.env`, `data/`, or Google credential files unless the user explicitly requests it.
- Do not install packages unless the user explicitly asks.
- Prefer small, reversible, verifiable changes.

## Context Discipline

- Use minimal context.
- Do not read the whole repo unless explicitly asked.
- Before reading extra files, state the file path and the reason.
- Read only the files needed for the current task.
- Keep responses short and practical.
- Avoid broad scans.
- Do not dump database contents, memory file contents, credentials, tokens, or large file bodies into AI context.
- Keep AI prompt context compact: allowed action types, user input, capped open-task lists, and memory target names only.

## Current Status

- Step 1 is complete: repo instructions, npm workspace skeleton, backend package, Fastify health check, SQLite schema/init, smoke test, and restrictive local binding.
- Step 3 is complete: Next.js dashboard shell with Today, Tasks, Approvals, Activity, shared nav/layout, typed API client, and backend proxy rewrites.
- Step 6 is complete: proposal-only Claude runtime, strict JSON/Zod validation, approval creation, action allowlist, and stubbed AI smoke test.
- Step 7 is complete: dashboard Deterministic/AI command mode toggle, AI result states, approval links, and manual live-Claude test documentation.
- Step 9 is complete: local events/reminders, approval-gated event/reminder actions, Bangkok-aware agenda bucketing, read-only routes, Today/Upcoming dashboard display, and smoke coverage.
- Step 10 is complete: Google Calendar connector, read-only calendar routes, approval-gated create-only Google event action, Google events in Daily Brief and dashboard, OAuth helper, and stubbed smoke coverage.

## Out of Scope

Do not add these without explicit user approval:

- MCP
- Notion
- Gmail
- Google Drive
- Voice
- Scheduler
- Local filesystem scanning
- External connectors beyond the existing Google Calendar connector
- Google Calendar update/delete access
- Calendar update/delete action types
- Authentication beyond minimal Google Calendar event OAuth
- Dashboard or backend scope not requested for the current task

## Testing Rules

- Use focused tests that match the changed surface area.
- Do not call the live `claude` binary from smoke tests.
- Do not call the real Google API from smoke tests.
- For backend changes, consider `npm run build`, `npm run smoke`, and focused smoke scripts.
- For dashboard changes, consider `npm run build:dashboard`.
- If tests are not run, report that clearly and say why.

## Working Style

- Stay narrow and approval-based.
- Keep Codex replies concise.
- State assumptions when they matter.
- Prefer existing patterns over new abstractions.
- Avoid unrelated refactors.
- Do not modify application code for documentation-only tasks.
- Keep local events/reminders secondary to Google Calendar unless told otherwise.
- Preserve UTC ISO timestamp behavior and application-maintained `updated_at`.

## Before Making Changes

- Read `AGENTS.md` first.
- Confirm the task scope from the user request.
- Identify the smallest relevant file set.
- Before reading extra files, state the file path and reason.
- Ask before risky or destructive work.
- Do not touch secrets, tokens, `.env`, `data/`, or Google credential files unless explicitly requested.

## After Making Changes

- Run only the commands that are relevant and approved.
- Report the files changed.
- Summarize key behavior or documentation updates.
- Report tests or checks run, including failures.
- Do not commit unless the user explicitly asks.
