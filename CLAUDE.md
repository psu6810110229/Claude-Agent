# Claude_Agent Core Instructions

Read this before planning or implementation. Keep this file short and current.

## Purpose

Claude_Agent is a local-first Personal Agent OS / Jarvis-style secretary for a Windows PC. It supports tasks, schedule, reminders, memory/facts, approvals, chat, dashboard UI, Google Calendar, Gmail, Google Contacts, Google Drive awareness, TTS voice output, and read-only LINE export ingestion/automation.

The system is built incrementally. Add new connectors or write capabilities only when explicitly requested.

## Core Architecture

- The deterministic local backend is the system of record.
- Backend owns DB, approvals, action dispatch, executor, logs, scheduler, notifications, connector boundaries, privacy gates, and safety policy.
- AI providers are proposal-only reasoning workers. Claude/Gemini may propose actions; backend validates and executes only through the dispatcher/executor.
- Do not add direct write routes for approved-action domains.
- Backend binds to `127.0.0.1` only.
- Dashboard uses same-origin `/api/*`; Next.js rewrites to backend `127.0.0.1:8787`.
- Google Calendar is the primary schedule source. Local events/reminders are secondary unless the user says otherwise.
- LINE is read-only and export-based. Backend reads exported `.txt` files; it never sends/replies in LINE.

## Current Status

- Stable branch: `main`.
- Stack: Node.js/TypeScript, Fastify, Next.js App Router, SQLite `better-sqlite3`, Zod, npm workspaces, Python LINE automation helpers.
- AI providers: Claude and Gemini. Gemini model default is `gemini-3.1-flash-lite`; dashboard defaults chat to Gemini. Provider policy lives in `packages/backend/src/services/aiProvider.ts`.
- TTS voice output is implemented. `spoken` is detail-preserving and capped to 4000 chars. Voice input is out of scope.
- Privacy guard is implemented. Verified sessions persist in config without storing secrets; unverified context is hard-redacted.
- Google connectors implemented: Calendar, Gmail, Contacts, Drive awareness. OAuth files are gitignored and must not be read/printed unless explicitly requested.
- LINE implemented: export parser, keyword search, chat context, Windows desktop export automation, batch runner, hardened Save As relocation.
- Step 21 implemented: `line_followup.create` creates one-shot scheduled checks over exported LINE data. Scheduler checks exports deterministically; no AI call, no live LINE.
- Planned major work: Step 22 Active Intelligence Layer: active topics, LINE evidence bundles, verifier, deterministic proactive attention triage.

## Safety Rules

- Local-first and safe by default.
- Read-only before write access.
- Ask before destructive, risky, outward-facing, credential, or scope-expanding work.
- Preserve approval-gated architecture.
- AI never executes directly.
- Google Calendar writes are approval-gated; recoverable delete may auto-execute only when explicitly enabled.
- Gmail draft/send are approval-gated; Gmail send must remain confirm-gated.
- LINE must remain read-only. Do not add LINE send/reply/update/delete.
- Do not read or modify `.env`, `data/`, credentials, tokens, Google auth files, real LINE exports, or DB contents unless explicitly requested.
- Do not install packages unless explicitly asked.
- Do not log secrets or LINE message bodies/snippets/keywords. Use counts, ids, timestamps only.
- Keep changes small, reversible, and testable.
- Do not commit or push unless explicitly asked.

## Out of Scope Unless Explicitly Approved

- New external connectors beyond current Google/Gmail/Contacts/Drive/LINE set.
- Notion.
- MCP.
- Voice input: STT, microphone, wake word.
- LINE write actions or live `.edb` decryption.
- Live LINE automation from backend scheduler.
- Vector DB / external retrieval service / broad multi-agent framework.
- Contacts write/update/delete.
- Local filesystem scanning or filesystem write/delete outside explicitly approved paths.
- Non-recoverable destructive auto-execution.

## Important Local State

- `.env` is gitignored and machine-local.
- `packages/backend/data/` is gitignored and may contain SQLite DB, Google OAuth client/token, and other local state.
- LINE export files and batch config files are local/private and must not be committed.
- `automation/line_export/chats.json` and test chat configs are private operator config, not source truth.
- Desktop/Tailscale host setup is local machine state, not repo state.

## LINE Notes

- LINE for Windows local DB is encrypted/locked and is not read directly.
- Export path is LINE's own "Save chat" `.txt` format.
- Backend connector requires both `LINE_ENABLED=1` and `LINE_EXPORT_DIR=<absolute path>` in local env/config.
- Python automation can drive the calibrated desktop UI: search chat -> open result -> menu -> Save chat -> native Save As -> sanitize/relocate.
- UI driver is coordinate/calibration based because LINE is an opaque Qt canvas. Keep LINE maximized and recalibrate on display/DPI/layout changes.
- Official/business accounts can have different menus and need a separate profile.
- Backend scheduler must not click LINE. Use the separate batch runner for desktop export refresh.

## Jarvis / Prompt Rules

- Jarvis should answer from evidence, not vibes.
- Be explicit about source limits: LINE data is export-based, not live, and has no read/unread state.
- Do not claim a LINE message is unread/read.
- Do not claim a follow-up/watch is done unless backend action actually executed.
- Durable memory claims require real approved/executed memory/fact action.
- Local conversation understanding is not durable memory.
- Keep persona consistent across `reply` and `spoken`.
- Avoid the Thai particle `นะ` / `นะครับ` in Jarvis output unless quoting the user.

## Key Commands

- `npm run build` - backend TypeScript build.
- `npm run build:dashboard` - dashboard build.
- `npm run smoke` - broad backend smoke; use sparingly.
- `npm run smoke:step10` - Google Calendar.
- `npm run smoke:step11` - scheduler/notifications.
- `npm run smoke:step12` - chat.
- `npm run smoke:step13` - TTS.
- `npm run smoke:step15` - privacy guard.
- `npm run smoke:step17` - Gmail.
- `npm run smoke:step18` - Contacts.
- `npm run smoke:step19` - Drive.
- `npm run smoke:step20` - LINE read-only exports.
- `npm run smoke:step21` - LINE follow-up watches.
- `npm run smoke:persona` - Jarvis persona/prompt invariants.
- `npm run smoke:phase3` / `npm run smoke:phase4` - provider/Gemini routing.
- `npm run google-auth` - one-time Google OAuth setup when explicitly needed.
- `npm run db:init` - initialize SQLite.
- `npm run dev` - backend watch on `127.0.0.1:8787`.
- `npm run dev:dashboard` - dashboard dev server.
- `python -m unittest automation.line_export.test_sanitize`
- `python -m unittest automation.line_export.test_batch_runner`

## Testing Guidance

- Run focused checks for the changed surface.
- Do not call real Claude/Gemini/Google APIs in smoke tests.
- Do not use real LINE exports in tests; create temp fixtures.
- For backend changes, prefer `npm run build` plus relevant focused smoke.
- For dashboard changes, run `npm run build:dashboard`.
- For prompt/persona changes, run `npm run smoke:persona`.
- For LINE Python automation changes, run the focused Python unit tests.
- If tests are skipped, say why.

## Common Focused Test Sets

- Chat/prompt/persona: `npm run build`, `npm run smoke:step12`, `npm run smoke:persona`.
- Provider/Gemini policy: `npm run build`, `npm run smoke:phase3`, `npm run smoke:phase4`.
- Privacy/secret phrase: `npm run build`, `npm run smoke:step15`.
- LINE backend: `npm run build`, `npm run smoke:step20`, `npm run smoke:step21`.
- LINE automation: Python sanitize + batch runner tests.
- Step 22 planned work: `npm run build`, `npm run smoke:step20`, `npm run smoke:step21`, `npm run smoke:step22`, `npm run smoke:persona`.

## Working Style

- Read `AGENTS.md` and this file first.
- Confirm scope and identify the smallest relevant file set.
- Prefer existing patterns over new abstractions.
- Avoid unrelated refactors.
- Keep local events/reminders secondary to Google Calendar.
- Preserve UTC ISO timestamps and app-maintained `updated_at`.
- Use `apply_patch` for manual edits.
- Report files changed and checks run.

## Production / Host Notes

- Backend and dashboard are usually run separately during debug.
- Backend dev command: `npm run dev`.
- Dashboard local-only command can be run with dashboard workspace flags as needed.
- Tailscale Serve should expose dashboard only; backend remains reachable through dashboard proxy.
- Production backend `npm run start -w @claude-agent/backend` may require copied runtime assets if `dist` lacks schema files; dev mode is the known-good debug path.

## Step 22 Direction

The next intelligence jump should be system-driven, not prompt-only:

- Active Topic Store.
- Topic resolver for short follow-ups.
- LINE evidence builder from exported messages.
- Evidence verifier before confident claims.
- Deterministic scheduler triage with cooldown/dedup.
- No AI call in scheduler for Step 22.
- No vector DB in Step 22.
- No LINE write or live LINE access.
