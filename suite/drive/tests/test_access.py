import itertools
from typing import ClassVar
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.access import (
    Acc,
    chain_ids,
    describe,
    effective_role,
    explain,
    is_blocked,
    require,
)
from suite.drive._core.errors import DriveForbidden, DriveLocked, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, ROLES, UPLOAD


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

    def answer(self, *offers) -> int:
        answers: set[int] = set()
        for ordering in itertools.permutations(offers):
            acc = Acc()
            for principal, role, depth in ordering:
                acc.offer(principal, role, depth, self.principals)

            answers.add(acc.answer())

        self.assertEqual(len(answers), 1, f"{offers} depends on row order: {answers}")
        return answers.pop()

    def test_a_general_deny_gives_way_to_a_nearer_link(self):
        self.assertEqual(self.answer(("$GENERAL", NONE, 1), ("$LINK:abc", COMMENT, 2)), COMMENT)

    def test_a_general_deny_gives_way_to_a_nearer_publication(self):
        self.assertEqual(self.answer(("$GENERAL", NONE, 1), ("$PUBLIC", READ, 2)), READ)

    def test_a_general_deny_refuses_a_link_it_is_nearer_than(self):
        self.assertEqual(self.answer(("$GENERAL", NONE, 2), ("$LINK:abc", COMMENT, 1)), NONE)

    def test_a_general_deny_refuses_a_link_at_its_own_depth(self):
        self.assertEqual(self.answer(("$GENERAL", NONE, 2), ("$LINK:abc", COMMENT, 2)), NONE)

    def test_a_deny_naming_the_person_or_their_group_beats_any_link_below(self):
        for principal in ("user@example.com", "$GROUP:a"):
            with self.subTest(principal=principal):
                self.assertEqual(self.answer((principal, NONE, 1), ("$LINK:abc", EDIT, 3)), NONE)

    def test_a_named_deny_stays_final_behind_a_nearer_general_deny(self):
        for principal in ("user@example.com", "$GROUP:a"):
            with self.subTest(principal=principal):
                self.assertEqual(
                    self.answer((principal, NONE, 0), ("$GENERAL", NONE, 1), ("$LINK:abc", EDIT, 2)),
                    NONE,
                )

    def test_a_named_deny_lifted_nearer_no_longer_holds_a_link_back(self):
        self.assertEqual(
            self.answer(
                ("user@example.com", NONE, 0),
                ("user@example.com", READ, 1),
                ("$GENERAL", NONE, 2),
                ("$LINK:abc", COMMENT, 3),
            ),
            COMMENT,
        )

    def test_a_guest_is_unmoved_by_a_general_deny_above_or_below_the_link(self):
        guest = Principals("Guest", (), ("$PUBLIC", "$LINK:abc"))
        for deny_depth in (1, 3):
            with self.subTest(deny_depth=deny_depth):
                acc = Acc()
                acc.offer("$GENERAL", NONE, deny_depth, guest)
                acc.offer("$LINK:abc", COMMENT, 2, guest)
                self.assertEqual(acc.answer(), COMMENT)


class TestGeneralDenyAcrossSurfaces(UnitTestCase):
    """What `require`, `describe`, `explain` and `is_blocked` say once the rows are read."""

    USER = "user@example.com"
    LINK = "$LINK:abc"
    node: ClassVar[dict[str, str]] = {
        "name": "doc",
        "kind": "document",
        "root": "root",
        "path": "/far/near/",
    }
    principals = Principals(USER, (USER, "$GROUP:a", "$GENERAL"), ("$PUBLIC", LINK))

    @staticmethod
    def row(node, principal, role, password_hash=None):
        return frappe._dict(
            node=node, principal=principal, role=role, password_hash=password_hash, expires_on=None
        )

    def patched_rows(self, *rows):
        clock = patch("suite.drive._core.access.now", return_value="2026-01-01 00:00:00")
        clock.start()
        self.addCleanup(clock.stop)
        sql = patch("suite.drive._core.access.frappe.db.sql", return_value=list(rows))
        self.addCleanup(sql.stop)
        return sql.start()

    def test_a_nearer_link_opens_the_node_and_is_named_as_the_way_in(self):
        self.patched_rows(self.row("far", "$GENERAL", NONE), self.row("near", self.LINK, COMMENT))

        self.assertEqual(effective_role(self.node, self.principals), COMMENT)
        self.assertEqual(require(self.node, COMMENT, self.principals), self.LINK)
        self.assertEqual(
            describe(self.node, self.principals),
            {
                "role": COMMENT,
                "via_link": self.LINK,
                "source_node": "near",
                "source_principal": self.LINK,
                "can_manage": False,
            },
        )
        self.assertFalse(is_blocked(self.node, self.principals))

    def test_explain_marks_the_link_and_not_the_deny_it_passed(self):
        self.patched_rows(self.row("far", "$GENERAL", NONE), self.row("near", self.LINK, COMMENT))

        with patch("suite.drive._core.access.require"):
            answer = explain(self.node, self.principals, subject=self.principals)

        self.assertEqual(answer["role"], COMMENT)
        self.assertEqual([row["principal"] for row in answer["rows"] if row["winner"]], [self.LINK])

    def test_explain_marks_the_deny_when_it_is_the_nearer_row(self):
        self.patched_rows(self.row("near", "$GENERAL", NONE), self.row("far", self.LINK, COMMENT))

        with patch("suite.drive._core.access.require"):
            answer = explain(self.node, self.principals, subject=self.principals)

        self.assertEqual(answer["role"], NONE)
        self.assertEqual([row["principal"] for row in answer["rows"] if row["winner"]], ["$GENERAL"])

    def test_a_nearer_deny_is_a_refusal_that_blocks_no_one(self):
        self.patched_rows(self.row("near", "$GENERAL", NONE), self.row("far", self.LINK, COMMENT))

        self.assertEqual(effective_role(self.node, self.principals), NONE)
        self.assertFalse(is_blocked(self.node, self.principals))

    def test_a_named_deny_blocks_the_person_behind_a_general_deny_and_a_link(self):
        self.patched_rows(
            self.row("root", self.USER, NONE),
            self.row("far", "$GENERAL", NONE),
            self.row("near", self.LINK, EDIT),
        )

        self.assertEqual(effective_role(self.node, self.principals), NONE)
        self.assertTrue(is_blocked(self.node, self.principals))

    def test_a_locked_nearer_link_asks_for_its_password(self):
        sql = self.patched_rows()
        sql.side_effect = [
            [self.row("far", "$GENERAL", NONE), self.row("near", self.LINK, COMMENT, password_hash="hash")],
            [],
        ]

        with self.assertRaises(DriveLocked):
            require(self.node, COMMENT, self.principals)


class TestPointAccess(UnitTestCase):
    node: ClassVar[dict[str, str]] = {
        "name": "node",
        "kind": "folder",
        "root": "root",
        "path": "",
    }
    principals = Principals("user@example.com", ("user@example.com",), ("$PUBLIC",))

    @patch("suite.drive._core.access.frappe.db.sql")
    def test_ownership_alone_does_not_grant_access(self, sql):
        sql.return_value = []
        owned_node = {**self.node, "owner": "user@example.com"}
        self.assertEqual(effective_role(owned_node, self.principals), NONE)

    @patch("suite.drive._core.access.frappe.db.sql")
    def test_system_precedes_grant_lookup(self, sql):
        system = Principals("Administrator", ("Administrator",), ("$PUBLIC",), is_admin=True, is_system=True)
        self.assertEqual(effective_role(self.node, system), MANAGE)
        require(self.node, EDIT, system)
        sql.assert_not_called()

    @patch("suite.drive._core.access._point_state", return_value=(COMMENT, [], {}, {}))
    def test_suite_admin_holds_manage_but_edits_through_grants(self, _point_state):
        # ADR 0001. Was `test_suite_admin_precedes_grant_lookup`: the admin
        # override answered every role; it now answers Manage alone.
        admin = Principals("admin@example.com", ("admin@example.com",), ("$PUBLIC",), is_admin=True)
        self.assertEqual(effective_role(self.node, admin), COMMENT)
        self.assertIsNone(require(self.node, MANAGE, admin))
        require(self.node, COMMENT, admin)
        with self.assertRaises(DriveForbidden):
            require(self.node, EDIT, admin)

    @patch("suite.drive._core.access._point_state", return_value=(NONE, [], {}, {}))
    def test_unreadable_is_not_found(self, _point_state):
        with self.assertRaises(DriveNotFound):
            require(self.node, READ, self.principals)

    @patch("suite.drive._core.access._point_state", return_value=(READ, [], {}, {}))
    def test_readable_but_insufficient_is_forbidden(self, _point_state):
        with self.assertRaises(DriveForbidden):
            require(self.node, EDIT, self.principals)
