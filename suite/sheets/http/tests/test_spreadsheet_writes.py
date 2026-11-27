import hashlib
import json
import struct
import uuid
from collections.abc import Callable
from datetime import timedelta
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client, now_datetime
from frappe.utils.synchronization import filelock
from werkzeug.wrappers import Response

from suite import content, drive
from suite.content import checker, copies, jobs, log, logged, tables
from suite.content.http import routes
from suite.sheets import content as sheets_content
from suite.sheets.content import agent
from suite.sheets.content.agent import SheetsRefused, WriteBusy, WriteRefused
from suite.sheets.content.tests.support import cells_of, require_converter
from suite.sheets.content.tests.test_pushes import call_route, opened
from suite.sheets.http import routes as sheets_routes
from suite.tests.utils import ensure_user, session_for

OWNER = "sheets-agent-owner@example.com"
READER = "sheets-agent-reader@example.com"
OUTSIDER = "sheets-agent-outsider@example.com"


def delete_log(node: str) -> None:
    frappe.set_user("Administrator")
    doc = log.find(sheets_content.APP, node)
    if doc:
        for kind in ("update", "session", "stage", "checkpoint", "copy", "recovery", "projection"):
            table = tables.table("sheets", kind)
            frappe.db.sql(f"DELETE FROM `{table}` WHERE `doc_id` = %s", doc.id)

        table = tables.table("sheets", "doc")
        frappe.db.sql(f"DELETE FROM `{table}` WHERE `id` = %s", doc.id)

    table = tables.table("sheets", "conversion")
    frappe.db.sql(f"DELETE FROM `{table}` WHERE `node` = %s", node)
    frappe.db.commit()


class TestSpreadsheetWrites(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, READER, OUTSIDER):
            ensure_user(user)

        logged.ensure_tables()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        require_converter(self)
        if log.mode(sheets_content.APP) != "on":
            sheets_content.turn_on()
            frappe.db.commit()

        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        root = drive.ensure_personal_root(OWNER)
        self.folder = frappe.db.get_value("Drive Root", root, "node")

    def create(self, sheets: list[dict], title: str | None = None) -> str:
        title = title or f"Agent {uuid.uuid4().hex[:8]}"
        node = sheets_routes.spreadsheet_create(self.folder, title, sheets)["name"]
        self.addCleanup(delete_log, node)
        return node

    def cells(self, node: str) -> dict[str, dict[str, str]]:
        # What a tab opens: each sheet's inputs by A1 position
        _header, state = opened(node)
        return cells_of(state)

    def head(self, node: str) -> int:
        return int(content.find(sheets_content.APP, node).head_rev)

    def copy_of(self, node: str) -> str:
        docname = frappe.db.get_value("Drive Node", node, "content_docname")
        return frappe.db.get_value("Sheet", docname, "html") or ""

    def age_copy(self, node: str) -> None:
        # As a minute after the copy was written
        table = tables.table("sheets", "projection")
        doc_id = content.find(sheets_content.APP, node).id
        frappe.db.sql(
            f"UPDATE `{table}` SET `updated` = %s WHERE `doc_id` = %s",
            (now_datetime() - timedelta(seconds=61), doc_id),
        )
        frappe.db.commit()

    def assert_created_nothing(self, title: str) -> None:
        self.assertFalse(frappe.db.exists("Drive Node", {"parent_node": self.folder, "title": title}))

    def tab_push(self, node: str, change: Callable[[pycrdt.Doc], None]) -> tuple[int, dict]:
        # A tab's own edit, through the layer's push route
        sid = uuid.uuid4().hex
        session = call_route(routes.sessions_post, node, json.dumps({"sid": sid}).encode())
        client_id = json.loads(session.get_data())["client_id"]
        header, state = opened(node)
        doc: pycrdt.Doc = pycrdt.Doc(client_id=client_id)
        doc.apply_update(state)
        seen = doc.get_state()
        change(doc)
        payload = doc.get_update(seen)
        fields = {
            "lineage": header["lineage"],
            "expected_user": frappe.session.user,
            "sid": sid,
            "from": 1,
            "to": 1,
            "cid": client_id,
            "seen_rev": 0,
            "schema": sheets_content.SCHEMA.version,
            "shas": [hashlib.sha256(payload).hexdigest()],
        }
        encoded = json.dumps(fields).encode()
        response = call_route(routes.updates_post, node, struct.pack(">I", len(encoded)) + encoded + payload)
        return response.status_code, json.loads(response.get_data())

    def sheet_state(self, node: str, store: str, value: dict) -> None:
        # What a tab's merge or protection keeps for the first sheet (collab/stores.ts)
        def keep(doc: pycrdt.Doc) -> None:
            [sheet] = doc.get("sheets", type=pycrdt.Array).to_py()
            doc.get("sheetState", type=pycrdt.Map)[f"{sheet}:{store}"] = value

        status, body = self.tab_push(node, keep)
        self.assertEqual(status, 200, body)

    def sent(self, method: str, path: str, body: dict | None, user: str | None = OWNER) -> Response:
        # A whole request on its own connection, so the answer is the one an agent reads after Frappe cleans it
        frappe.db.commit()
        headers: dict[str, str] = {}
        if user:
            sid = session_for(user)
            headers["Cookie"] = f"sid={sid}"

        kwargs = {"method": method, "headers": headers, "json": body}
        response = make_request(target=self.CLIENT.open, args=(f"/api/suite/sheets/{path}",), kwargs=kwargs)
        frappe.db.rollback()
        return response

    def refusal_sent(self, path: str, body: dict) -> dict:
        response = self.sent("POST", path, body)
        self.assertEqual(response.status_code, 422, response.get_data(as_text=True))
        (error,) = response.json["errors"]
        return error

    def test_a_new_spreadsheet_holds_the_sheets_in_order(self):
        title = f"Agent {uuid.uuid4().hex[:8]}"
        rows = [["Item", "Amount"], ["Rent", 1200], ["Paid", True], [None, "=SUM(B2:B2)"]]
        answer = sheets_routes.spreadsheet_create(
            self.folder, title, [{"name": "Budget", "rows": rows}, {"name": "Notes"}]
        )
        self.addCleanup(delete_log, answer["name"])

        self.assertEqual(
            (answer["title"], answer["parent_node"], answer["content_doctype"]), (title, self.folder, "Sheet")
        )
        self.assertEqual(
            self.cells(answer["name"]),
            {
                "Budget": {
                    "A1": "Item",
                    "B1": "Amount",
                    "A2": "Rent",
                    "B2": "1200",
                    "A3": "Paid",
                    "B3": "TRUE",
                    "B4": "=SUM(B2:B2)",
                },
                "Notes": {},
            },
        )

    def test_a_refused_create_makes_no_spreadsheet(self):
        cases = {
            "no sheets": ([], "at least one sheet"),
            "a bad name": ([{"name": "Q1/Q2"}], "1 to 31 characters"),
            "a name twice": ([{"name": "Data"}, {"name": "data"}], "already has a sheet named data"),
            "a value that is no cell's": ([{"name": "Data", "rows": [[{"v": 1}]]}], "text, a number"),
        }
        for case, (sheets, message) in cases.items():
            title = f"Refused {uuid.uuid4().hex[:8]}"
            with self.subTest(case), self.assertRaisesRegex(SheetsRefused, message):
                sheets_routes.spreadsheet_create(self.folder, title, sheets)

            self.assert_created_nothing(title)

    def test_a_block_of_cells_lands_from_its_start_and_leaves_the_rest(self):
        node = self.create([{"name": "Data", "rows": [["a", "b", "c"], ["d", "e", "f"]]}])
        before = self.head(node)

        answer = sheets_routes.spreadsheet_cells_write(node, "data", "b1", [["B", None, ""], ["E"]])

        self.assertGreater(answer["rev"], before)
        # null leaves C1, and "" in D1 clears a cell that held nothing
        self.assertEqual(
            self.cells(node), {"Data": {"A1": "a", "B1": "B", "C1": "c", "A2": "d", "B2": "E", "C2": "f"}}
        )
        sheets_routes.spreadsheet_cells_write(node, "Data", "C2", [[""]])
        self.assertEqual(self.cells(node)["Data"], {"A1": "a", "B1": "B", "C1": "c", "A2": "d", "B2": "E"})

    def test_a_write_sent_again_lands_as_nothing_and_answers_the_same_rev(self):
        node = self.create([{"name": "Data"}])
        first = sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [["kept"]])

        again = sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [["kept"]])

        self.assertEqual(again["rev"], first["rev"])
        self.assertEqual(self.head(node), first["rev"])

    def test_rows_land_below_the_last_used_row_each_time(self):
        node = self.create([{"name": "Data", "rows": [["Item"], [None, "x"]]}])

        sheets_routes.spreadsheet_rows_append(node, "Data", [["one"]])
        sheets_routes.spreadsheet_rows_append(node, "Data", [["one"]])

        self.assertEqual(self.cells(node)["Data"], {"A1": "Item", "B2": "x", "A3": "one", "A4": "one"})

    def test_rows_added_while_other_rows_land_wait_for_them(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])
        writing = agent.writing
        refused: list[WriteBusy] = []

        def second_starts_first(write: dict) -> Callable[[pycrdt.Doc], None]:
            change = writing(write)

            def change_after_the_second(state: pycrdt.Doc) -> None:
                # The first has read the spreadsheet and not pushed yet
                with (
                    patch.object(agent, "writing", writing),
                    patch.object(agent, "TURN_WAIT_S", 0.1),
                ):
                    try:
                        agent.append_rows(node, "Data", [["c"]])
                    except WriteBusy as busy:
                        refused.append(busy)

                change(state)

            return change_after_the_second

        with patch.object(agent, "writing", second_starts_first):
            sheets_routes.spreadsheet_rows_append(node, "Data", [["b"]])

        for _ in refused:
            sheets_routes.spreadsheet_rows_append(node, "Data", [["c"]])

        self.assertEqual(self.cells(node)["Data"], {"A1": "a", "A2": "b", "A3": "c"})
        [busy] = refused
        self.assertGreater(busy.retry_ms, 0)

    def test_a_write_over_a_megabyte_is_refused_before_the_converter_is_asked(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])
        before = self.head(node)
        # Each cell under a cell's own limit, the whole over 1 MB
        rows = [["x" * 30_000] * 40]
        bodies = {
            "spreadsheets": {
                "parent": self.folder,
                "title": "Agent too big",
                "sheets": [{"name": "Data", "rows": rows}],
            },
            f"spreadsheets/{node}/cells": {"sheet": "Data", "start": "A1", "rows": rows},
            f"spreadsheets/{node}/rows": {"sheet": "Data", "rows": rows},
            f"spreadsheets/{node}/sheets": {"name": "More", "rows": rows},
        }

        # A converter asked fails the request as a 500
        self.enterContext(patch.object(checker, "ask", side_effect=AssertionError("the converter was asked")))
        for path, body in bodies.items():
            with self.subTest(path):
                error = self.refusal_sent(path, body)
                self.assertEqual(error["type"], "SheetsRefused")
                self.assertIn("over 1 MB", error["message"])

        self.assertEqual(self.head(node), before)
        self.assert_created_nothing("Agent too big")

    def test_a_sheet_added_lands_after_the_others_and_takes_writes(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])

        sheets_routes.spreadsheet_sheet_add(node, "Notes")
        sheets_routes.spreadsheet_sheet_add(node, "Totals", [["Sum", "=SUM(Data!A1:A1)"]])
        sheets_routes.spreadsheet_rows_append(node, "notes", [["later"]])

        self.assertEqual(
            self.cells(node),
            {
                "Data": {"A1": "a"},
                "Notes": {"A1": "later"},
                "Totals": {"A1": "Sum", "B1": "=SUM(Data!A1:A1)"},
            },
        )

    def test_a_sheet_added_while_another_write_takes_its_turn_is_busy_and_lands_later(self):
        node = self.create([{"name": "Data"}])
        before = self.head(node)

        with filelock(agent.TURN_LOCK), patch.object(agent, "TURN_WAIT_S", 0.1):
            response = self.sent("POST", f"spreadsheets/{node}/sheets", {"name": "Notes"})

        self.assertEqual(response.status_code, 429, response.get_data(as_text=True))
        (error,) = response.json["errors"]
        self.assertEqual(error["type"], "WriteBusy")
        self.assertGreater(error["retry_ms"], 0)
        self.assertEqual(self.head(node), before)
        self.assertEqual(list(self.cells(node)), ["Data"])

        response = self.sent("POST", f"spreadsheets/{node}/sheets", {"name": "Notes"})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(list(self.cells(node)), ["Data", "Notes"])

    def test_a_sheet_whose_name_is_taken_or_bad_is_not_added(self):
        node = self.create([{"name": "Data"}])
        before = self.head(node)

        with self.assertRaisesRegex(SheetsRefused, "already has a sheet named DATA"):
            sheets_routes.spreadsheet_sheet_add(node, "DATA")

        with self.assertRaisesRegex(SheetsRefused, "1 to 31 characters"):
            sheets_routes.spreadsheet_sheet_add(node, "a" * 32)

        self.assertEqual(self.head(node), before)
        self.assertEqual(list(self.cells(node)), ["Data"])

    def test_a_write_to_a_sheet_not_there_writes_nothing(self):
        node = self.create([{"name": "Data"}])
        before = self.head(node)

        with self.assertRaisesRegex(SheetsRefused, "no sheet named Other"):
            sheets_routes.spreadsheet_cells_write(node, "Other", "A1", [["x"]])

        self.assertEqual(self.head(node), before)

    def test_a_tab_edits_what_an_agent_wrote_and_its_edit_stays(self):
        node = self.create([{"name": "Data", "rows": [["agent"]]}])

        def type_in_a2(doc: pycrdt.Doc) -> None:
            # What a tab writes for a cell typed in A2, below the agent's A1 (collab/schema.ts)
            [sheet] = doc.get("sheets", type=pycrdt.Array).to_py()
            [col] = doc.get("cols", type=pycrdt.Map)[sheet].to_py()
            doc.get("rows", type=pycrdt.Map)[sheet].append("e2")
            doc.get("tails", type=pycrdt.Map)[f"{sheet}:rows:e"] = 2
            doc.get("inputs", type=pycrdt.Map)[f"{sheet}:e2:{col}"] = "tab"

        status, body = self.tab_push(node, type_in_a2)
        self.assertEqual(status, 200, body)

        sheets_routes.spreadsheet_rows_append(node, "Data", [["agent again"]])

        self.assertEqual(self.cells(node)["Data"], {"A1": "agent", "A2": "tab", "A3": "agent again"})

    def test_the_readable_copy_follows_an_agent_write(self):
        node = self.create([{"name": "Budget", "rows": [["Rent", 1200]]}])
        doc_id = content.find(sheets_content.APP, node).id
        # A new spreadsheet has no copy, so its first write renders one
        self.assertIn("Rent", self.copy_of(node))
        self.age_copy(node)

        sheets_routes.spreadsheet_rows_append(node, "Budget", [["Food", 300]])

        self.assertIn("Budget", self.copy_of(node))
        self.assertIn("Food", self.copy_of(node))
        self.assertFalse(copies.is_owed(sheets_content.APP, doc_id))

    def test_writes_inside_a_minute_of_the_copy_leave_it_owed_to_the_sweep(self):
        node = self.create([{"name": "Budget", "rows": [["Rent"]]}])
        doc_id = content.find(sheets_content.APP, node).id

        sheets_routes.spreadsheet_rows_append(node, "Budget", [["Food"]])

        self.assertNotIn("Food", self.copy_of(node))
        self.assertTrue(copies.is_owed(sheets_content.APP, doc_id))
        jobs.render_owed(sheets_content.APP, doc_id)
        self.assertIn("Food", self.copy_of(node))
        self.assertIn("Rent", self.copy_of(node))

    def test_a_read_gives_what_was_typed_and_writes_back_as_the_same_cells(self):
        rows = [["Item", "Amount"], [], ["Rent", "=B5*2"]]
        node = self.create([{"name": "Budget", "rows": rows}, {"name": "Empty"}])

        read = sheets_routes.spreadsheet_read(node)

        self.assertEqual(
            read,
            {
                "sheets": [
                    {"name": "Budget", "rows": [["Item", "Amount"], [], ["Rent", "=B5*2"]]},
                    {"name": "Empty", "rows": []},
                ]
            },
        )
        again = self.create(read["sheets"])
        self.assertEqual(self.cells(again), self.cells(node))

    def test_a_values_read_gives_what_a_tab_shows_and_leaves_the_typed_read(self):
        rows = [["Item", "Cost"], ["Rent", 1200], ["Food", 300], ["Total", "=SUM(B2:B3)"], ["Bad", "=B2/0"]]
        node = self.create([{"name": "Costs", "rows": rows}, {"name": "Empty"}])
        typed = {
            "sheets": [
                {
                    "name": "Costs",
                    "rows": [
                        ["Item", "Cost"],
                        ["Rent", "1200"],
                        ["Food", "300"],
                        ["Total", "=SUM(B2:B3)"],
                        ["Bad", "=B2/0"],
                    ],
                },
                {"name": "Empty", "rows": []},
            ]
        }
        self.assertEqual(sheets_routes.spreadsheet_read(node), typed)

        shown = sheets_routes.spreadsheet_values(node)

        self.assertEqual(
            shown,
            {
                "sheets": [
                    {
                        "name": "Costs",
                        "rows": [
                            ["Item", "Cost"],
                            ["Rent", "1200"],
                            ["Food", "300"],
                            ["Total", "1500"],
                            ["Bad", "#DIV/0!"],
                        ],
                    },
                    {"name": "Empty", "rows": []},
                ]
            },
        )
        self.assertEqual(sheets_routes.spreadsheet_read(node), typed)

    def test_a_values_read_over_50000_cells_with_a_value_is_refused_for_the_typed_read(self):
        # Five full writes and one cell, each through the agent's own write
        block = [[1] * 100 for _ in range(100)]
        node = self.create([{"name": "Data", "rows": block}])
        for start in ("A101", "A201", "A301", "A401"):
            sheets_routes.spreadsheet_cells_write(node, "Data", start, block)

        sheets_routes.spreadsheet_rows_append(node, "Data", [[1]])

        refused = "at most 50,000 cells with a value: read the spreadsheet as typed"
        with self.assertRaisesRegex(SheetsRefused, refused):
            sheets_routes.spreadsheet_values(node)

        self.assertEqual(len(sheets_routes.spreadsheet_read(node)["sheets"][0]["rows"]), 501)

    def test_a_cell_under_a_merge_or_protected_is_named_and_left(self):
        node = self.create([{"name": "Data", "rows": [["a", "b"], ["c"]]}])
        self.sheet_state(node, "merge", {"masterMap": {"A1": "A1:B1"}, "slaveMap": {"B1": "A1"}})
        self.sheet_state(
            node, "protection", {"locked": False, "ranges": [{"r0": 1, "c0": 0, "r1": 1, "c1": 0}]}
        )

        merged = self.refusal_sent(
            f"spreadsheets/{node}/cells", {"sheet": "Data", "start": "A1", "rows": [["x", "y"]]}
        )
        # A1 is the merge's own cell, so it would take "w", and the write keeps none of it
        locked = self.refusal_sent(
            f"spreadsheets/{node}/cells", {"sheet": "Data", "start": "A1", "rows": [["w"], ["z"]]}
        )

        self.assertEqual(merged["type"], "SheetsRefused")
        self.assertIn("B1 on Data is under a merged cell: send null for it", merged["message"])
        self.assertIn("A2 on Data is protected", locked["message"])
        self.assertEqual(self.cells(node)["Data"], {"A1": "a", "B1": "b", "A2": "c"})

    def test_a_reader_reads_but_cannot_write_and_an_outsider_finds_nothing(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])
        frappe.db.commit()
        # Through Drive's own route, as an owner shares it
        sid = session_for(OWNER)
        kwargs = {"method": "PUT", "headers": {"Cookie": f"sid={sid}"}, "json": {"role": drive.READ}}
        shared = make_request(
            target=self.CLIENT.open, args=(f"/api/suite/drive/nodes/{node}/grants/{READER}",), kwargs=kwargs
        )
        self.assertEqual(shared.status_code, 200, shared.get_data(as_text=True))

        frappe.set_user(READER)
        for reads in (sheets_routes.spreadsheet_read, sheets_routes.spreadsheet_values):
            self.assertEqual(reads(node)["sheets"], [{"name": "Data", "rows": [["a"]]}])

        with self.assertRaises(drive.DriveForbidden):
            sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [["b"]])

        with self.assertRaises(drive.DriveForbidden):
            sheets_routes.spreadsheet_rows_append(node, "Data", [["b"]])

        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_read(node)

        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_values(node)

        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [["b"]])

        frappe.set_user(OWNER)
        self.assertEqual(self.cells(node)["Data"], {"A1": "a"})

    def test_a_guest_is_refused_on_every_route(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])
        calls = (
            (
                "POST",
                "spreadsheets",
                {"parent": self.folder, "title": "Agent guest", "sheets": [{"name": "Data"}]},
            ),
            ("POST", f"spreadsheets/{node}/cells", {"sheet": "Data", "start": "A1", "rows": [["x"]]}),
            ("POST", f"spreadsheets/{node}/rows", {"sheet": "Data", "rows": [["x"]]}),
            ("POST", f"spreadsheets/{node}/sheets", {"name": "More"}),
            ("GET", f"spreadsheets/{node}", None),
            ("GET", f"spreadsheets/{node}/values", None),
        )
        for method, path, body in calls:
            with self.subTest(method=method, path=path):
                response = self.sent(method, path, body, user=None)
                self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")

        self.assertEqual(self.cells(node), {"Data": {"A1": "a"}})
        self.assert_created_nothing("Agent guest")

    def test_a_wrong_body_is_refused_by_its_field(self):
        node = self.create([{"name": "Data", "rows": [["a"]]}])
        rev = self.head(node)
        new = {"parent": self.folder, "title": "Agent wrong", "sheets": [{"name": "Data"}]}
        cells = {"sheet": "Data", "start": "A1", "rows": [["x"]]}
        bodies = (
            ("spreadsheets", {}, "parent must be a string"),
            ("spreadsheets", {**new, "parent": 5}, "parent must be a string"),
            ("spreadsheets", {"parent": self.folder, "sheets": new["sheets"]}, "title must be a string"),
            ("spreadsheets", {**new, "title": "x" * 141}, "title must be 140 characters or fewer"),
            ("spreadsheets", {"parent": self.folder, "title": "Agent wrong"}, "sheets must list"),
            ("spreadsheets", {**new, "sheets": "x"}, "sheets must list"),
            (f"spreadsheets/{node}/cells", {"start": "A1", "rows": [["x"]]}, "sheet must be a string"),
            (f"spreadsheets/{node}/cells", {**cells, "sheet": 5}, "sheet must be a string"),
            (f"spreadsheets/{node}/cells", {"sheet": "Data", "rows": [["x"]]}, "start must be a cell"),
            (f"spreadsheets/{node}/cells", {**cells, "start": 5}, "start must be a cell"),
            (f"spreadsheets/{node}/cells", {"sheet": "Data", "start": "A1"}, "rows must be a list"),
            (f"spreadsheets/{node}/cells", {**cells, "rows": "x"}, "rows must be a list"),
            (f"spreadsheets/{node}/rows", {"rows": [["x"]]}, "sheet must be a string"),
            (f"spreadsheets/{node}/rows", {"sheet": "Data"}, "rows must be a list"),
            (f"spreadsheets/{node}/sheets", {}, "sheet's name must be"),
            (f"spreadsheets/{node}/sheets", {"name": "More", "rows": "x"}, "rows must be a list"),
        )
        for path, body, message in bodies:
            with self.subTest(path=path, body=body):
                response = self.sent("POST", path, body)
                self.assertIn(response.status_code, (400, 422), response.get_data(as_text=True))
                self.assertIn(message, response.json["errors"][0]["message"])

        self.assertEqual(self.head(node), rev)
        self.assert_created_nothing("Agent wrong")

    def test_a_node_that_is_not_a_spreadsheet_answers_not_found(self):
        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_read(self.folder)

        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_values(self.folder)

        with self.assertRaises(drive.DriveNotFound):
            sheets_routes.spreadsheet_rows_append(self.folder, "Data", [["x"]])

    def test_an_unconverted_spreadsheet_reads_busy_refuses_writes_and_asks_for_its_conversion(self):
        node = self.create([{"name": "Data"}])
        delete_log(node)
        frappe.set_user(OWNER)

        with patch.object(jobs, "request_conversion") as asked:
            with self.assertRaisesRegex(WriteBusy, "not converted yet"):
                sheets_routes.spreadsheet_read(node)

            with self.assertRaisesRegex(WriteBusy, "not converted yet"):
                sheets_routes.spreadsheet_values(node)

            with self.assertRaisesRegex(WriteRefused, "unconverted"):
                sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [["x"]])

        self.assertEqual(asked.call_count, 3)

    def test_a_busy_converter_answers_busy_and_creates_nothing(self):
        with (
            filelock(checker.LOCK),
            patch.object(checker, "REQUEST_WAIT_S", 0.2),
            self.assertRaises(WriteBusy),
        ):
            sheets_routes.spreadsheet_create(self.folder, "Agent busy", [{"name": "Data"}])

        self.assert_created_nothing("Agent busy")

    def test_a_value_json_cannot_carry_is_refused(self):
        node = self.create([{"name": "Data"}])

        with self.assertRaisesRegex(SheetsRefused, "text, a number"):
            sheets_routes.spreadsheet_cells_write(node, "Data", "A1", [[float("nan")]])

    def test_a_user_past_the_write_limit_waits_and_another_user_does_not(self):
        frappe.cache.delete_keys("rl:suite.sheets")
        self.addCleanup(frappe.cache.delete_keys, "rl:suite.sheets")

        def write():
            # Refused for its node, so the count is all it costs
            sheets_routes.spreadsheet_cells_write("no node", "Data", "A1", [["x"]])

        for _write in range(30):
            with self.assertRaises(drive.DriveError):
                call_route(lambda _node: write(), "")

        with self.assertRaises(frappe.RateLimitExceededError):
            call_route(lambda _node: write(), "")

        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveError):
            call_route(lambda _node: write(), "")

    def test_a_user_past_the_values_limit_waits_and_still_reads_as_typed(self):
        frappe.cache.delete_keys("rl:suite.sheets")
        self.addCleanup(frappe.cache.delete_keys, "rl:suite.sheets")

        for _read in range(10):
            with self.assertRaises(drive.DriveError):
                call_route(sheets_routes.spreadsheet_values, "no node")

        with self.assertRaises(frappe.RateLimitExceededError):
            call_route(sheets_routes.spreadsheet_values, "no node")

        with self.assertRaises(drive.DriveError):
            call_route(sheets_routes.spreadsheet_read, "no node")

    def test_an_unknown_address_answers_not_found(self):
        frappe.db.commit()
        sid = session_for(OWNER)
        kwargs = {"method": "GET", "headers": {"Cookie": f"sid={sid}"}}
        response = make_request(
            target=self.CLIENT.open, args=("/api/suite/sheets/nothing-here",), kwargs=kwargs
        )

        self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
