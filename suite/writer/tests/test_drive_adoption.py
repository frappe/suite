"""Writer's adoption of the Drive content contract (ticket 17, §10.7).

Adoption is an expand phase, not a switch. Writer declares its `ContentTypeSpec`
and `Writer Document` gains the `node` Link, but `suite/hooks.py` leaves
`drive_content_types` empty and keeps both `Writer Document` permission entries
on `suite.writer.overrides`. The README stages registry activation and
permission-hook changes until the node links exist, and ticket 29 makes all
three changes together, after Build.

So the three classes here split along that seam:

`TestWriterDeclaration`   the declaration and the body callbacks, no rows. It
                          also proves the hooks are dormant and that activation
                          registers exactly what ticket 29 will install.
`TestWriterBeforeActivation`
                          what a site running this commit does: legacy rows,
                          the legacy `create_document`, and a `DocShare` that
                          must not fail `migrate`.
`TestWriterInDrive`       the Drive-native lifecycle, history, media,
                          permissions, and failure rollback, under `activated()`.

`activated()` injects the registry and the two hook targets rather than shipping
them, so nothing here depends on the site being activated and nothing here
activates it.

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
from werkzeug.datastructures import FileStorage

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.content import clear_registry_cache, governs, spec_for
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_file, purge, update
from suite.drive._core.nodes import create_folder as create_node_folder
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version
from suite.drive.api.files import (
    create_folder,
    create_link,
    delete_entities,
    does_entity_exist,
    move,
    remove_or_restore,
    rename,
    set_favourite,
    track_visit,
    update_access,
)
from suite.drive.api.list import files as legacy_files
from suite.drive.api.notifications import create_notification
from suite.drive.api.permissions import get_general_access, get_shared_with_list, get_user_access
from suite.drive.framework import refuse_governed_share, validate_content_registry
from suite.tests.utils import ensure_user
from suite.writer import drive as writer
from suite.writer import overrides
from suite.writer.api import docs, embed
from suite.writer.api.general import get_document_list
from suite.writer.doctype.writer_document.writer_document import WriterDocument

USER = "writer-adoption-user@example.com"
OTHER = "writer-adoption-other@example.com"

DOCTYPE = "Writer Document"

# The smallest real PNG, so the upload path sniffs a mime rather than guessing.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# The three entries ticket 29 installs together, once Build has linked every
# `Writer Document` row. `suite/hooks.py` carries none of them yet.
ACTIVATION = {
    "drive_content_types": ["suite.writer.drive.SPEC"],
    "has_permission": ["suite.drive.framework.doc_has_permission"],
    "permission_query_conditions": ["suite.drive.framework.doc_query_conditions"],
}


@contextmanager
def activated():
    """Register Writer for the block, exactly the way ticket 29 will register it.

    The registry is built from `drive_content_types` and the framework reads
    both permission hooks from the same hook map, so injecting the map is the
    whole activation. Nothing is written and nothing survives the block: the
    per-request registry cache is dropped on the way in and on the way out.
    """
    real_get_hooks = frappe.get_hooks

    def hooks(key=None, *args, **kwargs):
        if key == "drive_content_types":
            return list(ACTIVATION[key])
        if key in ("has_permission", "permission_query_conditions"):
            wired = dict(real_get_hooks(key, *args, **kwargs) or {})
            wired[DOCTYPE] = list(ACTIVATION[key])
            return wired
        return real_get_hooks(key, *args, **kwargs)

    clear_registry_cache()
    try:
        with patch("frappe.get_hooks", hooks):
            yield
    finally:
        clear_registry_cache()


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

    def test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were(self):
        """README execution rules: stage the registry and the permission hooks
        after the required node links exist. Build writes them at ticket 28 and
        ticket 29 activates. Registering now would 409 every legacy row on its
        next permission check."""
        from suite import hooks

        self.assertEqual(hooks.drive_content_types, [], "activation waits for ticket 29")
        self.assertEqual(hooks.has_permission[DOCTYPE], "suite.writer.overrides.document_has_permission")
        self.assertEqual(
            hooks.permission_query_conditions[DOCTYPE],
            "suite.writer.overrides.document_query_conditions",
        )
        clear_registry_cache()
        self.assertFalse(governs(DOCTYPE), "Drive governs nothing while the registry is empty")

    def test_a_dormant_registry_leaves_a_docshare_alone(self):
        """The one thing that would fail `migrate` on a site with real Writer
        data. Desk assignment writes a `DocShare` (`frappe.share.add`), and no
        tool rewrites those rows as grants before Build."""
        share = frappe._dict(share_doctype=DOCTYPE, share_name="anything")
        refuse_governed_share(share)

        with activated(), self.assertRaises(DriveForbidden):
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
        self.assertFalse(governs(DOCTYPE), "the injection leaves nothing behind")

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


class TestWriterBeforeActivation(IntegrationTestCase):
    """What a site running this commit actually does: nothing Drive-native.

    `drive_content_types` is empty here, as it is on a site. These are the two
    outcomes the staged activation buys: a legacy document stays reachable, and
    a `DocShare` no longer fails `migrate`.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # Registered first, so it runs last: after every `delete_doc` cleanup a
        # test queues, and after the rows those cleanups missed are swept.
        self._documents_before = set(frappe.get_all(DOCTYPE, pluck="name"))
        self._shares_before = self._shares_now()
        self.addCleanup(self._remove_fixture_rows)
        clear_registry_cache()
        self.addCleanup(clear_registry_cache)

    def _remove_fixture_rows(self):
        """Commit the removals, because a test in this class commits.

        `IntegrationTestCase` rolls back once per class, not once per test, so
        a `frappe.db.commit()` inside a test makes its rows permanent. The
        per-test `delete_doc` cleanups then delete them inside the transaction
        that rollback throws away, and the committed rows come back.

        A `Writer Document` that survives carries a `DocShare` with it, and
        that share is poison: `_refuse_shared_list` refuses the whole list for
        the user who holds it, and `validate_content_registry` refuses to
        activate the type at all. Both are correct fail-closed answers, so the
        row is what has to go.
        """
        frappe.set_user("Administrator")
        for share in self._shares_now() - self._shares_before:
            frappe.delete_doc("DocShare", share, force=1, ignore_permissions=True, ignore_missing=True)
        for document in set(frappe.get_all(DOCTYPE, pluck="name")) - self._documents_before:
            frappe.delete_doc(DOCTYPE, document, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    @staticmethod
    def _shares_now() -> set[str]:
        return set(frappe.get_all("DocShare", filters={"share_doctype": DOCTYPE}, pluck="name"))

    def _legacy_document(self) -> str:
        document = frappe.new_doc(DOCTYPE)
        document.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, DOCTYPE, document.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        return document.name

    def test_a_committed_fixture_row_does_not_outlive_the_class_rollback(self):
        """The leak `_remove_fixture_rows` exists to stop, asserted in the run
        that causes it.

        Without this the leak is invisible here and lands on the next run of
        this module: one surviving share makes `_refuse_shared_list` refuse the
        whole list for its user and makes `validate_content_registry` refuse to
        activate the type, so three tests that share nothing with the leak fail.
        """
        docname = self._legacy_document()
        share = frappe.share.add(DOCTYPE, docname, OTHER, read=1)
        frappe.db.commit()

        self._remove_fixture_rows()
        # What `_rollback_db` does at class teardown. A removal that is only
        # queued and not committed does not survive it.
        frappe.db.rollback()

        self.assertFalse(frappe.db.exists("DocShare", share.name), "the share is gone for good")
        self.assertFalse(frappe.db.exists(DOCTYPE, docname), "and so is the row it was written against")

    def test_a_document_the_api_creates_is_reachable_by_the_legacy_read_path(self):
        """The whole point of not activating. `create_document` writes a `File`
        and a node-less document, and `get_document`, the row check, and the
        list all still find it. A Drive-native document would have no `File`,
        and every one of those reads is still `File`-based until ticket 23."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")

        entity = docs.create_document(title=f"Legacy {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        docname = entity.content_docname

        self.assertEqual(entity.content_doctype, DOCTYPE)
        self.assertIsNone(frappe.db.get_value(DOCTYPE, docname, "node"), "no node before Build")
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

        docs.get_document(entity.name)
        self.assertEqual(frappe.response["data"]["content_docname"], docname)

    def test_the_legacy_read_path_publishes_the_page_payload_the_editor_reads(self):
        """`get_document` merges the document onto the payload
        `get_entity_with_permissions` published, and §10.2 keeps that row on
        the `File` store while the type is in the expand phase. The page reads
        the permission bits to hide its buttons and the trail to draw the
        breadcrumb, so the whole payload is what has to arrive, not the id."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")

        entity = docs.create_document(title=f"Payload {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        docs.get_document(entity.name)
        payload = frappe.response["data"]

        self.assertEqual(payload["name"], entity.name)
        self.assertEqual(payload["content_doctype"], DOCTYPE)
        self.assertEqual(payload["read"], 1)
        self.assertEqual(payload["write"], 1)
        self.assertEqual(payload["kind"], "native")
        # The creator owns the row, so the trail reaches their own Home.
        self.assertTrue(payload["breadcrumbs"])
        self.assertEqual(payload["breadcrumbs"][-1]["name"], entity.name)
        # `hide_storage_key`: the raw storage key leaks the owner's path.
        self.assertIsNone(payload["file_url"])
        self.assertEqual(payload["share_count"], 0, "a new document is shared with nobody")

    def test_a_stranger_is_refused_the_document_by_the_rule_that_wrote_it(self):
        """The legacy gate still decides. No node carries this row, so the
        answer comes from `generate_upward_path` - the rule `create_document`
        checked on the way in - and it refuses with the class `ErrorPage.vue`
        sends a signed-out visitor to the login page on."""
        frappe.set_user(USER)
        entity = docs.create_document(title=f"Private {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        # `frappe.response` outlives one test, so the refusal is asked to
        # leave an empty envelope rather than merely not to fill this one.
        frappe.response.pop("data", None)
        with self.assertRaises(frappe.PermissionError):
            docs.get_document(entity.name)
        self.assertIsNone(frappe.response.get("data"))

    def test_a_removed_row_is_not_found_by_the_legacy_read_path(self):
        """The old query filtered `status: STATUS_ACTIVE`, so a document in
        the trash opened as a page said it was gone rather than rendering."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")

        entity = docs.create_document(title=f"Removed {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.set_value("File", entity.name, "status", "Removed", update_modified=False)

        with self.assertRaises(DriveNotFound):
            docs.get_document(entity.name)

    def test_a_document_the_api_creates_appears_in_the_folder_that_holds_it(self):
        """`create_document` writes into `Users/<email>`, and the trail
        `get_entity_with_permissions` publishes for the document names that
        folder. Opening it met `node_core.children`, which refuses a parent
        no node holds, so the folder page was an error page."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = docs.create_document(title=f"Listed {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        self.assertFalse(frappe.db.exists("Drive Node", entity.folder), "no node before Build")

        rows = {row["name"]: row for row in legacy_files(entity_name=entity.folder)}

        self.assertIn(entity.name, rows)
        row = rows[entity.name]
        self.assertEqual(row["file_name"], entity.file_name)
        self.assertEqual(row["read"], 1)
        self.assertEqual(row["file_type"], "Document")
        self.assertEqual(row["content_doctype"], DOCTYPE)

    def test_the_folder_page_pages_the_way_the_old_one_did(self):
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        made = []
        for index in range(3):
            entity = docs.create_document(title=f"Paged {index} {frappe.generate_hash(6)}")
            made.append(entity.name)
            self.addCleanup(
                frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
            )

        page = legacy_files(entity_name=entity.folder, limit=2, paginated=True)

        self.assertEqual(len(page["rows"]), 2)
        self.assertEqual(page["next_start"], 2)
        self.assertTrue(page["has_next"])
        # Walked to the end, because the folder is the fixture user's own and
        # holds whatever the rest of the class put there.
        seen = {row["name"] for row in page["rows"]}
        for _ in range(20):
            if not page["has_next"]:
                break
            page = legacy_files(entity_name=entity.folder, start=page["next_start"], limit=2, paginated=True)
            seen |= {row["name"] for row in page["rows"]}
        self.assertTrue(set(made) <= seen, "every document is on one of the pages")

    def test_a_stranger_is_refused_the_folder_the_document_is_in(self):
        """The gate is the old body's, on the store that holds the folder."""
        frappe.set_user(USER)
        entity = docs.create_document(title=f"Shut {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        with self.assertRaises(frappe.PermissionError):
            legacy_files(entity_name=entity.folder)

    @staticmethod
    def _drop_rows(*names: str):
        frappe.set_user("Administrator")
        for name in names:
            frappe.delete_doc("File", name, force=1, ignore_permissions=True, ignore_missing=True)

    def _opened(self, title: str):
        """One document `create_document` writes, with no node behind it."""
        entity = docs.create_document(title=title)
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        self.addCleanup(frappe.db.delete, "Drive Entity Log", {"entity_name": entity.name})
        self.assertFalse(frappe.db.exists("Drive Node", entity.name), "no node before Build")
        return entity

    def test_opening_a_document_the_api_creates_records_when_it_was_opened(self):
        """`useDocument` calls `track_visit` on every open, and nothing else
        writes `Drive Entity Log`. `get_document_list` orders the caller's own
        documents by that row and publishes it as `accessed`, so a forwarder
        that only visits nodes left every document with neither."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Opened {frappe.generate_hash(6)}")

        track_visit(entity_name=entity.name)

        self.assertTrue(
            frappe.db.get_value(
                "Drive Entity Log", {"entity_name": entity.name, "user": USER}, "last_interaction"
            ),
            "the open is on the log the list reads",
        )
        frappe.response.pop("data", None)
        get_document_list()
        rows = {row["name"]: row for row in frappe.response["data"]}
        self.assertTrue(rows[entity.name]["accessed"], "and the list publishes it")

    def test_opening_a_document_clears_the_badge_it_was_announced_with(self):
        """The visible half. `writer_document.notify_comments` still writes a
        pointerless `Drive Notification` naming the `File`, and the old body
        marked every unread row about the file it opened as read."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Announced {frappe.generate_hash(6)}")
        row = frappe.get_doc("File", entity.name)
        # The notifier runs as the site, not as the reader it announces to.
        frappe.set_user("Administrator")
        self.assertTrue(create_notification(OTHER, USER, "Comment", row, "somebody said something"))
        frappe.set_user(USER)
        announced = frappe.get_all(
            "Drive Notification", filters={"notif_doctype_name": entity.name}, pluck="name"
        )
        for row in announced:
            self.addCleanup(
                frappe.delete_doc,
                "Drive Notification",
                row,
                force=1,
                ignore_permissions=True,
                ignore_missing=True,
            )

        track_visit(entity_name=entity.name)

        self.assertEqual(
            frappe.get_all("Drive Notification", filters={"notif_doctype_name": entity.name}, pluck="read"),
            [1],
        )

    def test_a_stranger_cannot_record_a_visit_to_somebody_elses_document(self):
        """The gate is the `File` hook, as the old body's was."""
        frappe.set_user(USER)
        entity = self._opened(f"Unopened {frappe.generate_hash(6)}")

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        with self.assertRaises(frappe.PermissionError):
            track_visit(entity_name=entity.name)
        self.assertFalse(
            frappe.db.exists("Drive Entity Log", {"entity_name": entity.name, "user": OTHER}),
            "a refused visit writes nothing",
        )

    def test_renaming_a_document_the_api_creates_keeps_the_title_it_was_given(self):
        """`CoreEditor.vue` renames an untitled document from its first line on
        the first Enter, so this ran without any gesture the reader chose."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Untitled {frappe.generate_hash(6)}")

        answer = rename(entity.name, "A better title")

        self.assertEqual(answer["file_name"], "A better title")
        self.assertEqual(frappe.db.get_value("File", entity.name, "file_name"), "A better title")

    def test_a_stranger_cannot_rename_somebody_elses_document(self):
        """The gate is `File.rename`'s own Write check, the rule that named
        the row."""
        frappe.set_user(USER)
        entity = self._opened(f"Untouched {frappe.generate_hash(6)}")
        before = frappe.db.get_value("File", entity.name, "file_name")

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        with self.assertRaises(frappe.PermissionError):
            rename(entity.name, "Mine now")
        self.assertEqual(frappe.db.get_value("File", entity.name, "file_name"), before)

    def test_a_document_the_api_creates_goes_to_the_trash_and_comes_back(self):
        """Writer's own `RemoveDialog.vue` names the document the editor has
        open, for both halves of the gesture."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Doomed {frappe.generate_hash(6)}")

        remove_or_restore([entity.name])
        self.assertEqual(frappe.db.get_value("File", entity.name, "status"), "Trashed")
        with self.assertRaises(DriveNotFound):
            docs.get_document(entity.name)

        remove_or_restore([entity.name])
        self.assertEqual(frappe.db.get_value("File", entity.name, "status"), "Active")
        frappe.response.pop("data", None)
        docs.get_document(entity.name)
        self.assertEqual(frappe.response["data"]["name"], entity.name)

    def test_a_stranger_cannot_trash_somebody_elses_document(self):
        """The gate is `toggle_entity_status`'s own Write check."""
        frappe.set_user(USER)
        entity = self._opened(f"Kept {frappe.generate_hash(6)}")

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        with self.assertRaises(frappe.PermissionError):
            remove_or_restore([entity.name])
        self.assertEqual(frappe.db.get_value("File", entity.name, "status"), "Active")

    def test_sharing_a_document_the_api_creates_lets_the_other_reader_in(self):
        """Writer's `ShareDialog.vue` names the document the editor has open."""
        frappe.set_user(USER)
        entity = self._opened(f"Shared {frappe.generate_hash(6)}")

        update_access(entity.name, "share", user=OTHER, read=1, comment=1)

        self.assertEqual([person["user"] for person in get_shared_with_list(entity.name)], [USER, OTHER])
        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.assertEqual(get_user_access(entity.name)["read"], 1)
        self.assertEqual(get_user_access(entity.name)["write"], 0)

    def test_publishing_a_document_the_api_creates_reads_back_as_published(self):
        """`InfoDialog.vue` reads `get_general_access` for the same document."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Published {frappe.generate_hash(6)}")
        self.assertEqual(get_general_access(entity.name)["type"], "restricted")

        update_access(entity.name, "share", user="", read=1)

        self.assertEqual(get_general_access(entity.name)["type"], "public")

    def test_unsharing_a_document_the_api_creates_takes_the_reader_back_out(self):
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Unshared {frappe.generate_hash(6)}")
        update_access(entity.name, "share", user=OTHER, read=1)

        update_access(entity.name, "unshare", user=OTHER)

        self.assertEqual([person["user"] for person in get_shared_with_list(entity.name)], [USER])

    def test_a_stranger_cannot_share_somebody_elses_document(self):
        """The gate is `File.share`'s own share check, the rule that wrote the
        rows."""
        frappe.set_user(USER)
        entity = self._opened(f"Unshareable {frappe.generate_hash(6)}")

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        with self.assertRaises(frappe.PermissionError):
            update_access(entity.name, "share", user=OTHER, read=1)
        with self.assertRaises(frappe.PermissionError):
            get_shared_with_list(entity.name)

    def test_favouriting_a_document_the_api_creates_keeps_the_mark(self):
        """Writer's navbar and the Drive row menu both offer Favourite."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Favourite {frappe.generate_hash(6)}")
        self.addCleanup(frappe.db.delete, "Drive Favourite", {"entity": entity.name})

        set_favourite([{"name": entity.name, "is_favourite": True}])
        self.assertTrue(
            frappe.db.exists("Drive Favourite", {"entity": entity.name, "user": USER}),
            "the mark is on the caller's own row",
        )

        set_favourite([{"name": entity.name, "is_favourite": False}])
        self.assertFalse(frappe.db.exists("Drive Favourite", {"entity": entity.name, "user": USER}))

    def test_moving_a_document_the_api_creates_lands_it_in_the_named_folder(self):
        """Writer's `MoveDialog` names the document the editor has open. The
        destination is a legacy folder, because the two trees are separate
        until Build joins them."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Moved {frappe.generate_hash(6)}")
        home = frappe.db.get_value("File", entity.name, "folder")
        folder = create_folder(f"Box {frappe.generate_hash(6)}", home)
        # Registered after `_opened`, so it runs first: the folder cannot go
        # while it still holds the document.
        self.addCleanup(self._drop_rows, entity.name, folder["name"])
        self.assertFalse(frappe.db.exists("Drive Node", folder["name"]), "no node before Build")

        answer = move([entity.name], folder["name"])

        self.assertEqual(answer["name"], folder["name"])
        self.assertEqual(frappe.db.get_value("File", entity.name, "folder"), folder["name"])

    def test_a_folder_made_in_the_folder_that_holds_the_document_lands_there(self):
        """`list.files` serves that folder now, so Drive's New menu opens on
        it and names it as the parent."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Neighbour {frappe.generate_hash(6)}")
        home = frappe.db.get_value("File", entity.name, "folder")

        folder = create_folder(f"Box {frappe.generate_hash(6)}", home)
        self.addCleanup(self._drop_rows, folder["name"])

        self.assertEqual(folder["folder"], home)
        self.assertEqual(folder["file_type"], "Folder")
        self.assertFalse(frappe.db.exists("Drive Node", folder["name"]), "and no node was created")
        self.assertIn(folder["name"], {row["name"] for row in legacy_files(entity_name=home)})

    def test_a_link_made_in_the_folder_that_holds_the_document_lands_there(self):
        """`NewLinkDialog.vue` names the folder its page is showing."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Linked {frappe.generate_hash(6)}")
        home = frappe.db.get_value("File", entity.name, "folder")

        link = create_link(f"Site {frappe.generate_hash(6)}", "https://example.com", home)
        self.addCleanup(self._drop_rows, link["name"])

        self.assertEqual(link["file_type"], "Link")
        self.assertEqual(link["folder"], home)
        self.assertFalse(frappe.db.exists("Drive Node", link["name"]), "and no node was created")

    def test_a_document_the_api_creates_will_not_move_into_the_node_tree(self):
        """The two stores are two trees until Build joins them, so this is
        refused by name rather than moved on a guess."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Unmovable {frappe.generate_hash(6)}")
        frappe.set_user("Administrator")
        root = create_root(kind="Personal", title=f"Root {frappe.generate_hash(6)}", user=USER)
        self.addCleanup(_purge_fixture_roots)
        frappe.set_user(USER)
        home = frappe.db.get_value("File", entity.name, "folder")

        with self.assertRaises(frappe.ValidationError) as refusal:
            move([entity.name], root.node)
        # Named, not the workflow's 404 for a row it cannot see.
        self.assertIn("cannot move this into that folder yet", str(refusal.exception))
        self.assertEqual(frappe.db.get_value("File", entity.name, "folder"), home)

    def _posted(self, body: bytes, filename: str = "cat.png"):
        """One multipart POST, the way `embed.add` reads it."""
        upload = FileStorage(stream=io.BytesIO(body), filename=filename, content_type="image/png")
        # `framework._request_credentials` reads `X-Drive-Links` off the
        # request, so the stand-in needs headers as well as files.
        request = frappe._dict(files={"file": upload}, headers=frappe._dict())
        self.enterContext(patch.object(frappe.local, "request", request, create=True))
        self.enterContext(patch.object(frappe.local, "form_dict", frappe._dict(), create=True))

    def test_a_picture_added_to_a_legacy_document_lands_beside_it(self):
        """`embed.add` uploads into the document the editor has open, and a
        document `create_document` writes is a `File` with no node.
        `upload_core.create_upload` reads that parent as a node and refuses,
        so no picture could be added to any document the product creates."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = docs.create_document(title=f"Pictures {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        self._posted(PNG)

        answer = embed.add(entity.name)

        picture = answer["file_url"].split("id=")[-1]
        self.addCleanup(
            frappe.delete_doc, "File", picture, force=1, ignore_permissions=True, ignore_missing=True
        )
        row = frappe.db.get_value("File", picture, ["folder", "owner", "file_size"], as_dict=True)
        self.assertEqual(row.folder, entity.name, "the picture hangs off the document")
        self.assertEqual(row.owner, USER)
        self.assertEqual(row.file_size, len(PNG))
        self.assertFalse(frappe.db.exists("Drive Node", picture), "and no node was created")

    def test_a_picture_a_failed_import_uploaded_can_be_taken_back(self):
        """`writer/utils/docximporter.js` rolls back every picture it uploaded
        when an import fails, and each one is a `File` under the document."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Rolled back {frappe.generate_hash(6)}")
        self._posted(PNG)
        picture = embed.add(entity.name)["file_url"].split("id=")[-1]
        self.addCleanup(self._drop_rows, picture)
        self.assertFalse(frappe.db.exists("Drive Node", picture), "no node before Build")

        delete_entities([picture])

        # `File.permanent_delete` tombstones the row, as it always did.
        self.assertEqual(frappe.db.get_value("File", picture, "status"), "Removed")

    def test_the_uploader_can_ask_whether_that_folder_holds_the_name(self):
        """`FileUploader.vue` asks before it writes, about the folder whose
        page `list.files` now opens."""
        frappe.set_user(USER)
        self.addCleanup(frappe.set_user, "Administrator")
        entity = self._opened(f"Named {frappe.generate_hash(6)}")
        home = frappe.db.get_value("File", entity.name, "folder")

        self.assertTrue(does_entity_exist(entity.file_name, home))
        self.assertFalse(does_entity_exist(f"Nothing {frappe.generate_hash(6)}", home))

    def test_a_stranger_cannot_add_a_picture_to_somebody_elses_document(self):
        """The gate is the old body's, `user_has_permission(parent, "upload")`,
        and it is the rule that wrote the row."""
        frappe.set_user(USER)
        entity = docs.create_document(title=f"Private pictures {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, "File", entity.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")
        self._posted(PNG)
        before = set(frappe.get_all("File", filters={"folder": entity.name}, pluck="name"))
        with self.assertRaises(frappe.PermissionError):
            embed.add(entity.name)
        self.assertEqual(
            set(frappe.get_all("File", filters={"folder": entity.name}, pluck="name")),
            before,
            "a refused upload writes nothing",
        )

    def test_a_legacy_document_still_takes_its_private_history(self):
        docname = self._legacy_document()
        document = frappe.get_doc(DOCTYPE, docname)

        document.new_version("<p>a draft</p>", title="first")

        self.assertTrue(frappe.db.exists("Writer Version", {"doc": docname, "title": "first"}))
        with self.assertRaises(frappe.ValidationError):
            document.take_version()

    def test_a_docshare_on_a_writer_document_does_not_fail_a_migration(self):
        """`after_migrate` runs `validate_content_registry`. Desk assignment
        writes a `DocShare` (`frappe/desk/form/assign_to.py` calls
        `frappe.share.add`) and no tool rewrites those rows as grants before
        Build, so activating now would refuse the site."""
        docname = self._legacy_document()
        share = frappe.share.add(DOCTYPE, docname, OTHER, read=1)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        validate_content_registry()

        # And the reason it has to stay dormant: activation refuses the site
        # while that row exists. Ticket 28 owes the rewrite.
        with activated(), self.assertRaises(DriveConflict):
            validate_content_registry()

    def test_a_docshare_on_a_legacy_document_still_opens_it_and_still_lists_it(self):
        """The two refusals are scoped to a row that carries a node. No row
        carries one before Build, so a site with Desk assignments reads and
        lists exactly what it always did: `false_if_not_shared` answers the row
        check the staged hook denied, and the shared names are ORed into the
        list around the staged predicate.
        """
        docname = self._legacy_document()
        share = frappe.share.add(DOCTYPE, docname, OTHER, read=1)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

        frappe.set_user(OTHER)
        self.addCleanup(frappe.set_user, "Administrator")

        self.assertIn("`tabWriter Document`.`node` IS NULL", overrides.document_query_conditions(OTHER))
        self.assertFalse(overrides.document_has_permission(frappe.get_doc(DOCTYPE, docname), "read", OTHER))
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

    def test_activation_would_accept_the_declaration_itself(self):
        # Every check `validate_registry` makes that needs a database: the node
        # Link, the mixin, the node field name, and the fields §10.2 forbids.
        with activated():
            validate_content_registry()


class TestWriterInDrive(IntegrationTestCase):
    """Lifecycle, history, media, permissions, and legacy rows, on real rows.

    Every test runs under `activated()`, because none of these workflows exist
    on a site until ticket 29 registers the declaration.
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

        `refuse_governed_share` refuses a new one under `activated()`, and
        nothing rewrites the rows a site already had before Build, so the row
        the staged guards have to answer for is always a hand-written one.
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
