"""Site-free contracts for ticket 28 Writer compatibility guards."""

from __future__ import annotations

import io
import json
import unittest
from unittest import mock

import frappe

from suite.drive import framework
from suite.writer import drive as writer
from suite.writer import overrides


class WriterVersionPayloads(unittest.TestCase):
    def _errors(self):
        translate = mock.patch.object(writer, "_", side_effect=lambda message: message)
        throw = mock.patch.object(
            writer.frappe,
            "throw",
            side_effect=lambda message, exc=Exception: (_ for _ in ()).throw(exc(message)),
        )
        translate.start()
        throw.start()
        self.addCleanup(translate.stop)
        self.addCleanup(throw.stop)

    def test_native_and_old_envelopes_preserve_or_default_collaboration(self):
        native = {"schema": writer.VERSION_SCHEMA, "content": "body", "html": "<p>x</p>", "collab": 0}
        old = {"schema": writer.VERSION_SCHEMA, "content": "body", "html": "<p>x</p>"}
        self.assertEqual(writer._version_payload(json.dumps(native).encode())["collab"], 0)
        self.assertEqual(writer._version_payload(json.dumps(old).encode())["collab"], 1)

    def test_exact_utf8_legacy_html_becomes_non_collaborative(self):
        html = "<p>legacy π</p>"
        self.assertEqual(
            writer._version_payload(html.encode()),
            {"content": writer.EMPTY_BODY, "html": html, "collab": 0},
        )

    def test_unknown_schema_and_invalid_utf8_are_refused(self):
        self._errors()
        for raw in (b'{"schema":"writer-document/2"}', b"\xff"):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    def test_a_json_object_is_an_envelope_and_owes_a_schema(self):
        # The fork is the shape, not a key spelling. A truncated envelope, or
        # one whose key is misspelled, must not restore its own source text as
        # the document body.
        self._errors()
        for raw in (
            b"{}",
            b'{"shema": "writer-document/1", "content": "a", "html": ""}',
            b'{"content": "a", "html": "<p>x</p>"}',
        ):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    def test_json_that_is_not_an_object_is_still_read_as_legacy_html(self):
        # HTML never parses as a JSON object, but a snapshot may be any text.
        for raw in (b"[]", b"null", b"123", b"", b"<p>x</p>"):
            with self.subTest(raw=raw):
                self.assertEqual(
                    writer._version_payload(raw),
                    {"content": writer.EMPTY_BODY, "html": raw.decode(), "collab": 0},
                )

    def test_a_version_larger_than_the_bound_is_refused_before_it_is_held(self):
        self._errors()
        oversized = io.BytesIO(b"x" * (writer.MAX_VERSION_BYTES + 1))
        with mock.patch.object(writer.frappe.db, "set_value") as write:
            with self.assertRaises(frappe.ValidationError):
                writer.restore_version("WR-1", oversized)
        write.assert_not_called()

    def test_version_capture_includes_collaboration_mode(self):
        row = frappe._dict(content="body", html="<p>x</p>", collab=0)
        with mock.patch.object(writer.frappe.db, "get_value", return_value=row):
            stream, mime = writer.version_bytes("WR-1")
        self.assertEqual(mime, writer.VERSION_MIME)
        self.assertEqual(json.loads(stream.read())["collab"], 0)

    def test_restore_is_one_write_and_invalid_bytes_write_nothing(self):
        self._errors()
        with mock.patch.object(writer.frappe.db, "set_value") as write:
            writer.restore_version("WR-1", io.BytesIO(b"<p>legacy</p>"))
            write.assert_called_once_with(
                writer.DOCTYPE,
                "WR-1",
                {"content": writer.EMPTY_BODY, "html": "<p>legacy</p>", "collab": 0},
            )
            write.reset_mock()
            with self.assertRaises(frappe.ValidationError):
                writer.restore_version("WR-1", io.BytesIO(b"\xff"))
            write.assert_not_called()


class WriterVersionPermissions(unittest.TestCase):
    def _frappe(self):
        patcher = mock.patch.object(overrides, "frappe")
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        patched.session.user = "reader@example.com"
        patched.get_roles.return_value = ["All"]
        patched.PermissionError = PermissionError
        patched.throw.side_effect = lambda message, exc=Exception: (_ for _ in ()).throw(exc(message))
        return patched

    def test_linked_parent_refuses_child_share_before_legacy_file_lookup(self):
        frappe = self._frappe()
        frappe.db.get_value.return_value = "NODE-1"
        version = {"doctype": "Writer Version", "name": "VER-1", "doc": "DOC-1"}
        with (
            mock.patch.object(overrides.drive, "refuse_shared_row") as refuse,
            mock.patch.object(overrides.File, "get_for_doc") as legacy_file,
        ):
            self.assertFalse(overrides.version_has_permission(version, "read"))
        refuse.assert_called_once_with("Writer Version", "VER-1", "read", "reader@example.com")
        legacy_file.assert_not_called()

    def test_unlinked_parent_keeps_file_backed_permission(self):
        frappe = self._frappe()
        frappe.db.get_value.return_value = None
        with (
            mock.patch.object(overrides.File, "get_for_doc", return_value="FILE-1"),
            mock.patch.object(overrides, "user_has_permission", return_value=True) as allowed,
        ):
            self.assertTrue(
                overrides.version_has_permission(
                    {"doctype": "Writer Version", "name": "VER-1", "doc": "DOC-1"},
                    "read",
                )
            )
        allowed.assert_called_once_with("FILE-1", "read", "reader@example.com")

    def test_orphan_child_is_refused_before_frappe_can_apply_its_share(self):
        self._frappe()
        with mock.patch.object(overrides.drive, "refuse_shared_row") as refuse:
            self.assertFalse(
                overrides.version_has_permission(
                    {"doctype": "Writer Version", "name": "VER-1", "doc": None},
                    "write",
                )
            )
        refuse.assert_called_once_with("Writer Version", "VER-1", "write", "reader@example.com")

    def test_list_refuses_a_shared_child_of_a_linked_parent_through_drive(self):
        self._frappe()
        with (
            mock.patch.object(overrides.drive, "refuse_shared_child_rows") as refuse,
            mock.patch.object(overrides, "_document_predicate", return_value=""),
        ):
            overrides.version_query_conditions("reader@example.com")
        refuse.assert_called_once_with(
            "Writer Version", "Writer Document", "doc", "node", "reader@example.com"
        )

    def test_list_keeps_the_legacy_parent_predicate_when_no_shared_child_is_linked(self):
        frappe = self._frappe()
        with (
            mock.patch.object(overrides.drive, "refuse_shared_child_rows"),
            mock.patch.object(overrides, "_document_predicate", return_value="legacy-parent") as parent,
        ):
            condition = overrides.version_query_conditions("reader@example.com")
        self.assertIn("legacy-parent", condition)
        parent.assert_called_once_with("reader@example.com")
        frappe.db.set_value.assert_not_called()
        frappe.db.delete.assert_not_called()

    def test_only_the_administrator_skips_the_version_guards(self):
        # §4.9 grants no `System Manager` bypass. Drive Grant is the only
        # authority for a linked row (§1), and a role bypass here would hand a
        # System Manager every migrated document's history.
        frappe = self._frappe()
        frappe.get_roles.return_value = ["All", "System Manager", "Suite Admin"]
        frappe.db.get_value.return_value = "NODE-1"
        with (
            mock.patch.object(overrides.drive, "refuse_shared_row") as refuse,
            mock.patch.object(overrides.File, "get_for_doc") as legacy_file,
        ):
            self.assertFalse(
                overrides.version_has_permission(
                    {"doctype": "Writer Version", "name": "VER-1", "doc": "DOC-1"}, "read"
                )
            )
        refuse.assert_called_once()
        legacy_file.assert_not_called()

        with (
            mock.patch.object(overrides.drive, "refuse_shared_child_rows") as refuse_list,
            mock.patch.object(overrides, "_document_predicate", return_value=""),
        ):
            overrides.version_query_conditions("reader@example.com")
        refuse_list.assert_called_once()


class SharedChildRefusal(unittest.TestCase):
    """`suite.drive.framework.refuse_shared_child_rows`, the guard Writer calls."""

    def _framework(self):
        patcher = mock.patch.object(framework, "frappe")
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        patched.session.user = "reader@example.com"
        return patched

    def _refuse(self, user="reader@example.com"):
        framework.refuse_shared_child_rows("Writer Version", "Writer Document", "doc", "node", user)

    def test_a_share_reaching_a_linked_parent_raises_drive_forbidden(self):
        # Not `frappe.PermissionError`: `frappe.desk.notifications` and
        # `desktop` swallow that one, so the refusal would go silent there.
        patched = self._framework()
        patched.get_all.return_value = ["DOC-1"]
        patched.db.get_value.return_value = "DOC-1"
        with mock.patch("frappe.share.get_shared", return_value=["VER-1"]):
            with self.assertRaises(framework.DriveForbidden):
                self._refuse()

    def test_the_parent_read_asks_is_set_so_an_empty_link_is_unlinked(self):
        # Frappe stores an unset Link as `''`. `node IS NOT NULL` would read one
        # as linked and 403 the caller out of their own legacy version list.
        patched = self._framework()
        patched.get_all.return_value = ["DOC-1"]
        patched.db.get_value.return_value = None
        with mock.patch("frappe.share.get_shared", return_value=["VER-1"]):
            self._refuse()
        self.assertEqual(
            patched.db.get_value.call_args.args[1],
            {"name": ("in", ["DOC-1"]), "node": ("is", "set")},
        )

    def test_no_share_asks_the_database_nothing(self):
        patched = self._framework()
        with mock.patch("frappe.share.get_shared", return_value=[]):
            self._refuse()
        patched.get_all.assert_not_called()
        patched.db.get_value.assert_not_called()

    def test_a_share_on_an_orphan_child_never_builds_an_empty_in_clause(self):
        # `("in", [])` is a MariaDB syntax error, and a version row whose parent
        # is gone plucks `None`.
        patched = self._framework()
        patched.get_all.return_value = [None]
        with mock.patch("frappe.share.get_shared", return_value=["VER-1"]):
            self._refuse()
        patched.db.get_value.assert_not_called()

    def test_the_administrator_is_skipped(self):
        patched = self._framework()
        with mock.patch("frappe.share.get_shared") as shared:
            self._refuse("Administrator")
        shared.assert_not_called()
        patched.get_all.assert_not_called()


if __name__ == "__main__":
    unittest.main()
