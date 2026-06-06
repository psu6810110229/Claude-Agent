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

## 6. Troubleshooting `available: false`

The connector **fails closed** and never leaks the underlying error, so a bad
setup always shows up as `{ "events": [], "available": false }` (dashboard:
"Google Calendar not connected"). Root causes seen so far, in likely order:

1. **Flag not set on the backend process.** `GOOGLE_CALENDAR_ENABLED` is read
   once at process start, in the **backend** terminal (the one running
   `npm run dev`) — not the dashboard terminal. Set it *before* `npm run dev` and
   restart the backend after changing it. Setting it only in the dashboard
   terminal has no effect.
2. **Google Calendar API not enabled** in the Cloud project → raw error
   `SERVICE_DISABLED`. Enable it at
   `https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=<PROJECT>`
   and wait 1–2 min to propagate. Auth/token stay valid — no re-auth needed.
3. **Consent blocked (403 access_denied)** during `google-auth`: the signed-in
   account is not in **OAuth consent screen → Test users** (Testing mode). Add
   the exact account, Save, re-run `npm run google-auth`.
4. **Missing/invalid creds**: `data/google-client-secret.json` or
   `data/google-token.json` absent, or token has no `refresh_token`.

### Diagnosing the real (hidden) error

Because the fetcher swallows the Google error on purpose, diagnose with a
**throwaway** script (do not commit) that calls `buildOAuthClient()` +
`calendar.events.list` directly and prints `err.response.data` — that JSON
carries the real `reason` (e.g. `SERVICE_DISABLED`). Delete it afterwards. It is
safe to log the API error body; never log the token or client secret.
