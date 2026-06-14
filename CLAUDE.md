# Claude_Agent — Project Instructions

> Future sessions: **read before planning or implementation.**

## Project purpose

**Local-first Personal Agent OS / personal AI secretary** on Windows PC. Plans to support tasks, schedule, reminders, memory, projects, notes, approved local files, Google Calendar, Notion, Gmail/Drive. Built incrementally, smallest usable foundation first.

## Approved architecture

- **Deterministic local backend is system of record.** Owns DB, approval queue, logs, scheduler (Step 11), connector boundaries.
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

## Step 11 scope (done) — Scheduler + reminder/event firing + notifications

- Background scheduler (gated **off** by default) ticks on a configurable interval (default 60 s), detects newly-due reminders and soon-starting events, writes dedup'd `notification` rows (7th table), logs activity, and fires Windows desktop toasts. **No Claude, no approval queue, no calendar writes** — pure date math, reuses `bucketReminders` / `listEvents`.
- `notification` table: `(kind, source_id)` UNIQUE index → each reminder/event fires at most one notification regardless of tick count. `status`: `'unread'` → `'read'`. Soft-archived never hard-deleted.
- `services/scheduler.ts` — `runSchedulerTick(now, notifier)` (testable pure fn) + `startScheduler(notifier)` (lifecycle: `setInterval`, `handle.unref()`, try/catch per tick). Hooked into `index.ts:main()` after `buildServer()`; `shutdown` clears the handle. Stays **outside** `buildServer` so all HTTP tests unaffected.
- `services/desktopNotifier.ts` — `DesktopNotifier` interface (injectable), `StubDesktopNotifier` (smoke tests), `RealDesktopNotifier` (dynamic import of `node-notifier`; fails soft; gated by `DESKTOP_NOTIFICATIONS_ENABLED`).
- `db/repositories/notificationRepo.ts`, `schemas/notification.ts`, `routes/notifications.ts` (`GET /api/notifications`, `GET /api/notifications/unread`, `POST /api/notifications/:id/read`).
- Dashboard `components/NotificationCenter.tsx` — global bell in sidebar (layout.tsx), polls `/api/notifications/unread` every 30 s, browser `Notification` API toasts for new ids, mark-as-read dropdown. First polling added to dashboard.
- Config flags (all off by default): `CLAUDE_AGENT_SCHEDULER_ENABLED`, `CLAUDE_AGENT_SCHEDULER_INTERVAL_MS` (60000), `CLAUDE_AGENT_SCHEDULER_EVENT_LEAD_MS` (900000 = 15 min), `CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED`. DB path now also overridable: `CLAUDE_AGENT_DB_PATH`.
- `npm run smoke:step11` (stubbed notifier; temp DB; dedup; HTTP routes; no Claude/approval).
- Auto-morning-brief (timer-driven Claude call), AI natural-language query, drag-and-drop card UI — deferred to future steps.

## Step 12 scope (done) — Conversational chat agent (multi-turn + recall)

- **8th SQLite table `chat_message`**: `(id, role, content, actions_json, status, created_at, updated_at)`. Single ongoing thread, persisted across restarts. Soft-archived, never hard-deleted. `updated_at` app-maintained.
- **`db/repositories/chatRepo.ts`**: `appendMessage(role, content, actionsJson?)`, `listRecentMessages(limit)` (active only, chronological).
- **`schemas/chat.ts`**: request `{ message: string (1..4000) }` + strict output `{ reply: string (required), actions: AiAction[], clarification?, notes? }`. `reply` required (vs aiOutput which has none).
- **`services/chatPrompt.ts`**: like chiefOfStaffPrompt but with recall context (same as brief: real tasks/events/reminders/Google + memory **summaries only** — never file contents) + conversation history (last N turns). Required `reply` in output contract.
- **`services/chat.ts`**: `runChat(message, invoke, fetchGoogle)` — builds context, invokes Claude, validates strictly, persists both messages on success only (failed/rejected → nothing written to DB), routes actions through `createApproval`. Fails closed.
- **`routes/chat.ts`**: `POST /api/chat` (chat turn), `GET /api/chat/history?limit=` (recent messages). Both `aiInvoker` and `calendarFetcher` injectable.
- **Config**: `CHAT_HISTORY_LIMIT` (default 20). Reuses `CLAUDE_AI_ENABLED`, `CLAUDE_BRIEF_TIMEOUT_MS`, `CLAUDE_MAX_ACTIONS`.
- **Dashboard**: `app/chat/page.tsx` (chat bubbles + composer), nav entry "Chat" in `components/Nav.tsx`.
- **Verification**: `npm run build`, `npm run smoke` (8 tables), `npm run smoke:step12` (stubbed; 7 assertions), `npm run build:dashboard`.

## Step 13 scope (PLANNED — not yet implemented) — Voice output (TTS), JARVIS speaks

> Brings **Voice output only** in-scope. **Voice input (STT, mic, wake word) stays out of scope.** Validated by `experiments/jarvis-tts-poc/` (committed `c358e40`). Phased; each phase is a small, verifiable step, gated **off** by default, **fail-soft to text**. **Detailed implementation blueprint: `docs/step13-voice-output-plan.md` — read before coding any phase.**

**Voice + stack (decided via POC):**
- Voice: **`en-AU-WilliamMultilingualNeural`** (Microsoft Edge neural, multilingual — speaks Thai + English code-switch in one consistent character).
- Stack: Node-only — `msedge-tts` (free Edge endpoint, **no API key**) → SSML prosody (pitch/rate down) → `ffmpeg-static` FX chain (warm EQ, compressor, subtle reverb, loudnorm). No Python, no system ffmpeg, no GPU. Voice cloning ruled out (needs GPU).
- Default preset: **warm** (`william_v1_warm`: pitch -8% / rate -6%, room reverb). Second preset available: `intimate` (`william_v5_intimate`).
- **Local-first tradeoff (accepted):** Edge endpoint is cloud (needs internet). All TTS is **fail-soft**: disabled / offline / endpoint error → silently degrade to existing text behavior. Fallback option if endpoint breaks: Azure TTS free tier (same voices, official).

**Two playback contexts (architecturally distinct):**
1. **Browser playback** (dashboard open) — chat replies, daily brief. `<audio>` plays wav fetched from backend.
2. **Backend speaker playback** (headless, no browser needed) — scheduler reminders/events + proactive approval nag. Backend plays wav on PC speakers via Windows PowerShell `System.Media.SoundPlayer`. This is new capability beyond Step 11 (which only toasts).

**Phases:**
- **13.1 — core TTS + browser playback.** `services/tts.ts` (`synthesize(text, preset) -> wav`; wraps msedge-tts + ffmpeg-static; gated `CLAUDE_AGENT_TTS_ENABLED` default off; fail-soft → null). `POST /api/tts` (`{ text }` → `audio/wav`, or 204/text-fallback when disabled). Dashboard chat plays reply audio + **mute toggle** (persisted client-side). Spoken text = the chat `reply` string (no extra Claude call).
- **13.2 — backend speaker + scheduler speaks due items.** `services/audioPlayer.ts` (`play(wavPath)`; injectable + `StubAudioPlayer` for tests; `RealAudioPlayer` via PowerShell SoundPlayer; gated `CLAUDE_AGENT_TTS_SPEAKER_ENABLED`). Scheduler tick (Step 11) additionally **synthesizes + plays** a templated line for newly-due reminders / soon-starting events. **Templated text, deterministic — no Claude call** (keeps Step 11's no-Claude rule).
- **13.3 — proactive approval nag.** Pending `approval` rows older than `CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS` (default 120000 = 2 min) → backend speaks a templated reminder. **Repeats every `CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS` (default 120000) until the approval is actioned.** Per-approval last-spoken time tracked in-memory in scheduler (resets on restart — acceptable). Templated text, no Claude.
- **13.4 — daily brief spoken.** Brief text read aloud (browser and/or backend speaker). Lowest priority.

**Explicitly NOT in Step 13:** voice input / STT / microphone / wake word; quiet hours (user opted for none — speak any time); Claude-generated spoken lines for scheduler/nag (those stay templated/deterministic).

**Planned config flags (all off by default):** `CLAUDE_AGENT_TTS_ENABLED`, `CLAUDE_AGENT_TTS_SPEAKER_ENABLED`, `CLAUDE_AGENT_TTS_PRESET` (default `warm`), `CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS` (120000), `CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS` (120000).

**Planned verification:** `npm run smoke:step13` (stubbed `MsEdgeTTS` invoker + `StubAudioPlayer` + temp DB; real Edge endpoint and real audio never used in tests; assert fail-soft when disabled, nag dedup/repeat timing, templated text, route degrades when off), plus existing `npm run build`, `npm run smoke`, `npm run build:dashboard`.

## Step 14 scope (done) — Google Calendar update/delete + auto-execute engine

> User explicitly approved expanding the agent: full Google Calendar CRUD + optional auto-execute (no manual approve click), while keeping destructive actions confirm-gated and **truthful reporting** (report only the real executor outcome — never claim success that did not happen).

- **14.1 — Google Calendar update/delete (done).** Two new approval-gated allowlist actions: `google_event.update` (`events.patch`) and `google_event.delete` (`events.delete`). Target an existing event by its string `id` (from the read routes). Both **snapshot the prior event state first** (via `events.get`), stored in the new `approval.undo_json` column so a change is recoverable. `delete` carries a new `destructive` policy. Connector still **fails closed** when disabled. Google OAuth scope unchanged (`calendar.events`). `npm run smoke:step14` (no network: schemas, registry, undo_json column, fail-closed).
- **14.2 — Auto-execute engine (done).** Flag `CLAUDE_AGENT_AUTO_EXECUTE_ENABLED` (**default off**). `services/actionDispatcher.ts` is the single chokepoint every proposal site (command, ai, brief, chat, memory routes) now calls. When ON: reversible/non-destructive actions execute **immediately** through the existing executor and the **real** outcome is recorded (`succeeded`/`failed`); **destructive actions (`google_event.delete`, `*.archive`, `memory.write` mode `replace`) always stay pending and require explicit confirm.** Every action still writes an `approval` row (audit trail); a failed auto-exec stays pending for retry/reject. Activity events `action.auto_executed` / `action.auto_failed`. Executor remains the **single execution gate**; Claude still never executes directly. `npm run smoke:step14b` (auto on; classification, auto-exec success, confirm-pending, truthful failure).
- **14.3 — Dashboard + truthful report (done).** Dashboard types/registry mirror the two new actions (string-id payloads, Thai confirm copy; delete prompt warns it deletes for real but is recoverable from snapshot). Approvals board routes auto-executed rows → "Approved / Done" and failed auto-exec → "Needs Attention"; succeeded rows with a snapshot show "undo available". The board reflects the **real** stored execution state, so the report is never faked.
- **14.5 — AI can propose Google update/delete + opt-in destructive auto-exec (done).** Bugfix: `schemas/aiCommand.ts` `aiActionSchema` union was missing `google_event.update` / `google_event.delete`, so any AI/chat proposal to update or delete a Google event failed strict validation (chat → 400, "รูปแบบคำตอบไม่พร้อมใช้งาน"). Added both union members; chat context now also exposes each Google event's string `id` (chat.ts + chatPrompt.ts) so the model can target the right event. **User then explicitly approved auto-executing recoverable destructive Google deletes** (snapshot → `undo_json` → restorable). New flag `CLAUDE_AGENT_AUTO_EXECUTE_DESTRUCTIVE_ENABLED` (**default off**) + runtime DB override `auto_execute_destructive_enabled` (Settings toggle "Auto-execute Google delete"). When BOTH auto-execute and this toggle are on, `dispatchProposedAction` lets `RECOVERABLE_DESTRUCTIVE_TYPES` (currently only `google_event.delete`) execute immediately; `*.archive` and `memory.write` `replace` **still always require confirm**. Executor remains the single gate; reporting still truthful. `npm run smoke:step14b` extended (toggle exempts only Google delete; archive/memory-replace stay gated).
- **Still NOT in scope (Step 14):** local filesystem write/delete (deliberately excluded — too risky); Claude executing directly (executor is the only gate); auto-executing **non-recoverable** destructive actions (`*.archive`, memory `replace` stay confirm-gated).

## Step 17 scope (done) — Gmail connector (read inbox + draft + send)

- **Gmail connector** via existing Google OAuth client (`buildOAuthClient()` from googleCalendar.ts). Reuses same credential files; single `npm run google-auth` run gets combined scopes. Disabled by default (`GMAIL_ENABLED`).
- **Read:** `GET /api/gmail/unread` — returns up to `GMAIL_MAX_RESULTS` (default 20) unread inbox messages with metadata only (from/subject/snippet/date); never full body. Fails closed to `{ available: false, messages: [] }`.
- **Write (approval-gated):** `gmail.draft` (auto-executable, low risk — stays in Drafts) and `gmail.send` (ALWAYS confirm-gated, never auto-executed — sent mail cannot be recalled). Both in `ALWAYS_CONFIRM_TYPES` for send; draft is not. Executor is the only gate.
- **Chat context:** up to 5 unread Gmail messages included (fail-gracefully when disabled/error).
- **Dashboard:** `/gmail` page (read-only inbox, SWR refresh 5 min); sidebar link; Thai approval copy for both types.
- **Schemas:** `gmail.draft` payload `{ to, subject, body, cc?, bcc?, replyToMessageId? }` — same shape for send.
- **OAuth scopes:** `gmail.readonly` + `gmail.compose` added to `GOOGLE_ALL_SCOPES`; re-run `npm run google-auth` to get fresh token.
- **Verification:** `npm run smoke:step17` (16 assertions: action types, registry/risk, confirmation policy, schema validation, HTTP routes, approval proposals — all pass, no real credentials needed).

## Step 18 scope (done) — Google Contacts connector (read-only)

- **Google Contacts** via People API v1 (`people.connections.list`). Reuses same OAuth client + credential files as Calendar and Gmail. Disabled by default (`GOOGLE_CONTACTS_ENABLED`).
- **Read:** `GET /api/contacts` — returns up to `GOOGLE_CONTACTS_MAX_RESULTS` (default 200) contacts (name + primary email + phone). `GET /api/contacts/search?q=` — filters by name or email. Both fail closed to `{ available: false, contacts: [] }`.
- **Write:** none — contacts is read-only. No action types added for contacts.
- **Chat context:** up to 50 contacts (name + email) included so AI can look up correct email addresses when proposing `gmail.draft` / `gmail.send`. Fails gracefully when disabled.
- **OAuth scope:** `contacts.readonly` added to `GOOGLE_ALL_SCOPES`; re-run `npm run google-auth` once.
- **Verification:** `npm run smoke:step18` (7 assertions: disabled flag, scopes, HTTP routes fail-closed — no real People API calls).

## Out of scope (must NOT add without explicit approval)

- MCP
- External connectors **other than Google Calendar (Step 10), Gmail (Step 17), Google Contacts (Step 18)**
- **Local filesystem write/delete** (Step 14 expanded Google Calendar to full CRUD but deliberately did **not** grant local file mutation)
- Auto-executing **non-recoverable destructive** actions (`*.archive` / memory `replace` stay confirm-gated even with auto-execute on). **Exception (Step 14.5, user-approved):** recoverable `google_event.delete` (snapshot → restorable) may auto-execute when the opt-in `CLAUDE_AGENT_AUTO_EXECUTE_DESTRUCTIVE_ENABLED` toggle is on.
- Auto-morning-brief scheduler (timer-driven Claude invocation — Step 11 scheduler does **not** call Claude)
- **Voice input** (STT, microphone, wake word) — voice **output** (TTS) is in-scope via Step 13; input stays out
- Claude-generated spoken lines for scheduler/approval-nag (Step 13 keeps these templated/deterministic — no Claude)
- Google Drive, Notion
- LINE, Instagram (approved in principle but not yet implemented)
- Local filesystem scanning
- Authentication **beyond minimal OAuth for Google APIs**

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
- `npm run smoke:step11` — Step 11 scheduler smoke (stubbed notifier + temp DB; no real toast)
- `npm run smoke:step12` — Step 12 chat smoke (stubbed invoker + temp DB; real `claude` never called)
- `npm run google-auth` — one-time Google Calendar OAuth setup
- `npm run db:init` — initialize the SQLite database
- `npm run dev` — run backend in watch mode (127.0.0.1:8787)
- `npm run dev:dashboard` — run the dashboard (Next.js, :3000); requires backend running for `/api/*` to resolve
- `npm run build:dashboard` — production build of the dashboard
