# Manual live Google Calendar test (Step 10)

Verifies the **read-only** Google Calendar connector against the real API. The
automated `npm run smoke:step10` never touches the network; this doc covers the
one live path. Read-only only — nothing is ever created, updated, or deleted.

## 1. Google Cloud setup (one time)

1. Google Cloud Console → create/select a project.
2. Enable **Google Calendar API**.
3. OAuth consent screen → **External**, Testing; add your Google account as a
   **test user**.
4. Credentials → **Create OAuth client ID** → **Desktop app** → download the
   JSON.
5. Save it as `packages/backend/data/google-client-secret.json` (gitignored).

## 2. Authorize (one time)

```
npm run google-auth -w @claude-agent/backend
```

- Open the printed URL, sign in, grant **read-only** (`calendar.readonly`).
- The loopback server on `127.0.0.1:8799` captures the code and writes the
  refresh token to `packages/backend/data/google-token.json` (gitignored).
- The token file and client secret are **never logged or committed**.

## 3. Run

```
# PowerShell
$env:GOOGLE_CALENDAR_ENABLED = "1"
npm run dev            # backend on 127.0.0.1:8787
npm run dev:dashboard  # dashboard on :3000 (separate terminal)
```

## 4. Verify

- `GET http://127.0.0.1:8787/api/calendar/today` → `{ events: [...], available: true }`
  with your real events (timed + all-day).
- `GET http://127.0.0.1:8787/api/calendar/upcoming` → next 7 days.
- Dashboard **Today** and **Upcoming** show Google Calendar as the primary
  schedule; local events appear under "Local events (secondary)".
- With `GOOGLE_CALENDAR_ENABLED` unset (or creds missing), both endpoints return
  `available: false` and the dashboard shows "Google Calendar not connected" —
  the app still works (fail closed).

## 5. Read-only guarantee

- Only `events.list` is ever called; the only scope is `calendar.readonly`.
- There are no calendar write action types in the approval allowlist, so neither
  the command bar nor the Daily Brief can propose a calendar change.
