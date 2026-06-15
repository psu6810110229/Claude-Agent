"""One-chat LINE export CLI: front-half driver + Save As hand-off.

Glues the cautious front-half (`line_desktop_driver`) to the verified tail half
(`save_dialog.save_line_chat_from_native_dialog`). ONE chat per run — no batch.

Usage (run on the dedicated desktop, in this repo root):

    # 1) dry-run / locate — read-only, prints the LINE window rect + click points
    python -m automation.line_export.export_chat --chat-name "..." --mode dry-run

    # 2) supervised — confirms before EVERY real click / keystroke
    python -m automation.line_export.export_chat --chat-name "..." --mode supervised

    # 3) real one-chat — performs the sequence, prints ONLY the saved path
    python -m automation.line_export.export_chat --chat-name "..." --mode real \\
        --calibration my_calibration.json

Flags:
    --chat-name STR     exact chat title to search/open (required for clicking)
    --mode MODE         dry-run (default) | supervised | real
    --export-dir PATH   where the .txt lands (default: LINE_EXPORT_DIR env, else
                        %USERPROFILE%/Documents/LINEExports). Set LINE_EXPORT_DIR
                        so this and the backend connector share one folder.
    --calibration PATH  JSON of window-relative click fractions (see below)
    --allow-uncalibrated  let REAL mode click the unverified default profile
    --list-windows      just print all 'LINE'-titled windows and exit (read-only)
    --yes               skip the one-time real-mode go confirmation

Calibration JSON (window-relative fractions, 0..1 of the LINE window rect):
    {
      "calibrated": true,
      "search_box":     [0.09, 0.065],
      "first_result":   [0.12, 0.18],
      "chat_menu":      [0.965, 0.07],
      "save_chat_item": [0.92, 0.20]
    }

This never reads or prints chat contents, .env, data/, or credentials. LINE is
read-only: it only saves a copy of your own chat history.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .line_desktop_driver import (
    Calibration,
    CalibrationError,
    DriverAborted,
    DriverMode,
    LineDesktopDriver,
    LineWindowError,
    find_line_window,
    list_line_candidates,
)
from .save_dialog import SaveDialogError, default_export_dir, save_line_chat_from_native_dialog


def _configure_logging() -> None:
    # Logs go to STDERR so STDOUT carries only the final saved path in real mode.
    # Reconfigure BOTH streams to UTF-8 so Thai/Unicode chat names and saved
    # paths never crash on the Windows console's default cp1252 codec.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(handler)
    root.setLevel(logging.INFO)


def _load_calibration(path: str | None) -> Calibration:
    if not path:
        return Calibration()
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return Calibration.from_dict(data)


def _print_windows() -> int:
    cands = list_line_candidates()
    if not cands:
        print("No visible window titled 'LINE' found.", file=sys.stderr)
        return 2
    for w in cands:
        print(f"hwnd={w.hwnd} class={w.cls!r} rect={w.rect} size={w.size}",
              file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    p = argparse.ArgumentParser(prog="export_chat", description="Export one LINE chat.")
    p.add_argument("--chat-name", help="Exact chat title to search and open.")
    p.add_argument("--mode", choices=DriverMode.ALL, default=DriverMode.DRY_RUN)
    p.add_argument("--export-dir", default=None)
    p.add_argument("--calibration", default=None)
    p.add_argument("--allow-uncalibrated", action="store_true")
    p.add_argument("--list-windows", action="store_true")
    p.add_argument("--yes", action="store_true",
                   help="Skip the one-time real-mode confirmation.")
    args = p.parse_args(argv)

    if args.list_windows:
        return _print_windows()

    export_dir = Path(args.export_dir) if args.export_dir else default_export_dir()

    try:
        calibration = _load_calibration(args.calibration)
    except (OSError, ValueError, CalibrationError) as exc:
        print(f"Bad --calibration: {exc}", file=sys.stderr)
        return 2

    # Dry-run does not need a chat name to report the window; clicking modes do.
    if args.mode != DriverMode.DRY_RUN and not args.chat_name:
        print("--chat-name is required for supervised/real mode.", file=sys.stderr)
        return 2

    driver = LineDesktopDriver(
        mode=args.mode,
        calibration=calibration,
        allow_uncalibrated=args.allow_uncalibrated,
    )

    try:
        # Always locate + report first (read-only).
        win = driver.locate()
        print(f"LINE window: hwnd={win.hwnd} class={win.cls!r} rect={win.rect} "
              f"size={win.size}", file=sys.stderr)

        if args.mode == DriverMode.DRY_RUN:
            # Show the exact points the clicking modes WOULD use — nothing clicked.
            for name, frac in (
                ("search_box", calibration.search_box),
                ("search_result", calibration.search_result),
                ("chat_menu", calibration.chat_menu),
                ("save_chat_item", calibration.save_chat_item),
            ):
                print(f"[dry-run] {name}: fraction {frac} -> pixel "
                      f"{driver._point(frac)}", file=sys.stderr)
            print(f"[dry-run] calibrated={calibration.calibrated}; export_dir={export_dir}",
                  file=sys.stderr)
            print("[dry-run] no window focused, no clicks, no keystrokes.",
                  file=sys.stderr)
            return 0

        # One-time go gate for REAL mode (supervised confirms each step itself).
        if args.mode == DriverMode.REAL and not args.yes:
            try:
                ans = input(f"About to DRIVE LINE to export chat "
                            f"{args.chat_name!r}. Type GO to proceed: ").strip()
            except EOFError:
                ans = ""
            if ans != "GO":
                print("Aborted (no GO).", file=sys.stderr)
                return 1

        # Front half: focus → search → open → menu → Save chat.
        driver.navigate_to_save_chat(args.chat_name)

        # Tail half: delegate the native Save As dialog to the verified helper.
        saved = save_line_chat_from_native_dialog(export_dir)

        # STDOUT: the saved path ONLY (real mode contract).
        print(str(saved))
        return 0

    except DriverAborted as exc:
        print(f"Aborted: {exc}", file=sys.stderr)
        return 1
    except LineWindowError as exc:
        print(f"LINE window error: {exc}", file=sys.stderr)
        return 2
    except CalibrationError as exc:
        print(f"Calibration error: {exc}", file=sys.stderr)
        return 2
    except SaveDialogError as exc:
        print(f"Save As dialog error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
