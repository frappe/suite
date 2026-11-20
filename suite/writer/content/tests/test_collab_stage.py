import threading
import uuid
from datetime import timedelta
from unittest.mock import patch

import frappe

from suite import drive
from suite.content import capacity, jobs, scheduling
from suite.content.http import routes
from suite.content.stage import PIECE_MAX
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.writer.content.tests.support import (
    OUTSIDER,
    READER,
    WRITER,
    CollabCase,
    big_change,
    call_route,
    piece_body,
    pieces_of,
    read_frame,
)


class TestWriterCollabStage(CollabCase):
    def test_a_four_mebibyte_change_sent_in_pieces_in_any_order_commits_once_and_leaves_no_pieces(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 4 * 2**20)
        order = [5, 0, 15, 3, 3, 9, 1, 2, 14, 4, 6, 7, 8, 10, 11, 12, 13]

        stage_id = self.stage(node, sid, change, order=order)
        first = self.push_staged(node, sid, client_id, change, stage_id)
        again = self.push_staged(node, sid, client_id, change, stage_id)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        pieces = pieces_of(change)
        late_body = piece_body(lineage, sid, 1, change, pieces[2])
        late = self.put_piece(node, stage_id, 2, late_body)

        self.assertEqual((len(pieces_of(change)), first[0]), (16, 200))
        self.assertEqual((again[0], again[1]["dup"], again[1]["rev"]), (200, True, first[1]["rev"]))
        self.assertEqual(late, (200, {"dup": True}))
        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, change)])
        self.assertEqual(self.staged(node), 0)
        self.assert_one_order(node, 1)

    def test_a_push_naming_a_stage_that_lacks_a_piece_stores_nothing_until_the_piece_arrives(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)

        stage_id = self.stage(node, sid, change, order=[0, 2])
        waiting = self.push_staged(node, sid, client_id, change, stage_id)
        unknown = self.push_staged(node, sid, client_id, change, uuid.uuid4().hex)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        pieces = pieces_of(change)
        missing_body = piece_body(lineage, sid, 1, change, pieces[1])
        self.put_piece(node, stage_id, 1, missing_body)
        done = self.push_staged(node, sid, client_id, change, stage_id)

        self.assertEqual(waiting, (409, {"collab": "stage_incomplete"}))
        self.assertEqual(unknown, (409, {"collab": "stage_incomplete"}))
        self.assertEqual(done[0], 200)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, change)])
        self.assertEqual(self.staged(node), 0)

    def test_a_corrupt_piece_drops_its_stage_and_the_change_staged_again_commits(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        stage_id = uuid.uuid4().hex
        pieces = pieces_of(change)
        flipped = bytes([pieces[1][0] ^ 1]) + pieces[1][1:]

        for index, piece in enumerate([pieces[0], flipped, pieces[2]]):
            self.put_piece(node, stage_id, index, piece_body(lineage, sid, 1, change, piece))

        refused = self.push_staged(node, sid, client_id, change, stage_id)
        dropped = self.staged(node)
        for index, piece in enumerate(pieces):
            self.put_piece(node, stage_id, index, piece_body(lineage, sid, 1, change, piece))

        done = self.push_staged(node, sid, client_id, change, stage_id)

        self.assertEqual((refused, dropped), ((409, {"collab": "stage_incomplete"}), 0))
        self.assertEqual(done[0], 200)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, change)])

    def test_a_piece_that_disagrees_with_its_stage_or_another_sessions_stage_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        other_sid, other_client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        opened, _ = self.open_document(node)
        lineage = opened["lineage"]
        stage_id = self.stage(node, sid, change, order=[0])
        pieces = pieces_of(change)

        def put_overridden(index, piece, tab_sid=sid, **header):
            body = piece_body(lineage, tab_sid, 1, change, piece, **header)

            return self.put_piece(node, stage_id, index, body)

        refusals = [
            put_overridden(0, pieces[1]),
            put_overridden(1, pieces[1], sha_total="00" * 32),
            put_overridden(1, pieces[1], **{"to": 2}),
            put_overridden(1, pieces[1], tab_sid=other_sid),
        ]
        theirs = self.push_staged(node, other_sid, other_client_id, change, stage_id)

        self.assertEqual(refusals, [(409, {"collab": "stage_conflict"})] * 4)
        self.assertEqual(theirs, (409, {"collab": "stage_conflict"}))
        self.assertEqual(self.staged(node), 1)
        put_overridden(1, pieces[1])
        put_overridden(2, pieces[2])
        status, _ = self.push_staged(node, sid, client_id, change, stage_id)
        self.assertEqual(status, 200)

    def test_pieces_are_cut_where_their_change_says_and_no_change_is_over_four_mebibytes(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        opened, _ = self.open_document(node)
        lineage = opened["lineage"]
        pieces = pieces_of(change)

        def put_overridden(index, piece, stage_id=None, **header):
            stage_id = stage_id or uuid.uuid4().hex
            body = piece_body(lineage, sid, 1, change, piece, **header)

            return self.put_piece(node, stage_id, index, body)

        status, _ = put_overridden(0, pieces[0][:-1])
        self.assertEqual(status, 400)
        status, _ = put_overridden(2, pieces[2] + b"x")
        self.assertEqual(status, 400)
        status, _ = put_overridden(3, b"x")
        self.assertEqual(status, 400)
        status, _ = put_overridden(0, pieces[0], stage_id="not-an-id")
        self.assertEqual(status, 400)
        self.assertEqual(
            put_overridden(0, pieces[0], total_len=4 * 2**20 + 1), (413, {"collab": "too_large"})
        )
        self.assertEqual(put_overridden(0, pieces[0], lineage="0" * 32), (409, {"collab": "lineage"}))
        self.assertEqual(
            put_overridden(0, pieces[0], sid=uuid.uuid4().hex), (409, {"collab": "session_unknown"})
        )
        status, _ = put_overridden(2, pieces[2])
        self.assertEqual(status, 200)
        self.assertEqual(self.staged(node), 1)

    def test_a_change_over_a_quarter_mebibyte_sent_whole_is_refused_as_too_large(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        overhead = len(big_change(client_id, 200_000)) - 200_000
        over_cap = big_change(client_id, PIECE_MAX + 1 - overhead)
        at_cap = big_change(client_id, PIECE_MAX - overhead)

        self.assertEqual(self.push(node, sid, client_id, 1, over_cap), (413, {"collab": "too_large"}))
        status, _ = self.push(node, sid, client_id, 1, at_cap)
        self.assertEqual(status, 200)

    def test_a_change_over_the_layers_cap_is_malformed(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        payload = self.typed_update(client_id, 1, "abc")

        with patch.object(capacity, "CHANGE_MAX", len(payload) - 1):
            self.assertEqual(self.push(node, sid, client_id, 1, payload), (400, {"collab": "malformed"}))

        with patch.object(capacity, "CHANGE_MAX", len(payload)):
            status, _ = self.push(node, sid, client_id, 1, payload)
            self.assertEqual(status, 200)

    def test_a_change_sent_whole_over_what_the_database_takes_is_malformed(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        payload = self.typed_update(client_id, 1, "abc")

        with patch.object(capacity, "edit_max", return_value=len(payload) - 1):
            self.assertEqual(self.push(node, sid, client_id, 1, payload), (400, {"collab": "malformed"}))

        with patch.object(capacity, "edit_max", return_value=len(payload)):
            status, _ = self.push(node, sid, client_id, 1, payload)
            self.assertEqual(status, 200)

    def test_pieces_of_a_change_over_what_the_database_takes_are_refused_as_too_large(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * 600_000

        with patch.object(capacity, "edit_max", return_value=len(change) - 1):
            header, _ = self.open_document(node)
            lineage = header["lineage"]
            first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
            status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body), (413, {"collab": "too_large"}))
        self.assertEqual(self.staged(node), 0)

    def test_open_and_pull_name_the_sizes_a_change_is_checked_against(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        self.push(node, sid, client_id, 1, big_change(client_id, 10_000))

        opened_header, _ = self.open_document(node)
        opened = opened_header["limits"]
        pull = call_route(routes.updates_get, node)
        pulled_header, _ = read_frame(pull.get_data())
        pulled = pulled_header["limits"]

        self.assertEqual(opened, pulled)
        self.assertEqual(
            (opened["fragment"], opened["edit_max"], opened["state_max"]), (256 * 2**10, 4 * 2**20, 4 * 2**20)
        )
        self.assertEqual(opened["tail_bound"], len(big_change(client_id, 10_000)))

    def test_a_document_holds_at_most_sixteen_mebibytes_of_pieces(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * (4 * 2**20)

        for _ in range(4):
            self.stage(node, sid, change)

        header, _ = self.open_document(node)
        lineage = header["lineage"]
        first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
        status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body["collab"]), (423, "stage_full"))
        self.assertEqual(self.staged(node), 64)

    def test_one_editors_full_pieces_leave_room_for_anothers(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        change = b"x" * (4 * 2**20)
        for _ in range(4):
            self.stage(node, sid, change)

        grant(node, OUTSIDER, drive.EDIT, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(OUTSIDER)
        other_sid, _ = self.start_session(node)

        header, _ = self.open_document(node)
        lineage = header["lineage"]
        first_piece = piece_body(lineage, other_sid, 1, change, change[:PIECE_MAX])
        status, body = self.put_piece(node, uuid.uuid4().hex, 0, first_piece)

        self.assertEqual((status, body), (200, {"staged": 0}))

    def test_pieces_put_at_once_never_pass_the_cap_together(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        change = b"x" * (4 * 2**20)
        for _ in range(3):
            self.stage(node, sid, change)

        self.stage(node, sid, change[: 15 * PIECE_MAX])
        site = frappe.local.site
        answers: list[tuple[int, dict]] = []

        def put_first_piece():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)

            try:
                first_piece = piece_body(lineage, sid, 1, change, change[:PIECE_MAX])
                answers.append(self.put_piece(node, uuid.uuid4().hex, 0, first_piece))
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=put_first_piece) for _ in range(8)]
        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        self.assertEqual(sorted(status for status, _body in answers), [200] + [423] * 7)
        self.assertEqual(self.staged(node), 64)

    def test_someone_who_cannot_edit_is_refused_before_their_piece_is_read(self):
        self.set_mode("on")
        node = self.new_document()
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(READER)

        with patch.object(capacity, "edit_max", side_effect=AssertionError("read the piece")):
            status, body = self.put_piece(node, uuid.uuid4().hex, 0, b"not a piece")

        self.assertEqual((status, body["collab"]), (403, "forbidden"))

    def test_the_sweeper_drops_pieces_older_than_a_quarter_hour(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        change = big_change(client_id, 600_000)
        old = self.stage(node, sid, change)
        recent = self.stage(node, sid, change)
        now = frappe.utils.now_datetime()
        for stage_id, minutes in ((old, 16), (recent, 14)):
            frappe.db.sql(
                "UPDATE `__writer_content_stage` SET `created` = %s WHERE `stage_id` = %s",
                (now - timedelta(minutes=minutes), stage_id),
            )

        frappe.db.commit()

        with patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(
            self.push_staged(node, sid, client_id, change, old), (409, {"collab": "stage_incomplete"})
        )
        status, _ = self.push_staged(node, sid, client_id, change, recent)
        self.assertEqual(status, 200)

    def test_a_stage_whose_pieces_keep_arriving_outlives_a_quarter_hour(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        tabs: list[tuple[str, int, bytes, list[bytes]]] = []
        for _ in range(2):
            sid, client_id = self.start_session(node)
            change = big_change(client_id, 600_000)
            tabs.append((sid, client_id, change, pieces_of(change)))

        (slow_sid, _, slow_change, slow_pieces), (resent_sid, _, resent_change, resent_pieces) = tabs
        slow = self.stage(node, slow_sid, slow_change, order=[0])
        resent = self.stage(node, resent_sid, resent_change)
        sixteen_minutes_ago = frappe.utils.now_datetime() - timedelta(minutes=16)
        frappe.db.sql(
            "UPDATE `__writer_content_stage` SET `created` = %s WHERE `stage_id` IN %s",
            (sixteen_minutes_ago, (slow, resent)),
        )
        frappe.db.commit()

        for stage_id, sid, change, pieces, order in (
            (slow, slow_sid, slow_change, slow_pieces, range(1, len(slow_pieces))),
            (resent, resent_sid, resent_change, resent_pieces, [0]),
        ):
            for index in order:
                body = piece_body(lineage, sid, 1, change, pieces[index])
                status, _ = self.put_piece(node, stage_id, index, body)
                self.assertEqual(status, 200)

        with patch.object(scheduling, "enqueue"):
            jobs.sweep()

        pushed: list[int] = []
        for stage_id, (sid, client_id, change, _pieces) in zip((slow, resent), tabs, strict=True):
            status, _ = self.push_staged(node, sid, client_id, change, stage_id)
            pushed.append(status)

        self.assertEqual(pushed, [200, 200])

    def test_only_an_editor_signed_in_as_the_sessions_owner_stages_a_piece_on_an_open_session(self):
        self.set_mode("on")
        node = self.new_document()
        sid, _ = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        def put_as(user):
            frappe.set_user(user)

            try:
                body = piece_body(lineage, sid, 1, b"x", b"x")
                return self.put_piece(node, uuid.uuid4().hex, 0, body)
            finally:
                frappe.set_user(WRITER)

        outsider = put_as(OUTSIDER)
        reader = put_as(READER)
        frappe.db.sql("UPDATE `__writer_content_session` SET `closed` = 1 WHERE `sid` = %s", sid)
        frappe.db.commit()
        closed = put_as(WRITER)

        self.assertIn(outsider[0], (403, 404))
        self.assertEqual(reader[0], 403)
        self.assertEqual(closed, (409, {"collab": "client_closed"}))
        self.assertEqual(self.staged(node), 0)
