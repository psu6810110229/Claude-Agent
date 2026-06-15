"""Cautious front-half driver for LINE Desktop chat export (Step 20 Phase B).

This is the *fragile* head of the LINE export flow. It drives an already-open,
already-logged-in LINE Desktop window from "focus" through clicking
"Save chat" (บันทึกประวัติแชท), then hands the native Windows "Save As" dialog
to the verified tail half:

    automation.line_export.save_dialog.save_line_chat_from_native_dialog

Why it is built the way it is (see LESSONS_LEARNED.md + the Phase B handoff):

- **LINE Desktop is an opaque Qt canvas.** Its UIA tree has nodes but the chat
  list / search box / 3-dot (☰) menu / "Save chat" item all have EMPTY
  names/ids — nothing is addressable by a stable selector. So the in-LINE steps
  MUST use window-relative coordinates (calibrated) and clipboard paste, NOT
  selectors. The OS "Save As" dialog, by contrast, IS UIA-addressable and is
  handled entirely by save_dialog.py.
- **Coordinates are window-relative fractions** held in a calibration profile,
  not absolute pixels, so they survive the window moving (they do NOT survive a
  resolution / DPI / layout change — keep LINE maximized at a known size, as the
  handoff requires).
- **Thai chat names are pasted via the clipboard** (Ctrl+V), never typed
  per-keystroke, so Unicode is preserved exactly.

No new dependencies: reuses pywinauto + pywin32, already required by
save_dialog.py. No Claude/AI — pure deterministic UI automation.

Three safety modes (see `DriverMode`):
  - dry-run  : read-only. Find window, report rect, print the click points it
               WOULD use. No focus, no clicks, no keystrokes. Zero side effects.
  - supervised: print each planned action and require confirmation before every
               real click / keystroke.
  - real     : perform the sequence (the CLI still requires a one-time go).

LINE stays READ-ONLY end to end: this only *exports* (saves a copy of) the
user's own chat history. It never sends, replies to, or modifies a chat.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger("line_export.line_desktop_driver")

# ---------------------------------------------------------------------------
# Window identification
# ---------------------------------------------------------------------------

# LINE Desktop's main top-level window. Title is exactly "LINE"; the Qt window
# class embeds the Qt version (e.g. Qt663QWindowIcon on v26). The MAIN window's
# class ends in "QWindowIcon". LINE also spawns transient top-level popups that
# ALSO carry the title "LINE" — notably the chat dropdown menu, whose class is
# like "Qt663QWindowPopupSaveBits". We must target only the main window and
# ignore those popups, otherwise window discovery sees two "LINE" windows and
# (correctly) refuses as ambiguous. Match the version loosely (so a Qt
# minor-version bump does not break us) but the WindowIcon suffix strictly.
_LINE_TITLE = "LINE"
_LINE_MAIN_CLASS_RE = re.compile(r"^Qt\d+QWindowIcon$", re.IGNORECASE)


def _is_popup_class(cls: str) -> bool:
    """True for LINE's transient popups (dropdowns/tooltips), e.g. ...PopupSaveBits."""
    return "Popup" in cls or "ToolTip" in cls


# Acceptable maximized-window size/position envelope. A maximized LINE window has
# been seen at ~1550x878 (logical, 125% DPI) and ~1938x1098 (physical, 100% DPI);
# the range spans both. A minimized window collapses to ~159x27 at an off-screen
# origin (~ -25600), which these bounds reject so we never click into the void.
_MIN_W, _MAX_W = 1200, 2600
_MIN_H, _MAX_H = 600, 1500
_MIN_LEFT, _MIN_TOP = -200, -200


class LineWindowError(RuntimeError):
    """Raised when the LINE Desktop window cannot be found unambiguously."""


class CalibrationError(RuntimeError):
    """Raised when a clicking mode is asked to run without calibrated points."""


class DriverAborted(RuntimeError):
    """Raised when the operator declines a supervised confirmation."""


# ---------------------------------------------------------------------------
# Calibration profile
# ---------------------------------------------------------------------------

# Window-relative fractions (x, y in 0..1 of the window rect). These DEFAULTS are
# UNVERIFIED placeholders for a maximized LINE window — they are NOT trustworthy
# coordinates. `calibrated` stays False until the operator confirms real points
# (via a --calibration JSON file or after eyeballing dry-run output). Real mode
# refuses to click an uncalibrated profile unless explicitly overridden.
@dataclass
class Calibration:
    search_box: tuple[float, float] = (0.09, 0.065)
    # Top search-result row (clicked to open the chat). The flow clicks THIS,
    # not Enter — Enter-to-open proved unreliable on the opaque Qt list.
    search_result: tuple[float, float] = (0.1302, 0.1620)
    # Legacy: the currently-SELECTED chat row. Unused by the search flow; kept
    # for compatibility with older calibration files.
    first_result: tuple[float, float] = (0.12, 0.18)
    chat_menu: tuple[float, float] = (0.965, 0.07)
    save_chat_item: tuple[float, float] = (0.92, 0.20)
    calibrated: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "Calibration":
        def pt(key, default):
            v = data.get(key, default)
            if (isinstance(v, (list, tuple)) and len(v) == 2
                    and all(isinstance(n, (int, float)) for n in v)):
                return (float(v[0]), float(v[1]))
            raise CalibrationError(f"Calibration point {key!r} must be [x, y] fractions")
        return cls(
            search_box=pt("search_box", cls.search_box),
            search_result=pt("search_result", cls.search_result),
            first_result=pt("first_result", cls.first_result),
            chat_menu=pt("chat_menu", cls.chat_menu),
            save_chat_item=pt("save_chat_item", cls.save_chat_item),
            calibrated=bool(data.get("calibrated", False)),
        )


# ---------------------------------------------------------------------------
# Window discovery (Win32 — UIA cannot see this dialog/window reliably)
# ---------------------------------------------------------------------------

@dataclass
class WindowInfo:
    hwnd: int
    title: str
    cls: str
    rect: tuple[int, int, int, int]  # (left, top, right, bottom)

    @property
    def size(self) -> tuple[int, int]:
        l, t, r, b = self.rect
        return (r - l, b - t)


def _enum_top_level() -> list[WindowInfo]:
    import win32gui

    out: list[WindowInfo] = []

    def _cb(h, _):
        try:
            if not win32gui.IsWindowVisible(h):
                return True
            title = win32gui.GetWindowText(h)
            cls = win32gui.GetClassName(h)
            rect = win32gui.GetWindowRect(h)
            out.append(WindowInfo(h, title, cls, rect))
        except Exception:
            pass
        return True

    win32gui.EnumWindows(_cb, None)
    return out


def list_line_candidates() -> list[WindowInfo]:
    """All visible top-level windows that look like LINE Desktop (title 'LINE').

    Excludes LINE's transient popups (dropdown menu / tooltips) so callers see
    only real top-level windows; the main window is identified in
    `find_line_window`.
    """
    return [w for w in _enum_top_level()
            if w.title.strip() == _LINE_TITLE and not _is_popup_class(w.cls)]


def _is_viable_main(w: WindowInfo) -> bool:
    """True if `w` is a usable, maximized-like main LINE window.

    LINE spawns small auxiliary ``Qt...QWindowIcon`` windows (e.g. a ~280x164
    hidden/helper window) that share the main window's class and the title
    'LINE'. They must NOT make selection ambiguous, so we keep only candidates
    that are non-minimized, on-screen, and within the calibrated maximized-size
    envelope — the small auxiliaries fall below `_MIN_W`/`_MIN_H` and drop out.
    """
    import win32gui
    try:
        if win32gui.IsIconic(w.hwnd):
            return False
    except Exception:
        pass
    if not _LINE_MAIN_CLASS_RE.match(w.cls):
        return False
    l, t, r, b = w.rect
    width, height = r - l, b - t
    if not (_MIN_W <= width <= _MAX_W and _MIN_H <= height <= _MAX_H):
        return False
    if l < _MIN_LEFT or t < _MIN_TOP:
        return False
    return True


def find_line_window() -> WindowInfo:
    """Locate the single maximized LINE Desktop MAIN window, or raise on uncertainty.

    Targets the main-window class (``Qt...QWindowIcon``), ignores LINE's popup
    windows (e.g. ``Qt663QWindowPopupSaveBits``), and ignores small auxiliary
    main-class windows that fall outside the maximized-size envelope. Among the
    remaining viable windows: exactly one → use it; more than one → raise (we
    never guess). Largest area first only as a tiebreaker for the report.
    """
    cands = list_line_candidates()  # already popup-free
    mains = [w for w in cands if _LINE_MAIN_CLASS_RE.match(w.cls)]
    viable = [w for w in mains if _is_viable_main(w)]
    # Sort largest-area first so any reporting/tiebreak is deterministic.
    viable.sort(key=lambda w: w.size[0] * w.size[1], reverse=True)

    for w in mains:
        if w not in viable:
            logger.info("Ignoring non-viable LINE main candidate: hwnd=%s class=%s "
                        "rect=%s size=%s (too small / off-screen / minimized)",
                        w.hwnd, w.cls, w.rect, w.size)

    if not viable:
        if mains:
            desc = "; ".join(f"hwnd={w.hwnd} class={w.cls!r} rect={w.rect} size={w.size}"
                             for w in mains)
            raise LineWindowError(
                f"Found {len(mains)} 'LINE' main-class window(s) but none match the "
                f"maximized-size envelope {(_MIN_W, _MIN_H)}..{(_MAX_W, _MAX_H)} "
                f"[{desc}]. Open and maximize LINE Desktop."
            )
        raise LineWindowError(
            "No visible main window titled 'LINE' found. Open and log into LINE "
            "Desktop first, and make sure it is not minimized."
        )
    if len(viable) > 1:
        desc = "; ".join(f"hwnd={w.hwnd} class={w.cls!r} rect={w.rect} size={w.size}"
                         for w in viable)
        raise LineWindowError(
            f"Ambiguous: {len(viable)} viable maximized 'LINE' windows [{desc}]. "
            "Refusing to guess which to drive."
        )
    return viable[0]


# ---------------------------------------------------------------------------
# The driver
# ---------------------------------------------------------------------------

class DriverMode:
    DRY_RUN = "dry-run"
    SUPERVISED = "supervised"
    REAL = "real"
    ALL = (DRY_RUN, SUPERVISED, REAL)


def _default_confirm(prompt: str) -> bool:
    try:
        ans = input(f"{prompt} [y/N] ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


@dataclass
class LineDesktopDriver:
    """Drives LINE Desktop from focus → 'Save chat'. Save As is delegated out.

    `mode` gates every side-effecting action. `confirm` is the supervised
    confirmation callback (defaults to a stdin y/N prompt). `allow_uncalibrated`
    lets REAL mode run with the placeholder profile (use only after you have
    eyeballed dry-run points) — supervised never needs it because it confirms
    every click anyway.
    """

    mode: str = DriverMode.DRY_RUN
    calibration: Calibration = field(default_factory=Calibration)
    confirm: Callable[[str], bool] = _default_confirm
    allow_uncalibrated: bool = False
    settle: float = 0.6  # seconds to wait after each UI action for LINE to react
    search_settle: float = 1.2  # extra wait after pasting the query before clicking the result

    window: Optional[WindowInfo] = None

    # -- lifecycle ----------------------------------------------------------

    def locate(self) -> WindowInfo:
        """Find the LINE window and cache its rect. Read-only; safe in any mode."""
        self.window = find_line_window()
        logger.info("LINE window: hwnd=%s class=%s rect=%s size=%s",
                    self.window.hwnd, self.window.cls, self.window.rect,
                    self.window.size)
        return self.window

    def _require_window(self) -> WindowInfo:
        if self.window is None:
            self.locate()
        assert self.window is not None
        return self.window

    def _point(self, frac: tuple[float, float]) -> tuple[int, int]:
        l, t, r, b = self._require_window().rect
        x = int(round(l + frac[0] * (r - l)))
        y = int(round(t + frac[1] * (b - t)))
        return (x, y)

    # -- per-step safety preflight -----------------------------------------

    def _validate_window(self, w: WindowInfo, action: str) -> None:
        """Reject a window that is not a usable, maximized main LINE window."""
        import win32gui
        if not win32gui.IsWindow(w.hwnd) or not win32gui.IsWindowVisible(w.hwnd):
            raise LineWindowError(f"{action}: LINE main window is not visible.")
        if win32gui.IsIconic(w.hwnd):
            raise LineWindowError(f"{action}: LINE window is minimized — restore/maximize it.")
        if not _LINE_MAIN_CLASS_RE.match(w.cls):
            raise LineWindowError(
                f"{action}: window class {w.cls!r} is not the main LINE window "
                f"({_LINE_MAIN_CLASS_RE.pattern}).")
        l, t, r, b = w.rect
        width, height = r - l, b - t
        if not (_MIN_W <= width <= _MAX_W and _MIN_H <= height <= _MAX_H):
            raise LineWindowError(
                f"{action}: window size {(width, height)} is outside the calibrated "
                f"range {(_MIN_W, _MIN_H)}..{(_MAX_W, _MAX_H)} — keep LINE maximized.")
        if l < _MIN_LEFT or t < _MIN_TOP:
            raise LineWindowError(
                f"{action}: window is off-screen at {(l, t)} (likely minimized).")

    def _preflight(self, *, focus: bool, action: str) -> WindowInfo:
        """Re-find + validate the main LINE window, optionally focus it, then
        re-validate; updates `self.window` so the target pixel is recomputed from
        the CURRENT rect. `focus=False` is used when a dropdown is open (focusing
        the main window would dismiss it)."""
        w = find_line_window()           # popup-excluded; raises on ambiguity/none
        self._validate_window(w, action)
        self.window = w
        if focus:
            from pywinauto import Application
            Application(backend="uia").connect(handle=w.hwnd).window(handle=w.hwnd).set_focus()
            time.sleep(self.settle)
            w = find_line_window()       # rect may shift on focus/DPI; refresh
            self._validate_window(w, action)
            self.window = w
        return w

    # -- gating -------------------------------------------------------------

    def _gate(self, action: str) -> bool:
        """Decide whether to actually perform `action`, honoring the mode.

        Returns True to proceed, False to skip (dry-run). Raises DriverAborted
        if the operator declines in supervised mode.
        """
        if self.mode == DriverMode.DRY_RUN:
            print(f"[dry-run] would: {action}")
            return False
        if self.mode == DriverMode.SUPERVISED:
            if not self.confirm(f"[supervised] next: {action}\nProceed?"):
                raise DriverAborted(f"Operator declined: {action}")
            return True
        # real
        print(f"[real] {action}")
        return True

    def _guard_clicking(self) -> None:
        if self.mode == DriverMode.DRY_RUN:
            return
        if self.mode == DriverMode.REAL and not self.calibration.calibrated \
                and not self.allow_uncalibrated:
            raise CalibrationError(
                "Calibration profile is not marked calibrated. Pass a verified "
                "--calibration JSON (with \"calibrated\": true), or rerun in "
                "supervised mode, or pass --allow-uncalibrated after checking the "
                "dry-run points."
            )

    # -- primitive actions --------------------------------------------------
    #
    # Every side-effecting primitive runs the per-step preflight (re-find +
    # validate + optional focus + recompute pixel from the CURRENT rect) so a
    # mid-run minimize / DPI rect-flip / popup can never send a click into the
    # void. `focus=False` is for steps that must NOT raise the main window (it
    # would dismiss an open dropdown) — e.g. clicking a menu item in the dropdown.

    def focus(self) -> None:
        if self.mode == DriverMode.DRY_RUN:
            print(f"[dry-run] would: focus LINE main window")
            return
        win = self._preflight(focus=True, action="focus LINE window")
        self._gate(f"focus LINE window (hwnd={win.hwnd})")

    def _click(self, frac: tuple[float, float], desc: str, *, focus: bool = True) -> None:
        if self.mode == DriverMode.DRY_RUN:
            self.window = find_line_window()  # fresh rect for an accurate report
            print(f"[dry-run] would: click {desc} at {self._point(frac)} "
                  f"(window-relative {frac})")
            return
        # Validate (no focus yet) so the confirmation shows the real target pixel.
        self._preflight(focus=False, action=f"click {desc}")
        pt = self._point(frac)
        if not self._gate(f"click {desc} at {pt} (window-relative {frac})"):
            return
        # Re-find + (optionally) focus immediately before acting; recompute pixel
        # from the post-focus rect.
        self._preflight(focus=focus, action=f"click {desc}")
        pt = self._point(frac)
        from pywinauto import mouse
        mouse.click(coords=pt)
        time.sleep(self.settle)

    def _paste(self, text: str, desc: str) -> None:
        # Describe WITHOUT echoing chat content beyond what the operator passed.
        if self.mode == DriverMode.DRY_RUN:
            print(f"[dry-run] would: paste {desc} ({len(text)} chars) via clipboard + Ctrl+V")
            return
        self._preflight(focus=False, action=f"paste {desc}")
        if not self._gate(f"paste {desc} ({len(text)} chars) via clipboard + Ctrl+V"):
            return
        self._preflight(focus=True, action=f"paste {desc}")
        _set_clipboard_text(text)
        from pywinauto import keyboard
        keyboard.send_keys("^a")          # clear any existing query
        keyboard.send_keys("{BACKSPACE}")
        keyboard.send_keys("^v")
        time.sleep(self.settle)

    def _key(self, keys: str, desc: str) -> None:
        if self.mode == DriverMode.DRY_RUN:
            print(f"[dry-run] would: press {desc} ({keys})")
            return
        self._preflight(focus=False, action=f"press {desc}")
        if not self._gate(f"press {desc} ({keys})"):
            return
        self._preflight(focus=True, action=f"press {desc}")
        from pywinauto import keyboard
        keyboard.send_keys(keys)
        time.sleep(self.settle)

    # -- high-level steps ---------------------------------------------------

    def open_search(self) -> None:
        self._click(self.calibration.search_box, "search box")

    def type_chat_name(self, name: str) -> None:
        self._paste(name, "chat name")

    def open_search_result(self) -> None:
        # Click the TOP search-result row to open the chat. We use a calibrated
        # click here, not Enter — Enter-to-open proved unreliable on the opaque
        # Qt list (it often did nothing).
        self._click(self.calibration.search_result, "top search-result row")

    def open_first_result(self) -> None:
        # Legacy Enter-to-open. Kept as a fallback; NOT used by the default flow.
        self._key("{ENTER}", "Enter (open first search result)")

    def open_chat_menu(self) -> None:
        self._click(self.calibration.chat_menu, "chat 3-dot/hamburger (☰) menu")

    def click_save_chat(self) -> None:
        # focus=False: the ☰ dropdown is open; focusing the main window would
        # dismiss it. Preflight still re-validates the main window for coords —
        # the popup is excluded from discovery so this stays unambiguous.
        self._click(self.calibration.save_chat_item,
                    "'Save chat' (บันทึกประวัติแชท) menu item", focus=False)

    # -- orchestration up to (and including) the Save chat click ------------

    def navigate_to_save_chat(self, chat_name: str) -> None:
        """Run search → open chat (click result) → menu → click 'Save chat'.

        Each step re-finds/validates/focuses the window itself (see `_preflight`),
        so there is no separate up-front focus. Stops BEFORE the native Save As
        dialog: that is the caller's hand-off to save_line_chat_from_native_dialog.
        Does nothing side-effecting in dry-run.
        """
        self._guard_clicking()
        self.locate()
        self.open_search()
        self.type_chat_name(chat_name)
        if self.mode != DriverMode.DRY_RUN:
            time.sleep(self.search_settle)  # let results render before clicking
        self.open_search_result()
        self.open_chat_menu()
        self.click_save_chat()


def _set_clipboard_text(text: str) -> None:
    """Put `text` on the clipboard as Unicode (preserves Thai)."""
    import win32clipboard
    import win32con
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        win32clipboard.CloseClipboard()
