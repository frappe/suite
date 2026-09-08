"""Writer's adoption of the Drive content contract (ticket 17, §10.7).

Adoption was an expand phase. Writer declared its `ContentTypeSpec` at ticket
17 and `Writer Document` gained the `node` Link; ticket 28 linked every row,
and ticket 29 made the registry entry and the two hook changes together. So
`suite/hooks.py` now names `suite.writer.drive.SPEC` and points
`Writer Document` at `suite.drive.framework`.

The three classes here:

`TestWriterDeclaration`   the declaration, the version envelope, and the two
                          body readers, on no rows. It also proves the shipped
                          hook entries.
`TestWriterAfterActivation`
                          what activation settled: the declaration the boot
                          check accepts against the real doctype.
`TestWriterInDrive`       the Drive-native lifecycle, history, media,
                          permissions, and failure rollback.

**A document with no node cannot exist any more.** `require_node` holds §5.13
for a registered doctype, so `suite.writer.api.docs.create_document` and a bare
`insert` both refuse one, and the legacy-row cases this module used to carry are
gone with the state they described. `activated()` stays as a name so every
call site reads the same, and it is now only the registry cache drop.

The integration classes reach `suite.drive._core` for the workflows the package
root does not expose yet: roots, trash, media upload, and version restore. Those
imports are recorded as owned debt in `suite/tests/test_architecture.py` and go
when tickets 21 and 22 put those workflows behind HTTP.
"""

import base64
import dataclasses
import io
import json
from contextlib import contextmanager
from unittest.mock import patch

import frappe
import frappe.share
import pycrdt
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import get_datetime

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.content import clear_registry_cache, governs, spec_for
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_file, purge, update
from suite.drive._core.nodes import create_folder as create_node_folder
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version
from suite.drive.framework import refuse_governed_share, validate_content_registry
from suite.tests.utils import ensure_user
from suite.writer import drive as writer
from suite.writer import overrides
from suite.writer.doctype.writer_document.writer_document import WriterDocument

USER = "writer-adoption-user@example.com"
OTHER = "writer-adoption-other@example.com"

DOCTYPE = "Writer Document"

# The three entries ticket 29 installed together, once Build had linked every
# `Writer Document` row. `suite/hooks.py` carries all of them.
ACTIVATION = {
    "drive_content_types": ["suite.writer.drive.SPEC"],
    "has_permission": ["suite.drive.framework.doc_has_permission"],
    "permission_query_conditions": ["suite.drive.framework.doc_query_conditions"],
}


@contextmanager
def activated():
    """Read the registry `suite/hooks.py` ships, and leave nothing behind.

    Ticket 29 installed every entry in `ACTIVATION`, so there is nothing to
    inject. The registry is built from `drive_content_types` and cached per
    request, and the cache is dropped on the way in and on the way out.
    """
    clear_registry_cache()
    try:
        yield
    finally:
        clear_registry_cache()


@contextmanager
def linked():
    """Answer the Build link check the way a migrated site would.

    `slides.localhost` still holds pre-Build rows, so
    `validate_content_registry` refuses it on the count of unlinked rows. This
    case is about the declaration, not about the site's data;
    `suite/drive/tests/test_content.py` covers the link check itself.
    """
    with patch("suite.drive.framework.refuse_unlinked_documents"):
        yield


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


def node_attribute_body(*ids: str) -> str:
    """Build one body naming `ids` with the plain `data-node` spelling.

    The id is the whole attribute value here, with `data-node` held apart from
    it as the attribute name, which is what `html` never does.
    """
    document = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[writer.BODY_FRAGMENT] = fragment
    with document.transaction():
        paragraph = fragment.children.append(pycrdt.XmlElement("paragraph"))
        for found in ids:
            paragraph.children.append(pycrdt.XmlElement("image", {"data-node": found}))
    return base64.b64encode(document.get_update()).decode("ascii")


def rooted_body(value) -> str:
    """Build one body whose `default` root is not an XmlFragment at all."""
    document = pycrdt.Doc()
    document[writer.BODY_FRAGMENT] = value
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

    # staged activation

    def test_the_declaration_is_registered_and_both_hooks_moved(self):
        """README execution rules: stage the registry and the permission hooks
        after the required node links exist. Ticket 28 wrote the links, ticket
        29 activated, and `refuse_unlinked_documents` is what proves the
        ordering on a real migration."""
        from suite import hooks

        self.assertIn("suite.writer.drive.SPEC", hooks.drive_content_types)
        self.assertEqual(hooks.has_permission[DOCTYPE], "suite.drive.framework.doc_has_permission")
        self.assertEqual(
            hooks.permission_query_conditions[DOCTYPE], "suite.drive.framework.doc_query_conditions"
        )
        clear_registry_cache()
        self.assertTrue(governs(DOCTYPE), "Drive governs the type the registry names")

    def test_a_registered_document_refuses_a_docshare(self):
        """`Drive Grant` is the only permission table for a governed row, and a
        `DocShare` grants around both permission hooks. Desk assignment is what
        writes one, so it is refused where it is written."""
        share = frappe._dict(share_doctype=DOCTYPE, share_name="anything")
        with self.assertRaises(DriveForbidden):
            refuse_governed_share(share)

    def test_activation_registers_the_declaration_and_moves_both_hooks(self):
        with activated():
            self.assertTrue(governs(DOCTYPE))
            self.assertIs(spec_for(DOCTYPE), writer.SPEC)
            self.assertEqual(frappe.get_hooks("has_permission")[DOCTYPE], ACTIVATION["has_permission"])
            self.assertEqual(
                frappe.get_hooks("permission_query_conditions")[DOCTYPE],
                ACTIVATION["permission_query_conditions"],
            )

    # the version envelope

    def test_a_version_envelope_round_trips_the_body_html_and_mode(self):
        payload = {
            "schema": writer.VERSION_SCHEMA,
            "content": body_with("m1"),
            "html": "<p>x</p>",
            "collab": 0,
        }
        read = writer._version_payload(json.dumps(payload).encode("utf-8"))
        self.assertEqual(
            read,
            {"content": payload["content"], "html": payload["html"], "collab": 0},
        )

    def test_a_legacy_html_snapshot_becomes_an_exact_non_collaborative_body(self):
        html = "<p>an old snapshot π</p>"
        self.assertEqual(
            writer._version_payload(html.encode("utf-8")),
            {"content": writer.EMPTY_BODY, "html": html, "collab": 0},
        )

    def test_an_old_envelope_defaults_to_collaborative(self):
        payload = {"schema": writer.VERSION_SCHEMA, "content": body_with("m1"), "html": "<p>x</p>"}
        self.assertEqual(writer._version_payload(json.dumps(payload).encode())["collab"], 1)

    def test_an_envelope_of_another_schema_or_invalid_known_shape_is_refused(self):
        for raw in (
            json.dumps({"schema": "writer-document/2", "content": "a", "html": ""}).encode(),
            json.dumps({"schema": writer.VERSION_SCHEMA, "content": "", "html": ""}).encode(),
            json.dumps({"schema": writer.VERSION_SCHEMA, "content": "a", "html": None}).encode(),
            json.dumps({"schema": writer.VERSION_SCHEMA, "content": "a", "html": "", "collab": "1"}).encode(),
            b"\xff",
        ):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    def test_version_bytes_captures_collaboration_mode(self):
        row = frappe._dict(content="body", html="<p>x</p>", collab=0)
        with patch.object(writer.frappe.db, "get_value", return_value=row):
            stream, mime = writer.version_bytes("WR-1")
        self.assertEqual(mime, writer.VERSION_MIME)
        self.assertEqual(json.loads(stream.read())["collab"], 0)

    def test_restore_writes_every_body_field_atomically(self):
        html = "<p>legacy</p>"
        with patch.object(writer.frappe.db, "set_value") as write:
            writer.restore_version("WR-1", io.BytesIO(html.encode()))
        write.assert_called_once_with(
            DOCTYPE,
            "WR-1",
            {"content": writer.EMPTY_BODY, "html": html, "collab": 0},
        )

    def test_invalid_version_bytes_fail_before_a_body_write(self):
        with patch.object(writer.frappe.db, "set_value") as write:
            with self.assertRaises(frappe.ValidationError):
                writer.restore_version("WR-1", io.BytesIO(b"\xff"))
        write.assert_not_called()

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

    def test_the_plain_node_attribute_is_read_inside_the_yjs_body(self):
        # In `html` an attribute is text, so the pattern reads `data-node="x"`
        # whole. In the body the name and the value are held apart and the
        # value is a bare id, so reading values alone finds nothing and the
        # daily sweep would trash a picture the document still shows.
        self.assertEqual(body_ids(node_attribute_body("kept")), {"kept"})

    def test_a_plain_node_attribute_is_rewritten_by_a_copy(self):
        rewritten = writer._remap_body(node_attribute_body("old"), {"old": "new"})
        self.assertIsNotNone(rewritten, "a copy that leaves this alone points at the source's picture")
        self.assertEqual(body_ids(rewritten), {"new"})

    def test_a_node_attribute_nothing_maps_is_left_alone(self):
        self.assertIsNone(writer._remap_body(node_attribute_body("other"), {"old": "new"}))

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

    def test_a_body_that_applies_and_then_panics_still_refuses_as_a_validation_error(self):
        # `apply_update` is not the only pycrdt call that panics. A body whose
        # root was written as a `Text` or an `Array` applies cleanly and panics
        # on the first child read, which is past the one guarded call.
        for value in (pycrdt.Text("hello"), pycrdt.Array([1, 2])):
            with self.subTest(root=type(value).__name__):
                body = rooted_body(value)
                with self.assertRaises(writer.UnreadableBody) as refused:
                    writer._remap_body(body, {"old": "new"})
                self.assertIsInstance(refused.exception, frappe.ValidationError)

    def test_a_body_that_applies_and_then_panics_over_reports_for_the_sweep(self):
        # The same body on the sweep side must fall back, not kill the pass:
        # an escaping `BaseException` skips `sweep_unused_media`'s rollback.
        with patch.object(frappe, "log_error"):
            self.assertEqual(body_ids(rooted_body(pycrdt.Text("hello"))), set())

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


class TestWriterAfterActivation(IntegrationTestCase):
    """What activation settled, on the real `Writer Document` doctype.

    A row with no node cannot exist here: `require_node` holds §5.13 for a
    registered doctype, so the legacy-row cases this class used to carry
    describe a state Build and ticket 29 removed together. What is left is the
    declaration the boot check reads against the doctype.
    """

    def test_activation_accepts_the_declaration_itself(self):
        # Every check `validate_registry` makes that needs a database: the node
        # Link, the mixin, the node field name, and the fields §10.2 forbids.
        with activated(), linked():
            validate_content_registry()


class TestWriterInDrive(IntegrationTestCase):
    """Lifecycle, history, media, permissions, and legacy rows, on real rows.

    Every test runs under `activated()`, which now only drops the per-request
    registry cache: ticket 29 registered the declaration in `suite/hooks.py`.
    """

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
        # Entered first, so its exit runs last: the fixture purge below is a
        # Drive workflow and needs the registry it injects.
        activation = activated()
        activation.__enter__()
        self.addCleanup(activation.__exit__, None, None, None)
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

    def _share_row(self, docname: str, **columns) -> None:
        """Write one `DocShare` the way a site carried it before adoption.

        `refuse_governed_share` refuses a new one now, and nothing rewrites
        the rows a site already had before Build, so the row the guards have to
        answer for is always a hand-written one.
        `ignore_validate` also keeps `cascade_permissions_downwards` off, so a
        write-only row stays write-only.
        """
        share = frappe.get_doc(
            {"doctype": "DocShare", "share_doctype": DOCTYPE, "share_name": docname, **columns}
        )
        share.flags.ignore_validate = True
        share.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

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
        # A caller below Read never learns the node is there: `require` answers
        # `DriveNotFound`, because an unreadable node is never a 403 (spec
        # §5.4, [009 §2]). `DriveForbidden` here would disclose the folder.
        nodes_before = frappe.db.count("Drive Node")
        documents_before = frappe.db.count(DOCTYPE)
        self._as(OTHER)
        with self.assertRaises(DriveNotFound):
            drive.create_document(self.root.node, "Intruder", content_doctype=DOCTYPE)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), documents_before)

    def test_a_reader_who_cannot_upload_is_refused_and_not_hidden_from(self):
        # The other half of that contract, and the reason the test above is not
        # simply a weaker assertion: a caller who already holds Read gets
        # `DriveForbidden`, not 404. Both refusals roll everything back.
        nodes_before = frappe.db.count("Drive Node")
        documents_before = frappe.db.count(DOCTYPE)
        grant(self.root.node, OTHER, drive.READ, self.admin)

        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            drive.create_document(self.root.node, "Uninvited", content_doctype=DOCTYPE)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
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

    def test_a_native_non_collaborative_version_round_trips_its_mode(self):
        node = self._document(title="Non-collaborative")
        docname = self._docname(node)
        frappe.db.set_value(
            DOCTYPE,
            docname,
            {"content": writer.EMPTY_BODY, "html": "<p>first</p>", "collab": 0},
            update_modified=False,
        )
        seq = drive.take_version(node)
        frappe.db.set_value(DOCTYPE, docname, "collab", 1, update_modified=False)

        restore_version(self.admin, node, seq)

        row = frappe.db.get_value(DOCTYPE, docname, ("content", "html", "collab"), as_dict=True)
        self.assertEqual((row.content, row.html, row.collab), (writer.EMPTY_BODY, "<p>first</p>", 0))

    def test_a_migrated_html_version_restores_atomically_and_its_capture_restores_collab(self):
        node = self._document(title="Migrated history")
        docname = self._docname(node)
        current_body = body_with("current")
        frappe.db.set_value(
            DOCTYPE,
            docname,
            {"content": current_body, "html": "<p>current</p>", "collab": 1},
            update_modified=False,
        )
        blob = put_blob(io.BytesIO("<p>legacy π</p>".encode()), is_private=True)
        migrated = frappe.get_doc(
            {
                "doctype": "Drive Node Version",
                "node": node,
                "seq": 1,
                "kind": "auto",
                "actor": USER,
                "blob": blob.name,
                "size": blob.file_size,
            }
        ).insert(ignore_permissions=True)

        captured = restore_version(self.admin, node, migrated.seq)
        restored = frappe.db.get_value(DOCTYPE, docname, ("content", "html", "collab"), as_dict=True)
        self.assertEqual(
            (restored.content, restored.html, restored.collab),
            (writer.EMPTY_BODY, "<p>legacy π</p>", 0),
        )

        restore_version(self.admin, node, captured)
        current = frappe.db.get_value(DOCTYPE, docname, ("content", "html", "collab"), as_dict=True)
        self.assertEqual((current.content, current.html, current.collab), (current_body, "<p>current</p>", 1))

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

    def test_a_purge_keeps_no_recoverable_copy_of_the_body(self):
        # `delete_doc` keeps the whole row as JSON in `Deleted Document` unless
        # it is told not to, so a purge that forgets `delete_permanently` leaves
        # the body, its HTML, and the comment blob behind (§8.8: purge deletes).
        node = self._document(title="Confidential")
        docname = self._docname(node)
        frappe.db.set_value(DOCTYPE, docname, "html", "<p>a secret</p>", update_modified=False)

        update(self.admin, node, state="Trashed")
        purge(self.admin, node)

        self.assertFalse(
            frappe.db.exists("Deleted Document", {"deleted_doctype": DOCTYPE, "deleted_name": docname}),
            "a purged body must not survive as a recoverable row",
        )

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
        # `create_document` stamps `content_modified` itself, so the creation
        # stamp is the value the save must beat. `Drive Node.content_modified`
        # is a `datetime(6)`, and the two `now_datetime()` calls sit a node
        # insert, a factory call, and a grant apart, so the two stamps cannot
        # read equal. Deleting `drive_touch` leaves the creation stamp in
        # place and fails the comparison.
        node = self._document(title="Stamped")
        created = get_datetime(frappe.db.get_value("Drive Node", node, "content_modified"))
        document = frappe.get_doc(DOCTYPE, self._docname(node))

        document.save_html("<p>new</p>")

        after = frappe.db.get_value("Drive Node", node, ("content_modified", "title"), as_dict=True)
        self.assertGreater(get_datetime(after.content_modified), created)
        self.assertEqual(after.title, "Stamped")

    def test_an_inherited_folder_grant_reaches_the_row_and_the_list(self):
        folder = create_node_folder(self.admin, self.root.node, "Shared folder")
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

    def test_a_trashed_document_refuses_every_write_the_editor_makes(self):
        # §8.8: "A document node opens read-only while it is Trashed. Edits and
        # comments are refused." `require` cannot answer it, because restore and
        # purge must still act on a trashed node, so the app-facing calls do.
        node = self._document(title="Binned body")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        before = frappe.db.get_value(DOCTYPE, document.name, "html")
        update(self.admin, node, state="Trashed")

        for write in (
            lambda: document.save_doc(body_with("x"), html="<p>x</p>"),
            lambda: document.save_html("<p>x</p>"),
            lambda: document.update_settings('{"collab": false}'),
        ):
            with self.subTest(write=write), self.assertRaises(DriveForbidden):
                write()
        self.assertEqual(frappe.db.get_value(DOCTYPE, document.name, "html"), before)

    def test_a_trashed_document_refuses_the_generic_orm_write_too(self):
        # `frappe.client.save` and `frappe.client.set_value` never reach
        # `drive_check`. They ask the row hook, so the hook has to answer.
        node = self._document(title="Binned ORM")
        docname = self._docname(node)
        # MANAGE, so the refusal can only come from the trash state.
        grant(node, OTHER, drive.MANAGE, self.admin)
        update(self.admin, node, state="Trashed")
        frappe.db.commit()

        self._as(OTHER)
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname), "the bin still opens")
        self.assertFalse(frappe.has_permission(DOCTYPE, "write", docname))
        self.assertFalse(frappe.has_permission(DOCTYPE, "delete", docname))
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc(DOCTYPE, docname).save()

    def test_a_trashed_document_still_reads_and_still_restores(self):
        # The guard must not cost the bin its own workflows.
        node = self._document(title="Restored body")
        document = frappe.get_doc(DOCTYPE, self._docname(node))
        update(self.admin, node, state="Trashed")
        document.drive_check(drive.READ)

        update(self.admin, node, state="Active")
        document.save_html("<p>back</p>")
        self.assertEqual(frappe.db.get_value(DOCTYPE, document.name, "html"), "<p>back</p>")

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

    def test_the_staged_legacy_guards_never_answer_for_a_linked_row(self):
        """The dual path, from the other side. While the hooks are staged they
        are `suite.writer.overrides`, and a linked row has no `File`, so the
        legacy predicate's `owner = <user>` arm would have listed it and the
        legacy row check would have granted its owner everything."""
        node = self._document(title="Linked")
        document = frappe.get_doc(DOCTYPE, self._docname(node))

        self.assertFalse(overrides.document_has_permission(document, "read", USER))
        self.assertFalse(overrides.document_has_permission(document, "write", USER))
        for predicate in (
            overrides.document_query_conditions(USER),
            overrides.version_query_conditions(USER),
        ):
            with self.subTest(predicate=predicate):
                self.assertIn("`tabWriter Document`.`node` IS NULL", predicate)

    def test_a_docshare_cannot_open_a_linked_row_through_the_staged_guards(self):
        """The staged guards run alone between Build and ticket 29, and
        answering `False` is not a denial. Frappe reads `False` as "no role
        permission" and then asks `false_if_not_shared`
        (`frappe/permissions.py:214-216`); the list side ORs the shared names
        around whatever predicate the hook returns
        (`frappe/database/query.py:1739-1742`). Either one opens a linked
        document that has no `Drive Grant` (§1).
        """
        docname = self._docname(self._document(title="Staged and shared"))
        self._share_row(docname, user=OTHER, read=1)
        document = frappe.get_doc(DOCTYPE, docname)

        with self.assertRaises(DriveForbidden):
            overrides.document_has_permission(document, "read", OTHER)
        with self.assertRaises(DriveForbidden):
            overrides.document_query_conditions(OTHER)

        # The admin is the person who has to delete that row. Their predicate
        # is empty, so the engine ORs the shared names around nothing.
        self.assertEqual(overrides.document_query_conditions("Administrator"), "")

    def test_an_everyone_docshare_reaches_a_linked_row_no_more_easily(self):
        """`everyone` is the wide row: no `user` column at all, and
        `frappe.share.get_shared` matches it for every signed-in user
        (`frappe/share.py:188-190`). Guest is the exception those same lines
        make, so the guard finds nothing to refuse for a Guest and the hook
        denies for the ordinary reason.
        """
        docname = self._docname(self._document(title="Shared with everyone"))
        self._share_row(docname, everyone=1, read=1)
        document = frappe.get_doc(DOCTYPE, docname)

        with self.assertRaises(DriveForbidden):
            overrides.document_has_permission(document, "read", OTHER)
        with self.assertRaises(DriveForbidden):
            overrides.document_query_conditions(OTHER)
        self.assertFalse(overrides.document_has_permission(document, "read", "Guest"))

    def test_the_row_guard_refuses_exactly_the_rights_the_share_carries(self):
        """`false_if_not_shared` reads one `DocShare` column per ptype
        (`frappe/permissions.py:185-192`), so the guard reads the same one. A
        write-only row must not refuse a read the framework would never have
        granted, `email` and `print` are answered by the `read` column, and
        `select` is not shareable at all: the framework retries it as `read`.
        """
        write_only = frappe.get_doc(DOCTYPE, self._docname(self._document(title="Write only")))
        self._share_row(write_only.name, user=OTHER, write=1)

        with self.assertRaises(DriveForbidden):
            overrides.document_has_permission(write_only, "write", OTHER)
        for unshared in ("read", "email", "print", "select", "delete"):
            with self.subTest(ptype=unshared):
                self.assertFalse(overrides.document_has_permission(write_only, unshared, OTHER))

        read_only = frappe.get_doc(DOCTYPE, self._docname(self._document(title="Read only")))
        self._share_row(read_only.name, user=OTHER, read=1)
        for granted in ("read", "email", "print"):
            with self.subTest(ptype=granted), self.assertRaises(DriveForbidden):
                overrides.document_has_permission(read_only, granted, OTHER)

    def test_a_share_on_a_linked_row_leaves_the_legacy_version_list_alone(self):
        """The list refusal belongs to the doctype being listed. Frappe ORs the
        shared names of `Writer Version` around the version predicate, never
        those of `Writer Document`, so a share on a linked document cannot
        widen it. Refusing there would take a legacy reader's own history away
        for a row that could never have opened it.
        """
        docname = self._docname(self._document(title="Shared and versioned"))
        self._share_row(docname, user=OTHER, read=1)

        predicate = overrides.version_query_conditions(OTHER)
        self.assertIn("`tabWriter Document`.`node` IS NULL", predicate)

    def test_a_direct_version_share_cannot_reopen_linked_history(self):
        """`DriveForbidden`, not `frappe.PermissionError`: the guard is
        `drive.refuse_shared_child_rows`, and `frappe.desk.notifications` and
        `frappe.desk.desktop` swallow a `PermissionError`.
        """
        docname = self._docname(self._document(title="Preserved history share"))
        version = frappe.get_doc(
            {"doctype": "Writer Version", "doc": docname, "snapshot": "<p>old</p>", "title": "old"}
        ).insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc,
            "Writer Version",
            version.name,
            force=1,
            ignore_permissions=True,
            ignore_missing=True,
        )
        # Control: the preserved row alone refuses nothing, so the refusal
        # below belongs to the share and not to the linked parent.
        self._as(OTHER)
        self.assertNotIn(version.name, frappe.get_list("Writer Version", pluck="name"))
        frappe.set_user("Administrator")
        share = frappe.get_doc(
            {
                "doctype": "DocShare",
                "share_doctype": "Writer Version",
                "share_name": version.name,
                "user": OTHER,
                "read": 1,
            }
        )
        share.flags.ignore_validate = True
        share.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc,
            "DocShare",
            share.name,
            force=1,
            ignore_permissions=True,
            ignore_missing=True,
        )
        frappe.db.commit()

        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            frappe.has_permission("Writer Version", doc=version.name, ptype="read")
        with self.assertRaises(DriveForbidden):
            frappe.get_list("Writer Version", pluck="name")
        frappe.set_user("Administrator")
        self.assertTrue(frappe.db.exists("Writer Version", version.name))
        self.assertTrue(frappe.db.exists("DocShare", share.name))

    def test_a_linked_row_refuses_every_legacy_method(self):
        """§14.6 and §8.11 put history and comments on the node. A linked row
        must not grow a second, private copy of either that Drive cannot see."""
        node = self._document(title="No legacy writes")
        document = frappe.get_doc(DOCTYPE, self._docname(node))

        for legacy in (
            lambda: document.new_version("<p>x</p>", title="sneaky"),
            lambda: document.save_comments("AAA=", None),
            lambda: document.update_file(file_size=1),
        ):
            with self.subTest(legacy=legacy), self.assertRaises(frappe.ValidationError):
                legacy()
        self.assertFalse(frappe.db.exists("Writer Version", {"doc": document.name}))
        self.assertFalse(frappe.db.get_value(DOCTYPE, document.name, "ycomments"))

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
    # Purging a document node calls the app's `on_purge`, which Drive reads from
    # the registry, so the purge runs registered even when the caller is not.
    with activated():
        for root in roots:
            if frappe.db.get_value("Drive Root", root, "state") == "Active":
                update_root(root, admin, state="Archived")
            purge_root(root, admin)
