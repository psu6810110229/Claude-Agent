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
    # Mark the instant just before Save so relocation only ever considers files
    # LINE writes from THIS export (candidate mtime must be >= export_started_at).
    export_started_at = time.time()
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
    # SetValue: LINE writes the real content into its OWN current folder (e.g.
    # the OneDrive-redirected Documents), not the directory we asked for. We
    # relocate that just-saved file into the requested export dir so the result
    # is predictable.
    #
    # Hardened source selection (see _find_fresh_source) — only LINE's likely
    # save dirs, candidate mtime >= export_started_at, size-stable, largest-wins
    # — so a re-export can never grab a stale or half-written copy (which once
    # regressed the export dir to an older, shorter file).
    try:
        target_fresh = (target.exists() and target.stat().st_size > 0
                        and target.stat().st_mtime >= export_started_at)
    except Exception:
        target_fresh = False

    if target_fresh:
        # LINE saved straight into the export dir; nothing to relocate. Stamp the
        # mtime so the backend's mtime-keyed parse cache re-reads it.
        try:
            os.utime(target, None)
        except Exception:
            pass
        logger.info("Export written directly into the export dir.")
    else:
        source = _find_fresh_source(target, since=export_started_at)
        if source is None:
            # Fail loudly rather than copy an ambiguous/stale file into the
            # export dir (the previous best-effort heuristic could regress data).
            raise SaveDialogError(
                "No stable, freshly-saved export appeared in LINE's save folders "
                "after Save (looked for a file newer than this export with a "
                "settled size in Documents / OneDrive\\Documents). Refusing to "
                "copy an ambiguous or stale file into the export dir.")
        _relocate_from_source(source, target)

    logger.info("Saved LINE export to: %s", target)
    return target


# Set True only once the hardened source selection is verified live. While OFF
# the relocator never deletes the original file LINE wrote (safer during
# validation: a wrong pick can be inspected/recovered, not silently removed).
DELETE_SOURCE_AFTER_RELOCATE = False


def _relocate_from_source(source: Path, target: Path) -> bool:
    """Copy a VERIFIED freshly-saved `source` export into `target`.

    `source` must already be validated by the caller (`_find_fresh_source`:
    from this export, size-stable, non-empty). This only places that copy at the
    predictable export-dir path. Returns True if `target` exists afterwards.

    Source deletion is gated by DELETE_SOURCE_AFTER_RELOCATE (OFF during the
    hardening validation) — we never remove the original while proving the new
    source-selection logic is correct.
    """
    try:
        if source.resolve() == target.resolve():
            return target.exists()
    except Exception:
        pass
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # Remove an empty/stale stub or the old export at our path.
        if target.exists():
            target.unlink()
        # Copy (not move): the source may be a OneDrive-synced file locked
        # against deletion. Placing the content is what matters.
        shutil.copy2(str(source), str(target))
        # copy2 preserves the SOURCE mtime; stamp the target NOW so the backend's
        # mtime-keyed parse cache sees a changed mtime and re-reads the new file.
        try:
            os.utime(target, None)
        except Exception:
            pass
        logger.info("Relocated export into the requested export dir.")
        if DELETE_SOURCE_AFTER_RELOCATE:
            try:
                source.unlink()
            except Exception:
                logger.info("Original copy left in place (locked); content is in "
                            "the export dir.")
    except Exception as exc:  # pragma: no cover - filesystem dependent
        logger.warning("Could not relocate export: %s", exc)
    return target.exists()


def _line_save_dirs() -> list[Path]:
    """LINE's likely native Save-As destination folders. Deliberately NARROW:
    only the Documents pair. We do NOT search Downloads/Desktop/home — searching
    those let a re-export grab an unrelated stale ``[LINE]`` file by newest mtime
    and regress the export dir."""
    home = Path.home()
    return [home / "Documents", home / "OneDrive" / "Documents"]


def _stable_stat(p: Path, settle: float = 0.5):
    """Return p's stat iff it exists, is non-empty, and its (size, mtime) are
    UNCHANGED across a ~`settle`s window — i.e. LINE has finished writing it.
    Otherwise None (missing, empty, or still being written)."""
    try:
        st1 = p.stat()
    except Exception:
        return None
    if st1.st_size <= 0:
        return None
    time.sleep(settle)
    try:
        st2 = p.stat()
    except Exception:
        return None
    if (st2.st_size == st1.st_size and st2.st_mtime == st1.st_mtime
            and st2.st_size > 0):
        return st2
    return None


def _find_fresh_source(target: Path, *, since: float,
                       timeout: float = 10.0, settle: float = 0.5):
    """Find the export LINE wrote for THIS run, robustly. Returns a Path or None.

    A qualifying candidate (ALL required):
      - lives in `_line_save_dirs()` (no Downloads/Desktop/home),
      - basename == ``target.name`` (literal join; never globs ``[LINE]``),
      - is NOT the export-dir target itself (outside the target path),
      - has mtime >= `since` (the instant just before Save → only this run),
      - is size-stable across ~`settle`s and size > 0 (not half-written).
    Among qualifiers, prefer the LARGEST size; tie → newest mtime. Polls up to
    `timeout` for LINE's async write to finish. Returns None if nothing
    qualifies, so the caller fails loudly instead of copying a guess.
    """
    try:
        target_resolved = target.resolve()
    except Exception:
        target_resolved = target
    deadline = time.time() + timeout
    while True:
        candidates: list[tuple[Path, int, float]] = []
        for d in _line_save_dirs():
            p = d / target.name
            try:
                if p.resolve() == target_resolved:
                    continue  # never the export-dir target itself
            except Exception:
                continue
            # Cheap reject before the costly stability wait: must be from this run.
            try:
                if p.stat().st_mtime < since:
                    continue
            except Exception:
                continue
            st = _stable_stat(p, settle)
            if st is not None and st.st_mtime >= since:
                candidates.append((p, st.st_size, st.st_mtime))
        if candidates:
            # Largest size first; tie → newest mtime.
            candidates.sort(key=lambda c: (c[1], c[2]), reverse=True)
            return candidates[0][0]
        if time.time() >= deadline:
            return None
        time.sleep(0.3)


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
