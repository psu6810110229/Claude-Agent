"""Focused tests for filename sanitization (stdlib unittest, no pywinauto).

Run:  python -m unittest automation.line_export.test_sanitize
 or:  python automation/line_export/test_sanitize.py
"""

import unittest

from save_dialog import sanitize_filename  # noqa: E402  (run from this dir)


class SanitizeFilenameTests(unittest.TestCase):
    def test_invalid_chars_removed(self):
        self.assertEqual(
            sanitize_filename(r'a\b/c:d*e?f"g<h>i|j'),
            "abcdefghij.txt",
        )

    def test_control_chars_removed(self):
        self.assertEqual(sanitize_filename("hel\x00lo\x1f"), "hello.txt")

    def test_thai_unicode_preserved(self):
        self.assertEqual(
            sanitize_filename("กลุ่มครอบครัว"),
            "กลุ่มครอบครัว.txt",
        )

    def test_thai_with_invalid_char(self):
        # A colon hidden in a Thai group name must go; Thai stays intact.
        self.assertEqual(
            sanitize_filename("งาน: ครอบครัว"),
            "งาน ครอบครัว.txt",
        )

    def test_trailing_dots_and_spaces(self):
        self.assertEqual(sanitize_filename("report...   "), "report.txt")

    def test_empty_result_uses_fallback(self):
        self.assertEqual(sanitize_filename(r'\/:*?"<>|'), "line-chat.txt")
        self.assertEqual(sanitize_filename("   "), "line-chat.txt")

    def test_reserved_names_prefixed(self):
        self.assertEqual(sanitize_filename("CON"), "_CON.txt")
        self.assertEqual(sanitize_filename("nul"), "_nul.txt")
        self.assertEqual(sanitize_filename("COM1"), "_COM1.txt")
        self.assertEqual(sanitize_filename("LPT9"), "_LPT9.txt")

    def test_reserved_name_with_extension(self):
        # "CON.txt" -> stem "CON" is reserved -> "_CON.txt"
        self.assertEqual(sanitize_filename("CON.txt"), "_CON.txt")

    def test_non_reserved_lookalike(self):
        self.assertEqual(sanitize_filename("CONSOLE"), "CONSOLE.txt")
        self.assertEqual(sanitize_filename("COM10"), "COM10.txt")

    def test_existing_txt_extension_not_doubled(self):
        self.assertEqual(sanitize_filename("chat.txt"), "chat.txt")
        self.assertEqual(sanitize_filename("chat.TXT"), "chat.txt")

    def test_excessive_length_truncated(self):
        raw = "ก" * 500
        out = sanitize_filename(raw, max_len=200)
        self.assertEqual(len(out), 200)
        self.assertTrue(out.endswith(".txt"))

    def test_whitespace_runs_collapsed(self):
        self.assertEqual(sanitize_filename("a    b   c"), "a b c.txt")

    def test_tab_stripped_as_control_char(self):
        # Tab (0x09) is a control char, removed before whitespace collapse.
        self.assertEqual(sanitize_filename("a\tb"), "ab.txt")


if __name__ == "__main__":
    unittest.main()
