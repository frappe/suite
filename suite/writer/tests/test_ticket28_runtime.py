"""Site-free contracts for ticket 28 Writer compatibility guards."""

from __future__ import annotations

import io
import json
import unittest
from unittest import mock

import frappe

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

    def test_list_refuses_a_shared_child_of_a_linked_parent(self):
        frappe = self._frappe()
        frappe.db.sql.return_value = [("VER-1",)]
        with (
            mock.patch("frappe.share.get_shared", return_value=["VER-1"]),
            self.assertRaises(PermissionError),
        ):
            overrides.version_query_conditions("reader@example.com")

    def test_list_keeps_the_legacy_parent_predicate_when_no_shared_child_is_linked(self):
        frappe = self._frappe()
        frappe.db.sql.return_value = []
        with (
            mock.patch("frappe.share.get_shared", return_value=["VER-1"]),
            mock.patch.object(overrides, "_document_predicate", return_value="legacy-parent") as parent,
        ):
            condition = overrides.version_query_conditions("reader@example.com")
        self.assertIn("legacy-parent", condition)
        parent.assert_called_once_with("reader@example.com")
        frappe.db.set_value.assert_not_called()
        frappe.db.delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
