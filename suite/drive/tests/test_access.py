import itertools
from typing import ClassVar
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.access import Acc, chain_ids, effective_role, require
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, MANAGE, NONE, READ, ROLES, UPLOAD


class TestAccessAccumulator(UnitTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.principals = Principals(
            user="user@example.com",
            own=("user@example.com", "$GROUP:a", "$GROUP:b", "$GROUP:c", "$GENERAL"),
            open=("$PUBLIC", "$LINK:abc"),
        )

    def test_root_and_descendant_chains_use_materialized_path(self):
        self.assertEqual(chain_ids({"name": "root", "kind": "root"}), ["root"])
        self.assertEqual(
            chain_ids({"name": "child", "kind": "folder", "root": "root", "path": ""}),
            ["root", "child"],
        )
        self.assertEqual(
            chain_ids(
                {
                    "name": "leaf",
                    "kind": "file",
                    "root": "root",
                    "path": "/folder/nested/",
                }
            ),
            ["root", "folder", "nested", "leaf"],
        )

    def test_same_tier_groups_resolve_every_role_pair_in_every_order(self):
        for first_role, second_role in itertools.product(ROLES, repeat=2):
            offers = [("$GROUP:a", first_role), ("$GROUP:b", second_role)]
            expected = NONE if NONE in (first_role, second_role) else max(first_role, second_role)
            for ordering in itertools.permutations(offers):
                with self.subTest(roles=(first_role, second_role), ordering=ordering):
                    acc = Acc()
                    for principal, role in ordering:
                        acc.offer(principal, role, 2, self.principals)
                    self.assertEqual(acc.answer(), expected)

    def test_nearest_depth_precedes_identity_tier(self):
        acc = Acc()
        acc.offer("user@example.com", MANAGE, 0, self.principals)
        acc.offer("$GENERAL", READ, 2, self.principals)
        self.assertEqual(acc.answer(), READ)

    def test_identity_tier_breaks_a_same_depth_tie(self):
        offers = (("$GENERAL", MANAGE), ("$GROUP:a", EDIT), ("user@example.com", READ))
        for ordering in itertools.permutations(offers):
            acc = Acc()
            for principal, role in ordering:
                acc.offer(principal, role, 2, self.principals)
            self.assertEqual(acc.answer(), READ)

    def test_own_deny_is_final_even_with_open_access(self):
        acc = Acc()
        acc.offer("$GROUP:a", NONE, 1, self.principals)
        acc.offer("$LINK:abc", MANAGE, 2, self.principals)
        self.assertEqual(acc.answer(), NONE)

    def test_open_pass_is_nearest_then_highest_at_a_tie(self):
        acc = Acc()
        acc.offer("$PUBLIC", NONE, 2, self.principals)
        acc.offer("$LINK:abc", UPLOAD, 2, self.principals)
        acc.offer("$LINK:abc", MANAGE, 1, self.principals)
        self.assertEqual(acc.answer(), UPLOAD)

    def test_open_ties_take_the_highest_for_every_role_pair_and_order(self):
        for first_role, second_role in itertools.product(ROLES, repeat=2):
            offers = [("$PUBLIC", first_role), ("$LINK:abc", second_role)]
            for ordering in itertools.permutations(offers):
                with self.subTest(roles=(first_role, second_role), ordering=ordering):
                    acc = Acc()
                    for principal, role in ordering:
                        acc.offer(principal, role, 2, self.principals)
                    self.assertEqual(acc.answer(), max(first_role, second_role))


class TestPointAccess(UnitTestCase):
    node: ClassVar[dict[str, str]] = {
        "name": "node",
        "kind": "folder",
        "root": "root",
        "path": "",
    }
    principals = Principals("user@example.com", ("user@example.com",), ("$PUBLIC",))

    @patch("suite.drive._core.access.now", return_value="2026-09-05 12:00:00")
    @patch("suite.drive._core.access.frappe.db.sql")
    def test_point_query_filters_expired_rows_in_sql(self, sql, _now):
        sql.return_value = [frappe._dict(node="root", principal="user@example.com", role=READ)]
        self.assertEqual(effective_role(self.node, self.principals), READ)
        query, values = sql.call_args.args[:2]
        self.assertIn("expires_on IS NULL OR expires_on > %(now)s", query)
        self.assertEqual(values["chain"], ["root", "node"])

    @patch("suite.drive._core.access.frappe.db.sql")
    def test_ownership_alone_does_not_grant_access(self, sql):
        sql.return_value = []
        owned_node = {**self.node, "owner": "user@example.com"}
        self.assertEqual(effective_role(owned_node, self.principals), NONE)

    @patch("suite.drive._core.access.frappe.db.sql")
    def test_suite_admin_precedes_grant_lookup(self, sql):
        admin = Principals("Administrator", ("Administrator",), ("$PUBLIC",), is_admin=True)
        self.assertEqual(effective_role(self.node, admin), MANAGE)
        sql.assert_not_called()

    @patch("suite.drive._core.access._point_state", return_value=(NONE, [], {}, {}))
    def test_unreadable_is_not_found(self, _point_state):
        with self.assertRaises(DriveNotFound):
            require(self.node, READ, self.principals)

    @patch("suite.drive._core.access._point_state", return_value=(READ, [], {}, {}))
    def test_readable_but_insufficient_is_forbidden(self, _point_state):
        with self.assertRaises(DriveForbidden):
            require(self.node, EDIT, self.principals)
