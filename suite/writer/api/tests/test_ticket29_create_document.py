"""Site-free contracts for ticket 29: `create_document` as a Drive-native adapter.

`Writer Document` joined `drive_content_types` (`suite/hooks.py`), so
`DriveContent.before_insert` now refuses any row with no node
(`suite/drive/_core/content.py:require_node`). These tests never touch a
database: `suite.writer.api.docs.frappe` is replaced wholesale, and
`suite.drive.create_document` is mocked at the boundary the adapter calls it
through, so what is checked is the adapter's own contract, not the workflow it
delegates to (that workflow has its own tests under `suite/drive/tests/`).
"""

from __future__ import annotations

import unittest
from unittest import mock

import frappe

from suite.writer.api import docs


def _node_row(**overrides) -> frappe._dict:
    row = frappe._dict(
        name="NODE-1",
        parent="ROOT-1",
        title=docs.DEFAULT_TITLE,
        size=0,
        mime="frappe/writer",
        content_doctype="Writer Document",
        content_docname="WD-1",
        creation="2026-01-01 00:00:00",
        content_modified="2026-01-02 00:00:00",
        modified="2026-01-01 00:00:00",
        owner="writer@example.com",
    )
    row.update(overrides)
    return row


class CreateDocumentAdapter(unittest.TestCase):
    def _frappe(self):
        patcher = mock.patch.object(docs, "frappe")
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        patched.session.user = "writer@example.com"
        patched.ValidationError = frappe.ValidationError
        patched.as_json = frappe.as_json
        patched.throw.side_effect = lambda message, exc=Exception: (_ for _ in ()).throw(exc(message))
        return patched

    def test_success_writes_through_the_workflow_and_answers_legacy_fields(self):
        """The node, not a bare `File`, is what gets created; the response still
        reads like one, because the frontend contract never changed."""
        patched = self._frappe()
        patched.db.get_value.return_value = _node_row()
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value="ROOT-1") as root_for,
            mock.patch.object(docs.drive, "ensure_personal_root") as ensure_root,
            mock.patch.object(docs.drive, "create_document", return_value="NODE-1") as create,
        ):
            entity = docs.create_document()

        root_for.assert_called_once_with("writer@example.com")
        ensure_root.assert_not_called()
        create.assert_called_once_with("ROOT-1", docs.DEFAULT_TITLE, content_doctype="Writer Document")
        patched.new_doc.assert_not_called()
        self.assertEqual(
            entity,
            {
                "name": "NODE-1",
                "file_name": docs.DEFAULT_TITLE,
                "folder": "ROOT-1",
                "file_size": 0,
                "file_type": "Document",
                "mime_type": "frappe/writer",
                "is_folder": 0,
                "content_doctype": "Writer Document",
                "content_docname": "WD-1",
                "creation": "2026-01-01 00:00:00",
                "modified": "2026-01-02 00:00:00",
                "owner": "writer@example.com",
            },
        )
        patched.db.set_value.assert_not_called()

    def test_falls_back_to_content_modified_when_the_node_was_never_touched(self):
        patched = self._frappe()
        patched.db.get_value.return_value = _node_row(content_modified=None, modified="2026-01-01 00:00:00")
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value="ROOT-1"),
            mock.patch.object(docs.drive, "create_document", return_value="NODE-1"),
        ):
            entity = docs.create_document()
        self.assertEqual(entity["modified"], "2026-01-01 00:00:00")

    def test_no_parent_provisions_the_callers_personal_root_lazily(self):
        patched = self._frappe()
        patched.db.get_value.return_value = _node_row(parent="ROOT-2")
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value=None),
            mock.patch.object(docs.drive, "ensure_personal_root", return_value="ROOT-2") as ensure_root,
            mock.patch.object(docs.drive, "create_document", return_value="NODE-1") as create,
        ):
            docs.create_document()
        ensure_root.assert_called_once_with("writer@example.com")
        create.assert_called_once_with("ROOT-2", docs.DEFAULT_TITLE, content_doctype="Writer Document")

    def test_a_caller_with_no_personal_root_is_refused_before_any_write(self):
        """Guest and Administrator both answer `None` from `ensure_personal_root`
        (§7). The refusal must land before the workflow is ever called."""
        self._frappe()
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value=None),
            mock.patch.object(docs.drive, "ensure_personal_root", return_value=None),
            mock.patch.object(docs.drive, "create_document") as create,
        ):
            with self.assertRaises(frappe.ValidationError):
                docs.create_document()
        create.assert_not_called()

    def test_an_explicit_parent_and_title_pass_straight_through(self):
        patched = self._frappe()
        patched.db.get_value.return_value = _node_row(name="NODE-9", parent="FOLDER-9", title="Report")
        with (
            mock.patch.object(docs.drive, "personal_root_for") as root_for,
            mock.patch.object(docs.drive, "create_document", return_value="NODE-9") as create,
        ):
            docs.create_document(title="Report", parent="FOLDER-9")
        root_for.assert_not_called()
        create.assert_called_once_with("FOLDER-9", "Report", content_doctype="Writer Document")

    def test_a_template_is_written_onto_settings_after_the_document_exists(self):
        patched = self._frappe()
        patched.db.get_value.return_value = _node_row(content_docname="WD-4")
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value="ROOT-1"),
            mock.patch.object(docs.drive, "create_document", return_value="NODE-1"),
        ):
            docs.create_document(template="Letterhead")
        patched.db.set_value.assert_called_once_with(
            "Writer Document",
            "WD-4",
            "settings",
            frappe.as_json({"collab": True, "template": "Letterhead"}),
            update_modified=False,
        )

    def test_a_workflow_refusal_leaves_no_trailing_write(self):
        """The workflow's own savepoint already rolled the node and the document
        back (§8.3). The adapter must not read or write anything afterwards -
        that would be a second, unguarded write outside the rollback.

        `drive.rollback_savepoint` is mocked here the same way `create_document`
        and `personal_root_for` are above: it is a call through the `drive`
        boundary this adapter delegates to, not a workflow this file tests. Its
        real deadlock-vs-lost-savepoint behavior belongs to
        `suite/writer/tests/test_docs_savepoint.py`; leaving it unmocked here
        would let this unit test's fake `frappe.generate_hash()` savepoint name
        reach a real `frappe.db.rollback(save_point=...)` against a live
        connection.
        """
        patched = self._frappe()

        class Boom(Exception):
            pass

        failure = Boom("conflict")
        with (
            mock.patch.object(docs.drive, "personal_root_for", return_value="ROOT-1"),
            mock.patch.object(docs.drive, "create_document", side_effect=failure),
            mock.patch.object(docs.drive, "rollback_savepoint") as rollback,
        ):
            with self.assertRaises(Boom):
                docs.create_document(template="Letterhead")
        rollback.assert_called_once()
        savepoint, rolled_back_error = rollback.call_args.args
        self.assertIsInstance(savepoint, str)
        self.assertIs(rolled_back_error, failure)
        patched.db.get_value.assert_not_called()
        patched.db.set_value.assert_not_called()


if __name__ == "__main__":
    unittest.main()
