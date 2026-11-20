import base64
import gzip
import json
import uuid
from dataclasses import replace
from unittest.mock import patch

import frappe
import pycrdt

from suite import content, drive
from suite.content import capacity, checkpoints, logged, scheduling
from suite.content.http import routes
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase, declaring, embed, version_of
from suite.writer.content.tests.support import call_route, read_open


class TestWriterDocumentCopies(DriveCallbackCase):
    def copy_of(self, node: str) -> str:
        parent = frappe.db.get_value("Drive Node", node, "parent_node")
        copied = drive.copy(node, parent)
        frappe.db.commit()
        self.addCleanup(self.delete_document, copied)
        for media in frappe.get_all("Drive Node", {"parent_node": copied, "kind": "file"}, pluck="name"):
            self.addCleanup(self.delete_document, media)

        self.addCleanup(self.delete_log, copied)
        return copied

    def opened(self, node: str) -> pycrdt.Doc:
        frame = read_open(call_route(routes.document_get, node).get_data())
        doc = pycrdt.Doc()
        for payload in [frame.checkpoint, *(payload for _rev, payload in frame.rows)]:
            if payload:
                doc.apply_update(payload)

        return doc

    def assert_version_and_copy_refused(self, node: str, parent: str) -> None:
        with self.assertRaisesRegex(drive.DriveConflict, "is not available for this document right now"):
            version_of(self.docname_of(node))

        with self.assertRaisesRegex(drive.DriveConflict, "cannot be copied right now"):
            drive.copy(node, parent)

        frappe.db.rollback()

    def test_a_version_or_copy_larger_than_a_compaction_job_takes_is_refused(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        snapshot = content.read("writer", self.doc_row(node).id)
        size = len(snapshot.checkpoint or b"") + sum(len(payload) for payload in snapshot.payloads())
        parent = frappe.db.get_value("Drive Node", node, "parent_node")

        for state_max, tail_rows in ((size - 1, scheduling.TAIL_ROWS), (capacity.STATE_MAX, 1)):
            with (
                self.subTest(state_max=state_max, tail_rows=tail_rows),
                patch.object(capacity, "STATE_MAX", state_max),
                patch.object(scheduling, "TAIL_ROWS", tail_rows),
            ):
                self.assert_version_and_copy_refused(node, parent)

        with patch.object(capacity, "STATE_MAX", size), patch.object(scheduling, "TAIL_ROWS", 2):
            version = version_of(self.docname_of(node))
            state_gz = base64.b64decode(version["state"])
            state = gzip.decompress(state_gz)
            self.assertEqual(self.text_of(state), "one two")
            copied = self.copy_of(node)

        self.assertEqual(self.text_of(self.opened(copied).get_update()), "one two")

    def test_a_copy_carries_the_text_through_the_head_under_its_own_lineage(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])

        copied = self.copy_of(node)

        self.assertNotEqual(self.doc_row(copied).lineage, self.doc_row(node).lineage)
        self.assertEqual(self.text_of(self.opened(copied).get_update()), "one two three")
        self.assertEqual(self.type_into(copied, [" four"]), "one two three four")
        self.assertEqual(self.text_of(self.opened(node).get_update()), "one two three")

    def test_a_copy_names_its_own_pictures_and_keeps_its_text(self):
        node = self.new_document()
        picture = self.old_media(node, "picture.png")
        picture_url = embed(picture)

        def add_picture_and_link(body):
            body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)}))
            body.children.append(pycrdt.XmlText(f"see {picture_url}"))

        self.push_edit(node, add_picture_and_link)

        copied = self.copy_of(node)

        [copied_picture] = frappe.get_all("Drive Node", {"parent_node": copied, "kind": "file"}, pluck="name")
        image, text = self.opened(copied).get("default", type=pycrdt.XmlFragment).children
        self.assertEqual(dict(image.attributes), {"src": embed(copied_picture)})
        self.assertEqual(str(text), f"see {picture_url}")
        self.assertEqual(writer_drive.SPEC.used_nodes(self.docname_of(copied)), {copied_picture})
        source_image = self.opened(node).get("default", type=pycrdt.XmlFragment).children[0]
        self.assertEqual(dict(source_image.attributes), {"src": embed(picture)})

    def test_a_copy_starts_at_the_highest_schema_its_source_holds(self):
        node = self.new_document()
        picture = self.old_media(node, "picture.png")
        self.type_into(node, ["one"])
        schema_two = replace(writer_content.SCHEMA, version=2)
        spec_at_schema_two = replace(writer_content.EDITOR, schema=schema_two)
        with patch.object(writer_content, "EDITOR", spec_at_schema_two):
            self.push_edit(
                node,
                lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)})),
                schema=2,
            )

        copied = self.copy_of(node)

        self.assertEqual(json.loads(self.doc_row(node).schema_steps), [[0, 1], [2, 2]])
        self.assertEqual(json.loads(self.doc_row(copied).schema_steps), [[1, 2]])

    def test_a_copy_renames_pictures_in_a_list_and_keeps_text(self):
        node = self.new_document()
        picture = self.old_media(node, "picture.png")

        def add_picture_lists(body):
            body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)}))
            meta = body.doc.get("meta", type=pycrdt.Map)
            meta["pictures"] = pycrdt.Array([embed(picture), [picture]])
            meta["note"] = pycrdt.Text(embed(picture))

        with declaring("pictures", "note"):
            self.push_edit(node, add_picture_lists)

        copied = self.copy_of(node)

        [copied_picture] = frappe.get_all("Drive Node", {"parent_node": copied, "kind": "file"}, pluck="name")
        meta = self.opened(copied).get("meta", type=pycrdt.Map)
        self.assertEqual(meta["pictures"].to_py(), [embed(copied_picture), [copied_picture]])
        self.assertEqual(str(meta["note"]), embed(picture))

    def test_a_copys_start_cannot_change_once_a_tab_has_a_session(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        copied = self.copy_of(node)
        session_body = json.dumps({"sid": uuid.uuid4().hex}).encode()
        call_route(routes.sessions_post, copied, body=session_body)

        with self.assertRaises(ValueError):
            checkpoints.replace_start("writer", self.doc_row(copied).id, pycrdt.Doc().get_update(), 1)

    def test_a_source_whose_log_cannot_be_read_is_not_copied(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()
        parent = frappe.db.get_value("Drive Node", node, "parent_node")
        before = frappe.db.count("Drive Node", {"parent_node": parent})

        with self.assertRaisesRegex(drive.DriveConflict, "cannot be copied"):
            drive.copy(node, parent)

        frappe.db.rollback()
        self.assertEqual(frappe.db.count("Drive Node", {"parent_node": parent}), before)
