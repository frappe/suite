from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.contents import contents_sizes
from suite.drive._core.nodes import child_path, create_folder
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_personal_root, drop_root
from suite.tests.utils import ensure_user

OWNER = "drive-contents-owner@example.com"
FIELDS = ["name", "root", "path", "kind"]


class TestContentsSize(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        drop_personal_root(OWNER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.owner = Principals(OWNER, (OWNER,), ())
        self.root = create_root(kind="Personal", title="Contents root", user=OWNER)

    def tearDown(self):
        frappe.set_user("Administrator")
        drop_root(self.root.name)
        super().tearDown()

    def _folder(self, parent: str, title: str) -> str:
        return create_folder(self.owner, parent, title)

    def _item(self, parent: str, title: str, size: int, *, trashed: bool = False) -> str:
        """Add a file row of `size` bytes, without the blob a listing never reads."""
        container = frappe.db.get_value("Drive Node", parent, ["name", "kind", "path"], as_dict=True)
        node = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent_node": parent,
                "root": self.root.name,
                "path": child_path(container),
                "kind": "file",
                "state": "Active",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("Drive Node", node.name, "size", size)
        if trashed:
            frappe.db.set_value("Drive Node", node.name, {"state": "Trashed", "trash_root": node.name})
        return node.name

    def test_a_folder_counts_its_files_at_every_depth_and_leaves_out_trashed_ones(self):
        alpha = self._folder(self.root.name, "Alpha")
        self._item(alpha, "small.txt", 1_500)
        beta = self._folder(alpha, "Beta")
        self._item(beta, "medium.bin", 250_000)
        gamma = self._folder(beta, "Gamma")
        self._item(gamma, "large.bin", 3_200_000)
        self._item(gamma, "trashed.bin", 5_000_000, trashed=True)
        trashed_folder = self._folder(alpha, "Trashed folder")
        self._item(trashed_folder, "inside.bin", 7_000_000, trashed=True)
        frappe.db.set_value("Drive Node", trashed_folder, {"state": "Trashed", "trash_root": trashed_folder})
        empty = self._folder(self.root.name, "Empty")
        loose = self._item(self.root.name, "loose.txt", 12_345)

        frappe.set_user(OWNER)
        from suite.drive.http import routes

        page = routes.node_children(node=self.root.name, expand="contents_size")["rows"]
        self.assertEqual(
            {row["title"]: row.get("contents_size") for row in page},
            {"Alpha": 3_451_500, "Empty": 0, "loose.txt": None},
        )
        inner = routes.node_children(node=alpha, expand="contents_size")["rows"]
        self.assertEqual(
            {row["title"]: row.get("contents_size") for row in inner if row["kind"] == "folder"},
            {"Beta": 3_450_000},
        )
        self.assertEqual(routes.node_get(node=gamma, expand="contents_size")["contents_size"], 3_200_000)
        self.assertNotIn("contents_size", routes.node_children(node=self.root.name)["rows"][0])
        self.assertNotIn(
            loose, contents_sizes(frappe.get_all("Drive Node", filters={"name": loose}, fields=FIELDS))
        )
        self.assertEqual(
            contents_sizes(frappe.get_all("Drive Node", filters={"name": empty}, fields=FIELDS)), {empty: 0}
        )

    def test_a_page_costs_one_query_however_many_folders_it_holds(self):
        def queries_for(rows):
            with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql:
                found = contents_sizes(rows)
            return sql.call_count, found

        top = self._folder(self.root.name, "Top")
        first = self._folder(top, "Folder 0")
        self._item(first, "one.bin", 10)
        for index in range(1, 12):
            folder = self._folder(top, f"Folder {index}")
            self._item(self._folder(folder, "Inner"), "deep.bin", index)
        self._item(top, "file.bin", 99)

        page = frappe.get_all("Drive Node", filters={"parent_node": top}, fields=FIELDS)
        short = [row for row in page if row.name == first]
        files_only = [row for row in page if row.kind == "file"]

        self.assertEqual(len([row for row in page if row.kind == "folder"]), 12)
        self.assertEqual(queries_for(short), (1, {first: 10}))
        count, found = queries_for(page)
        self.assertEqual(count, 1)
        self.assertEqual(sorted(found.values()), sorted([10, *range(1, 12)]))
        self.assertEqual(queries_for(files_only), (0, {}))
