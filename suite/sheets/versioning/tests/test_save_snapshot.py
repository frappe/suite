# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""Tests for inline snapshot creation from `save_sheet`.

The legacy flow enqueued `maybe_snapshot` on the worker; if the worker
wasn't running the user saw an empty Version History panel. The Google
Sheets-style behaviour we now ship is:

  * snapshot inline so version history is always present,
  * but swallow snapshot errors so a transient snapshot failure never
    fails the save itself (data loss is the worst sin in this code path).

Both invariants are pinned here so a future refactor can't silently
regress.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from suite.sheets.versioning import save as save_mod


def _patched_save_sheet(maybe_snapshot_side_effect=None, enqueue_should_fail=False):
    """Drive `save_sheet` with every DB / Frappe interaction stubbed out.

    Returns the dict result + the maybe_snapshot mock for assertion.
    """
    maybe_mock = mock.Mock(side_effect=maybe_snapshot_side_effect)
    with (
        mock.patch.object(save_mod, "snapshots_mod") as snap_mod,
        mock.patch.object(save_mod, "_update_existing", return_value=("sheet_x", 7)),
        mock.patch.object(save_mod, "encode_sheets_data", return_value="ENCODED"),
        mock.patch.object(save_mod, "_validate_payload", return_value='{"A1":1}'),
        mock.patch.object(save_mod.frappe, "log_error") as log_error,
        mock.patch.object(save_mod.frappe, "get_traceback", return_value="trace"),
        mock.patch.object(save_mod.frappe, "enqueue") as enqueue_mock,
    ):
        snap_mod.maybe_snapshot = maybe_mock
        if enqueue_should_fail:
            enqueue_mock.side_effect = AssertionError("save_sheet must not enqueue")
        out = save_mod.save_sheet(
            title="My Sheet",
            sheets_data='{"A1":1}',
            name="sheet_x",
            ops=None,
        )
    return out, maybe_mock, log_error


class InlineSnapshotFromSave(unittest.TestCase):
    def test_save_sheet_calls_maybe_snapshot_inline(self):
        out, maybe_mock, _ = _patched_save_sheet()
        # Inline, not enqueued — the worker is no longer in the critical path.
        self.assertEqual(out, {"name": "sheet_x", "head_seq": 7})
        maybe_mock.assert_called_once_with("sheet_x", expected_head_seq=7)

    def test_save_sheet_never_enqueues(self):
        # Hard assertion that we never silently fall back to the old async
        # path — `enqueue_should_fail=True` blows up if `frappe.enqueue` is
        # touched during the save.
        out, _, _ = _patched_save_sheet(enqueue_should_fail=True)
        self.assertEqual(out["head_seq"], 7)

    def test_snapshot_failure_does_not_fail_the_save(self):
        # Ops are already persisted before maybe_snapshot runs; a failure
        # here must NOT propagate (otherwise the request 500s and the
        # client thinks the save was lost — data is fine, just no
        # snapshot for this round).
        out, _, log_error = _patched_save_sheet(
            maybe_snapshot_side_effect=RuntimeError("disk full"),
        )
        self.assertEqual(out["head_seq"], 7)
        log_error.assert_called_once()
        # The error message should make it obvious this is a snapshot
        # failure (not a save failure) when ops triage finds it.
        self.assertIn("maybe_snapshot", log_error.call_args.kwargs["title"])


class IdempotentSave(unittest.TestCase):
    def test_completed_request_returns_existing_sequence_without_saving_again(self):
        with (
            mock.patch.object(save_mod.frappe, "has_permission") as has_permission,
            mock.patch.object(save_mod.frappe.db, "get_value", return_value=12),
            mock.patch.object(save_mod, "_update_existing") as update_existing,
        ):
            result = save_mod.save_sheet(
                title="My Sheet",
                sheets_data='{"A1":1}',
                name="sheet_x",
                request_id="request-1",
            )

        self.assertEqual(result, {"name": "sheet_x", "head_seq": 12})
        has_permission.assert_called_once_with("Sheet", doc="sheet_x", ptype="write", throw=True)
        update_existing.assert_not_called()


if __name__ == "__main__":
    unittest.main()
