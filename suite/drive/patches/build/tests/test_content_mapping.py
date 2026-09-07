"""Pure ticket 28 codecs and mappings."""

import base64
import gzip
import json
import unittest

from suite.drive._core.roles import EDIT, MANAGE, READ
from suite.drive.patches.build.content_mapping import (
    InvalidLegacyContent,
    compact_settings,
    decode_sheets_data,
    derived_name,
    docshare_role,
    epoch_millis,
    sheet_anchor,
    sheet_version_bytes,
)
from suite.drive.patches.build.ports import ContentShareRow


class ContentMappingTest(unittest.TestCase):
    def test_docshare_role_uses_the_content_share_ladder(self):
        rows = (
            (ContentShareRow("a", "Writer Document", "doc", share=1), MANAGE),
            (ContentShareRow("b", "Writer Document", "doc", write=1), EDIT),
            (ContentShareRow("c", "Writer Document", "doc", submit=1), EDIT),
            (ContentShareRow("d", "Writer Document", "doc", read=1), READ),
            (ContentShareRow("e", "Writer Document", "doc"), None),
        )
        for row, expected in rows:
            with self.subTest(row=row.name):
                self.assertEqual(docshare_role(row), expected)

    def test_sheet_payload_preserves_plain_workbook_text_and_key_order(self):
        source = '{"sheets":[{"name":"Δ"}]}'
        expected = json.dumps({"schema": "sheet/1", "sheets_data": source, "head_seq": 42}).encode()
        self.assertEqual(sheet_version_bytes(source, 42), expected)

    def test_sheet_payload_decodes_the_legacy_gzip_envelope(self):
        source = '{"comments":{"Sheet 1":{}}}'
        envelope = json.dumps(
            {"_z": "gzip", "data": base64.b64encode(gzip.compress(source.encode())).decode()}
        )
        self.assertEqual(decode_sheets_data(envelope), source)
        self.assertEqual(json.loads(sheet_version_bytes(envelope, 7))["sheets_data"], source)

    def test_invalid_gzip_and_non_json_snapshots_are_refused(self):
        corrupt = json.dumps({"_z": "gzip", "data": "not-base64!"})
        with self.assertRaisesRegex(InvalidLegacyContent, "invalid gzip"):
            decode_sheets_data(corrupt)
        with self.assertRaisesRegex(InvalidLegacyContent, "not JSON"):
            sheet_version_bytes("plain text", 1)

    def test_sheet_anchor_is_compact_reversible_and_not_normalized(self):
        anchor = sheet_anchor("Résumé", "A/1")
        self.assertEqual(anchor, '["Résumé","A/1"]')
        self.assertEqual(json.loads(anchor), ["Résumé", "A/1"])
        with self.assertRaisesRegex(InvalidLegacyContent, "255"):
            sheet_anchor("x" * 250, "A1")

    def test_derived_names_are_full_stable_sha256_values(self):
        first = derived_name("drive-sheet-thread/1", "sheet", "a/b", "c")
        second = derived_name("drive-sheet-thread/1", "sheet", "a", "b/c")
        self.assertEqual(len(first), 64)
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertNotEqual(first, second)
        self.assertEqual(first, derived_name("drive-sheet-thread/1", "sheet", "a/b", "c"))

    def test_epoch_millis_uses_the_site_timezone(self):
        self.assertEqual(epoch_millis(0, "Asia/Kolkata"), "1970-01-01 05:30:00.000000")
        with self.assertRaises(InvalidLegacyContent):
            epoch_millis(True, "UTC")

    def test_template_settings_keep_only_a_nonblank_keymap(self):
        self.assertEqual(compact_settings("vim"), '{"keymap":"vim"}')
        self.assertEqual(compact_settings("  "), "{}")


if __name__ == "__main__":
    unittest.main()
