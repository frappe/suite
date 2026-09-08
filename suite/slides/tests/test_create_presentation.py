# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""create_presentation's Drive-native adapter (ticket 29).

Once `Presentation` joined `drive_content_types`, `content.require_node`
refuses an insert with no node (`content.py:757-770`). The legacy
`create_presentation` still built a bare `Presentation` through
`presentation.insert()`, so every call raised `DriveConflict`.

These are shape tests, not integration tests: `frappe`, `drive`, and
`slides_drive` are mocked wholesale, the way `suite.sheets.tests.test_create_sheet`
pins `create_sheet`'s adapter contract without a site. The Drive-native
lifecycle itself (`drive.create_document`, `require_node`, the reciprocal
link, the `duplicate` factory's slide and media copy) is
`suite.slides.tests.test_drive_adoption`'s `TestSlidesInDrive`.
"""

from __future__ import annotations

import unittest
from unittest import mock


class _CreatePresentationBase(unittest.TestCase):
    def setUp(self):
        frappe_patcher = mock.patch("suite.slides.doctype.presentation.presentation.frappe")
        self.frappe = frappe_patcher.start()
        self.addCleanup(frappe_patcher.stop)
        self.frappe.session.user = "alice@example.com"
        self.frappe.has_permission.return_value = True

        drive_patcher = mock.patch("suite.slides.doctype.presentation.presentation.drive")
        self.drive = drive_patcher.start()
        self.addCleanup(drive_patcher.stop)

        slides_drive_patcher = mock.patch("suite.slides.doctype.presentation.presentation.slides_drive")
        self.slides_drive = slides_drive_patcher.start()
        self.addCleanup(slides_drive_patcher.stop)
        self.slides_drive.DOCTYPE = "Presentation"

        self.drive.create_document.return_value = "node-1"
        self.slides_drive.docname_for_node.return_value = "PRES-1"
        self.new_doc = mock.MagicMock(node_title="Server Title")
        self.frappe.get_doc.return_value = self.new_doc


class CreatePresentationFromADuplicate(_CreatePresentationBase):
    def setUp(self):
        super().setUp()
        self.slides_drive.node_of.return_value = "node-source"
        self.slides_drive.node_title_of.return_value = "Budget"

    def test_creates_through_drive_with_a_copy_title_and_resolves_the_docname(self):
        from suite.slides.doctype.presentation import presentation

        result = presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.slides_drive.node_of.assert_called_once_with("PRES-source")
        self.drive.create_document.assert_called_once_with(
            "folder-1", "Copy of Budget", content_doctype="Presentation", from_node="node-source"
        )
        self.slides_drive.docname_for_node.assert_called_once_with("node-1")
        self.frappe.get_doc.assert_called_once_with("Presentation", "PRES-1")
        self.assertIs(result, self.new_doc)

    def test_the_response_title_is_read_from_the_node_not_the_frozen_column(self):
        # Drive owns the title and keeps no mirror (§10.2): the legacy column
        # stays blank on a fresh deck, so the caller-facing title has to come
        # from the node the adapter just created.
        from suite.slides.doctype.presentation import presentation

        result = presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.assertEqual(result.title, "Server Title")

    def test_requires_read_permission_on_the_source(self):
        from suite.slides.doctype.presentation import presentation

        self.frappe.has_permission.return_value = False
        self.frappe.throw.side_effect = RuntimeError("cannot duplicate")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.frappe.has_permission.assert_called_once_with("Presentation", "read", "PRES-source")
        self.drive.create_document.assert_not_called()

    def test_does_not_look_up_a_home_folder_with_an_explicit_parent(self):
        from suite.slides.doctype.presentation import presentation

        presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.drive.personal_root_for.assert_not_called()
        self.drive.ensure_personal_root.assert_not_called()


class CreatePresentationFromATemplate(_CreatePresentationBase):
    def setUp(self):
        super().setUp()
        self.frappe.db.get_value.return_value = "node-template"
        self.slides_drive.node_is_template.return_value = True

    def test_creates_through_drive_with_the_untitled_title(self):
        from suite.slides.doctype.presentation import presentation

        presentation.create_presentation(template="PRES-template", parent="folder-1")

        self.frappe.db.get_value.assert_called_once_with("Presentation", "PRES-template", "node")
        self.slides_drive.node_is_template.assert_called_once_with("node-template")
        self.drive.create_document.assert_called_once_with(
            "folder-1", "Untitled", content_doctype="Presentation", from_node="node-template"
        )

    def test_a_template_with_no_node_does_not_exist(self):
        from suite.slides.doctype.presentation import presentation

        self.frappe.db.get_value.return_value = None
        self.frappe.throw.side_effect = RuntimeError("template does not exist")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(template="PRES-missing", parent="folder-1")

        self.drive.create_document.assert_not_called()

    def test_a_linked_deck_that_is_not_a_template_does_not_exist(self):
        # `is_template` lives on the node, never on the frozen legacy column
        # (§8.10): a readable, non-template deck must still be refused, and
        # the same "does not exist" throw covers an unreadable one so
        # neither answer leaks whether it exists.
        from suite.slides.doctype.presentation import presentation

        self.slides_drive.node_is_template.return_value = False
        self.frappe.throw.side_effect = RuntimeError("template does not exist")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(template="PRES-not-a-template", parent="folder-1")

        self.frappe.has_permission.assert_not_called()
        self.drive.create_document.assert_not_called()

    def test_requires_read_permission_on_the_template(self):
        from suite.slides.doctype.presentation import presentation

        self.frappe.has_permission.return_value = False
        self.frappe.throw.side_effect = RuntimeError("cannot use this template")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(template="PRES-template", parent="folder-1")

        self.drive.create_document.assert_not_called()


class CreatePresentationWithNoParent(_CreatePresentationBase):
    def setUp(self):
        super().setUp()
        self.slides_drive.node_of.return_value = "node-source"
        self.slides_drive.node_title_of.return_value = "Budget"

    def test_falls_back_to_the_callers_existing_root(self):
        from suite.slides.doctype.presentation import presentation

        self.drive.personal_root_for.return_value = "root-alice"

        presentation.create_presentation(duplicate_from="PRES-source", parent="")

        self.drive.personal_root_for.assert_called_once_with("alice@example.com")
        self.drive.ensure_personal_root.assert_not_called()
        self.drive.create_document.assert_called_once_with(
            "root-alice", "Copy of Budget", content_doctype="Presentation", from_node="node-source"
        )

    def test_provisions_a_root_on_first_use(self):
        from suite.slides.doctype.presentation import presentation

        self.drive.personal_root_for.return_value = None
        self.drive.ensure_personal_root.return_value = "root-fresh"

        presentation.create_presentation(duplicate_from="PRES-source", parent="")

        self.drive.ensure_personal_root.assert_called_once_with("alice@example.com")
        self.drive.create_document.assert_called_once_with(
            "root-fresh", "Copy of Budget", content_doctype="Presentation", from_node="node-source"
        )

    def test_refuses_when_the_caller_has_no_home_folder(self):
        # Guest and Administrator both come back None from `ensure_personal_root`
        # (§7: a Personal root belongs to an ordinary Suite user).
        from suite.slides.doctype.presentation import presentation

        self.drive.personal_root_for.return_value = None
        self.drive.ensure_personal_root.return_value = None
        self.frappe.throw.side_effect = RuntimeError("no folder")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(duplicate_from="PRES-source", parent="")

        self.drive.create_document.assert_not_called()


class CreatePresentationRollsBackOnRefusal(_CreatePresentationBase):
    def setUp(self):
        super().setUp()
        self.slides_drive.node_of.return_value = "node-source"
        self.slides_drive.node_title_of.return_value = "Budget"

    def test_a_drive_refusal_propagates_without_reading_a_docname(self):
        # `drive.create_document` runs the whole create in its own savepoint
        # (node + deck + copied slides + copied media) and rolls it back on
        # any failure; the adapter must not paper over that by still trying
        # to resolve a docname for a create that never happened.
        from suite.slides.doctype.presentation import presentation

        class _Refused(Exception):
            pass

        self.drive.create_document.side_effect = _Refused("no upload rights")

        with self.assertRaises(_Refused):
            presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.slides_drive.docname_for_node.assert_not_called()
        self.frappe.get_doc.assert_not_called()

    def test_a_missing_reciprocal_link_is_never_silently_returned(self):
        # Structurally shouldn't happen — `nodes._link_document` guarantees
        # the reciprocal link before `create_document` returns — but the
        # adapter must refuse loudly rather than hand the caller a null deck.
        from suite.slides.doctype.presentation import presentation

        self.slides_drive.docname_for_node.return_value = None
        self.frappe.throw.side_effect = RuntimeError("not found")

        with self.assertRaises(RuntimeError):
            presentation.create_presentation(duplicate_from="PRES-source", parent="folder-1")

        self.frappe.get_doc.assert_not_called()
