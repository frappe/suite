import frappe
from frappe.tests import UnitTestCase

from suite.composition.contract import export
from suite.drive import framework


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestContract(UnitTestCase):
    def test_body_union_emits_one_named_operation_per_member(self):
        contract = export(framework.HTTP)
        ids = {operation["id"] for operation in contract["operations"]}
        self.assertTrue(
            {
                "node_patch.rename",
                "node_patch.move",
                "node_patch.trash",
                "node_patch.restore",
                "node_patch.stamp",
            }.issubset(ids)
        )

    def test_page_and_entity_metadata_are_exported(self):
        contract = export(framework.HTTP)
        operations = {operation["id"]: operation for operation in contract["operations"]}
        self.assertIn("next_cursor", operations["node_children"]["output"]["properties"])
        self.assertEqual(
            operations["node_get"]["entity"],
            {"tag": "DriveNode", "id": "name", "version": "modified"},
        )
        self.assertEqual(operations["node_get"]["nodeParams"], ["node"])
