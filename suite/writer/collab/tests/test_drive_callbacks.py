import base64
import gzip
import io
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import frappe
import pycrdt
from frappe.storage.blob import put_blob
from frappe.utils import now_datetime

from suite import drive
from suite.drive._core import content
from suite.drive._core.errors import DriveConflict
from suite.drive._core.nodes import create_file
from suite.drive._core.principals import Principals
from suite.drive._core.versions import restore_version
from suite.writer import drive as writer_drive
from suite.writer.collab import routes
from suite.writer.collab.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.collab.tests.test_collab import answer, call, push_body, read_open


def version_of(docname: str) -> dict:
    stream, mime = writer_drive.version_bytes(docname)
    assert mime == "application/json"
    return json.loads(stream.getvalue())


def embed(media: str) -> str:
    return f"/api/method/suite.writer.api.embed.get?id={media}"


class TestWriterDriveCallbacks(CheckpointCase):
    def edit(self, node: str, change) -> None:
        """A tab opened on the document makes `change` to its fragment and pushes it as one row."""
        sid = uuid.uuid4().hex
        cid = answer(call(routes.collab_sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]
        header, checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        doc = pycrdt.Doc(client_id=cid)
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                doc.apply_update(payload)
        seen = doc.get_state()
        change(doc.get("default", type=pycrdt.XmlFragment))
        body = push_body(header["lineage"], sid, cid, 1, 0, doc.get_update(seen))
        self.assertEqual(call(routes.collab_updates_post, node, body=body).status_code, 200)

    def docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def test_used_nodes_reads_the_pictures_a_collab_document_holds_now(self):
        node = self.new_document()
        self.edit(
            node,
            lambda body: [
                body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-kept")})),
                body.children.append(pycrdt.XmlElement("image", {"src": "", "data-node": "pic-bare"})),
                body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-removed")})),
            ],
        )
        self.compact(node)
        self.edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-new")}))
        )
        self.edit(node, lambda body: body.children.__delitem__(2))

        found = writer_drive.used_nodes(self.docname(node))

        self.assertEqual(found, {"pic-kept", "pic-bare", "pic-new"})

    def test_used_nodes_raises_on_a_log_it_cannot_read_so_the_sweep_skips_it(self):
        node = self.new_document()
        self.edit(node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic")})))
        frappe.db.sql(
            "UPDATE `__writer_collab_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(writer_drive.UnreadableBody):
            writer_drive.used_nodes(self.docname(node))

    def test_the_media_sweep_keeps_a_picture_only_the_log_names(self):
        node = self.new_document()
        named, unnamed = self.old_media(node, "named.png"), self.old_media(node, "unnamed.png")
        self.edit(node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed(named)})))

        spec = content.registry()[writer_drive.DOCTYPE]
        trashed = content._sweep_document(spec, frappe._dict(name=node, content_docname=self.docname(node)))

        self.assertEqual(trashed, 1)
        self.assertEqual(frappe.db.get_value("Drive Node", named, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", unnamed, "state"), "Trashed")

    def old_media(self, document: str, title: str) -> str:
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        blob = put_blob(io.BytesIO(title.encode()), is_private=True, filename=title)
        with patch("suite.drive._core.previews.enqueue_render"):
            media = create_file(
                admin, document, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type
            )
        aged = now_datetime() - timedelta(days=content.UNUSED_MEDIA_GRACE_DAYS + 1)
        frappe.db.set_value("Drive Node", media, "creation", aged, update_modified=False)
        frappe.db.commit()
        return media

    def test_a_collab_version_holds_the_state_through_the_head(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        self.edit(node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic")})))

        version = version_of(self.docname(node))

        doc = self.doc_row(node)
        self.assertEqual(
            {
                key: version[key]
                for key in ("schema", "codec", "lineage", "through_rev", "chain", "html", "media")
            },
            {
                "schema": "writer-document/2",
                "codec": "yjs1",
                "lineage": doc.lineage,
                "through_rev": doc.head_rev,
                "chain": bytes(doc.head_chain).hex(),
                "html": None,
                "media": ["pic"],
            },
        )
        self.assertEqual(
            self.text_of(gzip.decompress(base64.b64decode(version["state"]))),
            f'one two three<image src="{embed("pic")}"></image>',
        )

    def test_a_version_never_starts_from_a_fallback_checkpoint(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        doc = self.doc_row(node)
        fallback = pycrdt.Doc()
        fallback.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText("deleted words"))
        frappe.db.sql(
            """INSERT INTO `__writer_collab_checkpoint`
            (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `created`)
            VALUES (%s, %s, UNHEX(%s), UNHEX(%s), 0, UNHEX(%s), 0, 'test', NOW())""",
            (
                doc.id,
                doc.head_rev,
                bytes(doc.head_chain).hex(),
                "00" * 32,
                gzip.compress(fallback.get_update()).hex(),
            ),
        )
        self.set_doc(node, checkpoint_rev=doc.head_rev)

        version = version_of(self.docname(node))

        self.assertEqual(self.text_of(gzip.decompress(base64.b64decode(version["state"]))), "one two three")
        self.assertEqual(version["through_rev"], doc.head_rev)

    def test_with_collaboration_off_a_version_is_the_stored_body(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        frappe.db.set_single_value("Suite Collab Settings", "mode", "off")
        frappe.db.commit()

        version = version_of(self.docname(node))

        self.assertEqual(version["schema"], "writer-document/1")

    def test_a_broken_log_refuses_a_version_instead_of_storing_a_wrong_one(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        frappe.db.sql(
            "UPDATE `__writer_collab_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(DriveConflict):
            version_of(self.docname(node))

    def test_drive_refuses_to_restore_a_collab_version_and_the_log_is_untouched(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        seq = drive.take_version(node, kind="named", label="one")
        self.type_into(node, [" two"])
        head = self.doc_row(node).head_rev

        writer = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with self.assertRaisesRegex(DriveConflict, "Open the document to restore this version"):
            restore_version(writer, node, seq)

        frappe.db.rollback()
        self.assertEqual((self.doc_row(node).head_rev, self.row_count(node)), (head, head))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 1)
