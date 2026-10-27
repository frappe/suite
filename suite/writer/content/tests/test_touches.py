import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from itertools import product
from unittest.mock import patch

import frappe
from frappe.utils import now_datetime

from suite.content import jobs, scheduling, touches
from suite.content.http import routes
from suite.drive._core import content as drive_content
from suite.drive._core.principals import Principals
from suite.drive._core.versions import read_version
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase
from suite.writer.content.tests.support import WRITER


class TestWriterTouches(DriveCallbackCase):
    def content_modified(self, node: str):
        return frappe.db.get_value("Drive Node", node, "content_modified")

    @contextmanager
    def frozen_clock(self, at: datetime):
        with (
            patch.object(touches, "now_datetime", return_value=at),
            patch.object(drive_content, "now_datetime", return_value=at),
        ):
            yield

    def test_pushes_move_the_documents_last_change_at_most_every_ten_minutes(self):
        node = self.new_document()
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        for minutes in (0, 9):
            with self.frozen_clock(start + timedelta(minutes=minutes)):
                self.type_into(node, ["one"])

        self.assertEqual(self.content_modified(node), start)

        with self.frozen_clock(start + timedelta(minutes=10)):
            self.type_into(node, ["two"])

        self.assertEqual(self.content_modified(node), start + timedelta(minutes=10))

    def test_the_sweep_records_the_edits_after_a_touch_once_ten_minutes_pass(self):
        node = self.new_document()
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        for minutes in (0, 5):
            with self.frozen_clock(start + timedelta(minutes=minutes)):
                self.type_into(node, ["one"])

        frappe.set_user("Administrator")
        seen: list[datetime] = []
        for minutes in (9, 10, 30):
            with self.frozen_clock(start + timedelta(minutes=minutes)), patch.object(scheduling, "enqueue"):
                jobs.sweep()

            seen.append(self.content_modified(node))

        self.assertEqual(seen, [start, start + timedelta(minutes=10), start + timedelta(minutes=10)])

    def test_the_sweep_leaves_a_document_edited_before_pushes_touched_drive(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `touched_at` = NULL, `touched_rev` = 0 WHERE `node` = %s", node
        )
        frappe.db.commit()
        before = self.content_modified(node)

        with self.frozen_clock(now_datetime() + timedelta(hours=1)), patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(self.content_modified(node), before)

    def test_the_sweep_retries_a_touch_that_drive_failed(self):
        node = self.new_document()
        before = self.content_modified(node)
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        with self.frozen_clock(start), patch.object(routes.drive, "touch", side_effect=RuntimeError):
            self.type_into(node, ["one"])

        self.assertEqual(self.content_modified(node), before)

        frappe.set_user("Administrator")
        with self.frozen_clock(start + timedelta(minutes=10)), patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(self.content_modified(node), start + timedelta(minutes=10))

    def test_the_sweep_touches_the_longest_waiting_documents_first(self):
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        nodes = [self.new_document(), self.new_document()]
        for minutes, node in product((0, 5), nodes):
            with self.frozen_clock(start + timedelta(minutes=minutes)):
                self.type_into(node, ["one"])

        node_id_pairs = frappe.db.sql(
            "SELECT `node`, `id` FROM `__writer_content_doc` WHERE `node` IN %s", (tuple(nodes),)
        )
        doc_id_by_node = dict(node_id_pairs)
        # The one a plain id scan reaches last
        waiting = max(nodes, key=doc_id_by_node.get)
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `touched_at` = '2000-01-01' WHERE `node` = %s", waiting
        )
        frappe.db.commit()

        frappe.set_user("Administrator")
        with (
            self.frozen_clock(start + timedelta(minutes=10)),
            patch.object(scheduling, "enqueue"),
            patch.object(touches, "TOUCH_BATCH", 1),
        ):
            jobs.sweep()

        changed = {node: self.content_modified(node) for node in nodes}
        expected = dict.fromkeys(nodes, start)
        expected[waiting] = start + timedelta(minutes=10)
        self.assertEqual(changed, expected)

    def automatic_versions(self, node: str) -> list[int]:
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        seqs = frappe.get_all(
            "Drive Node Version", filters={"node": node, "kind": "auto"}, pluck="seq", order_by="seq"
        )
        through_revs: list[int] = []
        for seq in seqs:
            with read_version(owner, node, seq) as stream:
                through_revs.append(json.loads(stream.read())["through_rev"])

        return through_revs

    def test_pushes_take_an_automatic_version_at_most_every_ten_minutes(self):
        node = self.new_document()
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        for minutes in (0, 9):
            with self.frozen_clock(start + timedelta(minutes=minutes)):
                self.type_into(node, ["one"])

        first_head = self.doc_row(node).head_rev - 1
        self.assertEqual(self.automatic_versions(node), [first_head])

        with self.frozen_clock(start + timedelta(minutes=10)):
            self.type_into(node, ["two"])

        self.assertEqual(self.automatic_versions(node), [first_head, self.doc_row(node).head_rev])

    def test_the_sweep_versions_the_edits_after_an_automatic_version_once_ten_minutes_pass(self):
        node = self.new_document()
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        for minutes in (0, 5):
            with self.frozen_clock(start + timedelta(minutes=minutes)):
                self.type_into(node, ["one"])

        first_head = self.doc_row(node).head_rev - 1
        frappe.set_user("Administrator")
        seen: list[list[int]] = []
        for minutes in (9, 10, 30):
            with self.frozen_clock(start + timedelta(minutes=minutes)), patch.object(scheduling, "enqueue"):
                jobs.sweep()

            seen.append(self.automatic_versions(node))

        head = self.doc_row(node).head_rev
        self.assertEqual(seen, [[first_head], [first_head, head], [first_head, head]])

    def test_the_sweep_retries_an_automatic_version_that_failed(self):
        node = self.new_document()
        start = now_datetime().replace(microsecond=0) + timedelta(hours=1)
        with self.frozen_clock(start), patch.object(routes.drive, "take_version", side_effect=RuntimeError):
            self.type_into(node, ["one"])

        self.assertEqual(self.automatic_versions(node), [])

        frappe.set_user("Administrator")
        with self.frozen_clock(start + timedelta(minutes=10)), patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(self.automatic_versions(node), [self.doc_row(node).head_rev])

    def test_a_document_nobody_edits_gets_no_automatic_version(self):
        node = self.new_document()

        frappe.set_user("Administrator")
        with self.frozen_clock(now_datetime() + timedelta(hours=1)), patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(self.automatic_versions(node), [])
