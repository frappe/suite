import json
import uuid
from datetime import timedelta
from http import HTTPStatus
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils import now_datetime

from suite import drive
from suite.composition import content as routes
from suite.writer.content.tests.support import (
    CheckpointCase,
    answer,
    call_route,
    push_body,
    read_frame,
    read_open,
)


class TestRestoreFence(CheckpointCase):
    """A restore holds the document still, after a version of what it held."""

    def setUp(self):
        super().setUp()
        self.node = self.new_document()
        self.type_into(self.node, ["one", " two"])

    def begin(self, version: int = 1, seen_rev: int | None = None):
        head = int(self.doc_row(self.node).head_rev)
        body = json.dumps({"seen_rev": head if seen_rev is None else seen_rev, "version": version})
        response = call_route(routes.restore_post, self.node, body=body.encode())
        return response.status_code, answer(response)

    def cancel(self, token: str):
        body = json.dumps({"token": token}).encode()
        return call_route(routes.restore_cancel_post, self.node, body=body).status_code

    def milestones(self) -> list[str]:
        rows = drive.list_versions(self.node)["rows"]
        return [row["label"] for row in rows if row["kind"] == "milestone"]

    def test_a_restore_begins_at_the_head_and_holds_every_other_push(self):
        status, fence = self.begin()

        self.assertEqual(
            (status, fence["base_rev"], len(fence["token"]), fence["fence_ms"]), (200, 2, 32, 120_000)
        )
        self.assertEqual(self.refused_push(), (423, {"collab": "paused", "reason": "restoring"}))

    def test_a_version_of_the_head_is_taken_first_and_once_while_nothing_changes(self):
        _status, fence = self.begin(version=3)
        self.cancel(fence["token"])
        self.begin(version=3)

        self.assertEqual(self.milestones(), ["Before restoring version 3"])

    def test_an_edit_since_the_last_one_takes_a_new_version(self):
        _status, fence = self.begin(version=3)
        self.cancel(fence["token"])
        self.type_into(self.node, [" three"])
        self.begin(version=4)

        self.assertEqual(self.milestones(), ["Before restoring version 4", "Before restoring version 3"])

    def test_a_tab_missing_rows_is_sent_to_pull_first(self):
        self.assertEqual(self.begin(seen_rev=1), (409, {"collab": "behind", "head": 2}))
        self.assertEqual(self.refused_push(), None)

    def test_a_second_restore_waits_for_the_first(self):
        self.begin()

        self.assertEqual(self.begin(), (409, {"collab": "restoring"}))

    def test_a_cancelled_restore_lets_edits_in_again(self):
        _status, fence = self.begin()

        self.assertEqual(self.cancel(fence["token"]), 200)
        self.assertEqual(self.refused_push(), None)
        self.assertEqual(self.doc_row(self.node).mode, "active")

    def test_a_restore_nobody_finishes_lapses_at_its_deadline(self):
        self.begin()
        self.set_doc(self.node, restore_deadline=now_datetime() - timedelta(seconds=1))

        pushed = self.refused_push()
        status, _fence = self.begin()

        self.assertEqual((pushed, status), (None, 200))

    def test_a_restore_within_a_minute_of_the_last_says_how_long_to_wait(self):
        self.set_doc(self.node, restored_at=now_datetime() - timedelta(seconds=15))
        status, refusal = self.begin()

        self.assertEqual((status, refusal["collab"]), (409, "restore_recent"))
        self.assertIn(refusal["retry_s"], (44, 45, 46))
        self.set_doc(self.node, restored_at=now_datetime() - timedelta(seconds=61))
        status, _fence = self.begin()
        self.assertEqual(status, 200)

    def test_no_restore_begins_when_the_version_before_it_cant_be_taken(self):
        refused = drive.DriveOverQuota("The drive is full")
        with patch.object(drive, "take_version", side_effect=refused):
            status, refusal = self.begin()

        self.assertEqual((status, refusal["collab"]), (409, "milestone_failed"))
        self.assertEqual((self.doc_row(self.node).mode, self.milestones()), ("active", []))
        self.assertEqual(self.refused_push(), None)

    def test_the_restore_lands_as_the_next_rev_and_lifts_the_fence(self):
        restoring = self.open_tab()
        _status, fence = self.begin()

        status, landed = self.push_word(restoring, "old ", restore=fence["token"])
        row = self.doc_row(self.node)

        self.assertEqual((status, landed["rev"]), (200, 3))
        self.assertEqual((row.mode, row.restore_rev, row.restore_token), ("active", 3, None))
        self.assertEqual(self.refused_push(), None)
        self.assertEqual(str(self.open_tab().doc.get("default", type=pycrdt.XmlFragment)), "lateold one two")

    def test_work_made_before_the_restore_is_refused_for_good(self):
        earlier = self.open_tab()
        restoring = self.open_tab()
        _status, fence = self.begin()
        self.push_word(restoring, "old ", restore=fence["token"])

        self.assertEqual(self.push_word(earlier, "stale "), (409, {"collab": "restored", "restore_rev": 3}))

    def test_a_restore_without_its_fence_is_lost(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        self.cancel(fence["token"])

        self.assertEqual(
            self.push_word(restoring, "old ", restore=fence["token"]), (409, {"collab": "restore_lost"})
        )
        self.assertEqual(self.doc_row(self.node).restore_rev, 0)

    def test_a_restore_after_its_fence_lapsed_is_lost(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        self.set_doc(self.node, restore_deadline=now_datetime() - timedelta(seconds=1))

        self.assertEqual(
            self.push_word(restoring, "old ", restore=fence["token"]), (409, {"collab": "restore_lost"})
        )

    def test_a_restore_with_another_fences_token_is_lost_and_the_fence_stands(self):
        restoring = self.open_tab()
        self.begin()

        self.assertEqual(
            self.push_word(restoring, "old ", restore="0" * 32), (409, {"collab": "restore_lost"})
        )
        self.assertEqual(self.refused_push(), (423, {"collab": "paused", "reason": "restoring"}))

    def test_a_restore_made_from_an_older_copy_is_lost(self):
        restoring = self.open_tab()
        restoring.seen_rev = 1
        _status, fence = self.begin()

        self.assertEqual(
            self.push_word(restoring, "old ", restore=fence["token"]), (409, {"collab": "restore_lost"})
        )

    def test_a_restore_sent_again_after_a_lost_answer_gets_its_first_answer(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        _status, first = self.push_word(restoring, "old ", restore=fence["token"])

        again = call_route(routes.updates_post, self.node, body=restoring.last_body)

        self.assertEqual(
            (again.status_code, answer(again)["rev"], answer(again)["dup"]), (200, first["rev"], True)
        )

    def test_a_restore_token_of_the_wrong_shape_is_malformed(self):
        status, refusal = self.push_word(self.open_tab(), "old ", restore="short")

        self.assertEqual((status, refusal), (400, {"collab": "malformed"}))

    def test_live_tabs_hear_the_restore_row_and_that_it_landed(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        with patch("frappe.publish_realtime") as publish:
            self.push_word(restoring, "old ", restore=fence["token"])

        (row_event, row), (control_event, control) = (call.args for call in publish.call_args_list)

        self.assertEqual((row_event, row["rev"], row["restore"]), ("suite_collab_row", 3, True))
        self.assertEqual(
            (control_event, control["kind"], control["restore_rev"]), ("suite_collab_ctl", "restored", 3)
        )

    def test_opening_and_pulling_tell_the_last_restore_and_a_standing_fence(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        fenced_open = self.open_tab().header
        self.push_word(restoring, "old ", restore=fence["token"])
        pulled, _rows = read_frame(call_route(routes.updates_get, self.node).get_data())

        nearly_two_minutes = 110_000
        self.assertEqual(
            (fenced_open["restore_rev"], fenced_open["restoring_ms"] > nearly_two_minutes), (0, True)
        )
        self.assertEqual((pulled["restore_rev"], "restoring_ms" in pulled), (3, False))
        self.assertEqual(self.open_tab().header["restore_rev"], 3)

    def test_the_next_restore_waits_a_minute_after_one_lands(self):
        restoring = self.open_tab()
        _status, fence = self.begin()
        self.push_word(restoring, "old ", restore=fence["token"])

        _status, refusal = self.begin()
        self.assertEqual(refusal["collab"], "restore_recent")

    # A tab opened on the document now, holding every row through the head
    def open_tab(self) -> frappe._dict:
        sid = uuid.uuid4().hex
        session = call_route(routes.sessions_post, self.node, body=json.dumps({"sid": sid}).encode())
        header, checkpoint, rows = read_open(call_route(routes.document_get, self.node).get_data())
        doc = pycrdt.Doc(client_id=answer(session)["client_id"])
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                doc.apply_update(payload)

        seen_rev = 0
        if rows:
            seen_rev = rows[-1][0]

        return frappe._dict(sid=sid, doc=doc, header=header, seen_rev=seen_rev, seq=0)

    # The tab types `word` at the start and sends it
    def push_word(self, tab: frappe._dict, word: str, *, restore: str | None = None) -> tuple[int, dict]:
        seen = tab.doc.get_state()
        tab.doc.get("default", type=pycrdt.XmlFragment).children[0].insert(0, word)
        tab.seq += 1
        lineage = tab.header["lineage"]
        update = tab.doc.get_update(seen)
        body = push_body(lineage, tab.sid, tab.doc.client_id, tab.seq, tab.seen_rev, update, restore=restore)
        tab.last_body = body
        response = call_route(routes.updates_post, self.node, body=body)
        return response.status_code, answer(response)

    # How the server answers another tab's push of one word; None when it goes in
    def refused_push(self) -> tuple[int, dict] | None:
        status, refusal = self.push_word(self.open_tab(), "late")
        if status == HTTPStatus.OK:
            return None

        refusal.pop("retry_ms", None)
        return status, refusal
