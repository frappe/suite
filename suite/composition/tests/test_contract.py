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

    def test_the_create_body_names_one_operation_per_kind(self):
        contract = export(framework.HTTP)
        ids = {operation["id"] for operation in contract["operations"]}
        self.assertTrue(
            {
                "node_create.create_folder",
                "node_create.create_file",
                "node_create.create_link",
                "node_create.create_document",
            }.issubset(ids)
        )
        self.assertNotIn("node_create", ids)

    def test_a_stream_row_is_flagged_and_carries_no_json_body(self):
        operations = {operation["id"]: operation for operation in export(framework.HTTP)["operations"]}
        chunk = operations["upload_chunk"]
        self.assertTrue(chunk["stream"])
        self.assertIsNone(chunk["body"])
        self.assertIn("offset", chunk["query"]["properties"])
        self.assertIn("received", chunk["output"]["properties"])
        download = operations["node_get_content"]
        self.assertTrue(download["stream"])
        self.assertIsNone(download["body"])
        self.assertIsNone(download["output"])
        self.assertFalse(operations["node_get"]["stream"])

    def test_every_operation_has_a_typed_answer_or_is_a_stream(self):
        for operation in export(framework.HTTP)["operations"]:
            with self.subTest(operation=operation["id"]):
                if operation["stream"]:
                    self.assertIsNone(operation["body"])
                else:
                    self.assertIsNotNone(operation["output"])
                    self.assertEqual(
                        operation["body"] is not None, operation["method"] in ("POST", "PUT", "PATCH")
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
