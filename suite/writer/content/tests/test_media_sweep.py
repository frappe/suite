import frappe
import pycrdt

from suite.content import logged
from suite.drive._core import content as drive_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase, declaring, embed


class TestWriterMediaSweep(DriveCallbackCase):
    def test_used_nodes_reads_the_pictures_a_collab_document_holds_and_those_removed_since_compaction(self):
        node = self.new_document()

        def add_three_pictures(body):
            body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-kept")}))
            body.children.append(pycrdt.XmlElement("image", {"src": "", "data-node": "pic-bare"}))
            body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-removed")}))

        with declaring("data-node"):
            self.push_edit(node, add_three_pictures)

        self.compact(node)
        self.push_edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic-new")}))
        )
        self.push_edit(node, lambda body: body.children.__delitem__(2))

        found = writer_drive.SPEC.used_nodes(self.docname_of(node))

        self.assertEqual(found, {"pic-kept", "pic-bare", "pic-removed", "pic-new"})

    def test_used_nodes_raises_on_a_log_it_cannot_read_so_the_sweep_skips_it(self):
        node = self.new_document()
        self.push_edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed("pic")}))
        )
        frappe.db.sql(
            "UPDATE `__writer_content_update` SET `payload` = 'x' WHERE `doc_id` = %s", self.doc_row(node).id
        )
        frappe.db.commit()

        with self.assertRaises(logged.UnreadableBody):
            writer_drive.SPEC.used_nodes(self.docname_of(node))

    def test_the_media_sweep_keeps_a_picture_only_the_log_names(self):
        node = self.new_document()
        named = self.old_media(node, "named.png")
        unnamed = self.old_media(node, "unnamed.png")
        self.push_edit(
            node, lambda body: body.children.append(pycrdt.XmlElement("image", {"src": embed(named)}))
        )

        spec = drive_content.registry()[writer_drive.DOCTYPE]
        node_row = frappe._dict(name=node, content_docname=self.docname_of(node))
        trashed = drive_content._sweep_document(spec, node_row)

        self.assertEqual(trashed, 1)
        self.assertEqual(frappe.db.get_value("Drive Node", named, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", unnamed, "state"), "Trashed")
