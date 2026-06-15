"""Focused tests for the LINE export batch runner (stdlib unittest).

NO live LINE automation: a stub exporter replaces the real one, and the pure
scheduling logic (config parse, due selection, ordering, state) is tested
directly. pywinauto/pywin32 are never imported.

Run from the repo root:
    python -m unittest automation.line_export.test_batch_runner
Or from this dir:
    python -m unittest test_batch_runner
"""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:  # package context (python -m unittest automation.line_export.test_batch_runner)
    from automation.line_export import batch_runner as br
except ImportError:  # standalone context (run from this dir)
    import batch_runner as br  # type: ignore


NOW = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _base_config() -> dict:
    return {
        "defaults": {"enabled": True, "chat_kind": "group",
                     "calibration": "cal.json", "stop_on_failure": True},
        "chats": [
            {"name": "A", "search": "A", "refresh_minutes": 15, "priority": 100},
            {"name": "B", "search": "B", "refresh_minutes": 30, "priority": 80},
            {"name": "C", "search": "C", "refresh_minutes": 180, "priority": 40},
        ],
    }


class ConfigParsingTests(unittest.TestCase):
    def test_parses_chats_and_defaults(self):
        cfg = br.parse_config(_base_config())
        self.assertEqual([c.name for c in cfg.chats], ["A", "B", "C"])
        self.assertTrue(cfg.stop_on_failure)
        self.assertEqual(cfg.chats[0].calibration, "cal.json")  # inherited default
        self.assertEqual(cfg.chats[0].chat_kind, "group")

    def test_search_defaults_to_name(self):
        raw = {"chats": [{"name": "X", "refresh_minutes": 10}]}
        cfg = br.parse_config(raw)
        self.assertEqual(cfg.chats[0].search, "X")

    def test_per_chat_overrides_default_enabled(self):
        raw = _base_config()
        raw["chats"][1]["enabled"] = False
        cfg = br.parse_config(raw)
        self.assertFalse(cfg.chats[1].enabled)
        self.assertTrue(cfg.chats[0].enabled)

    def test_missing_name_raises(self):
        with self.assertRaises(br.ConfigError):
            br.parse_config({"chats": [{"refresh_minutes": 10}]})

    def test_bad_refresh_raises(self):
        with self.assertRaises(br.ConfigError):
            br.parse_config({"chats": [{"name": "X", "refresh_minutes": 0}]})
        with self.assertRaises(br.ConfigError):
            br.parse_config({"chats": [{"name": "X", "refresh_minutes": "soon"}]})

    def test_duplicate_name_raises(self):
        raw = {"chats": [{"name": "X", "refresh_minutes": 10},
                         {"name": "X", "refresh_minutes": 20}]}
        with self.assertRaises(br.ConfigError):
            br.parse_config(raw)

    def test_empty_chats_raises(self):
        with self.assertRaises(br.ConfigError):
            br.parse_config({"chats": []})

    def test_load_config_from_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "chats.json"
            p.write_text(json.dumps(_base_config()), encoding="utf-8")
            cfg = br.load_config(p)
            self.assertEqual(len(cfg.chats), 3)


class DueSelectionTests(unittest.TestCase):
    def test_never_exported_is_due(self):
        cfg = br.parse_config(_base_config())
        due = br.select_due_chats(cfg.chats, {"chats": {}}, NOW)
        self.assertEqual([c.name for c in due], ["A", "B", "C"])  # all due, by priority

    def test_recent_success_not_due(self):
        cfg = br.parse_config(_base_config())
        state = {"chats": {"A": {"last_success": _iso(NOW - timedelta(minutes=5))}}}
        due = br.select_due_chats(cfg.chats, state, NOW)
        self.assertNotIn("A", [c.name for c in due])  # 5m < 15m refresh
        self.assertIn("B", [c.name for c in due])

    def test_elapsed_past_refresh_is_due(self):
        cfg = br.parse_config(_base_config())
        state = {"chats": {"A": {"last_success": _iso(NOW - timedelta(minutes=20))}}}
        due = br.select_due_chats(cfg.chats, state, NOW)
        self.assertIn("A", [c.name for c in due])  # 20m >= 15m refresh

    def test_disabled_chat_skipped(self):
        raw = _base_config()
        raw["chats"][0]["enabled"] = False
        cfg = br.parse_config(raw)
        due = br.select_due_chats(cfg.chats, {"chats": {}}, NOW)
        self.assertNotIn("A", [c.name for c in due])
        self.assertEqual(br.classify(cfg.chats[0], {"chats": {}}, NOW),
                         br.STATUS_DISABLED)

    def test_official_chat_unsupported_and_skipped(self):
        raw = _base_config()
        raw["chats"][0]["chat_kind"] = "official"
        cfg = br.parse_config(raw)
        self.assertEqual(br.classify(cfg.chats[0], {"chats": {}}, NOW),
                         br.STATUS_UNSUPPORTED)
        due = br.select_due_chats(cfg.chats, {"chats": {}}, NOW)
        self.assertNotIn("A", [c.name for c in due])

    def test_max_chats_caps_selection(self):
        cfg = br.parse_config(_base_config())
        due = br.select_due_chats(cfg.chats, {"chats": {}}, NOW, max_chats=2)
        self.assertEqual(len(due), 2)


class OrderingTests(unittest.TestCase):
    def test_priority_desc_then_oldest_success(self):
        cfg = br.parse_config(_base_config())
        due = br.select_due_chats(cfg.chats, {"chats": {}}, NOW)
        self.assertEqual([c.name for c in due], ["A", "B", "C"])  # 100, 80, 40

    def test_same_priority_oldest_first(self):
        raw = {"chats": [
            {"name": "P", "search": "P", "refresh_minutes": 10, "priority": 50},
            {"name": "Q", "search": "Q", "refresh_minutes": 10, "priority": 50},
        ]}
        cfg = br.parse_config(raw)
        # Both due; P refreshed more recently than Q => Q (older) sorts first.
        state = {"chats": {
            "P": {"last_success": _iso(NOW - timedelta(hours=1))},
            "Q": {"last_success": _iso(NOW - timedelta(hours=5))},
        }}
        due = br.select_due_chats(cfg.chats, state, NOW)
        self.assertEqual([c.name for c in due], ["Q", "P"])

    def test_never_exported_sorts_before_previously_exported(self):
        raw = {"chats": [
            {"name": "P", "search": "P", "refresh_minutes": 10, "priority": 50},
            {"name": "Q", "search": "Q", "refresh_minutes": 10, "priority": 50},
        ]}
        cfg = br.parse_config(raw)
        state = {"chats": {"P": {"last_success": _iso(NOW - timedelta(hours=1))}}}
        due = br.select_due_chats(cfg.chats, state, NOW)
        self.assertEqual([c.name for c in due], ["Q", "P"])  # Q never run => oldest


class StateUpdateTests(unittest.TestCase):
    def test_success_sets_last_success_and_attempt(self):
        state = {"chats": {}}
        br.update_state(state, "A", success=True, now=NOW)
        e = state["chats"]["A"]
        self.assertEqual(e["last_success"], _iso(NOW))
        self.assertEqual(e["last_attempt"], _iso(NOW))
        self.assertEqual(e["status"], "succeeded")

    def test_failure_sets_attempt_not_success(self):
        state = {"chats": {"A": {"last_success": _iso(NOW - timedelta(hours=2))}}}
        later = NOW
        br.update_state(state, "A", success=False, now=later)
        e = state["chats"]["A"]
        self.assertEqual(e["last_attempt"], _iso(later))
        self.assertEqual(e["last_success"], _iso(NOW - timedelta(hours=2)))  # unchanged
        self.assertEqual(e["status"], "failed")

    def test_custom_status(self):
        state = {"chats": {}}
        br.update_state(state, "A", success=False, now=NOW,
                        status=br.STATUS_UNSUPPORTED)
        self.assertEqual(state["chats"]["A"]["status"], br.STATUS_UNSUPPORTED)

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / br.STATE_FILENAME
            state = {"chats": {}}
            br.update_state(state, "ก-ไทย", success=True, now=NOW)
            br.save_state(p, state)
            loaded = br.load_state(p)
            self.assertEqual(loaded["chats"]["ก-ไทย"]["status"], "succeeded")

    def test_load_missing_state_is_empty(self):
        with tempfile.TemporaryDirectory() as d:
            loaded = br.load_state(Path(d) / "nope.json")
            self.assertEqual(loaded, {"chats": {}})


class RunOnceTests(unittest.TestCase):
    def test_once_exports_due_and_records(self):
        cfg = br.parse_config(_base_config())
        calls = []

        def stub(search, calibration, export_dir, yes):
            calls.append(search)
            return True

        with tempfile.TemporaryDirectory() as d:
            sp = Path(d) / br.STATE_FILENAME
            rc = br.run_once(cfg, sp, exporter=stub, export_dir=d, yes=True,
                             max_chats=None, pause_seconds=0, now=NOW)
            self.assertEqual(rc, 0)
            self.assertEqual(calls, ["A", "B", "C"])  # priority order
            state = br.load_state(sp)
            self.assertEqual(state["chats"]["A"]["status"], "succeeded")

    def test_once_stops_on_first_failure(self):
        cfg = br.parse_config(_base_config())
        calls = []

        def stub(search, calibration, export_dir, yes):
            calls.append(search)
            return search != "A"  # first (highest priority) fails

        with tempfile.TemporaryDirectory() as d:
            sp = Path(d) / br.STATE_FILENAME
            rc = br.run_once(cfg, sp, exporter=stub, export_dir=d, yes=True,
                             max_chats=None, pause_seconds=0, now=NOW)
            self.assertEqual(rc, 1)
            self.assertEqual(calls, ["A"])  # stopped after first failure
            self.assertEqual(br.load_state(sp)["chats"]["A"]["status"], "failed")

    def test_once_continues_when_stop_disabled(self):
        cfg = br.parse_config(_base_config())
        cfg.stop_on_failure = False
        calls = []

        def stub(search, calibration, export_dir, yes):
            calls.append(search)
            return search != "A"

        with tempfile.TemporaryDirectory() as d:
            sp = Path(d) / br.STATE_FILENAME
            rc = br.run_once(cfg, sp, exporter=stub, export_dir=d, yes=True,
                             max_chats=None, pause_seconds=0, now=NOW)
            self.assertEqual(rc, 1)  # had a failure
            self.assertEqual(calls, ["A", "B", "C"])  # but kept going

    def test_once_official_chat_recorded_unsupported(self):
        raw = _base_config()
        raw["chats"][0]["chat_kind"] = "official"
        cfg = br.parse_config(raw)
        calls = []

        def stub(search, calibration, export_dir, yes):
            calls.append(search)
            return True

        with tempfile.TemporaryDirectory() as d:
            sp = Path(d) / br.STATE_FILENAME
            rc = br.run_once(cfg, sp, exporter=stub, export_dir=d, yes=True,
                             max_chats=None, pause_seconds=0, now=NOW)
            self.assertEqual(rc, 0)
            self.assertNotIn("A", calls)  # official never exported


if __name__ == "__main__":
    unittest.main()
