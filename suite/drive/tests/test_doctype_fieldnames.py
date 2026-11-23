"""Every Drive DocType passes the framework's own fieldname rules.

`Drive Node` once named its parent link `parent`, which is a framework column
on every table and a restricted fieldname: the DocType form refused to save it
and `frappe.db.get_value(..., "parent")` read the framework column instead of
the Link. The check runs the framework's rule over the shipped JSON, so a new
restricted name fails here before it reaches a site.
"""

import json
from pathlib import Path

import frappe
from frappe.tests import IntegrationTestCase

DOCTYPE_DIR = Path(__file__).resolve().parents[1] / "doctype"


def shipped_doctypes() -> list[dict]:
    return [
        json.loads(path.read_text())
        for path in sorted(DOCTYPE_DIR.glob("*/*.json"))
        if path.stem == path.parent.name
    ]


class TestDriveDoctypeFieldnames(IntegrationTestCase):
    def test_every_shipped_doctype_uses_only_allowed_fieldnames(self):
        definitions = shipped_doctypes()
        self.assertIn("Drive Node", [d["name"] for d in definitions])
        for definition in definitions:
            with self.subTest(doctype=definition["name"]):
                doc = frappe.get_doc(definition)
                doc.scrub_field_names()  # raises InvalidFieldNameError on a restricted name
                self.assertEqual(
                    [f["fieldname"] for f in definition["fields"]],
                    [f.fieldname for f in doc.fields],
                    "scrubbing must leave every shipped fieldname as written",
                )

    def test_drive_node_parent_link_is_the_parent_node_field(self):
        meta = frappe.get_meta("Drive Node")
        field = meta.get_field("parent_node")
        self.assertIsNotNone(field)
        self.assertEqual((field.fieldtype, field.options), ("Link", "Drive Node"))
        self.assertIsNone(meta.get_field("parent"))
