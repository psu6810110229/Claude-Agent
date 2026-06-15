"""Batch / priority-refresh runner for the one-chat LINE exporter (Step 20).

A **foreground CLI loop only** — explicitly NOT a Windows service, NOT Task
Scheduler, NOT a background daemon, NOT an auto-start. It reads a small JSON
config of chats + refresh intervals, decides which chats are *due* a fresh
export, and drives them **one at a time** by reusing the existing one-chat
exporter (`export_chat.main`) — it never re-implements any LINE UI automation.

Modes (see `main`):
    --dry-run   Show which chats are due and the planned order. NO LINE actions.
    --once      Export all currently-due chats once, sequentially. Stop on the
                first failure by default (--no-stop-on-failure to continue).
    --watch     Foreground loop: every --poll-seconds, export due chats one at a
                time. A single failure is recorded and the pass backs off to the
                next poll — it does NOT crash the loop.

Safety:
    - Reuses `export_chat` for every real export (Save As stays delegated to
      save_dialog.py; LINE UI stays in line_desktop_driver.py).
    - Real export still requires confirmation per chat: `export_chat` real mode
      asks for `GO` unless `--yes` is passed through here.
    - chat_kind="official" (e.g. ShopeeTH) is **unsupported** — skipped with a
      clear message until a separate calibration profile exists.
    - State file holds ONLY timestamps + status per chat — never message bodies.
    - If LINE is minimized / not found / calibration invalid, the underlying
      exporter stops safely and the failure is recorded.

This module imports `export_chat` LAZILY (inside the real exporter) so the pure
scheduling logic — and its unit tests — load without pywinauto/pywin32 and never
touch LINE.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger("line_export.batch_runner")

# Default minimum pause between two real exports in one pass (seconds).
DEFAULT_PAUSE_SECONDS = 10
DEFAULT_POLL_SECONDS = 60
STATE_FILENAME = ".line-export-state.json"

# Chat-status classifications used for selection + dry-run reporting.
STATUS_DUE = "due"
STATUS_NOT_DUE = "not-due"
STATUS_DISABLED = "disabled"
STATUS_UNSUPPORTED = "unsupported"  # chat_kind=official, no profile yet

SUPPORTED_CHAT_KINDS = ("group", "private")


# ---------------------------------------------------------------------------
# Config model
# ---------------------------------------------------------------------------

class ConfigError(RuntimeError):
    """Raised when the chats config is missing/invalid."""


@dataclass
class ChatSpec:
    name: str                 # human label
    search: str               # substring LINE search can find
    refresh_minutes: float    # how often to refresh
    priority: int = 0         # tie-breaker when many are due (higher first)
    enabled: bool = True
    chat_kind: str = "group"
    calibration: Optional[str] = None  # path to calibration JSON for this chat


@dataclass
class BatchConfig:
    chats: list[ChatSpec] = field(default_factory=list)
    stop_on_failure: bool = True
    min_pause_seconds: float = DEFAULT_PAUSE_SECONDS


def _as_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def parse_config(raw: dict) -> BatchConfig:
    """Build a :class:`BatchConfig` from a parsed JSON dict.

    `defaults` supplies fallbacks (enabled, chat_kind, calibration,
    stop_on_failure, min_pause_seconds) for each entry in `chats`. Raises
    :class:`ConfigError` on a missing/invalid required field.
    """
    if not isinstance(raw, dict):
        raise ConfigError("Config root must be a JSON object.")

    defaults = raw.get("defaults") or {}
    if not isinstance(defaults, dict):
        raise ConfigError("'defaults' must be an object.")

    d_enabled = _as_bool(defaults.get("enabled"), True)
    d_kind = defaults.get("chat_kind", "group")
    d_calibration = defaults.get("calibration")
    stop_on_failure = _as_bool(defaults.get("stop_on_failure"), True)
    try:
        min_pause = float(defaults.get("min_pause_seconds", DEFAULT_PAUSE_SECONDS))
    except (TypeError, ValueError):
        raise ConfigError("'min_pause_seconds' must be a number.")

    chats_raw = raw.get("chats")
    if not isinstance(chats_raw, list) or not chats_raw:
        raise ConfigError("'chats' must be a non-empty array.")

    chats: list[ChatSpec] = []
    seen: set[str] = set()
    for i, entry in enumerate(chats_raw):
        if not isinstance(entry, dict):
            raise ConfigError(f"chats[{i}] must be an object.")
        name = entry.get("name")
        if not name or not isinstance(name, str):
            raise ConfigError(f"chats[{i}] is missing a string 'name'.")
        if name in seen:
            raise ConfigError(f"Duplicate chat name {name!r} in config.")
        seen.add(name)
        search = entry.get("search") or name
        if not isinstance(search, str):
            raise ConfigError(f"chats[{i}] 'search' must be a string.")
        try:
            refresh = float(entry.get("refresh_minutes"))
        except (TypeError, ValueError):
            raise ConfigError(f"chats[{i}] ({name!r}) needs a numeric 'refresh_minutes'.")
        if refresh <= 0:
            raise ConfigError(f"chats[{i}] ({name!r}) 'refresh_minutes' must be > 0.")
        try:
            priority = int(entry.get("priority", 0))
        except (TypeError, ValueError):
            raise ConfigError(f"chats[{i}] ({name!r}) 'priority' must be an integer.")
        chats.append(ChatSpec(
            name=name,
            search=search,
            refresh_minutes=refresh,
            priority=priority,
            enabled=_as_bool(entry.get("enabled"), d_enabled),
            chat_kind=entry.get("chat_kind", d_kind),
            calibration=entry.get("calibration", d_calibration),
        ))

    return BatchConfig(chats=chats, stop_on_failure=stop_on_failure,
                       min_pause_seconds=min_pause)


def load_config(path: str | Path) -> BatchConfig:
    p = Path(path)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"Config not found: {p}") from exc
    except (OSError, ValueError) as exc:
        raise ConfigError(f"Could not read config {p}: {exc}") from exc
    return parse_config(raw)


# ---------------------------------------------------------------------------
# State (timestamps + status only — never message bodies)
# ---------------------------------------------------------------------------

def now_iso(now: Optional[datetime] = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def default_state_path(export_dir: Path) -> Path:
    return Path(export_dir) / STATE_FILENAME


def load_state(path: str | Path) -> dict:
    p = Path(path)
    if not p.exists():
        return {"chats": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("State file %s unreadable; starting fresh.", p)
        return {"chats": {}}
    if not isinstance(data, dict) or not isinstance(data.get("chats"), dict):
        return {"chats": {}}
    return data


def save_state(path: str | Path, state: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def update_state(state: dict, name: str, *, success: bool,
                 now: Optional[datetime] = None,
                 status: Optional[str] = None) -> dict:
    """Record an export attempt for `name`. Mutates and returns `state`.

    Always sets `last_attempt`; sets `last_success` only on success. `status`
    overrides the derived 'succeeded'/'failed' (used for 'skipped'/'unsupported').
    Stores timestamps + status ONLY — never any message content.
    """
    ts = now_iso(now)
    chats = state.setdefault("chats", {})
    entry = chats.setdefault(name, {})
    entry["last_attempt"] = ts
    if success:
        entry["last_success"] = ts
    entry["status"] = status or ("succeeded" if success else "failed")
    return state


# ---------------------------------------------------------------------------
# Due-chat selection + ordering
# ---------------------------------------------------------------------------

def classify(chat: ChatSpec, state: dict,
             now: Optional[datetime] = None) -> str:
    """Return a STATUS_* for `chat` given recorded state and the current time."""
    if not chat.enabled:
        return STATUS_DISABLED
    if chat.chat_kind not in SUPPORTED_CHAT_KINDS:
        return STATUS_UNSUPPORTED
    now_dt = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    entry = state.get("chats", {}).get(chat.name, {})
    last_success = parse_iso(entry.get("last_success"))
    if last_success is None:
        return STATUS_DUE
    elapsed_minutes = (now_dt - last_success).total_seconds() / 60.0
    return STATUS_DUE if elapsed_minutes >= chat.refresh_minutes else STATUS_NOT_DUE


def _order_key(chat: ChatSpec, state: dict):
    """Sort key: highest priority first, then oldest last_success first.

    Never-exported chats (last_success=None) sort oldest (refresh first).
    """
    entry = state.get("chats", {}).get(chat.name, {})
    last_success = parse_iso(entry.get("last_success"))
    last_ts = last_success.timestamp() if last_success else float("-inf")
    return (-chat.priority, last_ts, chat.name)


def select_due_chats(chats: list[ChatSpec], state: dict,
                     now: Optional[datetime] = None,
                     max_chats: Optional[int] = None) -> list[ChatSpec]:
    """Return due chats sorted by (priority desc, oldest last_success first).

    Disabled, not-yet-due, and unsupported (official) chats are excluded.
    `max_chats` caps the returned list length when set.
    """
    due = [c for c in chats if classify(c, state, now) == STATUS_DUE]
    due.sort(key=lambda c: _order_key(c, state))
    if max_chats is not None and max_chats >= 0:
        due = due[:max_chats]
    return due


# ---------------------------------------------------------------------------
# Export (reuses export_chat — imported lazily)
# ---------------------------------------------------------------------------

# Signature: (search, calibration, export_dir, yes) -> bool (True on success).
Exporter = Callable[[str, Optional[str], Optional[str], bool], bool]


def _real_exporter(search: str, calibration: Optional[str],
                   export_dir: Optional[str], yes: bool) -> bool:
    """Drive ONE chat through the existing real-mode exporter. True on success.

    Lazy-imports `export_chat` so importing this module (and the unit tests)
    never pulls in pywinauto/pywin32 or touches LINE.
    """
    try:
        from .export_chat import main as export_chat_main  # type: ignore
    except ImportError:  # pragma: no cover - standalone fallback
        from export_chat import main as export_chat_main  # type: ignore

    argv = ["--chat-name", search, "--mode", "real"]
    if calibration:
        argv += ["--calibration", calibration]
    if export_dir:
        argv += ["--export-dir", export_dir]
    if yes:
        argv.append("--yes")
    code = export_chat_main(argv)
    return code == 0


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------

def _print_plan(chats: list[ChatSpec], state: dict,
                now: Optional[datetime] = None) -> list[ChatSpec]:
    """Print the per-chat classification + the planned due order. Read-only."""
    due = select_due_chats(chats, state, now)
    print("Chat status:", file=sys.stderr)
    for c in chats:
        st = classify(c, state, now)
        entry = state.get("chats", {}).get(c.name, {})
        last = entry.get("last_success", "never")
        print(f"  [{st:<11}] {c.name}  (priority={c.priority}, "
              f"every {c.refresh_minutes}m, last_success={last})", file=sys.stderr)
    if due:
        print("Planned export order (due now):", file=sys.stderr)
        for i, c in enumerate(due, 1):
            print(f"  {i}. {c.name}  (search={c.search!r})", file=sys.stderr)
    else:
        print("No chats are due right now.", file=sys.stderr)
    return due


def run_once(config: BatchConfig, state_path: Path, *, exporter: Exporter,
             export_dir: Optional[str], yes: bool, max_chats: Optional[int],
             pause_seconds: float, now: Optional[datetime] = None) -> int:
    """Export all currently-due chats once, sequentially. One chat at a time.

    Stops on the first failure when `config.stop_on_failure`. Returns 0 if no
    failures, else 1.
    """
    state = load_state(state_path)
    due = select_due_chats(config.chats, state, now, max_chats)
    if not due:
        print("No chats are due right now.", file=sys.stderr)
        return 0

    failures = 0
    for i, chat in enumerate(due):
        if i > 0 and pause_seconds > 0:
            logger.info("Pausing %.0fs before next export…", pause_seconds)
            time.sleep(pause_seconds)
        ok = _export_and_record(chat, state, state_path, exporter=exporter,
                                export_dir=export_dir, yes=yes)
        if not ok:
            failures += 1
            if config.stop_on_failure:
                logger.error("Stopping --once after failure on %r "
                             "(stop_on_failure).", chat.name)
                break
    return 0 if failures == 0 else 1


def run_watch(config: BatchConfig, state_path: Path, *, exporter: Exporter,
              export_dir: Optional[str], yes: bool, max_chats: Optional[int],
              pause_seconds: float, poll_seconds: float) -> int:
    """Foreground loop. Each poll, export due chats one at a time.

    A single export failure is recorded and ends the current pass (backoff to
    the next poll); it never crashes the loop. Ctrl+C exits cleanly.
    """
    logger.info("Watch loop started: poll every %.0fs, min pause %.0fs. "
                "Ctrl+C to stop.", poll_seconds, pause_seconds)
    try:
        while True:
            state = load_state(state_path)
            due = select_due_chats(config.chats, state, None, max_chats)
            if due:
                logger.info("%d chat(s) due this pass.", len(due))
            for i, chat in enumerate(due):
                if i > 0 and pause_seconds > 0:
                    time.sleep(pause_seconds)
                ok = _export_and_record(chat, state, state_path,
                                        exporter=exporter, export_dir=export_dir,
                                        yes=yes)
                if not ok:
                    logger.warning("Export failed for %r; backing off to next "
                                   "poll.", chat.name)
                    break
            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        logger.info("Watch loop stopped by user.")
        return 0


def _export_and_record(chat: ChatSpec, state: dict, state_path: Path, *,
                       exporter: Exporter, export_dir: Optional[str],
                       yes: bool) -> bool:
    """Export one chat through `exporter`, persist its state, return success.

    Never raises on an export failure — records and reports it. Official chats
    are recorded as 'unsupported' without an export attempt.
    """
    if chat.chat_kind not in SUPPORTED_CHAT_KINDS:
        logger.warning("Skipping %r: chat_kind=%r is unsupported (needs a "
                       "separate calibration profile).", chat.name, chat.chat_kind)
        update_state(state, chat.name, success=False, status=STATUS_UNSUPPORTED)
        save_state(state_path, state)
        return False

    logger.info("Exporting %r (search=%r)…", chat.name, chat.search)
    try:
        ok = exporter(chat.search, chat.calibration, export_dir, yes)
    except Exception as exc:  # never crash the batch on one chat
        logger.error("Exporter raised for %r: %s", chat.name, exc)
        ok = False
    update_state(state, chat.name, success=ok)
    save_state(state_path, state)
    if ok:
        logger.info("Exported %r OK.", chat.name)
    else:
        logger.error("Export FAILED for %r.", chat.name)
    return ok


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _configure_logging() -> None:
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


def _resolve_export_dir(arg: Optional[str]) -> Path:
    if arg:
        return Path(arg)
    # Reuse the exporter's resolution (LINE_EXPORT_DIR env, else Documents).
    try:
        from .save_dialog import default_export_dir  # type: ignore
    except ImportError:  # pragma: no cover - standalone fallback
        from save_dialog import default_export_dir  # type: ignore
    return default_export_dir()


def main(argv: Optional[list[str]] = None, *,
         exporter: Optional[Exporter] = None) -> int:
    _configure_logging()
    p = argparse.ArgumentParser(
        prog="batch_runner",
        description="Foreground batch/priority-refresh runner for LINE export.")
    p.add_argument("--config", required=True, help="Path to chats JSON config.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true",
                      help="Export all due chats once, sequentially, then exit.")
    mode.add_argument("--watch", action="store_true",
                      help="Foreground loop: export due chats every --poll-seconds.")
    mode.add_argument("--dry-run", action="store_true",
                      help="Show due chats + planned order. No LINE actions.")
    p.add_argument("--poll-seconds", type=float, default=DEFAULT_POLL_SECONDS,
                   help=f"Watch poll interval (default {DEFAULT_POLL_SECONDS}).")
    p.add_argument("--pause-seconds", type=float, default=None,
                   help="Min pause between exports in a pass (default "
                        f"{DEFAULT_PAUSE_SECONDS}; overrides config).")
    p.add_argument("--max-chats", type=int, default=None,
                   help="Limit number of due chats exported in one pass.")
    p.add_argument("--state", default=None,
                   help="State file path (default <export-dir>/"
                        f"{STATE_FILENAME}).")
    p.add_argument("--export-dir", default=None,
                   help="Export dir (default LINE_EXPORT_DIR env, else Documents).")
    p.add_argument("--yes", action="store_true",
                   help="Pass --yes through to export_chat (skip per-chat GO "
                        "prompt). Omit to confirm each real export.")
    p.add_argument("--no-stop-on-failure", action="store_true",
                   help="In --once, continue after a failed export.")
    args = p.parse_args(argv)

    if not (args.once or args.watch or args.dry_run):
        print("Choose a mode: --dry-run, --once, or --watch.", file=sys.stderr)
        return 2

    try:
        config = load_config(args.config)
    except ConfigError as exc:
        print(f"Config error: {exc}", file=sys.stderr)
        return 2

    if args.no_stop_on_failure:
        config.stop_on_failure = False

    export_dir = _resolve_export_dir(args.export_dir)
    state_path = Path(args.state) if args.state else default_state_path(export_dir)
    pause_seconds = (args.pause_seconds if args.pause_seconds is not None
                     else config.min_pause_seconds)
    exporter = exporter or _real_exporter

    if args.dry_run:
        state = load_state(state_path)
        _print_plan(config.chats, state)
        print(f"[dry-run] export_dir={export_dir}", file=sys.stderr)
        print(f"[dry-run] state_file={state_path}", file=sys.stderr)
        print("[dry-run] no LINE actions, no state writes.", file=sys.stderr)
        return 0

    if args.once:
        return run_once(config, state_path, exporter=exporter,
                        export_dir=str(export_dir), yes=args.yes,
                        max_chats=args.max_chats, pause_seconds=pause_seconds)

    # --watch
    return run_watch(config, state_path, exporter=exporter,
                     export_dir=str(export_dir), yes=args.yes,
                     max_chats=args.max_chats, pause_seconds=pause_seconds,
                     poll_seconds=args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
