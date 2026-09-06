import itertools
import json
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core import nodes as nodes_module
from suite.drive._core.access import effective_roles
from suite.drive._core.errors import DriveConflict, DriveLinkExpired, DriveLocked
from suite.drive._core.nodes import (
    MAX_PAGE_SIZE,
    SHARED_SQL,
    children,
    decode_cursor,
    encode_cursor,
    views,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, NONE, READ
from suite.drive._core.roots import create_root
from suite.drive.doctype.drive_node.drive_node import on_doctype_update
from suite.drive.tests.fixtures import drop_personal_root
from suite.tests.utils import ensure_user

VIEWER = "drive-views-viewer@example.com"
OTHER = "drive-views-other@example.com"


class TestListingContract(UnitTestCase):
    principals = Principals(
        VIEWER,
        (VIEWER, "$GROUP:viewers", "$GENERAL"),
        ("$PUBLIC",),
    )

    def test_cursor_is_an_opaque_base64_offset(self):
        cursor = encode_cursor(50)
        self.assertEqual(cursor, "b2Zmc2V0OjUw")
        self.assertEqual(decode_cursor(cursor), 50)
        for invalid in ("", "not-base64", "b2Zmc2V0Oisx"):
            with self.subTest(cursor=invalid), self.assertRaises(frappe.ValidationError):
                decode_cursor(invalid)

    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_folder_window_uses_exactly_three_queries_and_advances_past_hidden_rows(self, sql, _now):
        parent = frappe._dict(
            _drive_parent=0,
            name="root",
            kind="root",
            root=None,
            path="",
        )
        child = frappe._dict(
            _drive_parent=1,
            name="hidden",
            kind="file",
            root="root",
            path="",
            mime="text/plain",
        )
        sql.side_effect = [
            [parent, child],
            [frappe._dict(node="root", principal=VIEWER, role=READ, password_hash=None)],
            [frappe._dict(node="hidden", principal=VIEWER, role=NONE, password_hash=None)],
        ]

        page = children(self.principals, "root", limit=1)

        self.assertEqual(page["rows"], [])
        self.assertEqual(decode_cursor(page["next_cursor"]), 1)
        self.assertEqual(sql.call_count, 3)
        window_query = sql.call_args_list[0].args[0]
        self.assertIn("parent = %(parent)s", window_query)
        self.assertIn("is_template = 0", window_query)
        self.assertIn("kind <> 'root'", window_query)
        self.assertEqual(sql.call_args_list[0].args[1]["limit"], 1)

    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_limit_is_capped_and_short_raw_window_ends_paging(self, sql, _now):
        sql.side_effect = [
            [
                frappe._dict(
                    _drive_parent=0,
                    name="root",
                    kind="root",
                    root=None,
                    path="",
                )
            ],
            [],
            [],
        ]
        principals = Principals("Administrator", ("Administrator",), (), is_admin=True)

        page = children(principals, "root", limit=500)

        self.assertEqual(page, {"rows": [], "next_cursor": None})
        self.assertEqual(sql.call_args_list[0].args[1]["limit"], MAX_PAGE_SIZE)

    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_default_limit_and_cursor_offset_are_applied_to_the_raw_window(self, sql, _now):
        sql.side_effect = [
            [frappe._dict(_drive_parent=0, name="root", kind="root", root=None, path="")],
            [],
            [],
        ]
        principals = Principals("Administrator", ("Administrator",), (), is_admin=True)

        children(principals, "root", cursor=encode_cursor(7))

        values = sql.call_args_list[0].args[1]
        self.assertEqual(values["limit"], 60)
        self.assertEqual(values["offset"], 7)

    def _parent_window(self):
        return [frappe._dict(_drive_parent=0, name="root", kind="root", root=None, path="")]

    @patch("suite.drive._core.access.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_locked_parent_preserves_the_ticket08_error_on_denial(self, sql, _node_now, _access_now):
        token = "A" * 22
        principals = Principals(VIEWER, (VIEWER,), (f"$LINK:{token}",))
        sql.side_effect = [
            self._parent_window(),
            [
                frappe._dict(
                    node="root",
                    principal=f"$LINK:{token}",
                    role=READ,
                    password_hash="protected",
                )
            ],
            [],
            [],
        ]

        with self.assertRaises(DriveLocked):
            children(principals, "root")

    @patch("suite.drive._core.access.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_expired_parent_preserves_the_ticket08_error_on_denial(self, sql, _node_now, _access_now):
        token = "B" * 22
        principals = Principals(VIEWER, (VIEWER,), (f"$LINK:{token}",))
        sql.side_effect = [
            self._parent_window(),
            [],
            [],
            [
                frappe._dict(
                    node="root",
                    principal=f"$LINK:{token}",
                    role=READ,
                    expires_on="2026-09-04 12:00:00",
                    password_hash=None,
                )
            ],
        ]

        with self.assertRaises(DriveLinkExpired):
            children(principals, "root")

    def test_batch_resolution_keeps_direct_deny_and_group_tier_rules(self):
        offers = [
            frappe._dict(node="child", principal="$GROUP:viewers", role=EDIT, password_hash=None),
            frappe._dict(node="child", principal=VIEWER, role=NONE, password_hash=None),
        ]
        for ordering in itertools.permutations(offers):
            with self.subTest(ordering=ordering):
                self.assertEqual(
                    effective_roles(["root"], {"child": list(ordering)}, [], self.principals),
                    {"child": NONE},
                )

    @patch("suite.drive._core.nodes.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.nodes.frappe.db.sql")
    def test_a_short_fully_hidden_window_has_no_next_cursor(self, sql, _now):
        sql.side_effect = [
            [
                frappe._dict(_drive_parent=0, name="root", kind="root", root=None, path=""),
                frappe._dict(
                    _drive_parent=1,
                    name="hidden",
                    kind="file",
                    root="root",
                    path="",
                    mime="text/plain",
                ),
            ],
            [frappe._dict(node="root", principal=VIEWER, role=READ, password_hash=None)],
            [frappe._dict(node="hidden", principal=VIEWER, role=NONE, password_hash=None)],
        ]

        page = children(self.principals, "root", limit=2)

        self.assertEqual(page, {"rows": [], "next_cursor": None})

    def test_shared_query_deduplicates_overlapping_grants_before_limit(self):
        distinct = SHARED_SQL.index("SELECT DISTINCT")
        ancestor_filter = SHARED_SQL.index("NOT EXISTS")
        limit = SHARED_SQL.index("LIMIT")
        self.assertLess(distinct, ancestor_filter)
        self.assertLess(ancestor_filter, limit)
        self.assertIn("ancestor_grant.principal IN %(own)s", SHARED_SQL)

    def test_path_schema_is_data_500_with_a_full_composite_index(self):
        schema_path = Path(__file__).parents[1] / "doctype" / "drive_node" / "drive_node.json"
        fields = {field["fieldname"]: field for field in json.loads(schema_path.read_text())["fields"]}
        self.assertEqual(fields["path"]["fieldtype"], "Data")
        self.assertEqual(fields["path"]["length"], 500)

        with patch("suite.drive.doctype.drive_node.drive_node.frappe.db.add_index") as add_index:
            on_doctype_update()
        add_index.assert_any_call("Drive Node", ["root", "path"], "node_subtree")
        self.assertFalse(any(call.args[-1] == "node_root_page" for call in add_index.call_args_list))


class TestDriveViews(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(VIEWER)
        ensure_user(OTHER)
        drop_personal_root(VIEWER)
        drop_personal_root(OTHER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._root_nodes_before = set(frappe.get_all("Drive Node", filters={"kind": "root"}, pluck="name"))
        self._root_metadata_before = set(frappe.get_all("Drive Root", pluck="name"))
        self.personal = create_root(kind="Personal", title="Viewer", user=VIEWER)
        self.other = create_root(kind="Personal", title="Other", user=OTHER)
        self.principals = Principals(
            VIEWER,
            (VIEWER, "$GROUP:viewers", "$GENERAL"),
            ("$PUBLIC",),
        )

    def tearDown(self):
        frappe.set_user("Administrator")
        root_nodes = (
            set(frappe.get_all("Drive Node", filters={"kind": "root"}, pluck="name"))
            - self._root_nodes_before
        )
        root_metadata = set(frappe.get_all("Drive Root", pluck="name")) - self._root_metadata_before
        node_names = set(root_nodes)
        if root_nodes:
            node_names.update(
                frappe.get_all(
                    "Drive Node",
                    filters={"root": ["in", tuple(root_nodes)]},
                    pluck="name",
                )
            )
        if node_names:
            frappe.db.delete("Drive Grant", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Activity", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Node", {"name": ["in", tuple(node_names)]})
        if root_metadata:
            frappe.db.delete("Drive Root", {"name": ["in", tuple(root_metadata)]})
        super().tearDown()

    def _node(
        self,
        parent_id: str,
        title: str,
        *,
        kind: str = "folder",
        state: str = "Active",
        is_template: int = 0,
        trashed_at=None,
        trash_root: str | None = None,
        content_doctype: str | None = None,
    ):
        parent = frappe.db.get_value("Drive Node", parent_id, ["name", "kind", "root", "path"], as_dict=True)
        root = parent.name if parent.kind == "root" else parent.root
        path = "" if parent.kind == "root" else f"{parent.path or '/'}{parent.name}/"
        self_trashed = trash_root == "self"
        stored_trash_root = None if self_trashed else trash_root
        node = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": parent.name,
                "root": root,
                "path": path,
                "kind": kind,
                "state": "Active" if self_trashed else state,
                "size": 0,
                "is_template": is_template,
                "trashed_at": None if self_trashed else trashed_at,
                "trash_root": stored_trash_root,
                "content_doctype": content_doctype,
            }
        ).insert(ignore_permissions=True)
        if self_trashed:
            frappe.db.set_value(
                "Drive Node",
                node.name,
                {"state": "Trashed", "trashed_at": trashed_at, "trash_root": node.name},
            )
            node.state = "Trashed"
            node.trashed_at = trashed_at
            node.trash_root = node.name
        return node

    def _grant(self, node: str, principal: str, role: int):
        return frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": node,
                "principal": principal,
                "role": role,
            }
        ).insert(ignore_permissions=True)

    def test_folder_page_is_three_queries_and_never_lists_templates(self):
        visible = self._node(self.personal.name, "A visible")
        folder = self._node(self.personal.name, "A folder")
        nested = self._node(folder.name, "Nested visible")
        self._node(self.personal.name, "B template", kind="document", is_template=1)
        hidden = self._node(self.personal.name, "C hidden")
        self._grant(hidden.name, VIEWER, NONE)

        original_sql = frappe.db.sql
        with patch("suite.drive._core.nodes.frappe.db.sql", wraps=original_sql) as sql:
            page = children(self.principals, self.personal.name)

        self.assertEqual({row.name for row in page["rows"]}, {visible.name, folder.name})
        self.assertEqual(sql.call_count, 3)

        with patch("suite.drive._core.nodes.frappe.db.sql", wraps=original_sql) as sql:
            nested_page = children(self.principals, folder.name)
        self.assertEqual([row.name for row in nested_page["rows"]], [nested.name])
        self.assertEqual(sql.call_count, 3)

    def test_document_children_are_hidden_from_children_and_general_views(self):
        document = self._node(self.other.name, "Deck", kind="document")
        media = self._node(document.name, "unique-media-token", kind="file")
        self._grant(document.name, VIEWER, READ)

        with self.assertRaises(DriveConflict):
            children(self.principals, document.name)
        self.assertNotIn(
            media.name,
            [row.name for row in views(self.principals, "search", term="unique-media-token")["rows"]],
        )

    def test_shared_view_deduplicates_identity_and_ancestor_overlaps(self):
        folder = self._node(self.other.name, "Shared folder")
        descendant = self._node(folder.name, "Nested share")
        self._grant(folder.name, VIEWER, READ)
        self._grant(folder.name, "$GROUP:viewers", EDIT)
        self._grant(descendant.name, VIEWER, READ)

        rows = views(self.principals, "shared")["rows"]

        self.assertEqual([row.name for row in rows], [folder.name])

    def test_shared_overlap_is_removed_before_cursor_windows(self):
        ancestor = self._node(self.other.name, "A ancestor")
        unrelated = self._node(self.other.name, "B unrelated")
        descendant = self._node(ancestor.name, "Z descendant")
        for node in (ancestor, unrelated, descendant):
            self._grant(node.name, VIEWER, READ)

        first = views(self.principals, "shared", limit=1)
        second = views(self.principals, "shared", limit=1, cursor=first["next_cursor"])

        self.assertEqual([row.name for row in first["rows"]], [ancestor.name])
        self.assertEqual([row.name for row in second["rows"]], [unrelated.name])

    def test_archived_root_discovery_uses_existing_descendant_grants(self):
        folder = self._node(self.other.name, "Archived share")
        self._grant(folder.name, VIEWER, READ)
        frappe.db.set_value("Drive Root", self.other.name, "state", "Archived")

        rows = views(self.principals, "archived-roots")["rows"]

        self.assertIn(self.other.name, [row.root for row in rows])
        self.assertNotIn(self.other.name, [row.name for row in views(self.principals, "shared")["rows"]])

    def test_archived_root_metadata_is_hidden_when_direct_deny_beats_group_allow(self):
        folder = self._node(self.other.name, "Denied archive")
        self._grant(folder.name, "$GROUP:viewers", READ)
        self._grant(folder.name, VIEWER, NONE)
        frappe.db.set_value("Drive Root", self.other.name, "state", "Archived")

        rows = views(self.principals, "archived-roots")["rows"]

        self.assertNotIn(self.other.name, [row.root for row in rows])

    def test_trash_and_template_views_are_separate_and_permission_filtered(self):
        template = self._node(
            self.other.name,
            "Template",
            kind="document",
            is_template=1,
            content_doctype="User",
        )
        other_template = self._node(
            self.other.name,
            "Other template",
            kind="document",
            is_template=1,
            content_doctype="Role",
        )
        trashed = self._node(
            self.other.name,
            "Trashed",
            state="Trashed",
            trashed_at="2026-09-05 12:00:00",
            trash_root="self",
        )
        self._grant(self.other.name, VIEWER, READ)

        self.assertEqual(
            {row.name for row in views(self.principals, "templates")["rows"]},
            {template.name, other_template.name},
        )
        self.assertEqual(
            [row.name for row in views(self.principals, "templates", content_doctype="User")["rows"]],
            [template.name],
        )
        self.assertEqual(
            [row.name for row in views(self.principals, "trash", root=self.other.name)["rows"]],
            [trashed.name],
        )
        self.assertNotIn(
            template.name,
            [row.name for row in children(self.principals, self.other.name)["rows"]],
        )

    def test_document_descendants_are_hidden_from_shared_and_trash(self):
        document = self._node(self.other.name, "Hidden document", kind="document")
        media = self._node(document.name, "Hidden media", kind="file")
        self._grant(media.name, VIEWER, READ)
        self.assertNotIn(media.name, [row.name for row in views(self.principals, "shared")["rows"]])

        frappe.db.set_value(
            "Drive Node",
            media.name,
            {"state": "Trashed", "trash_root": media.name, "trashed_at": "2026-09-05 12:00:00"},
        )
        self.assertNotIn(
            media.name,
            [row.name for row in views(self.principals, "trash", root=self.other.name)["rows"]],
        )

    def test_search_uses_one_ancestor_union_grant_query_for_the_window(self):
        first = self._node(self.other.name, "needle one")
        second = self._node(self.other.name, "needle two")
        self._grant(self.other.name, VIEWER, READ)

        with patch("suite.drive._core.nodes._grant_rows", wraps=nodes_module._grant_rows) as grant_rows:
            rows = views(self.principals, "search", term="needle")["rows"]

        self.assertEqual({row.name for row in rows}, {first.name, second.name})
        grant_rows.assert_called_once()

    def test_fully_hidden_search_window_advances_by_the_sql_window(self):
        hidden = self._node(self.other.name, "hidden-window-token")
        self._grant(self.other.name, VIEWER, READ)
        self._grant(hidden.name, VIEWER, NONE)

        page = views(self.principals, "search", term="hidden-window-token", limit=1)

        self.assertEqual(page["rows"], [])
        self.assertEqual(decode_cursor(page["next_cursor"]), 1)
