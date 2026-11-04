import base64
import gzip
import io
import json
from unittest.mock import patch

import frappe
import pycrdt
from frappe.storage.blob import put_blob

from suite import drive
from suite.content import logged
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.drive._core.versions import _insert_version, restore_version
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.api import docs
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase, embed, version_of
from suite.writer.content.tests.support import OUTSIDER, READER, WRITER


class TestWriterDriveVersions(DriveCallbackCase):
    def test_a_collab_version_holds_the_state_through_the_head(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        self.push_edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic")}))
        )

        version = version_of(self.docname_of(node))

        doc = self.doc_row(node)
        stamp_keys = ("schema", "codec", "lineage", "through_rev", "chain", "html", "media")
        stamp = {key: version[key] for key in stamp_keys}
        expected_stamp = {
            "schema": "writer-document/2",
            "codec": "yjs1",
            "lineage": doc.lineage,
            "through_rev": doc.head_rev,
            "chain": bytes(doc.head_chain).hex(),
            "html": None,
            "media": ["pic"],
        }
        self.assertEqual(stamp, expected_stamp)
        state_gz = base64.b64decode(version["state"])
        state = gzip.decompress(state_gz)
        picture_url = embed("pic")
        self.assertEqual(self.text_of(state), f'one two three<image src="{picture_url}"></image>')

    def test_a_version_never_starts_from_a_fallback_checkpoint(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        doc = self.doc_row(node)
        fallback = pycrdt.Doc()
        fallback.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText("deleted words"))
        fallback_gz = gzip.compress(fallback.get_update())
        frappe.db.sql(
            """INSERT INTO `__writer_content_checkpoint`
            (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `crdt_version`, `created`)
            VALUES (%s, %s, UNHEX(%s), UNHEX(%s), 0, UNHEX(%s), 0, 'test', NOW())""",
            (
                doc.id,
                doc.head_rev,
                bytes(doc.head_chain).hex(),
                "00" * 32,
                fallback_gz.hex(),
            ),
        )
        frappe.db.commit()

        version = version_of(self.docname_of(node))

        state_gz = base64.b64decode(version["state"])
        state = gzip.decompress(state_gz)
        self.assertEqual(self.text_of(state), "one two three")
        self.assertEqual(version["through_rev"], doc.head_rev)

    def test_a_broken_log_refuses_a_version_instead_of_storing_a_wrong_one(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(drive.DriveConflict):
            version_of(self.docname_of(node))

    def test_drive_refuses_to_restore_a_collab_version_and_the_log_is_untouched(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        version_seq = drive.take_version(node, kind="named", label="one")
        self.type_into(node, [" two"])
        head_rev = self.doc_row(node).head_rev

        writer_principals = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with self.assertRaisesRegex(drive.DriveConflict, "Open the document to restore this version"):
            restore_version(writer_principals, node, version_seq)

        frappe.db.rollback()
        self.assertEqual((self.doc_row(node).head_rev, self.row_count(node)), (head_rev, head_rev))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node, "kind": ("!=", "auto")}), 1)

    def test_every_collab_version_starts_with_the_bytes_a_restore_refuses(self):
        node = self.new_document()
        self.type_into(node, ["one"])

        record = logged.version(writer_content.APP, node)

        self.assertTrue(record.startswith(logged.record_prefix(writer_content.APP)))

    def restoring_without_a_log(self):
        node = self.new_document()
        self.delete_log(node)
        docname = self.docname_of(node)
        fields = ("content", "html", "collab")

        def restore(raw: bytes) -> None:
            writer_drive.SPEC.restore_version(docname, io.BytesIO(raw))

        def row() -> dict:
            return frappe.db.get_value("Writer Document", docname, fields, as_dict=True)

        return restore, row

    def test_a_collab_version_is_refused_on_a_document_without_a_log(self):
        logged_node = self.new_document()
        self.type_into(logged_node, ["one"])
        record = logged.version(writer_content.APP, logged_node)
        restore, row = self.restoring_without_a_log()
        before = row()

        refusal = "This version can be restored once the document is converted"
        with self.assertRaisesRegex(drive.DriveConflict, refusal):
            restore(record)

        self.assertEqual(row(), before)

    def test_a_row_version_restores_on_a_document_without_a_log(self):
        restore, row = self.restoring_without_a_log()
        body = base64.b64encode(pycrdt.Doc().get_update()).decode("ascii")
        record = {"schema": "writer-document/1", "content": body, "html": "<p>one</p>", "collab": 0}

        restore(json.dumps(record).encode("utf-8"))

        self.assertEqual(row(), {"content": body, "html": "<p>one</p>", "collab": 0})

    def test_a_legacy_html_version_restores_on_a_document_without_a_log(self):
        restore, row = self.restoring_without_a_log()

        restore(b"<p>legacy</p>")

        self.assertEqual(row(), {"content": "AAA=", "html": "<p>legacy</p>", "collab": 0})

    def test_a_version_shorter_than_a_collab_record_meets_writers_own_refusal(self):
        restore, row = self.restoring_without_a_log()
        before = row()

        with self.assertRaisesRegex(frappe.ValidationError, "This Writer version is not valid UTF-8"):
            restore(b"\xff")

        self.assertEqual(row(), before)

    def old_document_with_versions(self, *bodies: str) -> str:
        node = self.new_document()
        self.delete_log(node)
        docname = self.docname_of(node)
        for body in bodies:
            frappe.db.set_value("Writer Document", docname, {"content": body, "html": "", "collab": 1})
            drive.take_version(node)
            frappe.db.commit()

        return node

    def add_html_version(self, node: str):
        blob = put_blob(io.BytesIO(b"<p>legacy</p>"), is_private=True)
        writer = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _insert_version(
            frappe._dict(name=node), writer, blob=blob.name, size=int(blob.file_size), kind="auto", label=None
        )
        frappe.db.commit()

    def add_raw_version(self, node: str, raw: bytes):
        blob = put_blob(io.BytesIO(raw), is_private=True)
        writer = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _insert_version(
            frappe._dict(name=node), writer, blob=blob.name, size=int(blob.file_size), kind="auto", label=None
        )
        frappe.db.commit()

    def test_the_old_body_is_the_latest_row_version_past_newer_html_ones(self):
        node = self.old_document_with_versions("b2xkZXI=", "bmV3ZXI=")
        self.add_html_version(node)

        self.assertEqual(docs.old_body(node), {"content": "bmV3ZXI="})

    def test_no_old_body_past_a_version_too_large_to_read(self):
        node = self.old_document_with_versions("b2xkZXI=", "A" * 4000)

        with patch.object(writer_drive, "MAX_VERSION_BYTES", 2000):
            self.assertEqual(docs.old_body(node), {})

    def test_the_old_body_is_the_row_version_under_newer_logged_ones_too_large_to_read(self):
        node = self.old_document_with_versions("b2xkZXI=")
        logged_head = logged.record_prefix(writer_content.APP)
        self.add_raw_version(node, logged_head + b', "state": ""}')
        self.add_raw_version(node, logged_head + b', "state": "' + b"A" * 4000 + b'"}')

        with patch.object(writer_drive, "MAX_VERSION_BYTES", 2000):
            self.assertEqual(docs.old_body(node), {"content": "b2xkZXI="})

    def test_the_old_body_closes_every_version_it_opens(self):
        node = self.old_document_with_versions("b2xkZXI=")
        self.add_raw_version(node, logged.record_prefix(writer_content.APP) + b', "state": ""}')
        self.add_html_version(node)
        opened: list[io.IOBase] = []
        read_version = drive.read_version

        def tracked(node: str, seq: int):
            stream = read_version(node, seq)
            opened.append(stream)
            return stream

        with patch.object(drive, "read_version", side_effect=tracked):
            self.assertEqual(docs.old_body(node), {"content": "b2xkZXI="})

        self.assertEqual([stream.closed for stream in opened], [True, True, True])

    def test_a_version_with_missing_bytes_fails_the_old_body(self):
        node = self.old_document_with_versions("b2xkZXI=", "bmV3ZXI=")
        frappe.db.set_value("Drive Node Version", {"node": node, "seq": 2}, "blob", "missing-blob")
        frappe.db.commit()

        with self.assertRaises(drive.DriveConflict):
            docs.old_body(node)

    def test_a_reader_gets_the_old_body(self):
        node = self.old_document_with_versions("b2xkZXI=")
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()
        frappe.set_user(READER)

        self.assertEqual(docs.old_body(node), {"content": "b2xkZXI="})

    def test_someone_without_access_gets_no_old_body(self):
        node = self.old_document_with_versions("b2xkZXI=")
        frappe.set_user(OUTSIDER)

        with self.assertRaises(drive.DriveNotFound):
            docs.old_body(node)

    def test_there_is_no_old_body_without_a_row_version(self):
        never_versioned = self.new_document()
        logged_only = self.new_document()
        self.type_into(logged_only, ["one"])
        drive.take_version(logged_only)
        frappe.db.commit()
        html_only = self.new_document()
        self.add_html_version(html_only)

        answers = [docs.old_body(node) for node in (never_versioned, logged_only, html_only)]

        self.assertEqual(answers, [{}, {}, {}])
