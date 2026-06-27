# Claude_Agent Project Instructions for Codex

## Purpose

Claude_Agent is a local-first Personal Agent OS / personal AI secretary for a Windows PC. It supports local tasks, schedule, reminders, memory/facts, approvals, chat, dashboard UI, Google Calendar, Gmail, Google Contacts, Google Drive awareness, TTS voice output, and read-only LINE export ingestion/automation.

Future connectors or new write capabilities must be added only when explicitly requested.

## Current Architecture

- The deterministic local backend is the system of record. It owns the database, approval queue, logs, scheduler, connector boundaries, notifications, and safety gates.
- AI providers are proposal-only reasoning runtimes. Claude/Gemini may suggest action payloads, but the backend validates them and executes only through the approval/action dispatcher.
- Claude Code is not a persistent process. The backend may call provider runtimes in a controlled way; provider calls never bypass backend validation.
- Gemini is supported. The default Gemini model is `gemini-3.1-flash-lite`; the dashboard currently defaults chat to Gemini. Backend provider policy is still centralized in `services/aiProvider.ts`.
- Backend and dashboard are separate packages in one npm workspace.
- The backend binds to `127.0.0.1` only.
- The dashboard uses same-origin `/api/*`; Next.js rewrites requests to the backend on `127.0.0.1:8787`.
- Google Calendar is the primary schedule source. Local events/reminders are secondary unless the user says otherwise.
- LINE is read-only and export-based. The backend reads exported `.txt` files only; it never sends or replies in LINE.

## Stack

- Node.js and TypeScript
- Fastify backend
- Next.js App Router dashboard
- SQLite with `better-sqlite3`
- Zod for request/response/action validation
- Markdown files for human-readable memory
- npm workspaces
- Python automation helpers for LINE Desktop export on Windows
- UTC ISO 8601 timestamps stored as `TEXT`; app code maintains `updated_at`

## Key Commands

Run commands only when relevant to the current request.

- `npm install` - install workspace dependencies; do not run unless explicitly asked.
- `npm run build` - build the backend workspace.
- `npm run build:dashboard` - production build of the dashboard.
- `npm run smoke` - broad backend smoke test.
- `npm run smoke:step10` - Google Calendar smoke; stubbed, no real Google API.
- `npm run smoke:step11` - scheduler/notification smoke.
- `npm run smoke:step12` - chat smoke; stubbed AI.
- `npm run smoke:step13` - TTS smoke; stubbed TTS/audio.
- `npm run smoke:step15` - privacy guard/identity smoke.
- `npm run smoke:step17` - Gmail smoke.
- `npm run smoke:step18` - Google Contacts smoke.
- `npm run smoke:step19` - Google Drive smoke.
- `npm run smoke:step20` - LINE read-only export smoke; temp exports only.
- `npm run smoke:step21` - LINE follow-up watch smoke.
- `npm run smoke:persona` - Jarvis persona/prompt invariants.
- `npm run provider-smoke` / `npm run smoke:phase3` / `npm run smoke:phase4` - provider/Gemini routing checks.
- `npm run google-auth` - one-time Google OAuth setup; only when explicitly needed.
- `npm run db:init` - initialize the SQLite database.
- `npm run dev` - run backend in watch mode on `127.0.0.1:8787`.
- `npm run dev:dashboard` - run dashboard; backend must also be running.
- LINE helper tests: `python -m unittest automation.line_export.test_sanitize` and `python -m unittest automation.line_export.test_batch_runner`.

## Safety Rules

- Read `AGENTS.md` first in future Codex sessions.
- Keep the project local-first and safe by default.
- Use read-only access before write access.
- Ask before destructive, risky, outward-facing, credential, or scope-expanding actions.
- Do not silently expand scope.
- Preserve the approval-gated architecture.
- AI/Claude/Gemini must propose only; the backend executes only approved or explicitly auto-executable actions through the dispatcher.
- Do not bypass the approval queue/action dispatcher or add direct write routes for approved-action domains.
- Google Calendar create/update/delete are approval-gated; recoverable delete may auto-execute only when its explicit destructive auto-execute toggle is on.
- Gmail draft/send are approval-gated; Gmail send must remain confirm-gated.
- LINE must remain read-only. Do not add LINE send/reply/update/delete actions.
- Do not read or modify secrets, tokens, `.env`, `data/`, Google credential files, real LINE exports, or local DB contents unless the user explicitly requests it.
- Do not install packages unless the user explicitly asks.
- Prefer small, reversible, verifiable changes.

## Context Discipline

- Use minimal context.
- Do not read the whole repo unless explicitly asked.
- Before reading extra files, state the file path and the reason.
- Read only the files needed for the current task.
- Keep responses short and practical.
- Avoid broad scans.
- Do not dump database contents, memory file contents, credentials, tokens, real LINE message bodies, or large file bodies into AI context.
- Keep AI prompt context compact and capped.
- Activity logs must not contain LINE message bodies/snippets/keywords or secrets; use counts, ids, and timestamps only.

## Current Status

- Step 1 complete: repo instructions, npm workspace skeleton, backend package, Fastify health check, SQLite schema/init, smoke test, local binding.
- Step 3 complete: Next.js dashboard shell with Today, Tasks, Approvals, Activity, shared nav/layout, typed API client, backend proxy rewrites.
- Step 6-7 complete: proposal-only AI runtime, strict JSON/Zod validation, approval creation, action allowlist, dashboard AI toggle/result states.
- Step 9 complete: local events/reminders, approval-gated actions, Bangkok-aware agenda bucketing, read-only routes, dashboard display.
- Step 10 complete: Google Calendar connector, read-only routes, approval-gated Google event writes.
- Step 11 complete: background scheduler, notification rows, desktop notifications.
- Step 12 complete: multi-turn Jarvis chat with recall, approval proposals, provider metadata, history.
- Step 13 complete: TTS voice output, browser playback, backend speaker playback for scheduler/nags, spoken reply field.
- Step 14 complete: Google Calendar update/delete with undo snapshots and optional auto-execute policy.
- Step 15 complete: privacy guard, owner verification, session persistence, redaction boundary.
- Step 16 complete: durable fact memory/recall.
- Step 17 complete: Gmail unread read + approval-gated draft/send.
- Step 18 complete: Google Contacts read-only connector and contact-state prompt fix.
- Step 19 complete: Google Drive recent-file awareness/read routes.
- Step 20 complete: LINE read-only export parser, keyword search, chat context, Windows desktop export automation, batch runner, hardened Save As relocation.
- Step 21 complete: approval-gated `line_followup.create` and deterministic one-shot LINE export follow-up notifications.
- Persona/TTS updates complete: Jarvis prompt has stricter tone/auth boundaries and detail-preserving spoken output.
- Planned next major work: Step 22 Active Intelligence Layer (active topics, LINE evidence bundles, verifier, deterministic proactive triage).

## Out of Scope Unless Explicitly Requested

- New external connectors beyond the current Google/Gmail/Contacts/Drive/LINE set.
- Notion.
- MCP.
- Voice input: STT, microphone, wake word.
- LINE write actions or live `.edb` decryption.
- Live LINE automation from backend scheduler.
- Vector database or new external retrieval service.
- Broad multi-agent/orchestrator rewrite.
- Local filesystem scanning or filesystem write/delete outside explicitly approved paths.
- Contacts write/update/delete.
- Non-recoverable destructive auto-execution.

## Testing Rules

- Use focused tests that match the changed surface area.
- Do not call the live `claude` binary from smoke tests.
- Do not call real Gemini/Google APIs from smoke tests.
- Do not use real LINE exports in smoke tests; create temp export fixtures.
- For backend changes, consider `npm run build` plus focused smoke scripts.
- For dashboard changes, consider `npm run build:dashboard`.
- For prompt/persona changes, consider `npm run smoke:persona`.
- For LINE automation Python changes, run the focused Python unit tests.
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

## Design Context

- Strategy lives in `PRODUCT.md`; visual system lives in `DESIGN.md` and `.impeccable/design.json`. Read those before dashboard UI work.
- Register: product. Personality: warm, conversational, human; secretary with a voice, not console, not toy.
- North Star: "Liquid Glass Atelier" - dark-only, frosted glass over near-black void; depth from tonal layering and blur, not borders.
- Signature: Arc Blue `#0a84ff` for action; Halo Violet `#8b5cf6` for identity/glow only. Status hues amber/rose/green are semantic only. Use one IBM Plex family.
- Anti-refs: generic SaaS dashboard, toy chatbot, cluttered enterprise admin, over-the-top sci-fi HUD. Orb is the only spectacle.
- A11y target WCAG 2.1 AA for a single operator: verify contrast on glass, not void; use at least 44px touch targets; reduced-motion must cover framer-motion/JS; never disable zoom.
- Tokens live in `packages/dashboard/src/app/globals.css` `:root`.

## UI Loop Engineering

- For dashboard UI changes, run the design loop from the docs first: read `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, and the relevant component/page files.
- Prefer existing primitives and tokens over one-off styling. New actions should use the shared `Button` / `IconButton` primitives where applicable.
- Use `/impeccable` commands for UI changes to catch visual hierarchy, placement, and design-system drift that lint/build checks cannot see.
- Keep UI refactors incremental: migrate one surface or primitive family at a time, then run the focused dashboard check before expanding scope.

## Before Making Changes

- Read `AGENTS.md` first.
- Confirm the task scope from the user request.
- Identify the smallest relevant file set.
- Before reading extra files, state the file path and reason.
- Ask before risky or destructive work.
- Do not touch secrets, tokens, `.env`, `data/`, Google credential files, real LINE exports, or DB contents unless explicitly requested.

## After Making Changes

- Run only relevant focused checks.
- Report the files changed.
- Summarize key behavior or documentation updates.
- Report tests/checks run, including failures.
- Do not commit unless the user explicitly asks.
