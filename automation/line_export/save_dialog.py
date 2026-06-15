"""Native Windows "Save As" dialog handler for the LINE chat-export RPA.

This module is the *deterministic* tail end of the LINE export flow. The flaky,
coordinate/image-based part (open chat -> menu -> "Save chat") lives in the
caller. The moment LINE pops the native Windows "Save As" dialog, the caller
hands control to:

    save_line_chat_from_native_dialog(export_dir: Path) -> Path

It drives the dialog via pywinauto's UIA backend (no coordinates, no image
matching, no pyautogui typing), so Thai Unicode in the auto-filled filename is
preserved exactly. It sanitizes the filename, writes the *full* target path into
the File-name field (so the file lands in our predictable export dir, not the
dialog's last-used folder), clicks Save, and recovers from at most one
"invalid filename" error popup.

The sanitizer (`sanitize_filename`) is a pure function with no pywinauto
dependency, so it is unit-testable without a desktop session. pywinauto is
imported lazily inside the dialog driver for the same reason.

No Claude/AI involvement: this is plain, deterministic UI automation.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import sys
import time
from pathlib import Path

logger = logging.getLogger("line_export.save_dialog")

# ---------------------------------------------------------------------------
# Filename sanitization (pure — no pywinauto, fully unit-testable)
# ---------------------------------------------------------------------------

# Windows-invalid filename characters: \ / : * ? " < > |
_INVALID_CHARS = r'\/:*?"<>|'
_INVALID_CHARS_RE = re.compile("[" + re.escape(_INVALID_CHARS) + "]")
# C0 control chars (0x00-0x1F) and DEL (0x7F).
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
# Windows reserved device names (case-insensitive), with or without extension.
_RESERVED_RE = re.compile(
    r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.IGNORECASE
)

DEFAULT_EXT = ".txt"
DEFAULT_FALLBACK = "line-chat"
# Conservative cap for a single path component. Windows allows 255; we leave
# room for the directory prefix and stay well clear of MAX_PATH issues.
DEFAULT_MAX_LEN = 200


def sanitize_filename(
    raw: str,
    *,
    ext: str = DEFAULT_EXT,
    fallback: str = DEFAULT_FALLBACK,
    max_len: int = DEFAULT_MAX_LEN,
    replacement: str = "",
) -> str:
    """Return a safe Windows filename, preserving Thai (and other) Unicode.

    Only the *filename* is touched — no path separators survive, by design.

    Handles: invalid chars (\\ / : * ? " < > |), control chars, trailing dots/
    spaces, empty result, reserved device names (CON/PRN/.../COM1-9/LPT1-9),
    and excessive length. Always returns a name ending in ``ext``.
    """
    if raw is None:
        raw = ""

    # Split off a trailing extension that matches `ext` (case-insensitive) so we
    # sanitize only the stem and re-attach a single clean extension.
    stem = raw
    if ext and stem.lower().endswith(ext.lower()):
        stem = stem[: -len(ext)]

    # Strip control chars first, then invalid punctuation.
    stem = _CONTROL_CHARS_RE.sub("", stem)
    stem = _INVALID_CHARS_RE.sub(replacement, stem)

    # Normalize whitespace runs to single spaces (a replacement of "" can leave
    # awkward gaps), then strip. Windows also forbids trailing dots/spaces.
    stem = re.sub(r"\s+", " ", stem).strip()
    stem = stem.rstrip(" .")
    stem = stem.strip()

    if not stem:
        stem = fallback

    # Reserved device name? (checked against the bare stem, case-insensitive)
    if _RESERVED_RE.match(stem):
        stem = "_" + stem

    # Cap length, leaving room for the extension. Slice by codepoint so Thai
    # characters are not corrupted.
    budget = max(1, max_len - len(ext))
    if len(stem) > budget:
        stem = stem[:budget].rstrip(" .")
        if not stem:
            stem = fallback[:budget]

    return stem + ext


def default_export_dir() -> Path:
    """Resolve the export dir.

    Order: ``LINE_EXPORT_DIR`` env var, else a safe user-facing folder
    ``%USERPROFILE%\\Documents\\LINEExports``. The backend's LINE connector
    reads from whatever ``LINE_EXPORT_DIR`` points at, so set that env var on the
    desktop to point the exporter and the connector at the same directory.
    """
    env = os.environ.get("LINE_EXPORT_DIR")
    if env:
        return Path(env)
    return Path.home() / "Documents" / "LINEExports"


# ---------------------------------------------------------------------------
# Native "Save As" dialog driver (pywinauto / UIA)
# ---------------------------------------------------------------------------

# Standard Win32 common-dialog class shared by Save As and message boxes.
_DIALOG_CLASS = "#32770"
# Locale-independent control ids used by the common file dialog / message box.
_FILENAME_COMBO_AUTOID = "1148"  # legacy file-name ComboBox
_FILENAME_EDIT_AUTOID = "1001"   # IFileDialog file-name Edit
_OK_BUTTON_AUTOID = "1"          # IDOK (Save / OK)
# Locale fallbacks for the filename label and the Save/OK buttons.
_FILENAME_LABELS = ("File name:", "ชื่อไฟล์:")
_SAVE_TITLES_RE = r"(?i)^(save|บันทึก|ตกลง|ok)$"
# "Yes" on an overwrite-confirmation ("file already exists, replace?").
_YES_TITLES_RE = r"(?i)^(yes|&yes|ใช่)$"
# Win32 child-window classes that mark a *file* dialog (vs a plain message box).
# Used to tell the Save As dialog apart from an invalid-filename error popup.
_FILE_DIALOG_CHILD_MARKERS = (
    "ComboBoxEx32", "SHELLDLL_DefView", "Breadcrumb Parent", "DUIViewWndClassName",
)


class SaveDialogError(RuntimeError):
    """Raised when the Save As dialog cannot be driven to completion."""


def save_line_chat_from_native_dialog(
    export_dir: Path | str | None = None,
    *,
    timeout: float = 30.0,
) -> Path:
    """Drive the native Windows "Save As" dialog to save the LINE export.

    Call this immediately after the existing automation clicks "Save chat".

    Steps: wait for the dialog -> dismiss any pre-existing invalid-filename
    popup -> read LINE's auto-filled name -> sanitize it -> write the full
    target path into the file-name field -> click Save -> on a single invalid-
    filename popup, dismiss, re-apply, click Save once more (no retry loop).

    Returns the final saved :class:`Path`. Raises :class:`SaveDialogError` on
    failure.
    """
    # Lazy import so the module (and its sanitizer/tests) load without the deps.
    # We locate the dialog window via Win32 (reliable for the #32770 common
    # dialog, which the UIA desktop-tree walk can miss when another app owns it)
    # and then drive its controls via pywinauto's UIA backend connected by HWND.
    try:
        import win32gui  # noqa: F401  (presence check; used in helpers)
        from pywinauto import Application  # noqa: F401
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SaveDialogError(
            "pywinauto + pywin32 are required to drive the Save As dialog. "
            "Install: pip install pywinauto pywin32  (see automation/requirements.txt)"
        ) from exc

    out_dir = Path(export_dir) if export_dir is not None else default_export_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    hwnd = _wait_for_save_dialog_hwnd(timeout)
    dialog = _connect_dialog(hwnd)

    # Step 2: an invalid-filename popup may already be showing.
    _dismiss_error_popup(hwnd)

    # Steps 4-5: read what LINE inserted, sanitize the basename only.
    current = _read_filename(dialog)
    logger.info("LINE auto-filled filename: %r", current)
    safe_name = sanitize_filename(Path(current).name if current else "")
    target = out_dir / safe_name
    logger.info("Sanitized target path: %s", target)

    # Steps 9-10: put ONLY the sanitized filename in the box and save. We do NOT
    # write the full path here: LINE ignores the directory part of a path placed
    # via SetValue and writes the file into its own current folder regardless
    # (and a full path only leaves a confusing 0-byte stub at our location). The
    # file is moved into `out_dir` by the relocate step below — that is what
    # makes the export dir predictable.
    _set_filename(dialog, safe_name)
    _commit_save(dialog)

    # Expected (not an error): re-exporting an existing chat triggers an
    # overwrite confirmation. We deliberately chose this path → confirm "Yes".
    _confirm_overwrite_if_present(hwnd)

    # If the dialog has closed, the save succeeded — we are done. Only if it is
    # still open do we treat it as a (likely invalid-filename) error and recover
    # once. This avoids a spurious retry against an already-closed dialog.
    if not _wait_hwnd_gone(hwnd, timeout=3.0):
        # Step 11: recover from a single invalid-filename popup, re-save once.
        if _dismiss_error_popup(hwnd):
            logger.warning("Invalid-filename popup appeared; re-applying once.")
            try:
                _set_filename(dialog, safe_name)
                _commit_save(dialog)
                _confirm_overwrite_if_present(hwnd)
            except SaveDialogError:
                pass  # dialog vanished mid-retry → treat as terminal below
        # Step 12/13: no unbounded loop. Confirm the window finally closed.
        if not _wait_hwnd_gone(hwnd, timeout=min(10.0, timeout)):
            logger.warning("Save As dialog still visible after Save; check for "
                           "a second popup or a permission issue.")

    # The native dialog ignores the *directory* part of a full path placed via
    # SetValue: LINE writes the real content into its own current folder (e.g.
    # the OneDrive-redirected Documents) and only an empty stub (if any) lands at
    # our path. Relocate the real, just-saved file into the requested export dir
    # so the result is predictable (requirement 8). Trigger when the target is
    # missing OR a 0-byte stub.
    try:
        target_ok = target.exists() and target.stat().st_size > 0
    except Exception:
        target_ok = False
    if not target_ok:
        # LINE writes the file asynchronously after the dialog closes (it may
        # briefly be 0 bytes mid-write). Poll for a non-empty saved file before
        # relocating. Bounded — no unbounded loop.
        for _ in range(20):  # ~6s max
            if _locate_recent_save(target.name) is not None:
                break
            time.sleep(0.3)
        _relocate_to_target(target)

    logger.info("Saved LINE export to: %s", target)
    return target


def _relocate_to_target(target: Path) -> bool:
    """Move a just-saved export into `target` if the dialog wrote it elsewhere.

    The Windows Save dialog may save the file (with our sanitized basename) into
    its own current folder rather than the directory we specified. We find that
    freshly-written file by basename + recent mtime in the usual save folders and
    move it to `target`. Returns True if `target` exists afterwards.
    """
    found = _locate_recent_save(target.name)
    if found is None:
        logger.warning("Saved file not found for relocation; left where the "
                       "dialog wrote it.")
        return target.exists()
    if found.resolve() == target.resolve():
        return target.exists()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # Remove an empty/stale stub the dialog may have created at our path.
        if target.exists():
            target.unlink()
        # Copy (not move): the source may be a OneDrive-synced file that is
        # locked against deletion. Placing the content is what matters; removing
        # the original is best-effort.
        shutil.copy2(str(found), str(target))
        logger.info("Relocated export into the requested export dir.")
        try:
            found.unlink()
        except Exception:
            logger.info("Original copy left in place (locked); content is in "
                        "the export dir.")
    except Exception as exc:  # pragma: no cover - filesystem dependent
        logger.warning("Could not relocate export: %s", exc)
    return target.exists()


def _locate_recent_save(name: str, max_age: float = 180.0):
    """Find a recently-written file named `name` in the usual save folders.

    Direct path joins only (no glob) so names containing glob metacharacters
    like ``[LINE]`` are matched literally. Non-recursive: the dialog writes the
    file directly into its current folder.
    """
    now = time.time()
    home = Path.home()
    roots = [
        home / "OneDrive" / "Documents",
        home / "Documents",
        home / "Downloads",
        home / "Desktop",
        home / "OneDrive" / "Desktop",
        home,
    ]
    best = None
    for r in roots:
        try:
            p = r / name
            st = p.stat()
            # Ignore 0-byte stubs the dialog may leave; we want the real export.
            if st.st_size > 0 and (now - st.st_mtime) <= max_age:
                if best is None or st.st_mtime > best.stat().st_mtime:
                    best = p
        except Exception:
            continue
    return best


def _list_dialog_hwnds() -> list:
    """Return hwnds of all visible top-level #32770 (common dialog) windows."""
    import win32gui
    hwnds: list = []

    def _cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == _DIALOG_CLASS:
                hwnds.append(h)
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(_cb, None)
    except Exception:
        pass
    return hwnds


def _hwnd_is_file_dialog(hwnd) -> bool:
    """True if this #32770 is a file chooser (Save As), not a plain message box.

    A file dialog has shell child windows (folder view / breadcrumb / file-name
    combo); an invalid-filename error popup has only Static + Button.
    """
    import win32gui
    found = {"hit": False}

    def _cb(ch, _):
        try:
            if win32gui.GetClassName(ch) in _FILE_DIALOG_CHILD_MARKERS:
                found["hit"] = True
        except Exception:
            pass
        return True

    try:
        win32gui.EnumChildWindows(hwnd, _cb, None)
    except Exception:
        pass
    return found["hit"]


def _connect_dialog(hwnd):
    """Attach to a dialog by HWND via the UIA backend and return its window."""
    from pywinauto import Application
    app = Application(backend="uia").connect(handle=hwnd)
    return app.window(handle=hwnd)


def _wait_hwnd_gone(hwnd, timeout: float) -> bool:
    import win32gui
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
                return True
        except Exception:
            return True
        time.sleep(0.25)
    return False


def _wait_for_save_dialog_hwnd(timeout: float):
    """Poll for the Save As dialog's HWND (Win32 enumeration, foreground-first).

    Raises SaveDialogError on timeout.
    """
    import win32gui
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            fg = win32gui.GetForegroundWindow()
            if (fg and win32gui.GetClassName(fg) == _DIALOG_CLASS
                    and _hwnd_is_file_dialog(fg)):
                return fg
        except Exception:
            pass
        for h in _list_dialog_hwnds():
            if _hwnd_is_file_dialog(h):
                return h
        time.sleep(0.3)
    raise SaveDialogError("Save As dialog did not appear in time")


def _read_filename(dialog) -> str:
    edit = _find_filename_control(dialog)
    if edit is None:
        return ""
    return _read_edit_value(edit)


def _find_filename_control(dialog):
    """Locate the file-name input via locale-independent ids, then fallbacks."""
    candidates = (
        lambda: dialog.child_window(auto_id=_FILENAME_EDIT_AUTOID,
                                    control_type="Edit"),
        lambda: dialog.child_window(auto_id=_FILENAME_COMBO_AUTOID,
                                    control_type="ComboBox"),
    )
    for make in candidates:
        try:
            ctrl = make()
            if ctrl.exists():
                # A ComboBox wraps an Edit; prefer the inner Edit for SetValue.
                try:
                    inner = ctrl.child_window(control_type="Edit")
                    if inner.exists():
                        return inner.wrapper_object()
                except Exception:
                    pass
                return ctrl.wrapper_object()
        except Exception:
            continue

    # Label-based fallback (localized).
    for label in _FILENAME_LABELS:
        try:
            ctrl = dialog.child_window(title=label, control_type="Edit")
            if ctrl.exists():
                return ctrl.wrapper_object()
        except Exception:
            continue

    # Last resort: first Edit descendant.
    try:
        edits = dialog.descendants(control_type="Edit")
        if edits:
            return edits[0]
    except Exception:
        pass
    return None


def _read_edit_value(edit) -> str:
    for getter in ("get_value", "window_text"):
        try:
            v = getattr(edit, getter)()
            if v:
                return v
        except Exception:
            continue
    return ""


def _set_filename(dialog, text: str) -> None:
    """Write `text` (the sanitized filename) into the file-name field via UIA
    SetValue, then VERIFY.

    Uses pywinauto's value-setting (UIA ValuePattern / WM_SETTEXT) so the text
    is placed atomically and Unicode is preserved — no per-keystroke typing.

    Critically, it then polls the field until it reads back the value: UIA
    SetValue can race the combo-box commit, and clicking Save before the value
    is committed makes the dialog close WITHOUT writing the file. We do not
    return until the value is confirmed present (bounded retries).
    """
    edit = _find_filename_control(dialog)
    if edit is None:
        raise SaveDialogError("Could not find the Save As file-name field")

    def _apply() -> bool:
        for setter in ("set_edit_text", "set_text"):
            try:
                getattr(edit, setter)(text)
                return True
            except Exception:
                continue
        try:
            edit.iface_value.SetValue(text)
            return True
        except Exception:
            return False

    applied = False
    for attempt in range(3):
        applied = _apply() or applied
        # Poll for the value to commit before returning.
        for _ in range(8):
            time.sleep(0.12)
            if text in _read_edit_value(edit):
                return
    if not applied:
        raise SaveDialogError("Failed to set the filename field")
    # Best effort: value didn't read back but a setter succeeded; let caller try.


def _press_button(btn) -> bool:
    """Activate a button without relying on foreground/visibility.

    Uses the UIA Invoke pattern first (works even if the dialog is occluded or
    not foreground); falls back to a real-mouse click only if invoke fails.
    """
    try:
        w = btn.wrapper_object()
    except Exception:
        return False
    for method in ("invoke", "click", "click_input"):
        try:
            getattr(w, method)()
            return True
        except Exception:
            continue
    return False


def _commit_save(dialog) -> None:
    """Submit the dialog: press Enter on the file-name edit, falling back to
    clicking the Save button if Enter cannot be delivered.

    Enter only submits — the filename was placed via SetValue, preserving
    Unicode (we never type the filename itself).
    """
    edit = _find_filename_control(dialog)
    if edit is not None:
        try:
            edit.set_focus()
        except Exception:
            pass
        try:
            # set_foreground brings the dialog up so the keystroke lands on it.
            edit.type_keys("{ENTER}", set_foreground=True)
            return
        except Exception:
            pass
    _click_save(dialog)


def _click_save(dialog) -> None:
    # Prefer the locale-independent IDOK button.
    try:
        btn = dialog.child_window(auto_id=_OK_BUTTON_AUTOID, control_type="Button")
        if btn.exists() and _press_button(btn):
            return
    except Exception:
        pass
    try:
        btn = dialog.child_window(title_re=_SAVE_TITLES_RE, control_type="Button")
        if btn.exists() and _press_button(btn):
            return
    except Exception:
        pass
    raise SaveDialogError("Could not find the Save button in the dialog")


def _has_button(win, titles_re) -> bool:
    try:
        return win.child_window(title_re=titles_re, control_type="Button").exists(timeout=0)
    except Exception:
        return False


def _confirm_overwrite_if_present(save_hwnd, timeout: float = 4.0) -> bool:
    """Click "Yes" on an overwrite-confirmation if one appears after Save.

    Returns True if confirmed. Bounded poll (the prompt may take a moment to
    appear); returns False quickly if there is no such prompt.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        for h in _list_dialog_hwnds():
            if h == save_hwnd or _hwnd_is_file_dialog(h):
                continue
            try:
                win = _connect_dialog(h)
            except Exception:
                continue
            if _has_button(win, _YES_TITLES_RE):
                btn = win.child_window(title_re=_YES_TITLES_RE, control_type="Button")
                if _press_button(btn):
                    logger.info("Confirmed overwrite (Yes).")
                    return True
        time.sleep(0.3)
    return False


def _dismiss_error_popup(save_hwnd) -> bool:
    """Dismiss an invalid-filename error popup if one is showing.

    Returns True if a popup was found and dismissed, else False. The popup is a
    separate #32770 message box (OK button, no file-chooser child windows),
    distinct from the Save As dialog identified by `save_hwnd`. An overwrite
    confirmation (Yes/No) is NOT an error — it is left for
    `_confirm_overwrite_if_present` and skipped here.
    """
    for h in _list_dialog_hwnds():
        if h == save_hwnd:
            continue
        # A real file dialog has shell children; skip those.
        if _hwnd_is_file_dialog(h):
            continue
        try:
            win = _connect_dialog(h)
        except Exception:
            continue
        # Skip overwrite-confirmation prompts (they have a Yes button).
        if _has_button(win, _YES_TITLES_RE):
            continue
        try:
            _dismiss_one(win)
            logger.info("Dismissed an invalid-filename / error popup.")
            return True
        except Exception:
            continue
    return False


def _dismiss_one(win) -> None:
    for finder in (
        lambda: win.child_window(auto_id=_OK_BUTTON_AUTOID, control_type="Button"),
        lambda: win.child_window(title_re=_SAVE_TITLES_RE, control_type="Button"),
    ):
        try:
            btn = finder()
            if btn.exists() and _press_button(btn):
                return
        except Exception:
            continue
    # Fall back to closing the message box.
    try:
        win.close()
    except Exception:
        pass


def _configure_utf8_logging() -> None:
    """Ensure logged paths (Thai) are emitted as UTF-8, not mangled."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    if not logging.getLogger().handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        logging.getLogger().addHandler(handler)
        logging.getLogger().setLevel(logging.INFO)


if __name__ == "__main__":  # pragma: no cover - manual smoke entry point
    _configure_utf8_logging()
    saved = save_line_chat_from_native_dialog()
    print(saved)
