# Step 20 LINE — Phase B/C handoff (read this on the DESKTOP)

> Purpose: a COLD Claude Code session on the dedicated desktop must be able to
> continue this work without the laptop's chat history or local Claude memory.
> Everything needed is in this file + `CLAUDE.md` (Step 20 section) + the code.

## Where we are

- **Phase A (DONE, committed `a791b2b` on `dev`)** — LINE read-only connector +
  chat-context recall. Parser, routes, schemas, smoke (`npm run smoke:step20`,
  32 assertions). Jarvis knows all chats + reads recent-per-chat. Works on
  whatever `.txt` exports exist in `packages/backend/data/line-exports/`.
- **Phase B (TODO, do on this desktop)** — RPA auto-exporter: automatically
  export every LINE chat to `data/line-exports/` every ~15 min, unattended.
- **Phase C (TODO)** — run backend+dashboard on this desktop always-on; reach it
  from laptop+phone over Tailscale.

## Why this architecture (decided with the user)

- Live LINE `.edb` is encrypted (key derived inside `LINE.exe`, NOT in DPAPI/
  registry/Credential Manager — verified) + locked while LINE runs. Decryption =
  reverse-engineering, breaks every LINE update. REJECTED.
- LINE UI = Qt opaque canvas: UIA tree has nodes but ALL names/ids EMPTY, zero
  addressable buttons/menus (verified via UIAutomation). So RPA MUST use
  coordinates / image-matching, NOT stable selectors. The Windows "Save As"
  dialog IS UIA-addressable (robust).
- No personal-chat read API. Unofficial protocol APIs = account-ban risk.
- User accepted the fragile tradeoff and chose: dedicated always-on DESKTOP runs
  LINE + RPA; laptop (daily driver) + phone are thin clients over Tailscale.
  Focus-stealing during export only hits the unused desktop.

## Phase B — RPA exporter plan

Goal: a scheduled task that, every ~15 min, exports each chat's history to a
`.txt` in `LINE_EXPORT_DIR` (default `packages/backend/data/line-exports/`).
The backend already re-parses on file mtime change — no other glue needed.

Hard constraints to lock down FIRST (de-risk before building the loop):
1. **Freeze LINE version** — disable LINE auto-update so the UI layout stays put
   (block/rename `...\LINE\bin\LineUpdater.exe`, or firewall it). Record the
   pinned version.
2. **Fixed screen resolution + LINE always maximized** at a known position.
3. Confirm one full automated export works end-to-end and produces a valid
   `.txt` the existing parser accepts, then prove it repeats unattended 2-3x.

Implementation approach (no Python/AHK installed by default — choose one):
- PowerShell + .NET `System.Windows.Automation` for the Save dialog (robust) +
  `SendKeys`/mouse for the in-LINE menu (coordinate/image, fragile). OR
- AutoHotkey v2 (simplest for UI + Save dialog) run by Task Scheduler. OR
- Python + pywinauto (most controllable) — needs install.

The flaky step is ONLY the in-LINE "open chat → menu (☰) → บันทึกประวัติแชท
(Export chat) → Save As". Make it as robust as possible:
- Prefer image-matching on the menu icon over raw coordinates.
- Drive the Save dialog via UIA (it has named controls): set filename/path,
  confirm overwrite.
- Add retries + a screenshot-on-failure for debugging.

**Staleness detector (REQUIRED — so Jarvis never silently serves stale data):**
- Track the newest export file mtime. If no export has refreshed within
  e.g. 2× the interval, surface it (a notification / a flag the chat context can
  mention) so the user knows the feed broke. Never pretend data is fresh.

## Phase C — deploy + Tailscale

- Run backend (`npm run dev` or build+start) + dashboard on the desktop.
- Backend currently binds `127.0.0.1` only (`HOST` in `config.ts`) — to reach it
  from laptop/phone, bind to the Tailscale interface (or `0.0.0.0` restricted by
  Windows Firewall + Tailscale ACL). This CHANGES the CLAUDE.md "127.0.0.1 only"
  safety rule — Tailscale (private encrypted mesh) makes it acceptable, but get
  explicit user OK and document it as a Step 20.C scope note.
- Recreate secrets on the desktop (NOT in git): `.env` (flags incl `LINE_ENABLED=1`)
  + run `npm run google-auth` for Google token, if Google connectors are wanted.

## Safety notes

- LINE stays READ-ONLY: no `line.*` action types, executor unchanged, nothing
  Jarvis does can send/modify LINE. RPA only reads (exports) the user's own chats.
- Nothing here auto-runs destructive actions. Approval queue + deterministic
  backend remain the execution gate.

## Verification checklist (desktop)

- `npm install` && `npm run build` clean
- `npm run smoke:step20` → all pass
- Set `LINE_ENABLED=1`, drop/export real `.txt` into `data/line-exports/`,
  hit `GET /api/line/chats` → `available:true` with chats
- Phase B: confirm the scheduled exporter refreshes files unattended
- Phase C: open dashboard from laptop/phone over Tailscale
