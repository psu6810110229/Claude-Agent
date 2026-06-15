# automation/ — LINE chat-export RPA (Step 20 Phase B)

Deterministic UI automation that runs on the **dedicated desktop** (see
`docs/step20-line-phaseB-handoff.md`). No Claude/AI — pure, scriptable steps.

## `line_export/save_dialog.py`

Handles the **native Windows "Save As" dialog** that LINE pops after "Save chat".
The in-LINE menu navigation (the fragile coordinate/image part) is the caller's
job; this module takes over once the OS dialog is on screen.

```python
from pathlib import Path
from automation.line_export import save_line_chat_from_native_dialog

# ... existing automation clicks LINE's "Save chat" ...
saved_path = save_line_chat_from_native_dialog(Path(r"C:\path\to\line-exports"))
# export_dir defaults to LINE_EXPORT_DIR env, else
# %USERPROFILE%\Documents\LINEExports
# Set LINE_EXPORT_DIR so the exporter and the backend LINE connector read/write
# the same folder.
```

What it does (deterministic, bounded — no retry loop):
1. Wait for the Save As dialog (UIA, `backend="uia"`).
2. Dismiss a pre-existing invalid-filename popup if present.
3. Read LINE's auto-filled filename, sanitize **only the basename** (Thai
   Unicode preserved; strips `\ / : * ? " < > |`, control chars, trailing
   dots/spaces; fixes empty / reserved `CON`/`COM1`.. names; caps length).
4. Write the **full target path** into the file-name field via UIA SetValue
   (so the file lands in our export dir, not the dialog's last folder).
5. Click Save. On **one** invalid-filename popup: dismiss, re-apply, Save once
   more. Then return the final `Path`.

`sanitize_filename()` is a pure function — unit-tested without a desktop.

## Front half — `line_export/line_desktop_driver.py` + `export_chat.py`

Drives an **already-open, logged-in, maximized** LINE Desktop window from focus
through clicking "Save chat", then hands off to `save_dialog.py`. Coordinate /
clipboard automation (the Qt UI is opaque — no addressable controls). Reuses
`pywinauto` + `pywin32`; no new deps. **One chat per run — no batch built in.**

### Real-mode export (one chat)

```
python -m automation.line_export.export_chat \
  --chat-name "คุยกันเรื่อง กยศ" \
  --mode real \
  --calibration automation/line_export/calibration.json
```

- Prompts once for `GO` (type it). Add `--yes` to skip the prompt.
- Prints ONLY the saved path on success (stdout is UTF-8 — Thai-safe).
- Modes: `dry-run` (locate + print points, no side effects) → `supervised`
  (confirm before each click/key) → `real`. Always dry-run on a new machine
  first.

### Safe batch template (PowerShell)

Batch is **not** a feature of the tool — loop the one-chat CLI yourself, and
**stop on the first failure** (do not blindly continue; a wrong menu can misfire):

```powershell
$ErrorActionPreference = "Stop"
$env:LINE_EXPORT_DIR = "D:\Project-server_side\Claude-Agent\packages\backend\data\line-exports"
$chats = @(
  "กลุ่มลูกค้ารถตู้",
  "Freshman 25",
  "สิงหนครอิเล็กทรอนิ"
)
foreach ($c in $chats) {
  Write-Host "Exporting: $c"
  python -m automation.line_export.export_chat --chat-name "$c" --mode real `
    --calibration automation/line_export/calibration.json --yes
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Export FAILED for '$c' (exit $LASTEXITCODE). Stopping batch."
    break
  }
  Start-Sleep -Seconds 2   # let LINE settle between chats
}
```

### Requirements & caveats (READ before running)

- **LINE must be open and maximized** at a known resolution. The driver
  preflights each step and **stops** (no misclick) if the window is minimized,
  off-screen, or out of the size envelope.
- **Calibration is screen / DPI / layout dependent.** `calibration.json` holds
  window-relative fractions tied to this display + LINE layout. A new monitor,
  DPI change, or LINE UI update means **recalibrate** (dry-run → supervised).
- **`--chat-name` must be a substring LINE's search can actually find.** Spelling
  and display truncation matter — use a distinctive substring of the real title
  (e.g. `สิงหนครอิเล็กทรอนิ` finds `สิงหนครอิเล็กทรอนิกส`). The exported file is
  named from LINE's own auto-filled name, not your search string.
- **Group / private chats only (current profile).** **Official / business
  accounts (e.g. ShopeeTH) have a DIFFERENT menu layout** and will fail with the
  current `chat_menu` / `save_chat_item` points — they need a separate
  calibration profile. Not supported yet.
- **`LINE_EXPORT_DIR` must align with the backend connector.** Set it to the
  backend's `packages/backend/data/line-exports` (or move files there) so the
  Step 20 connector ingests the exports. Unset → falls back to
  `%USERPROFILE%\Documents\LINEExports`, which the backend will not read.
- **Backend needs two flags in its `.env` to surface chats** (see
  [Backend connector config](#backend-connector-required-local-config) below).
  Setting only `LINE_EXPORT_DIR` is not enough — the connector stays disabled
  until `LINE_ENABLED=1` is also set.
- **OneDrive / source duplicates may remain.** LINE writes into its own current
  folder (often OneDrive-redirected Documents); the helper copies the file into
  `LINE_EXPORT_DIR` but a sync-locked original can persist (best-effort delete).
- A small auxiliary `Qt...QWindowIcon` LINE window can appear; the driver filters
  out non-viable small windows so it never picks the wrong one.

## Backend connector — required local config

The Step 20 LINE connector is **off by default**. To make the backend read and
surface the exported `.txt` files, both flags must be in the **backend's `.env`**
— either the repo-root `.env` or `packages/backend/.env` (those are the only two
the backend's loader reads; the file is gitignored — never commit it):

```
LINE_ENABLED=1
LINE_EXPORT_DIR=<absolute path to your LINEExports folder>
```

Notes:
- `LINE_ENABLED` is a **separate gate** from `LINE_EXPORT_DIR`. Pointing the dir
  without enabling the flag leaves `GET /api/line/chats` returning
  `{ available: false }`.
- Use the **absolute path** to the folder the exporter writes into, e.g.
  `C:\Users\<you>\Documents\LINEExports` or
  `D:\path\to\Claude-Agent\packages\backend\data\line-exports`. Backslashes in
  the value are fine (the loader stores the raw string).
- Restart the backend after editing `.env` (config is read once at startup).
- A DB config row `line_enabled` (Settings) overrides the env flag when present.

## Dependency

`pywinauto` is **not** part of the Node workspace. Install on the desktop:

```
python -m pip install -r automation/requirements.txt
```

## Tests

```
cd automation/line_export && python -m unittest test_sanitize
```

Filename sanitization only. The dialog driver needs a live Windows desktop +
the real Save As dialog, so it is verified manually on the desktop (see the
handoff doc's verification checklist).
