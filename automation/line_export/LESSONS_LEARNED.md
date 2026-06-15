# LINE Save As helper — lessons from live debugging

Notes captured while building and live-verifying
`save_line_chat_from_native_dialog` against real LINE Desktop (Win v26) on
Windows 11. Read before changing the helper.

## Architecture

- **LINE Desktop UI is an opaque Qt canvas.** Its UIA tree has nodes but the
  chat list / 3-dot menu / "Save chat" have empty names/ids — not addressable.
  So **in-LINE navigation (reach "Save chat") must stay separate** from the
  native Save As handling. This helper owns only the OS dialog; the flaky
  coordinate/image navigation is the caller's job.

## Dialog discovery

- **UIA desktop-tree lookup missed the dialog.** `Desktop(backend="uia")
  .window(class_name="#32770")` never matched — the dialog is owned by LINE and
  UIA's desktop walk skips it. Win32 `EnumWindows`/`GetForegroundWindow` see it
  fine.
- **Working approach:** locate the `#32770` HWND via Win32 (foreground first,
  then `EnumWindows`), then `Application(backend="uia").connect(handle=hwnd)`.
  Connect-by-handle gives full control access even though tree-walk did not.
- Tell the file dialog apart from a message box by **Win32 child classes**
  (`ComboBoxEx32` / `SHELLDLL_DefView` / `Breadcrumb Parent`). A message box has
  only Static + Button.

## Setting the filename

- **Verify SetValue committed before saving.** UIA `SetValue` on the file-name
  edit can race the combo-box commit; clicking Save too early closes the dialog
  **without writing**. Poll-read the field until it reflects the value.
- **Set the sanitized basename only — not a full path.** LINE ignores the
  directory part of a path placed via SetValue: it writes the file into its own
  current folder regardless, and a full path only leaves a confusing 0-byte stub
  at the intended location. Put just the filename, then relocate (below).
- **Thai Unicode is preserved** via SetValue (no per-keystroke typing).

## Saving / popups

- **`invoke()` (or Enter) beats `click_input()`.** A real-mouse `click_input`
  hits the wrong window when the dialog isn't foreground/is occluded. The UIA
  Invoke pattern (and Enter on the edit) work regardless of focus.
- **Overwrite confirmation is NOT an error.** A re-export triggers a "Confirm
  Save As" Yes/No box — handle it by clicking **Yes**, separately from the
  invalid-filename error box (OK-only), which is dismissed.
- **Invalid-filename recovery is bounded to one attempt** (dismiss → re-apply →
  save once). No unbounded retry loop.
- After Save, **only run error-recovery if the dialog is still open** — a closed
  dialog means success; retrying against it crashes.

## Where the file lands

- **Save-then-relocate.** LINE writes to its current folder (often the
  **OneDrive-redirected** `Documents`, not literal `C:\Users\<u>\Documents`).
  After the dialog closes, **wait for LINE's async write** (the file is briefly
  0 bytes), find the fresh non-empty file by basename, then move it into the
  export dir. This is what makes the export location predictable.
- **OneDrive/source duplicates may remain.** The source copy in OneDrive can be
  **sync-locked against deletion**, so relocate copies into the export dir but
  the original may persist (best-effort delete). May need a cleanup follow-up.
- **`LINE_EXPORT_DIR` must be set** so the exporter and the backend connector
  read/write the same folder. The helper default
  (`%USERPROFILE%\Documents\LINEExports`) differs from the backend default.

## Verification status

- **Happy path live-verified:** detect → read Thai name → sanitize → save →
  overwrite Yes → relocate → file in export dir (real content, Thai intact).
- **Invalid-character popup path is implemented but NOT live-tested** (the test
  chat name had no illegal chars). Sanitizer is unit-tested for illegal chars;
  the live error-popup was never triggered.
