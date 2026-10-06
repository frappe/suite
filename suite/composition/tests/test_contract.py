from dataclasses import replace

import frappe
from frappe.tests import UnitTestCase

from suite.composition.contract import export
from suite.drive import framework


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestContract(UnitTestCase):
    def test_continuation_pages_export_a_boolean_end_condition(self):
        from suite.mail.http.framework import HTTP

        rows = {row["id"]: row for row in export(HTTP)["operations"]}
        threads = rows["get_threads"]
        self.assertEqual(threads["page"], {"offset": "start", "rows": "rows", "more": "has_more"})
        self.assertEqual(threads["output"]["properties"]["has_more"]["type"], "boolean")
        route = next(row for row in HTTP.contract_routes if row.handler == "get_threads")
        with self.assertRaisesRegex(ValueError, "invalid page metadata"):
            export(
                replace(
                    HTTP,
                    routes=(),
                    contract_routes=(
                        replace(route, page={"offset": "start", "rows": "rows", "more": "mailbox"}),
                    ),
                )
            )

    def test_offset_readers_export_their_actual_items_and_total_fields(self):
        from suite.mail.http.framework import HTTP

        operations = {row["id"]: row for row in export(HTTP)["operations"]}
        members = operations["get_members"]
        self.assertEqual(members["kind"], "query")
        self.assertEqual(members["publicName"], "admin.members.list")
        self.assertEqual(members["path"], "/api/method/suite.mail.api.admin.get_members")
        self.assertEqual(members["page"], {"offset": "start", "rows": "items", "total": "total"})
        self.assertEqual(members["output"]["properties"]["items"]["type"], "array")
        self.assertEqual(members["output"]["properties"]["total"]["type"], "integer")

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

    def test_references_declare_kind_public_path_and_page_facts(self):
        rows = {row["id"]: row for row in export(framework.HTTP)["operations"]}
        self.assertEqual(rows["node_get"]["kind"], "query")
        self.assertEqual(rows["node_patch.rename"]["kind"], "mutation")
        self.assertEqual(rows["node_patch.rename"]["publicName"], "nodes.rename")
        self.assertEqual(rows["node_patch.rename"]["path"], "nodes/{node}")
        self.assertEqual(
            rows["node_children"]["page"], {"cursor": "cursor", "rows": "rows", "next": "next_cursor"}
        )

    def test_refuses_incomplete_and_conflicting_references(self):
        node = next(route for route in framework.HTTP.routes if route.handler == "node_get")
        page = next(route for route in framework.HTTP.routes if route.handler == "node_children")
        cases = (
            ((replace(node, kind=None),), "missing operation kind"),
            ((replace(node, public_name=None),), "missing public name"),
            ((node, replace(node, id="other", public_name="nodes.get.extra")), "overlapping public name"),
            ((replace(page, kind="mutation"),), "invalid page metadata"),
            (
                (replace(page, page={"cursor": "cursor", "rows": "absent", "next": "next_cursor"}),),
                "invalid page metadata",
            ),
        )
        for routes, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    export(replace(framework.HTTP, routes=routes))
