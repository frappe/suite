"""Ticket 28 conversion wiring against real Frappe tables.

The site-free suite proves the mapping matrix. These narrow fixtures prove
that bulk target rows, source queries, and exact blob bytes fit the shipped
schemas. Run them only at the ticket 28 site gate.
"""

import json
from pathlib import Path

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.history import convert_history_and_comments
from suite.drive.patches.build.ports import SiteContentSource, SiteContentTarget
from suite.drive.patches.build.slide_journal import SlidePreimageJournal
from suite.drive.patches.build.state import BuildState, GrantConversion, TreeConversion


class TestBuildContentWiring(IntegrationTestCase):
    """Synthetic linked documents, isolated by a unique name prefix."""

    def setUp(self):
        super().setUp()
        self.prefix = "bldct" + frappe.generate_hash(length=8)
        self.state = BuildState(Path(frappe.get_site_path("private", f"{self.prefix}-state.json")))
        self.journal = SlidePreimageJournal(
            Path(frappe.get_site_path("private", f"{self.prefix}-slide-preimages"))
        )
        self.state.put_tree(TreeConversion(completed=True))
        self.state.put_grants(GrantConversion(completed=True))
        self.blobs = set()

    def tearDown(self):
        like = self.prefix + "%"
        frappe.db.delete("Drive Comment", {"name": ("like", like)})
        frappe.db.delete("Drive Comment Thread", {"name": ("like", like)})
        frappe.db.delete("Drive Node Version", {"name": ("like", like)})
        frappe.db.delete("Sheet Snapshot", {"name": ("like", like)})
        frappe.db.delete("Sheet", {"name": ("like", like)})
        frappe.db.delete("Writer Version", {"name": ("like", like)})
        frappe.db.delete("Writer Document", {"name": ("like", like)})
        frappe.db.delete("Drive Node", {"name": ("like", like)})
        for blob in self.blobs:
            frappe.db.delete("File Blob", {"name": blob})
        self.state.path.unlink(missing_ok=True)
        super().tearDown()

    def environment(self):
        return BuildEnvironment(
            storage=None,
            files=None,
            state=self.state,
            legacy_s3=LegacyS3Config(),
            content=SiteContentSource(self.prefix),
            content_target=SiteContentTarget(),
            slide_journal=self.journal,
        )

    def insert(self, doctype, name, **values):
        stamp = now_datetime()
        doc = frappe.new_doc(doctype)
        doc.update(values)
        doc.name = name
        doc.owner = doc.modified_by = "Administrator"
        doc.creation = doc.modified = stamp
        doc.flags.ignore_validate = True
        doc.db_insert()
        return doc

    def node(self, name, doctype):
        stamp = str(now_datetime())
        SiteContentTarget().insert_nodes(
            [
                {
                    "name": name,
                    "title": name,
                    "kind": "document",
                    "size": 0,
                    "content_doctype": doctype,
                    "content_docname": name,
                    "state": "Active",
                    "content_modified": stamp,
                    "is_template": 0,
                    "owner": "Administrator",
                    "creation": stamp,
                    "modified": stamp,
                    "modified_by": "Administrator",
                    "docstatus": 0,
                    "idx": 0,
                }
            ]
        )

    def test_writer_html_bytes_and_sequences_survive_an_identical_rerun(self):
        name = self.prefix + "writer"
        self.node(name, "Writer Document")
        self.insert("Writer Document", name, node=name, content="AAA=", html="head", collab=0)
        older = self.insert("Writer Version", self.prefix + "a", doc=name, snapshot="<p>old</p>", manual=0)
        newer = self.insert(
            "Writer Version",
            self.prefix + "b",
            doc=name,
            snapshot="<p>named</p>",
            title="Named",
            manual=1,
        )
        older.creation = newer.creation
        older.db_update()

        first = convert_history_and_comments(self.environment())
        second = convert_history_and_comments(self.environment())
        rows = frappe.get_all(
            "Drive Node Version", filters={"node": name}, fields=["name", "seq", "blob"], order_by="seq"
        )
        self.blobs.update(row.blob for row in rows)
        self.assertEqual([(row.name, row.seq) for row in rows], [(older.name, 1), (newer.name, 2)])
        self.assertEqual(SiteContentTarget().read_blob(rows[0].blob), b"<p>old</p>")
        self.assertEqual(first.versions_seen, second.versions_seen)

    def test_sheet_payload_and_sparse_head_id_survive_an_identical_rerun(self):
        name = self.prefix + "sheet"
        version = self.prefix + "snapshot"
        self.node(name, "Sheet")
        self.insert(
            "Sheet",
            name,
            node=name,
            title="Sheet",
            sheets_data='{"cells":[]}',
            head_seq=7,
            head_snapshot=version,
        )
        self.insert(
            "Sheet Snapshot",
            version,
            sheet=name,
            seq=7,
            kind="milestone",
            pinned=1,
            actor="Administrator",
            sheets_data='{"cells":[1]}',
        )

        convert_history_and_comments(self.environment())
        report = convert_history_and_comments(self.environment())
        row = frappe.db.get_value(
            "Drive Node Version", version, ["name", "seq", "blob", "pinned"], as_dict=True
        )
        self.blobs.add(row.blob)
        payload = json.loads(SiteContentTarget().read_blob(row.blob))
        self.assertEqual((row.name, row.seq, row.pinned), (version, 7, 1))
        self.assertEqual(payload, {"schema": "sheet/1", "sheets_data": '{"cells":[1]}', "head_seq": 7})
        self.assertTrue(report.history_completed)
