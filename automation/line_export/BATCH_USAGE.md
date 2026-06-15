# LINE export — batch / priority-refresh runner

`batch_runner.py` exports several LINE chats on a refresh schedule by reusing the
one-chat exporter (`export_chat.py` → `save_dialog.py`). It is a **foreground CLI
loop only**.

> ⚠️ **Not a system scheduler.** No Windows service, no Task Scheduler, no
> background daemon, no auto-start. It runs only while you keep the terminal
> open, and only exports when you run the command.
>
> ⚠️ **LINE must be open and MAXIMIZED** at the calibrated resolution. If LINE is
> minimized / not found / the calibration is invalid, the underlying exporter
> stops safely and the failure is recorded — no misclicks.
>
> ⚠️ **Official / business accounts (e.g. ShopeeTH) are unsupported.** Set their
> `chat_kind` to `official` and the runner **skips** them (different menu layout
> → needs a separate calibration profile, added later).

## Config (JSON)

See `chats.example.json`. Copy it to your own `chats.json` (gitignored area or
outside the repo) and edit:

```json
{
  "defaults": {
    "enabled": true,
    "chat_kind": "group",
    "calibration": "automation/line_export/calibration.json",
    "stop_on_failure": true,
    "min_pause_seconds": 10
  },
  "chats": [
    { "name": "เอ๋วน้องต้าว",     "search": "เอ๋วน้องต้าว",  "refresh_minutes": 15,  "priority": 100 },
    { "name": "คุยกันเรื่อง กยศ", "search": "คุยกันเรื่อง กยศ", "refresh_minutes": 30,  "priority": 80  },
    { "name": "ENGINEERING PSU 68", "search": "ENGINEERIN",   "refresh_minutes": 30,  "priority": 80  },
    { "name": "กลุ่มลูกค้ารถตู้",  "search": "กลุ่มลูกค้ารถตู้", "refresh_minutes": 180, "priority": 40  }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `name` | Human label (also the state key). |
| `search` | Substring LINE's search box can actually find (display truncation matters). |
| `refresh_minutes` | How often the chat should be re-exported. |
| `priority` | Tie-breaker when many chats are due — higher exports first. |
| `enabled` | `false` skips the chat entirely. |
| `chat_kind` | `group` / `private` supported; `official` is skipped (unsupported). |
| `calibration` | Per-chat calibration JSON path (defaults to `defaults.calibration`). |

`defaults` supplies fallbacks. `stop_on_failure` (default `true`) and
`min_pause_seconds` (default `10`) are read from `defaults`.

Example intervals (from the example config):
- `เอ๋วน้องต้าว` — every **15 minutes**
- `คุยกันเรื่อง กยศ` / `ENGINEERING PSU 68` — every **30 minutes**
- `กลุ่มลูกค้ารถตู้` — every **180 minutes**

## Scheduling behavior

- A chat is **due** when it was never exported, or `refresh_minutes` have passed
  since its last success.
- Due chats are ordered: **highest priority first**, then **oldest
  `last_success` first** (never-exported counts as oldest).
- **One chat at a time.** `min_pause_seconds` (default 10) is waited between
  exports in a pass.
- State lives in `<export-dir>/.line-export-state.json` (override with `--state`).
  It stores only `last_attempt` / `last_success` / `status` per chat —
  **never message content**.
- `--once` stops on the first failure by default (`--no-stop-on-failure` to
  continue). `--watch` records a failure and backs off to the next poll — it
  does not crash the loop.

## Commands

Run from the repo root. `export-dir` defaults to `LINE_EXPORT_DIR` (else
`%USERPROFILE%\Documents\LINEExports`).

### Dry-run (no LINE actions)

```
python -m automation.line_export.batch_runner --config automation/line_export/chats.json --dry-run
```

Prints each chat's status and the planned export order. Writes nothing.

### One-shot (export all currently-due chats once)

```
python -m automation.line_export.batch_runner --config automation/line_export/chats.json --once
```

Each real export asks `export_chat` for a `GO` confirmation. Add `--yes` to skip
the per-chat prompt:

```
python -m automation.line_export.batch_runner --config automation/line_export/chats.json --once --yes
```

### Watch loop (foreground, polls and exports due chats)

```
python -m automation.line_export.batch_runner --config automation/line_export/chats.json --watch --poll-seconds 60
```

`Ctrl+C` stops it. Add `--yes` to avoid a `GO` prompt on every export.

### Useful flags

| Flag | Effect |
|------|--------|
| `--max-chats N` | Cap how many due chats are exported per pass. |
| `--pause-seconds N` | Min pause between exports (overrides config; default 10). |
| `--state PATH` | State file path (default `<export-dir>/.line-export-state.json`). |
| `--export-dir PATH` | Where exports land (default `LINE_EXPORT_DIR`). |
| `--yes` | Pass `--yes` through to `export_chat` (skip per-chat `GO`). |
| `--no-stop-on-failure` | In `--once`, keep going after a failed export. |

## Tests

No live LINE automation — a stub exporter and the pure scheduling logic are
tested directly:

```
python -m unittest automation.line_export.test_batch_runner
```
