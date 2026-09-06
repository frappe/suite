"""Writer's adoption of the Drive content contract (ticket 17, §10.7).

`TestWriterDeclaration` proves the declaration and the body callbacks with no
rows. `TestWriterInDrive` proves the lifecycle, history, media, permissions,
failure rollback, and legacy compatibility on real rows.

The integration class reaches `suite.drive._core` for the workflows the
package root does not expose yet: roots, trash, media upload, and version
restore. Those imports are recorded as owned debt in
`suite/tests/test_architecture.py` and go when tickets 21 and 22 put those
workflows behind HTTP.
"""

import base64
import dataclasses
import io
import json
from unittest.mock import patch

import frappe
import frappe.share
import pycrdt
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveConflict, DriveForbidden
from suite.drive._core.nodes import create_file, create_folder, purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version
from suite.tests.utils import ensure_user
from suite.writer import drive as writer
from suite.writer.doctype.writer_document.writer_document import WriterDocument

USER = "writer-adoption-user@example.com"
OTHER = "writer-adoption-other@example.com"

DOCTYPE = "Writer Document"

# Valid base64, but not a Yjs update: pycrdt panics on it.
BROKEN_BODY = b"suite.writer.api.embed.get?id=survivor and then garbage"


def body_with(*ids: str) -> str:
    """Build one base64 Yjs body naming `ids` the way the editor does."""
    document = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[writer.BODY_FRAGMENT] = fragment
    with document.transaction():
        paragraph = fragment.children.append(pycrdt.XmlElement("paragraph"))
        for found in ids:
            paragraph.children.append(
                pycrdt.XmlElement(
                    "image",
                    {"src": f"/api/method/suite.writer.api.embed.get?id={found}"},
                )
            )
    return base64.b64encode(document.get_update()).decode("ascii")


def body_ids(content: str) -> set[str]:
    """Read back the ids one encoded body names, through pycrdt."""
    return writer._body_ids(content)


def html_with(*ids: str) -> str:
    pictures = "".join(f'<img src="/api/method/suite.writer.api.embed.get?id={found}">' for found in ids)
    return f"<p>hello</p>{pictures}"


class TestWriterDeclaration(UnitTestCase):
    """The declaration, the version envelope, and the two body readers."""

    # the declaration

    def test_writer_declares_the_identity_section_ten_seven_fixes(self):
        self.assertEqual(writer.SPEC.doctype, DOCTYPE)
        self.assertEqual(writer.SPEC.mime, "frappe/writer")
        self.assertEqual(writer.SPEC.node_field, "node")
        self.assertEqual(writer.SPEC.satellites, ())
        self.assertFalse(writer.SPEC.pushes_preview, "Drive never renders a Writer document")

    def test_writer_stays_hidden_over_dav_and_keeps_its_explicit_html_export(self):
        self.assertIsNone(writer.SPEC.default_export, "no default export means invisible over DAV")
        self.assertEqual(writer.SPEC.export_formats, ("html",))
        self.assertTrue(callable(writer.SPEC.export))

    def test_every_callback_the_ticket_names_is_declared(self):
        for name in (
            "create_empty",
            "duplicate",
            "export",
            "version_bytes",
            "restore_version",
            "on_purge",
            "used_nodes",
            "remap_media",
        ):
            with self.subTest(callback=name):
                self.assertTrue(callable(getattr(writer.SPEC, name)), name)

    def test_the_controller_carries_the_drive_mixin(self):
        self.assertTrue(issubclass(WriterDocument, drive.DriveContent))

    def test_the_two_framework_hooks_point_at_drive_and_no_writer_code(self):
        from suite import hooks

        self.assertEqual(hooks.drive_content_types, ["suite.writer.drive.SPEC"])
        self.assertEqual(hooks.has_permission[DOCTYPE], "suite.drive.framework.doc_has_permission")
        self.assertEqual(
            hooks.permission_query_conditions[DOCTYPE],
            "suite.drive.framework.doc_query_conditions",
        )

    # the version envelope

    def test_a_version_envelope_round_trips_the_body_and_its_html(self):
        payload = {"schema": writer.VERSION_SCHEMA, "content": body_with("m1"), "html": "<p>x</p>"}
        read = writer._version_payload(json.dumps(payload).encode("utf-8"))
        self.assertEqual(read, {"content": payload["content"], "html": payload["html"]})

    def test_a_legacy_html_snapshot_is_refused_rather_than_half_restored(self):
        # §14.6 migrates `Writer Version` rows as snapshot HTML. A Yjs body
        # cannot be rebuilt from HTML outside the editor, so restoring one
        # would leave the collaborative body and the HTML disagreeing.
        with self.assertRaises(frappe.ValidationError):
            writer._version_payload(b"<p>an old snapshot</p>")

    def test_an_envelope_of_another_schema_or_shape_is_refused(self):
        for raw in (
            b"{}",
            json.dumps({"schema": "writer-document/2", "content": "a", "html": ""}).encode(),
            json.dumps({"schema": writer.VERSION_SCHEMA, "content": "", "html": ""}).encode(),
            json.dumps({"schema": writer.VERSION_SCHEMA, "content": "a", "html": None}).encode(),
        ):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    # used-node discovery

    def test_a_media_id_is_found_in_both_spellings_a_body_uses(self):
        html = '<img src="/api/method/writer.api.embed.get?id=one"><img data-node="two">'
        self.assertEqual(writer._ids_in(html), {"one", "two"})

    def test_the_yjs_body_answers_live_attributes_only(self):
        # The read is exact: a removed picture stops being named at once, and a
        # rewritten attribute names only its new id. A raw scan of the update
        # bytes would instead match every id-shaped run of text in them.
        content = body_with("keep", "drop")
        document, fragment = writer._loaded_body(base64.b64decode(content))
        with document.transaction():
            paragraph = fragment.children[0]
            del paragraph.children[1]
        rewritten = base64.b64encode(document.get_update()).decode("ascii")

        self.assertEqual(body_ids(rewritten), {"keep"}, "a removed picture is not still named")

    def test_an_empty_or_unreadable_body_names_nothing_it_can_read(self):
        self.assertEqual(body_ids(""), set())
        self.assertEqual(body_ids(writer.EMPTY_BODY), set())
        self.assertEqual(body_ids("not base64 at all !!"), set())

    def test_an_undecodable_body_over_reports_instead_of_losing_a_picture(self):
        # A body pycrdt cannot read must never cost somebody a picture, so the
        # raw scan stands in. It over-reports, which only keeps media alive.
        broken = base64.b64encode(BROKEN_BODY).decode("ascii")
        with patch.object(frappe, "log_error"):
            self.assertEqual(body_ids(broken), {"survivor"})

    def test_a_body_pycrdt_cannot_read_refuses_as_an_ordinary_validation_error(self):
        # pycrdt is a Rust extension and raises `pyo3_runtime.PanicException`,
        # which derives from `BaseException`. Unconverted it would pass through
        # the `except Exception` that rolls Drive's copy savepoint back.
        broken = base64.b64encode(BROKEN_BODY).decode("ascii")
        with self.assertRaises(writer.UnreadableBody) as refused:
            writer._remap_body(broken, {"survivor": "other"})
        self.assertIsInstance(refused.exception, frappe.ValidationError)

    # media remapping

    def test_a_rewrite_touches_only_the_ids_it_was_given(self):
        html = html_with("old", "untouched")
        rewritten = writer._remap_text(html, {"old": "new"})
        self.assertIn("id=new", rewritten)
        self.assertIn("id=untouched", rewritten)
        self.assertNotIn("id=old", rewritten)

    def test_a_body_rewrite_survives_a_yjs_round_trip(self):
        rewritten = writer._remap_body(body_with("old"), {"old": "new"})
        self.assertIsNotNone(rewritten)
        self.assertEqual(body_ids(rewritten), {"new"})

    def test_a_body_that_names_nothing_to_remap_is_left_alone(self):
        self.assertIsNone(writer._remap_body(body_with("other"), {"old": "new"}))
        self.assertIsNone(writer._remap_body(None, {"old": "new"}))


class TestWriterInDrive(IntegrationTestCase):
    """Lifecycle, history, media, permissions, and legacy rows, on real rows."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        # A run killed between `setUp` and its cleanup leaves the fixture roots
        # behind, and `create_root` then refuses every later run.
        _purge_fixture_roots()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        # Registered before the first row exists, so a `setUp` that dies half
        # way still hands its roots back.
        self.addCleanup(self._remove_fixture_rows)
        self.root = create_root(kind="Personal", title="Writer Root", user=USER)
        self.other_root = create_root(kind="Personal", title="Writer Other", user=OTHER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.person = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))

    def _remove_fixture_rows(self):
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    # helpers

    def _document(self, title="Report", parent=None, **kwargs) -> str:
        return drive.create_document(
            parent or self.root.node,
            title,
            content_doctype=DOCTYPE,
            **kwargs,
        )

    def _docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def _write_body(self, node: str, *ids: str) -> None:
        frappe.db.set_value(
            DOCTYPE,
            self._docname(node),
            {"content": body_with(*ids), "html": html_with(*ids)},
            update_modified=False,
        )

    def _media(self, node: str, title: str, payload: bytes) -> str:
        blob = put_blob(io.BytesIO(payload), is_private=True, filename=title)
        with patch("suite.drive._core.previews.enqueue_render"):
            return create_file(
                self.admin,
                node,
                title,
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )

    def _used_bytes(self) -> int:
        return frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

    def _as(self, user: str):
        frappe.set_user(user)
        self.addCleanup(frappe.set_user, "Administrator")

    # creation, and the immutable link

    def test_a_new_document_carries_its_node_and_its_node_carries_it(self):
        node = self._document()
        row = frappe.db.get_value(
            "Drive Node", node, ("kind", "mime", "title", "content_doctype", "content_docname"), as_dict=True
        )
        self.assertEqual(row.kind, "document")
        self.assertEqual(row.mime, "frappe/writer")
        self.assertEqual(row.title, "Report")
        self.assertEqual(row.content_doctype, DOCTYPE)
        self.assertEqual(frappe.db.get_value(DOCTYPE, row.content_docname, "node"), node)

    def test_a_document_without_a_node_cannot_exist(self):
        with self.assertRaises(DriveConflict):
            frappe.new_doc(DOCTYPE).insert(ignore_permissions=True)

    def test_a_saved_document_cannot_repoint_itself_at_another_node(self):
        first = self._document(title="First")
        second = self._document(title="Second")
        document = frappe.get_doc(DOCTYPE, self._docname(first))
        document.node = second
        with self.assertRaises(DriveConflict):
            document.save(ignore_permissions=True)

    def test_the_document_owns_no_field_drive_owns(self):
        meta = frappe.get_meta(DOCTYPE)
        for forbidden in ("title", "trashed", "trashed_at", "trashed_on", "trashed_by"):
            self.assertIsNone(meta.get_field(forbidden), forbidden)
        self.assertFalse([f for f in meta.fields if (f.fieldname or "").startswith(("share_", "shared_"))])
        node_field = meta.get_field("node")
        self.assertEqual((node_field.fieldtype, node_field.options), ("Link", "Drive Node"))

    def test_the_title_is_read_from_the_node_and_never_mirrored(self):
        node = self._document(title="Quarterly")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        self.assertEqual(document.node_title, "Quarterly")

    # templates

    def test_a_template_starts_a_new_document_and_drops_the_template_flag(self):
        template = self._document(title="Letterhead", is_template=True)
        frappe.db.set_value(DOCTYPE, self._docname(template), "html", "<p>Dear</p>", update_modified=False)
        started = self._document(title="Letter", from_node=template)

        self.assertTrue(frappe.db.get_value("Drive Node", template, "is_template"))
        self.assertFalse(frappe.db.get_value("Drive Node", started, "is_template"))
        self.assertEqual(frappe.db.get_value(DOCTYPE, self._docname(started), "html"), "<p>Dear</p>")

    # copy, and the media it carries

    def test_a_copy_carries_the_body_and_repoints_it_at_the_copied_pictures(self):
        node = self._document(title="Illustrated")
        picture = self._media(node, "one.png", b"picture-one")
        self._write_body(node, picture)

        copied = drive.copy(node, self.root.node, title="Illustrated copy")
        copied_media = frappe.get_all(
            "Drive Node", filters={"parent": copied, "state": "Active"}, pluck="name"
        )
        self.assertEqual(len(copied_media), 1)
        self.assertNotEqual(copied_media[0], picture)

        row = frappe.db.get_value(DOCTYPE, self._docname(copied), ("content", "html"), as_dict=True)
        self.assertEqual(body_ids(row.content), {copied_media[0]}, "the Yjs body follows the copy")
        self.assertIn(f"id={copied_media[0]}", row.html, "the HTML mirror follows the copy")
        self.assertNotIn(picture, row.html)

    def test_one_picture_used_twice_becomes_one_node_and_one_charge(self):
        node = self._document(title="Twice")
        picture = self._media(node, "logo.png", b"logo-bytes")
        self._write_body(node, picture, picture)
        before = self._used_bytes()

        copied = drive.copy(node, self.root.node, title="Twice copy")
        copied_media = frappe.get_all("Drive Node", filters={"parent": copied}, pluck="name")

        self.assertEqual(len(copied_media), 1, "one media node per blob inside one document")
        self.assertEqual(self._used_bytes(), before + len(b"logo-bytes"))

    def test_a_copy_carries_no_comment_blob(self):
        node = self._document(title="Discussed")
        frappe.db.set_value(DOCTYPE, self._docname(node), "ycomments", "AAA=", update_modified=False)
        copied = drive.copy(node, self.root.node, title="Discussed copy")
        self.assertFalse(frappe.db.get_value(DOCTYPE, self._docname(copied), "ycomments"))

    # failure and rollback

    def test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge(self):
        node = self._document(title="Fragile")
        picture = self._media(node, "one.png", b"picture-one")
        self._write_body(node, picture)
        nodes_before = frappe.db.count("Drive Node")
        documents_before = frappe.db.count(DOCTYPE)
        bytes_before = self._used_bytes()

        with patch.object(writer, "_remap_body", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                drive.copy(node, self.root.node, title="Fragile copy")

        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), documents_before)
        self.assertEqual(self._used_bytes(), bytes_before)

    def test_a_refused_create_leaves_neither_a_node_nor_a_document(self):
        nodes_before = frappe.db.count("Drive Node")
        documents_before = frappe.db.count(DOCTYPE)

        def explode(node):
            raise RuntimeError("boom")

        broken = dataclasses.replace(writer.SPEC, create_empty=explode)
        with patch("suite.drive._core.content.spec_for", return_value=broken):
            with self.assertRaises(RuntimeError):
                self._document(title="Never")

        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), documents_before)

    def test_a_stranger_cannot_create_a_document_in_somebody_elses_drive(self):
        documents_before = frappe.db.count(DOCTYPE)
        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            drive.create_document(self.root.node, "Intruder", content_doctype=DOCTYPE)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.count(DOCTYPE), documents_before)

    # history

    def test_a_version_round_trips_the_collaborative_body_and_its_html(self):
        node = self._document(title="Versioned")
        docname = self._docname(node)
        first = body_with("first")
        frappe.db.set_value(
            DOCTYPE, docname, {"content": first, "html": "<p>first</p>"}, update_modified=False
        )

        self._as(USER)
        seq = drive.take_version(node, kind="named", label="before the edit")
        frappe.set_user("Administrator")

        frappe.db.set_value(
            DOCTYPE,
            docname,
            {"content": body_with("second"), "html": "<p>second</p>"},
            update_modified=False,
        )
        restore_version(self.person, node, seq)

        row = frappe.db.get_value(DOCTYPE, docname, ("content", "html"), as_dict=True)
        self.assertEqual(body_ids(row.content), {"first"})
        self.assertEqual(row.html, "<p>first</p>")

    def test_a_restore_keeps_the_state_it_replaced_as_history(self):
        node = self._document(title="Kept")
        docname = self._docname(node)
        frappe.db.set_value(DOCTYPE, docname, "content", body_with("first"), update_modified=False)
        seq = drive.take_version(node)
        frappe.db.set_value(DOCTYPE, docname, "content", body_with("second"), update_modified=False)

        captured = restore_version(self.admin, node, seq)
        self.assertGreater(captured, seq, "the state a restore replaced is versioned first")
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 2)

    def test_the_document_method_takes_a_version_through_drive(self):
        node = self._document(title="Methodical")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        self._as(USER)
        seq = document.take_version(label="milestone")
        frappe.set_user("Administrator")

        row = frappe.db.get_value(
            "Drive Node Version", {"node": node, "seq": seq}, ("kind", "label", "actor"), as_dict=True
        )
        self.assertEqual((row.kind, row.label, row.actor), ("named", "milestone", USER))

    # the body callbacks Drive drives

    def test_the_html_export_streams_the_stored_body(self):
        node = self._document(title="Exported")
        frappe.db.set_value(DOCTYPE, self._docname(node), "html", "<p>bye</p>", update_modified=False)
        stream, mime = writer.SPEC.export(self._docname(node), "html")
        self.assertEqual((stream.read(), mime), (b"<p>bye</p>", "text/html"))

    def test_an_export_format_writer_does_not_offer_is_refused(self):
        node = self._document(title="Refused")
        with self.assertRaises(frappe.ValidationError):
            writer.SPEC.export(self._docname(node), "pdf")

    def test_a_purge_removes_the_document_its_media_and_its_legacy_versions(self):
        node = self._document(title="Purged")
        docname = self._docname(node)
        picture = self._media(node, "one.png", b"picture-one")
        legacy = frappe.get_doc(
            {"doctype": "Writer Version", "doc": docname, "snapshot": "<p>old</p>", "title": "old"}
        ).insert(ignore_permissions=True)

        update(self.admin, node, state="Trashed")
        purge(self.admin, node)

        self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertFalse(frappe.db.exists("Drive Node", picture))
        self.assertFalse(frappe.db.exists(DOCTYPE, docname))
        self.assertFalse(frappe.db.exists("Writer Version", legacy.name))

    def test_the_body_answers_only_the_pictures_it_still_names(self):
        """The one question §10.6 asks the app. Drive owns the trashing itself,
        and the daily pass is not run here: it would sweep every document on
        the site, and a shared-site test never touches a live user's rows."""
        node = self._document(title="Swept")
        kept = self._media(node, "kept.png", b"kept-bytes")
        self._media(node, "forgotten.png", b"forgotten-bytes")
        self._write_body(node, kept)

        self.assertEqual(writer.SPEC.used_nodes(self._docname(node)), {kept})

    # authorization

    def test_a_reader_cannot_save_the_body_and_an_editor_can(self):
        node = self._document(title="Guarded")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        grant(node, OTHER, drive.READ, self.admin)

        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            document.save_doc(body_with("x"))
        frappe.set_user("Administrator")

        grant(node, OTHER, drive.EDIT, self.admin)
        self._as(OTHER)
        document.save_doc(body_with("x"), html="<p>x</p>")
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value(DOCTYPE, document.name, "html"), "<p>x</p>")

    def test_a_save_stamps_the_node_and_never_the_document_title(self):
        node = self._document(title="Stamped")
        before = frappe.db.get_value("Drive Node", node, "content_modified")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        document.save_html("<p>new</p>")
        after = frappe.db.get_value("Drive Node", node, ("content_modified", "title"), as_dict=True)
        self.assertGreaterEqual(after.content_modified, before)
        self.assertEqual(after.title, "Stamped")

    def test_an_inherited_folder_grant_reaches_the_row_and_the_list(self):
        folder = create_folder(self.admin, self.root.node, "Shared folder")
        node = self._document(title="Inherited", parent=folder)
        docname = self._docname(node)
        grant(folder, OTHER, drive.READ, self.admin)
        frappe.db.commit()

        self._as(OTHER)
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertIn(docname, frappe.get_list(DOCTYPE, pluck="name"))
        self.assertFalse(frappe.has_permission(DOCTYPE, "write", docname))

    def test_a_stranger_reads_neither_the_row_nor_the_list(self):
        node = self._document(title="Private")
        docname = self._docname(node)
        frappe.db.commit()

        self._as(OTHER)
        self.assertFalse(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertNotIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

    def test_a_trashed_document_stays_readable_and_leaves_the_list(self):
        node = self._document(title="Binned")
        docname = self._docname(node)
        update(self.admin, node, state="Trashed")
        frappe.db.commit()

        self._as(USER)
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname), "the bin opens read-only")
        self.assertNotIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

    # compatibility with what Build has not copied yet

    def test_a_docshare_cannot_open_a_document_the_grants_refuse(self):
        node = self._document(title="Unshared")
        docname = self._docname(node)
        with self.assertRaises(DriveForbidden):
            frappe.share.add(DOCTYPE, docname, OTHER, read=1)

        # A row written before adoption is refused on the read side too.
        share = frappe.get_doc(
            {"doctype": "DocShare", "share_doctype": DOCTYPE, "share_name": docname, "read": 1, "user": OTHER}
        )
        share.flags.ignore_validate = True
        share.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            frappe.has_permission(DOCTYPE, "read", docname)

    def test_the_legacy_columns_and_doctypes_survive_adoption(self):
        # §14.6 and §14.7: Build copies these, Cleanup removes them. Nothing
        # in this ticket may drop them early.
        meta = frappe.get_meta(DOCTYPE)
        for legacy in ("html", "ycomments", "versions", "updates", "collab", "content", "settings"):
            self.assertIsNotNone(meta.get_field(legacy), legacy)
        for doctype in ("Writer Version", "Writer Template", "Writer Doc Version"):
            self.assertTrue(frappe.db.exists("DocType", doctype), doctype)

    def test_a_legacy_version_row_survives_an_ordinary_save(self):
        node = self._document(title="Historic")
        docname = self._docname(node)
        legacy = frappe.get_doc(
            {"doctype": "Writer Version", "doc": docname, "snapshot": "<p>old</p>", "title": "old"}
        ).insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc,
            "Writer Version",
            legacy.name,
            force=1,
            ignore_permissions=True,
            ignore_missing=True,
        )

        frappe.get_doc(DOCTYPE, docname).save_html("<p>new</p>")
        self.assertTrue(frappe.db.exists("Writer Version", legacy.name))


def _purge_fixture_roots() -> None:
    """Hand back every Drive root the two fixture users own, through Drive's purge.

    `USER` and `OTHER` belong to this module alone, so the filter can never
    reach a live account or another test.
    """
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    roots = frappe.get_all("Drive Root", filters={"user": ["in", (USER, OTHER)]}, pluck="name")
    for root in roots:
        if frappe.db.get_value("Drive Root", root, "state") == "Active":
            update_root(root, admin, state="Archived")
        purge_root(root, admin)
