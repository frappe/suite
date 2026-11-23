from unittest.mock import patch

import frappe
from frappe.utils.logging import connection_for

from suite import drive
from suite.content import copies, live
from suite.drive._core import content as drive_content
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase


class TestWriterDocumentRow(DriveCallbackCase):
    def test_a_comment_change_tells_the_documents_open_tabs(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc = self.doc_row(node)
        room = live.rooms(writer_content.APP, doc.id, doc.lineage)["keys"][0]

        with patch("frappe.publish_realtime") as publish:
            drive_content.spec_for("Writer Document").threads_changed(node)

        control = {"lineage": doc.lineage, "kind": "threads"}
        publish.assert_called_once_with("suite_collab_ctl", control, room=room)

    def test_a_generic_row_write_cannot_change_the_body_of_a_collab_document(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        self.compact(node)
        name = self.docname_of(node)
        fields = ("content", "html", "ycomments", "collab")
        before = frappe.db.get_value("Writer Document", name, fields)

        # frappe.client.set_value, and a REST PUT, which updates the row and saves it
        for write in (
            lambda: frappe.client.set_value("Writer Document", name, "content", "AAA="),
            lambda: frappe.client.set_value("Writer Document", name, "html", "<p>older</p>"),
            lambda: frappe.client.set_value("Writer Document", name, "ycomments", "AQID"),
            lambda: frappe.client.set_value("Writer Document", name, "collab", 0),
            lambda: frappe.get_doc("Writer Document", name).update({"content": "AAA="}).save(),
        ):
            with self.subTest(), self.assertRaisesRegex(drive.DriveConflict, "reload it"):
                write()

            frappe.db.rollback()
            self.assertEqual(frappe.db.get_value("Writer Document", name, fields), before)

        self.assertEqual(self.text_of(self.body_of(node)), "one")

    def test_changing_settings_keeps_the_body_a_compaction_wrote_meanwhile(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        document = frappe.get_doc("Writer Document", self.docname_of(node))
        self.type_into(node, [" two"])
        self.compact(node)

        document.update_settings('{"fullWidth": true}')

        self.assertEqual(self.text_of(self.body_of(node)), "one two")
        self.assertEqual(
            frappe.db.get_value("Writer Document", self.docname_of(node), "settings"), '{"fullWidth": true}'
        )

    def test_the_row_read_sends_no_body_for_a_collab_document(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        self.compact(node)

        row = frappe.client.get("Writer Document", self.docname_of(node))

        self.assertEqual((row["name"], row.get("content")), (self.docname_of(node), None))
        self.assertEqual(self.text_of(self.body_of(node)), "one")

    def test_drive_exports_a_collab_document_only_from_a_checked_copy_of_its_head(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        refresh = "Open the document to refresh its export"

        with self.assertRaisesRegex(drive.DriveConflict, refresh):
            writer_drive.SPEC.export(self.docname_of(node), "html")

        doc = self.doc_row(node)
        copies.install(
            writer_content.APP,
            doc.id,
            1,
            doc.lineage,
            doc.q_epoch,
            "<p>one</p>",
            writer_content.EDITOR.readable_copy,
        )
        exported, _mime = writer_drive.SPEC.export(self.docname_of(node), "html")
        self.assertEqual(exported.read(), b"<p>one</p>")

        self.type_into(node, [" two"])
        with self.assertRaisesRegex(drive.DriveConflict, refresh):
            writer_drive.SPEC.export(self.docname_of(node), "html")

    def test_drive_never_exports_a_copy_something_else_wrote_and_keeps_it_once(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc = self.doc_row(node)
        copies.install(
            writer_content.APP,
            doc.id,
            1,
            doc.lineage,
            doc.q_epoch,
            "<p>one</p>",
            writer_content.EDITOR.readable_copy,
        )
        frappe.db.set_value(
            "Writer Document", self.docname_of(node), "html", "<p>foreign</p>", update_modified=False
        )
        frappe.db.commit()
        alerts = connection_for("Error Log").count(
            "Error Log", {"method": "Collab readable copy: written elsewhere"}
        )

        for _attempt in range(2):
            with self.assertRaisesRegex(drive.DriveConflict, "Open the document to refresh its export"):
                writer_drive.SPEC.export(self.docname_of(node), "html")

        evidence = frappe.db.sql(
            "SELECT `reason`, `payload` FROM `__writer_content_recovery` WHERE `doc_id` = %s", doc.id
        )
        self.assertEqual(
            [(reason, bytes(payload)) for reason, payload in evidence], [("copy_foreign", b"<p>foreign</p>")]
        )
        self.assertEqual(
            connection_for("Error Log").count(
                "Error Log", {"method": "Collab readable copy: written elsewhere"}
            ),
            alerts + 1,
        )
