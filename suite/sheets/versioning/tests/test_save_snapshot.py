# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Inline versioning from `save_sheet`.

A save takes a `Drive Node Version` inline, so version history is always
present with no background worker, but rapid saves cluster: a version younger
than `AUTO_VERSION_SECS` means this save takes none. A failure in the version
step never fails the save itself, because the ops are already persisted and
data loss is the worst outcome on this path.

No database. Every Frappe and Drive interaction is stubbed, so each case
states what the newest version looks like and asserts what the save does.
"""

from __future__ import annotations

import datetime
import unittest
from unittest import mock

from frappe.utils import now_datetime

from suite.sheets.versioning import save as save_mod


def _save(newest_age_secs: float | None, take_version_side_effect=None, **kwargs):
    """Run `save_sheet` with every DB / Frappe / Drive interaction stubbed out.

    `newest_age_secs` is how old the newest Drive version is, or `None` for a
    sheet with no version yet. Returns the result, the `drive` stub and the
    `frappe` stub.
    """
    rows = []
    if newest_age_secs is not None:
        creation = now_datetime() - datetime.timedelta(seconds=newest_age_secs)
        rows = [{"seq": 3, "creation": creation}]
    with (
        mock.patch.object(save_mod, "frappe") as patched,
        mock.patch.object(save_mod, "drive") as drive,
        mock.patch.object(save_mod, "node_of", return_value="NODE-1"),
        mock.patch.object(save_mod, "require_sheet") as require_sheet,
        mock.patch.object(save_mod, "_append_ops_and_save", return_value=7) as append,
        mock.patch.object(save_mod, "encode_sheets_data", return_value="ENCODED"),
        mock.patch.object(save_mod, "_validate_payload", return_value='{"A1":1}'),
    ):
        patched.conf.get.return_value = None
        patched.db.get_value.return_value = None
        patched.throw.side_effect = RuntimeError("thrown")
        drive.list_versions.return_value = {"rows": rows, "next_cursor": None}
        drive.take_version.side_effect = take_version_side_effect
        arguments = {"name": "sheet_x", "sheets_data": '{"A1":1}'}
        arguments.update(kwargs)
        out = save_mod.save_sheet(**arguments)
    patched.require_sheet = require_sheet
    patched.append = append
    return out, drive, patched


class InlineVersionFromSave(unittest.TestCase):
    def test_the_first_save_takes_a_version(self):
        out, drive, _ = _save(newest_age_secs=None)
        self.assertEqual(out, {"name": "sheet_x", "head_seq": 7})
        drive.take_version.assert_called_once_with("NODE-1", kind="auto")

    def test_a_save_after_a_quiet_spell_takes_a_version(self):
        _, drive, _ = _save(newest_age_secs=save_mod.AUTO_VERSION_SECS + 5)
        drive.take_version.assert_called_once_with("NODE-1", kind="auto")

    def test_rapid_saves_cluster_into_the_newest_version(self):
        _, drive, _ = _save(newest_age_secs=1)
        drive.take_version.assert_not_called()

    def test_a_version_failure_does_not_fail_the_save(self):
        # Ops are already persisted before the version is taken, so a failure
        # here must not propagate: the request would 500 and the client would
        # think the save was lost, when only this round's version is missing.
        out, _, patched = _save(newest_age_secs=None, take_version_side_effect=RuntimeError("disk full"))
        self.assertEqual(out["head_seq"], 7)
        patched.log_error.assert_called_once()
        self.assertIn("version", patched.log_error.call_args.kwargs["title"])


class SaveGuards(unittest.TestCase):
    def test_a_save_without_a_name_is_refused_before_anything_is_written(self):
        # A sheet is created through Drive, never by saving a body with no name.
        with self.assertRaises(RuntimeError):
            _save(newest_age_secs=None, name="")

    def test_the_write_check_runs_before_the_body_is_touched(self):
        _, _, patched = _save(newest_age_secs=None)
        patched.require_sheet.assert_called_once_with("sheet_x", write=True)

    def test_a_completed_request_answers_its_seq_without_saving_again(self):
        with mock.patch.object(save_mod, "frappe") as patched:
            patched.db.get_value.return_value = 12
            with (
                mock.patch.object(save_mod, "require_sheet"),
                mock.patch.object(save_mod, "_append_ops_and_save") as append,
                mock.patch.object(save_mod, "drive") as drive,
            ):
                result = save_mod.save_sheet("sheet_x", '{"A1":1}', request_id="request-1")

        self.assertEqual(result, {"name": "sheet_x", "head_seq": 12})
        append.assert_not_called()
        drive.take_version.assert_not_called()


if __name__ == "__main__":
    unittest.main()
