"""Pure ticket 28 codecs and mappings."""

import base64
import gzip
import json
import unicodedata
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

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
        # §14.5: `share` and `write` is MANAGE, `write` is EDIT, `read` only
        # is READ, and `share` without `write` leaves the highest content
        # flag to win. `submit` is not on the ladder.
        rows = (
            (ContentShareRow("a", "Writer Document", "doc", share=1, write=1), MANAGE),
            (ContentShareRow("b", "Writer Document", "doc", write=1), EDIT),
            (ContentShareRow("c", "Writer Document", "doc", share=1, read=1), READ),
            (ContentShareRow("d", "Writer Document", "doc", read=1), READ),
            (ContentShareRow("e", "Writer Document", "doc"), None),
            (ContentShareRow("f", "Writer Document", "doc", share=1), None),
            (ContentShareRow("g", "Writer Document", "doc", submit=1, read=1), READ),
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

    def test_sheet_anchor_is_compact_and_reversible(self):
        anchor = sheet_anchor("Résumé", "A/1")
        self.assertEqual(anchor, '["Résumé","A/1"]')
        self.assertEqual(json.loads(anchor), ["Résumé", "A/1"])

    def test_sheet_anchor_keeps_a_decomposed_sheet_name_decomposed(self):
        # The literal below is NFD. Normalising it would rewrite the stored
        # anchor, and §9 forbids applying any Unicode normalisation: the
        # round trip has to return the exact source strings.
        decomposed = "Re\u0301sume\u0301"
        self.assertFalse(unicodedata.is_normalized("NFC", decomposed))
        self.assertEqual(json.loads(sheet_anchor(decomposed, "A1"))[0], decomposed)

    def test_the_sheet_anchor_bound_is_the_exact_column_width(self):
        # `Drive Comment Thread.anchor` is varchar(255), so 255 fits and 256
        # does not. The encoding adds seven characters to the two values.
        self.assertEqual(len(sheet_anchor("x" * 246, "A1")), 255)
        with self.assertRaisesRegex(InvalidLegacyContent, "255"):
            sheet_anchor("x" * 247, "A1")

    def test_derived_names_are_full_stable_sha256_values(self):
        first = derived_name("drive-sheet-thread/1", "sheet", "a/b", "c")
        second = derived_name("drive-sheet-thread/1", "sheet", "a", "b/c")
        self.assertEqual(len(first), 64)
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertNotEqual(first, second)
        self.assertEqual(first, derived_name("drive-sheet-thread/1", "sheet", "a/b", "c"))

    def test_the_frozen_id_domains_and_material_are_pinned_to_literals(self):
        # These two ids are the identity of every migrated Sheet comment. A
        # changed domain, part order, or separator re-ids the whole corpus, and
        # the next run would insert a duplicate set instead of validating the
        # stored one. Recomputing them with `derived_name` would pin nothing.
        thread = derived_name("drive-sheet-thread/1", "SH-1", "Sheet 1", "A1")
        self.assertEqual(thread, "00c4e2c344f3e28e61ae6fd9dac42a167abfcdc9e46345a740bcc70edc77da3d")
        self.assertEqual(
            derived_name("drive-sheet-comment/1", "0" * 64, 0),
            "c8f5f1b9227c0b02846b9d666b86262b8b783d3c1425219dab871817821ef625",
        )

    def test_epoch_millis_uses_the_site_timezone(self):
        # Neither zone may be the host's, or a host-local `fromtimestamp` would
        # pass here and shift every migrated comment on a differently
        # configured runner.
        host = datetime.now().astimezone().utcoffset()
        for timezone, expected in (
            ("UTC", "1970-01-01 00:00:00.000000"),
            ("America/New_York", "1969-12-31 19:00:00.000000"),
        ):
            with self.subTest(timezone=timezone):
                self.assertNotEqual(host, ZoneInfo(timezone).utcoffset(datetime(1970, 1, 1)))
                self.assertEqual(epoch_millis(0, timezone), expected)
        with self.assertRaises(InvalidLegacyContent):
            epoch_millis(True, "UTC")

    def test_template_settings_keep_only_a_nonblank_keymap(self):
        self.assertEqual(compact_settings("vim"), '{"keymap":"vim"}')
        self.assertEqual(compact_settings("  "), "{}")


if __name__ == "__main__":
    unittest.main()
