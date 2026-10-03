"""Prove the SQL list predicate agrees with the Python access engine.

`framework._list_predicate` repeats `access.effective_role` in SQL so that
`frappe.get_list` can filter content documents in one query. Two
implementations of one rule drift, so this module seeds random trees and
grants and compares the two on every node, for several callers.

The contract under test, from the predicate's docstring:

1. The SQL never admits a node the engine refuses. Always.
2. The SQL may refuse more only through its two named simplifications:
   grants at the same depth are not ordered by own tier, and a password link
   is skipped because a list caller presents no unlock ticket. Where neither
   applies, the two answers are equal.
"""

import random
import time
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.drive import framework
from suite.drive._core.access import chain_ids, effective_role, own_tier
from suite.drive._core.principals import LINK_TOKEN_LENGTH, Principals, make_ticket
from suite.drive._core.roles import MANAGE, READ, ROLES
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_personal_root
from suite.tests.utils import ensure_user

OWNER = "drive-predicate-owner@example.com"
VIEWER = "drive-predicate-viewer@example.com"
GROUP = "$GROUP:Drive Predicate Group"
OWN_PRINCIPALS = (VIEWER, GROUP, "$GENERAL")
PASSWORD_HASH = "$pbkdf2-sha256$predicate-fixture"
TREES = 24
MAX_DEPTH = 5
NODE_COLUMN = "`outer_node`.`name`"


def _token(rng: random.Random) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(rng.choice(alphabet) for _ in range(LINK_TOKEN_LENGTH))


class TestPredicateAgreement(IntegrationTestCase):
    """The SQL predicate against the engine, on real rows, under a fixed seed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.addCleanup(self._remove_rows)
        # `ensure_user` provisions a Personal root for a new user; this module
        # wants a root it controls, so start from none.
        drop_personal_root(OWNER)
        self.root = create_root(kind="Personal", title="Predicate Root", user=OWNER)
        frappe.db.commit()

    def _remove_rows(self):
        frappe.set_user("Administrator")
        drop_personal_root(OWNER)
        frappe.db.commit()

    # fixture

    def _seed_tree(self, rng: random.Random) -> tuple[list[frappe._dict], list[frappe._dict]]:
        """Insert one random tree under the root with random grants on it.

        Rows go in with `db_insert`, the way the Build tests seed canonical
        shapes: the predicate and the engine read only `name`, `kind`, `root`,
        `path` and `state`, and the folder workflow would add Administrator
        grants and activity on every row for nothing.
        """
        root = frappe._dict(name=self.root.node, kind="root", root=None, path="")
        nodes: list[frappe._dict] = []
        containers = [root]
        for index in range(rng.randint(6, 20)):
            parent = rng.choice(containers)
            depth = 0 if parent.kind == "root" else parent.path.count("/")
            kind = "folder" if depth < MAX_DEPTH and rng.random() < 0.4 else "document"
            if kind == "document" and rng.random() < 0.2:
                kind = rng.choice(("file", "folder"))
            trashed = rng.random() < 0.15
            row = frappe._dict(
                doctype="Drive Node",
                title=f"{kind} {index}",
                parent_node=parent.name,
                root=self.root.node,
                path="" if parent.kind == "root" else f"{parent.path or '/'}{parent.name}/",
                kind=kind,
                state="Trashed" if trashed else "Active",
                trashed_at=now_datetime() if trashed else None,
                trash_root=parent.name if trashed else None,
                size=0,
                is_template=0,
            )
            doc = frappe.get_doc(dict(row))
            doc.db_insert()
            row.name = doc.name
            del row["doctype"]
            nodes.append(row)
            if kind == "folder" and not trashed:
                containers.append(row)

        grants: list[frappe._dict] = []
        targets = [root, *nodes]
        used: set[tuple[str, str]] = set()
        for _ in range(rng.randint(0, 10)):
            node = rng.choice(targets)
            flavour = rng.choice(("own", "own", "own", "public", "link", "locked"))
            if flavour == "own":
                principal = rng.choice(OWN_PRINCIPALS)
                role = rng.choice(ROLES)
            elif flavour == "public":
                principal = "$PUBLIC"
                # `grant()` caps $PUBLIC at READ and keeps a deny legal.
                role = rng.choice((0, READ))
            else:
                principal = f"$LINK:{_token(rng)}"
                role = rng.choice(ROLES)
            if (node.name, principal) in used:
                continue
            used.add((node.name, principal))
            expires_on = rng.choice(
                (None, None, now_datetime() + timedelta(days=3), now_datetime() - timedelta(days=3))
            )
            grant = frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": node.name,
                    "principal": principal,
                    "role": role,
                    "expires_on": expires_on,
                    "password_hash": PASSWORD_HASH if flavour == "locked" else None,
                }
            ).insert(ignore_permissions=True)
            grants.append(
                frappe._dict(
                    node=node.name,
                    principal=principal,
                    role=role,
                    expires_on=expires_on,
                    password_hash=grant.password_hash,
                )
            )
        frappe.db.commit()
        return nodes, grants

    def _callers(self, grants) -> list[tuple[str, Principals]]:
        """The list callers to compare: a member, a guest, each with and without links."""
        links = tuple(sorted({row.principal for row in grants if row.principal.startswith("$LINK:")}))
        exp = int(time.time()) + 600
        tickets = tuple(
            (
                row.principal,
                str(exp),
                make_ticket(row.principal.removeprefix("$LINK:"), row.password_hash, exp).split(".")[1],
            )
            for row in grants
            if row.password_hash
        )
        return [
            ("member", Principals(VIEWER, OWN_PRINCIPALS, ("$PUBLIC",))),
            ("member with links", Principals(VIEWER, OWN_PRINCIPALS, ("$PUBLIC", *links))),
            ("guest", Principals("Guest", (), ("$PUBLIC",))),
            ("guest with links", Principals("Guest", (), ("$PUBLIC", *links))),
            # Unlocked: the one caller the SQL is documented to refuse more than.
            (
                "member with unlocked links",
                Principals(VIEWER, OWN_PRINCIPALS, ("$PUBLIC", *links), link_tickets=tickets),
            ),
        ]

    # the two sides

    def _admitted_by_sql(self, principals: Principals) -> set[str]:
        with patch("suite.drive.framework.principals_for", return_value=principals):
            predicate = framework._list_predicate(NODE_COLUMN, principals.user)
        return set(
            frappe.db.sql_list(
                f"SELECT {NODE_COLUMN} FROM `tabDrive Node` `outer_node` "
                f"WHERE `outer_node`.`root` = %(root)s AND {predicate}",
                {"root": self.root.node},
            )
        )

    def _admitted_by_engine(self, nodes, principals: Principals) -> set[str]:
        return {
            node.name
            for node in nodes
            if node.kind == "document" and node.state == "Active" and effective_role(node, principals) >= READ
        }

    def _simplified(self, node, grants, principals: Principals) -> bool:
        """Whether one of the predicate's two named simplifications applies to `node`."""
        chain = chain_ids(node)
        live = [
            row
            for row in grants
            if row.node in chain
            and row.principal in principals.all()
            and (row.expires_on is None or row.expires_on > now_datetime())
        ]
        if any(row.password_hash and principals.ticket_for(row.principal) for row in live):
            return True
        own = [row for row in live if row.principal in principals.own]
        if not own:
            return False
        deepest = max(chain.index(row.node) for row in own)
        tiers = {own_tier(row.principal, principals.user) for row in own if chain.index(row.node) == deepest}
        return len(tiers) > 1

    # tests

    def test_the_sql_never_admits_what_the_engine_refuses_and_agrees_elsewhere(self):
        rng = random.Random(20261003)
        compared = admitted = 0
        for tree in range(TREES):
            nodes, grants = self._seed_tree(rng)
            for label, principals in self._callers(grants):
                sql = self._admitted_by_sql(principals)
                engine = self._admitted_by_engine(nodes, principals)
                self.assertLessEqual(
                    sql,
                    engine,
                    f"tree {tree}, {label}: the SQL admitted {sorted(sql - engine)} which the engine refuses",
                )
                admitted += len(sql)
                for node in nodes:
                    if node.kind != "document" or node.state != "Active":
                        continue
                    if self._simplified(node, grants, principals):
                        continue
                    compared += 1
                    self.assertEqual(
                        node.name in sql,
                        node.name in engine,
                        f"tree {tree}, {label}, node {node.name}: no named simplification applies, "
                        f"yet the SQL says {node.name in sql} and the engine says {node.name in engine}",
                    )
            drop_personal_root(OWNER)
            self.root = create_root(kind="Personal", title="Predicate Root", user=OWNER)
            frappe.db.commit()
        # The run is not vacuous: plenty of nodes were compared and some were readable.
        self.assertGreater(compared, 200)
        self.assertGreater(admitted, 20)

    def test_an_admin_has_no_filter_and_manage_everywhere(self):
        rng = random.Random(7)
        nodes, _grants = self._seed_tree(rng)
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        with patch("suite.drive.framework.principals_for", return_value=admin):
            self.assertEqual(framework._list_predicate(NODE_COLUMN, admin.user), "")
        self.assertTrue(all(effective_role(node, admin) == MANAGE for node in nodes))

    def test_a_caller_with_no_principals_sees_nothing(self):
        nobody = Principals("Guest", (), ())
        with patch("suite.drive.framework.principals_for", return_value=nobody):
            self.assertEqual(framework._list_predicate(NODE_COLUMN, nobody.user), "1=0")
        self.assertEqual(
            effective_role(frappe._dict(name=self.root.node, kind="root", root=None, path=""), nobody), 0
        )
