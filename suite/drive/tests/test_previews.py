import io
import json
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.tests import IntegrationTestCase, UnitTestCase
from PIL import Image

from suite.drive._core.errors import DriveForbidden
from suite.drive._core.nodes import copy, create_file, purge, update
from suite.drive._core.previews import (
    PREVIEW_LONGEST_SIDE,
    PREVIEW_TTL_SECONDS,
    RENDERABLE_MIMES,
    _publish_rendered,
    preview_expansions,
    push_preview,
    render,
    sweep_missing,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.drive._core.roots import create_root
from suite.tests.utils import ensure_user

USER = "drive-preview-user@example.com"
OTHER = "drive-preview-other@example.com"


def _png(width: int = 1024, height: int = 256, color: str = "red") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), color).save(output, format="PNG")
    return output.getvalue()


class TestPreviewContract(UnitTestCase):
    def test_schema_is_one_row_per_node_and_both_blobs_are_gc_references(self):
        schema_path = Path(__file__).parents[1] / "doctype" / "drive_node_preview" / "drive_node_preview.json"
        fields = {field["fieldname"]: field for field in json.loads(schema_path.read_text())["fields"]}
        self.assertEqual(fields["node"]["options"], "Drive Node")
        self.assertEqual(fields["node"]["unique"], 1)
        self.assertEqual(fields["source_blob"]["options"], "File Blob")
        self.assertEqual(fields["source_blob"]["search_index"], 1)
        self.assertEqual(fields["blob"]["options"], "File Blob")
        self.assertEqual(fields["blob"]["search_index"], 1)

    def test_preview_expansion_is_explicit_batched_and_fifteen_minutes(self):
        rows = [frappe._dict(node="node-a", blob="preview-a")]
        with (
            patch("suite.drive._core.previews.frappe.get_all", return_value=rows) as get_all,
            patch("suite.drive._core.previews.time.time", return_value=100),
            patch(
                "suite.drive._core.previews.signed_url_for_blob",
                return_value="/f/preview-a/node-a.webp?e=1000&s=sig",
            ) as signed,
        ):
            self.assertEqual(
                preview_expansions(["node-a", "node-a"]),
                {
                    "node-a": {
                        "url": "/f/preview-a/node-a.webp?e=1000&s=sig",
                        "expires": 100 + PREVIEW_TTL_SECONDS,
                    }
                },
            )
        get_all.assert_called_once()
        self.assertEqual(get_all.call_args.kwargs["filters"], {"node": ["in", ("node-a",)]})
        signed.assert_called_once_with("preview-a", "node-a.webp", PREVIEW_TTL_SECONDS)

        with patch("suite.drive._core.previews.signed_url_for_blob") as signed:
            self.assertEqual(preview_expansions([]), {})
        signed.assert_not_called()

    @patch("suite.drive._core.previews.frappe.enqueue")
    def test_enqueue_uses_the_post_commit_short_queue(self, enqueue):
        from suite.drive._core.previews import enqueue_render

        enqueue_render("node")

        enqueue.assert_called_once_with(
            "suite.drive._core.previews.render",
            queue="short",
            enqueue_after_commit=True,
            node="node",
        )

    def test_renderable_mimes_are_an_explicit_sweep_safe_set(self):
        self.assertEqual(tuple(sorted(RENDERABLE_MIMES)), RENDERABLE_MIMES)
        self.assertIn("image/png", RENDERABLE_MIMES)
        self.assertIn("video/mp4", RENDERABLE_MIMES)
        self.assertIn("application/pdf", RENDERABLE_MIMES)
        self.assertNotIn("image/svg+xml", RENDERABLE_MIMES)


class TestPreviews(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        self.root = create_root(kind="Personal", title="Preview Root", user=USER)
        self.other_root = create_root(kind="Personal", title="Preview Other", user=OTHER)
        self.root_ids = (self.root.name, self.other_root.name)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        frappe.cache().delete_value("drive:preview-sweep-cursor:slides.localhost")

    def tearDown(self):
        frappe.set_user("Administrator")
        placeholders = ", ".join(["%s"] * len(self.root_ids))
        node_ids = tuple(
            frappe.db.sql(
                f"SELECT name FROM `tabDrive Node` WHERE name IN ({placeholders}) "
                f"OR root IN ({placeholders})",
                self.root_ids * 2,
                pluck=True,
            )
        )
        if node_ids:
            for doctype in ("Drive Node Preview", "Drive Node Version", "Drive Grant", "Drive Activity"):
                frappe.db.delete(doctype, {"node": ["in", node_ids]})
            frappe.db.delete("Drive Node", {"name": ["in", node_ids]})
        frappe.db.delete("Drive Root", {"name": ["in", self.root_ids]})
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.cache().delete_value("drive:preview-sweep-cursor:slides.localhost")
        frappe.db.commit()
        super().tearDown()

    def _blob(self, content: bytes, filename: str = "source.png"):
        return put_blob(io.BytesIO(content), is_private=True, filename=filename)

    def _file(self, title: str, content: bytes | None = None, parent: str | None = None) -> str:
        blob = self._blob(content or _png())
        with patch("suite.drive._core.previews.enqueue_render"):
            return create_file(
                self.admin,
                parent or self.root.name,
                title,
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )

    def _document(self, title: str = "Document") -> str:
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": title,
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "document",
                    "content_doctype": "ToDo",
                    "content_docname": f"preview-{frappe.generate_hash(length=8)}",
                    "mime": "frappe/test",
                    "state": "Active",
                }
            )
            .insert(ignore_permissions=True, ignore_links=True)
            .name
        )

    def _preview_image(self, node: str) -> Image.Image:
        preview_blob = frappe.db.get_value("Drive Node Preview", {"node": node}, "blob")
        blob = frappe.get_doc("File Blob", preview_blob)
        driver = get_driver(blob.driver)
        with driver.read(blob.key, is_private=True) as stream:
            image = Image.open(stream)
            image.load()
        return image

    def test_render_makes_a_free_512_longest_side_webp(self):
        node = self._file("wide.png", _png(1024, 256))
        usage = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

        render(node)

        row = frappe.db.get_value("Drive Node Preview", {"node": node}, ["source_blob", "blob"], as_dict=True)
        self.assertEqual(row.source_blob, frappe.db.get_value("Drive Node", node, "blob"))
        self.assertEqual(self._preview_image(node).size, (PREVIEW_LONGEST_SIDE, 128))
        self.assertEqual(frappe.get_doc("File Blob", row.blob).mime_type, "image/webp")
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), usage)

    def test_duplicate_source_reuses_the_preview_blob_without_rendering(self):
        content = _png(640, 320)
        first = self._file("first.png", content)
        second = self._file("second.png", content)
        render(first)
        expected = frappe.db.get_value("Drive Node Preview", {"node": first}, "blob")

        with patch("suite.drive._core.previews._render_webp") as render_webp:
            render(second)

        render_webp.assert_not_called()
        self.assertEqual(frappe.db.get_value("Drive Node Preview", {"node": second}, "blob"), expected)

    def test_unsupported_mime_writes_no_preview(self):
        blob = self._blob(b"plain bytes", "notes.txt")
        with patch("suite.drive._core.previews.enqueue_render"):
            node = create_file(
                self.admin,
                self.root.name,
                "notes.txt",
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )

        render(node)

        self.assertFalse(frappe.db.exists("Drive Node Preview", {"node": node}))

    def test_replacement_invalidates_and_a_stale_publish_cannot_restore_the_old_preview(self):
        node = self._file("replace.png", _png(color="red"))
        render(node)
        old_source = frappe.db.get_value("Drive Node", node, "blob")
        old_preview = frappe.db.get_value("Drive Node Preview", {"node": node}, "blob")
        replacement = self._blob(_png(color="blue"), "replacement.png")

        with patch("suite.drive._core.previews.enqueue_render") as enqueue:
            update(
                self.admin,
                node,
                blob=replacement.name,
                size=replacement.file_size,
                mime=replacement.mime_type,
            )

        self.assertFalse(frappe.db.exists("Drive Node Preview", {"node": node}))
        enqueue.assert_called_once_with(node)
        self.assertFalse(_publish_rendered(node, old_source, old_preview))
        self.assertFalse(frappe.db.exists("Drive Node Preview", {"node": node}))

    def test_push_needs_edit_and_does_not_touch_content_time_or_activity(self):
        node = self._document()
        before = frappe.db.get_value("Drive Node", node, ["modified", "content_modified"], as_dict=True)
        activities = frappe.db.count("Drive Activity", {"node": node})
        frappe.get_doc({"doctype": "Drive Grant", "node": node, "principal": OTHER, "role": READ}).insert(
            ignore_permissions=True
        )
        reader = Principals(OTHER, (OTHER,), ("$PUBLIC",))

        with self.assertRaises(DriveForbidden):
            push_preview(reader, node, _png(), "image/png")
        push_preview(self.admin, node, _png(256, 1024), "image/png")

        row = frappe.db.get_value("Drive Node Preview", {"node": node}, ["source_blob", "blob"], as_dict=True)
        after = frappe.db.get_value("Drive Node", node, ["modified", "content_modified"], as_dict=True)
        self.assertIsNone(row.source_blob)
        self.assertEqual(self._preview_image(node).size, (128, PREVIEW_LONGEST_SIDE))
        self.assertEqual(after, before)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": node}), activities)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root.name, "used_bytes"), 0)

    def test_trash_retains_copy_shares_and_purge_removes_preview_reference(self):
        source = self._file("lifecycle.png")
        render(source)
        preview = frappe.db.get_value("Drive Node Preview", {"node": source}, "blob")

        update(self.admin, source, state="Trashed")
        self.assertTrue(frappe.db.exists("Drive Node Preview", {"node": source}))
        update(self.admin, source, state="Active")

        copied = copy(self.admin, source, self.other_root.name)
        copied_row = frappe.db.get_value(
            "Drive Node Preview", {"node": copied}, ["source_blob", "blob"], as_dict=True
        )
        self.assertEqual(copied_row.blob, preview)
        self.assertEqual(copied_row.source_blob, frappe.db.get_value("Drive Node", copied, "blob"))
        copied_usage = frappe.db.get_value("Drive Root", self.other_root.name, "used_bytes")
        self.assertEqual(copied_usage, frappe.db.get_value("Drive Node", copied, "size"))

        purge(self.admin, copied)
        self.assertFalse(frappe.db.exists("Drive Node Preview", {"node": copied}))
        self.assertTrue(frappe.db.exists("File Blob", preview))

    def test_gap_sweep_queues_only_active_supported_files_without_rows(self):
        missing = self._file("missing.png")
        previewed = self._file("previewed.png", _png(color="green"))
        render(previewed)
        unsupported_blob = self._blob(b"not renderable", "plain.txt")
        with patch("suite.drive._core.previews.enqueue_render"):
            create_file(
                self.admin,
                self.root.name,
                "plain.txt",
                blob=unsupported_blob.name,
                size=unsupported_blob.file_size,
                mime=unsupported_blob.mime_type,
            )
        trashed = self._file("trashed.png", _png(color="purple"))
        update(self.admin, trashed, state="Trashed")
        self._document("No document sweep")

        with patch("suite.drive._core.previews.enqueue_render") as enqueue:
            result = sweep_missing()

        self.assertEqual(result["enqueued"], 1)
        enqueue.assert_called_once_with(missing)

    def test_file_creation_requests_render_after_its_writes(self):
        blob = self._blob(_png())
        with patch("suite.drive._core.previews.enqueue_render") as enqueue:
            node = create_file(
                self.admin,
                self.root.name,
                "queued.png",
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )
        enqueue.assert_called_once_with(node)
