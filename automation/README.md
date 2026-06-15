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
