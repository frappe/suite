import base64
import gzip
import io
import json
import uuid
from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch

import frappe
import pycrdt
from frappe.storage.blob import put_blob
from frappe.utils import now_datetime

from suite import drive
from suite.drive._core import content as drive_content
from suite.drive._core.nodes import _trash, purge
from suite.drive._core.principals import Principals
from suite.drive._core.versions import restore_version
from suite.suite_core import content
from suite.suite_core.content import log, scheduling
from suite.writer import collab as writer_collab
from suite.writer import drive as writer_drive
from suite.writer.collab import routes
from suite.writer.collab.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.collab.tests.test_collab import answer, call, push_body, read_open


def version_of(docname: str) -> dict:
    stream, mime = writer_drive.version_bytes(docname)
    assert mime == "application/json"
    return json.loads(stream.getvalue())


def declaring(*names: str):
    """Writer's schema with `names` declared and Arrays, Maps and Texts allowed, so a row may hold a shape the
    editor does not write today."""
    features = {**routes.SCHEMA.features, **dict.fromkeys(names, 1)}
    shared_types = routes.SCHEMA.shared_types | {0, 1, 2}
    return patch.object(
        routes, "SCHEMA", replace(routes.SCHEMA, features=features, shared_types=shared_types)
    )


def embed(media: str) -> str:
    return f"/api/method/suite.writer.api.embed.get?id={media}"


class TestWriterDriveCallbacks(CheckpointCase):
    def edit(self, node: str, change, schema: int = 1) -> None:
        """A tab opened on the document makes `change` to its fragment and pushes it as one row stamped `schema`."""
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
        body = push_body(header["lineage"], sid, cid, 1, 0, doc.get_update(seen), schema=schema)
        self.assertEqual(call(routes.collab_updates_post, node, body=body).status_code, 200)

    def docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def test_used_nodes_reads_the_pictures_a_collab_document_holds_now(self):
        node = self.new_document()
        with declaring("data-node"):
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
            "UPDATE `__writer_content_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(writer_drive.UnreadableBody):
            writer_drive.used_nodes(self.docname(node))

    def test_the_media_sweep_keeps_a_picture_only_the_log_names(self):
        node = self.new_document()
        named, unnamed = self.old_media(node, "named.png"), self.old_media(node, "unnamed.png")
        self.edit(node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed(named)})))

        spec = drive_content.registry()[writer_drive.DOCTYPE]
        trashed = drive_content._sweep_document(
            spec, frappe._dict(name=node, content_docname=self.docname(node))
        )

        self.assertEqual(trashed, 1)
        self.assertEqual(frappe.db.get_value("Drive Node", named, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", unnamed, "state"), "Trashed")

    def old_media(self, document: str, title: str) -> str:
        blob = put_blob(io.BytesIO(title.encode()), is_private=True, filename=title)
        with patch.object(frappe, "enqueue"):
            media = drive.create_file(
                document, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type
            )
        aged = now_datetime() - timedelta(days=drive_content.UNUSED_MEDIA_GRACE_DAYS + 1)
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
            """INSERT INTO `__writer_content_checkpoint`
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
            "UPDATE `__writer_content_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(drive.DriveConflict):
            version_of(self.docname(node))

    def test_a_version_or_copy_larger_than_a_compaction_job_takes_is_refused(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        read = content.read("writer", self.doc_row(node).id)
        size = len(read["checkpoint"] or b"") + sum(len(payload) for _rev, payload in read["rows"])
        parent = frappe.db.get_value("Drive Node", node, "parent_node")

        for limits in ({"STATE_MAX": size - 1}, {"TAIL_ROWS": 1}):
            with self.subTest(limits=limits), patch.multiple(scheduling, **limits):
                with self.assertRaisesRegex(
                    drive.DriveConflict, "is not available for this document right now"
                ):
                    version_of(self.docname(node))
                with self.assertRaisesRegex(drive.DriveConflict, "cannot be copied right now"):
                    drive.copy(node, parent)
                frappe.db.rollback()

        with patch.multiple(scheduling, STATE_MAX=size, TAIL_ROWS=2):
            state = gzip.decompress(base64.b64decode(version_of(self.docname(node))["state"]))
            self.assertEqual(self.text_of(state), "one two")
            copied = self.copy_of(node)
        self.assertEqual(self.text_of(self.opened(copied).get_update()), "one two")

    def test_drive_refuses_to_restore_a_collab_version_and_the_log_is_untouched(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        seq = drive.take_version(node, kind="named", label="one")
        self.type_into(node, [" two"])
        head = self.doc_row(node).head_rev

        writer = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with self.assertRaisesRegex(drive.DriveConflict, "Open the document to restore this version"):
            restore_version(writer, node, seq)

        frappe.db.rollback()
        self.assertEqual((self.doc_row(node).head_rev, self.row_count(node)), (head, head))
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 1)

    def test_with_collaboration_off_drive_refuses_a_version_saved_while_it_was_on(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        seq = drive.take_version(node, kind="named", label="one")
        frappe.db.set_single_value("Suite Collab Settings", "mode", "off")
        frappe.db.commit()
        fields = ("content", "html", "collab")
        before = frappe.db.get_value("Writer Document", self.docname(node), fields)

        writer = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with self.assertRaisesRegex(
            drive.DriveConflict, "This version can be restored only while collaboration is on"
        ):
            restore_version(writer, node, seq)

        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value("Writer Document", self.docname(node), fields), before)
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 1)

    def copy_of(self, node: str) -> str:
        parent = frappe.db.get_value("Drive Node", node, "parent_node")
        copied = drive.copy(node, parent)
        frappe.db.commit()
        self.addCleanup(self.forget, copied)
        return copied

    def opened(self, node: str) -> pycrdt.Doc:
        _header, checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        doc = pycrdt.Doc()
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                doc.apply_update(payload)
        return doc

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
        self.edit(
            node,
            lambda body: [
                body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)})),
                body.children.append(pycrdt.XmlText(f"see {embed(picture)}")),
            ],
        )

        copied = self.copy_of(node)

        [copied_picture] = frappe.get_all("Drive Node", {"parent_node": copied, "kind": "file"}, pluck="name")
        image, text = self.opened(copied).get("default", type=pycrdt.XmlFragment).children
        self.assertEqual(dict(image.attributes), {"src": embed(copied_picture)})
        self.assertEqual(str(text), f"see {embed(picture)}")
        self.assertEqual(writer_drive.used_nodes(self.docname(copied)), {copied_picture})
        source_image = self.opened(node).get("default", type=pycrdt.XmlFragment).children[0]
        self.assertEqual(dict(source_image.attributes), {"src": embed(picture)})

    def test_a_copy_starts_at_the_highest_schema_its_source_holds(self):
        node = self.new_document()
        picture = self.old_media(node, "picture.png")
        self.type_into(node, ["one"])
        with patch.object(routes, "SCHEMA", replace(routes.SCHEMA, version=2)):
            self.edit(
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

        def change(body):
            body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)}))
            meta = body.doc.get("meta", type=pycrdt.Map)
            meta["pictures"] = pycrdt.Array([embed(picture), [picture]])
            meta["note"] = pycrdt.Text(embed(picture))

        with declaring("pictures", "note"):
            self.edit(node, change)

        copied = self.copy_of(node)

        [copied_picture] = frappe.get_all("Drive Node", {"parent_node": copied, "kind": "file"}, pluck="name")
        meta = self.opened(copied).get("meta", type=pycrdt.Map)
        self.assertEqual(meta["pictures"].to_py(), [embed(copied_picture), [copied_picture]])
        self.assertEqual(str(meta["note"]), embed(picture))

    def test_with_collaboration_off_every_callback_leaves_the_log_alone(self):
        node = self.new_document()
        picture = self.old_media(node, "picture.png")
        self.edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed(picture)}))
        )
        before = self.checkpoints_of(node), self.row_count(node)
        frappe.db.set_single_value("Suite Collab Settings", "mode", "off")
        frappe.db.commit()

        writer_drive.remap_media(self.docname(node), {picture: "elsewhere"})
        writer_drive.export(self.docname(node), "html")
        self.assertEqual(version_of(self.docname(node))["schema"], "writer-document/1")

        self.assertEqual((self.checkpoints_of(node), self.row_count(node)), before)

    def test_a_copys_start_cannot_change_once_a_tab_has_a_session(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        copied = self.copy_of(node)
        call(routes.collab_sessions_post, copied, body=json.dumps({"sid": uuid.uuid4().hex}).encode())

        with self.assertRaises(ValueError):
            content.replace_start("writer", self.doc_row(copied).id, pycrdt.Doc().get_update(), 1)

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

    def purged(self, node: str) -> str:
        """Trash and purge `node` through Drive as its owner, then commit; answers its log's id."""
        doc_id = self.doc_row(node).id
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with patch.object(scheduling, "enqueue") as enqueue:
            _trash(owner, node)
            purge(owner, node)
            frappe.db.commit()
        enqueue.assert_called_once()
        self.assertEqual(enqueue.call_args.kwargs["enqueue_after_commit"], True)
        return doc_id

    def rows_of(self, doc_id: str) -> dict:
        return {
            kind: frappe.db.sql(
                f"SELECT COUNT(*) FROM `__writer_content_{kind}` WHERE `{'id' if kind == 'doc' else 'doc_id'}` = %s",
                doc_id,
            )[0][0]
            for kind in ("doc", "update", "checkpoint", "session", "stage")
        }

    def test_a_purge_marks_the_log_and_its_job_deletes_every_row_in_batches(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        self.compact(node)
        self.type_into(node, [" four"])
        frappe.db.sql(
            """INSERT INTO `__writer_content_stage` (`doc_id`, `stage_id`, `idx`, `purpose`, `sid`, `total_len`,
            `sha_total`, `bytes`, `created`) VALUES (%s, %s, 0, 'save', %s, 1, UNHEX(%s), 'x', NOW())""",
            (self.doc_row(node).id, "a" * 32, "b" * 32, "00" * 32),
        )

        doc_id = self.purged(node)

        self.assertEqual(frappe.db.get_value("Drive Node", node, "name"), None, "Drive purged the node")
        self.assertEqual(
            frappe.db.sql("SELECT `mode` FROM `__writer_content_doc` WHERE `id` = %s", doc_id)[0][0], "purged"
        )
        with patch.object(log, "PURGE_BATCH", 2):
            writer_collab.delete_purged(doc_id)
        self.assertEqual(
            self.rows_of(doc_id), {"doc": 0, "update": 0, "checkpoint": 0, "session": 0, "stage": 0}
        )

    def test_the_sweeper_finishes_a_purge_whose_job_never_ran(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.purged(node)

        with patch.object(scheduling, "enqueue") as enqueue:
            writer_collab.sweep()

        self.assertIn(
            (
                ("suite.writer.collab.delete_purged", f"suite-collab-purge-writer-{doc_id}"),
                {"doc_id": doc_id},
            ),
            [(call.args, call.kwargs) for call in enqueue.call_args_list],
        )
        writer_collab.delete_purged(doc_id)
        self.assertEqual(self.rows_of(doc_id)["update"], 0)

    def test_a_compaction_never_stores_a_checkpoint_for_a_purged_log(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()

        writer_collab.compact(doc_id)

        self.assertEqual(self.rows_of(doc_id)["checkpoint"], 0)
        writer_collab.delete_purged(doc_id)

    def test_a_compaction_during_a_purge_raises_no_alert(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        doc_id = self.purged(node)
        # The purge job has deleted the first rows and not yet the rest
        frappe.db.sql("DELETE FROM `__writer_content_update` WHERE `doc_id` = %s AND `rev` = 1", doc_id)
        frappe.db.commit()
        alerts = frappe.db.count("Error Log", {"method": "Collab compaction: chain_break"})

        writer_collab.compact(doc_id)

        self.assertEqual(frappe.db.count("Error Log", {"method": "Collab compaction: chain_break"}), alerts)
        writer_collab.delete_purged(doc_id)

    def test_a_purged_log_reads_as_missing_on_every_route(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        sid = uuid.uuid4().hex
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()
        self.addCleanup(writer_collab.delete_purged, doc_id)

        header, _checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        self.assertEqual((header["state"], rows), ("unconverted", []))
        for handler, body in (
            (routes.collab_updates_get, b""),
            (routes.collab_sessions_post, json.dumps({"sid": sid}).encode()),
            (routes.collab_updates_post, push_body("x", sid, 1, 1, 0, b"\x00")),
        ):
            self.assertEqual(answer(call(handler, node, body=body)), {"collab": "unconverted"})
        self.assertEqual(self.rows_of(doc_id)["update"], 1)
        self.assertEqual(self.rows_of(doc_id)["session"], 1)

    def test_a_push_that_meets_a_purge_is_refused_and_writes_nothing(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        sid = uuid.uuid4().hex
        cid = answer(call(routes.collab_sessions_post, node, body=json.dumps({"sid": sid}).encode()))[
            "client_id"
        ]
        lineage = self.doc_row(node).lineage
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()
        self.addCleanup(writer_collab.delete_purged, doc_id)
        doc = pycrdt.Doc(client_id=cid)
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText("two"))
        header, payload = content.parse_push(push_body(lineage, sid, cid, 1, 1, doc.get_update()))

        with self.assertRaises(content.Refusal) as refused:
            content.push(routes.ADAPTER, doc_id, header, payload, WRITER, routes.SCHEMA)

        self.assertEqual((refused.exception.status, refused.exception.body), (404, {"collab": "not_found"}))
        self.assertEqual(self.rows_of(doc_id)["update"], 1)

    def test_drive_refuses_to_export_a_collab_document(self):
        node = self.new_document()
        self.type_into(node, ["one"])

        with self.assertRaisesRegex(drive.DriveConflict, "Open the document to download it"):
            writer_drive.export(self.docname(node), "html")

    def purging_on_find(self):
        """A purge that lands after a log is found and before it is read."""
        found = content.find

        def find(adapter: str, node: str):
            doc = found(adapter, node)
            if doc:
                frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc.id)
                self.addCleanup(writer_collab.delete_purged, doc.id)
            return doc

        return patch.object(content, "find", find)

    def test_a_log_purged_between_finding_and_reading_it_reads_as_missing(self):
        reads = (
            (
                "open",
                lambda node: read_open(call(routes.collab_get, node).get_data())[0]["state"],
                "unconverted",
            ),
            ("live state", writer_collab.live_state, None),
            ("live checkpoint", writer_collab.live_checkpoint, None),
            ("remap", lambda node: writer_collab.remap_log(node, lambda value: value), None),
        )
        for name, read, expected in reads:
            with self.subTest(read=name):
                node = self.new_document()
                self.type_into(node, ["one"])
                with self.purging_on_find():
                    self.assertEqual(read(node), expected)
