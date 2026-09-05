from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime
from frappe.utils.password import passlibctx

from suite.drive._core.access import (
    UNLOCK_WINDOW_SECONDS,
    _verify_link_password,
    effective_role,
    explain,
    grant,
    require,
    revoke,
    revoke_below,
    rotate_link,
    unlock_link,
)
from suite.drive._core.errors import (
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
)
from suite.drive._core.principals import Principals, ticket_ok
from suite.drive._core.roles import EDIT, MANAGE, NONE, READ
from suite.drive._core.roots import create_root
from suite.tests.utils import ensure_user

TARGET = "drive-grant-target@example.com"
MANAGER = "drive-grant-manager@example.com"
UNHELD = "drive-grant-unheld@example.com"


class _GrantFixture(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(TARGET)
        ensure_user(MANAGER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._root_nodes_before = set(frappe.get_all("Drive Node", filters={"kind": "root"}, pluck="name"))
        self._root_metadata_before = set(frappe.get_all("Drive Root", pluck="name"))
        self.root = create_root(
            kind="Personal",
            title="Grant test root",
            user=TARGET,
        )
        self.folder = self._child(self.root.name, "Folder")
        self.admin = Principals(
            "Administrator",
            ("Administrator",),
            ("$PUBLIC",),
            is_admin=True,
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
            activity_ids = tuple(
                frappe.get_all(
                    "Drive Activity",
                    filters={"node": ["in", tuple(node_names)]},
                    pluck="name",
                )
            )
            if activity_ids:
                frappe.db.delete("Drive Notification", {"activity": ["in", activity_ids]})
            frappe.db.delete("Drive Grant", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Activity", {"node": ["in", tuple(node_names)]})
            frappe.db.delete("Drive Node", {"name": ["in", tuple(node_names)]})
        if root_metadata:
            frappe.db.delete("Drive Root", {"name": ["in", tuple(root_metadata)]})
        super().tearDown()

    def _child(self, parent_id: str, title: str):
        parent = frappe.db.get_value("Drive Node", parent_id, ["name", "kind", "root", "path"], as_dict=True)
        root = parent.name if parent.kind == "root" else parent.root
        path = "" if parent.kind == "root" else f"{parent.path or '/'}{parent.name}/"
        child = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": parent.name,
                "root": root,
                "path": path,
                "kind": "folder",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        )
        if parent.kind == "root":
            return child.insert(ignore_permissions=True)

        # Ticket 07's validator still expects the former double-slash shape.
        # Build canonical nested fixture data directly so this ticket tests the
        # accepted child_path/revoke-below contract without expanding scope.
        child.db_insert()
        return child

    def _activity(self, node: str):
        rows = frappe.get_all(
            "Drive Activity",
            filters={"node": node},
            fields=["name", "action", "actor", "at", "detail"],
            order_by="creation",
        )
        for row in rows:
            row.detail = frappe.parse_json(row.detail)
        return rows

    def _assert_no_mutation(self, operation, exception):
        before = {
            "grants": frappe.db.count("Drive Grant"),
            "activity": frappe.db.count("Drive Activity"),
        }
        with self.assertRaises(exception):
            operation()
        self.assertEqual(frappe.db.count("Drive Grant"), before["grants"])
        self.assertEqual(frappe.db.count("Drive Activity"), before["activity"])


class TestGrantWorkflows(_GrantFixture):
    def test_all_twelve_refusals_use_the_specified_errors_and_mutate_nothing(self):
        outsider = Principals(MANAGER, (MANAGER,), ("$PUBLIC",))
        cases = (
            (
                "missing node precedes malformed role",
                lambda: grant("missing-node", "bad", 99, outsider),
                DriveNotFound,
            ),
            (
                "insufficient access precedes malformed role",
                lambda: grant(self.folder.name, "bad", 99, outsider),
                DriveForbidden,
            ),
            (
                "malformed role",
                lambda: grant(self.folder.name, TARGET, "10", self.admin),
                frappe.ValidationError,
            ),
            (
                "malformed principal",
                lambda: grant(self.folder.name, "$UNKNOWN", READ, self.admin),
                frappe.ValidationError,
            ),
            (
                "missing principal target",
                lambda: grant(
                    self.folder.name,
                    "missing-drive-grant-user@example.com",
                    READ,
                    self.admin,
                ),
                frappe.ValidationError,
            ),
            (
                "public above read",
                lambda: grant(self.folder.name, "$PUBLIC", EDIT, self.admin),
                DriveForbidden,
            ),
            (
                "public root",
                lambda: grant(self.root.name, "$PUBLIC", READ, self.admin),
                DriveForbidden,
            ),
            (
                "link root",
                lambda: grant(self.root.name, "$LINK", READ, self.admin),
                DriveForbidden,
            ),
            (
                "link above edit",
                lambda: grant(self.folder.name, "$LINK", MANAGE, self.admin),
                DriveForbidden,
            ),
            (
                "password on a non-link",
                lambda: grant(self.folder.name, TARGET, READ, self.admin, password="secret"),
                DriveForbidden,
            ),
            (
                "personal owner deny",
                lambda: grant(self.folder.name, TARGET, NONE, self.admin),
                DriveForbidden,
            ),
            (
                "past expiry",
                lambda: grant(
                    self.folder.name,
                    TARGET,
                    READ,
                    self.admin,
                    expires_on="2000-01-01 00:00:00",
                ),
                frappe.ValidationError,
            ),
        )
        for label, operation, exception in cases:
            with self.subTest(label=label):
                self._assert_no_mutation(operation, exception)

    def test_missing_group_is_a_validation_error(self):
        self._assert_no_mutation(
            lambda: grant(self.folder.name, "$GROUP:missing-grant-group", READ, self.admin),
            frappe.ValidationError,
        )

    def test_malformed_and_timezone_aware_expiries_are_validation_errors(self):
        for expires_on in (
            "",
            "not-a-date",
            datetime.now(UTC) + timedelta(days=1),
        ):
            with self.subTest(expires_on=expires_on):
                self._assert_no_mutation(
                    lambda value=expires_on: grant(
                        self.folder.name,
                        MANAGER,
                        READ,
                        self.admin,
                        expires_on=value,
                    ),
                    frappe.ValidationError,
                )

    def test_activity_failure_rolls_back_the_grant_write(self):
        with patch("suite.drive._core.access._write_activity", side_effect=RuntimeError("stop")):
            self._assert_no_mutation(
                lambda: grant(self.folder.name, TARGET, READ, self.admin),
                RuntimeError,
            )

    def test_insert_update_and_root_target_each_write_one_exact_activity(self):
        manager_identity = Principals(MANAGER, (MANAGER,), ("$PUBLIC",), is_admin=True)
        created = grant(self.folder.name, TARGET, READ, manager_identity)
        updated = grant(self.folder.name, TARGET, EDIT, self.admin)
        root_grant = grant(self.root.name, "$GENERAL", READ, self.admin)

        self.assertEqual(created["name"], updated["name"])
        rows = self._activity(self.folder.name)
        self.assertEqual([row.action for row in rows], ["share_add", "share_edit"])
        # The actor is the identity that performed the write, not the admin
        # capability that authorized it.
        self.assertEqual(rows[0].actor, MANAGER)
        self.assertEqual(rows[1].actor, "Administrator")
        self.assertEqual(
            rows[0].detail,
            {
                "principal": TARGET,
                "old_role": None,
                "new_role": READ,
                "expires_on": None,
                "has_password": False,
            },
        )
        self.assertEqual(rows[1].detail["old_role"], READ)
        self.assertEqual(rows[1].detail["new_role"], EDIT)
        self.assertEqual(len(self._activity(self.root.name)), 1)
        self.assertEqual(root_grant["node"], self.root.name)

    def test_explicit_deny_is_stored_while_revoke_only_removes_the_local_row(self):
        grant(self.root.name, MANAGER, READ, self.admin)
        grant(self.folder.name, MANAGER, EDIT, self.admin)
        target = Principals(MANAGER, (MANAGER,), ("$PUBLIC",))
        self.assertEqual(effective_role(self.folder, target), EDIT)

        before = len(self._activity(self.folder.name))
        revoke(self.folder.name, MANAGER, self.admin)

        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.folder.name, "principal": MANAGER}))
        self.assertEqual(effective_role(self.folder, target), READ)
        rows = self._activity(self.folder.name)
        self.assertEqual(len(rows), before + 1)
        self.assertEqual(rows[-1].action, "share_remove")
        self.assertEqual(rows[-1].detail["old_role"], EDIT)
        self.assertIsNone(rows[-1].detail["new_role"])

        grant(self.folder.name, MANAGER, NONE, self.admin)
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": self.folder.name, "principal": MANAGER}, "role"),
            NONE,
        )
        self.assertEqual(effective_role(self.folder, target), NONE)

    def test_revoke_below_includes_origin_and_descendants_without_sibling_leakage(self):
        origin = self._child(self.folder.name, "Nested origin")
        descendant = self._child(origin.name, "Descendant")
        sibling = self._child(self.folder.name, "Nested sibling")
        for node in (origin, descendant, sibling):
            frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": node.name,
                    "principal": TARGET,
                    "role": READ,
                }
            ).insert(ignore_permissions=True)

        deleted = revoke_below(origin.name, TARGET, self.admin)

        self.assertEqual(deleted, 2)
        self.assertFalse(
            frappe.db.exists(
                "Drive Grant",
                {"node": ["in", (origin.name, descendant.name)], "principal": TARGET},
            )
        )
        self.assertTrue(frappe.db.exists("Drive Grant", {"node": sibling.name, "principal": TARGET}))
        activity = self._activity(origin.name)
        self.assertEqual(len(activity), 1)
        self.assertEqual(
            activity[0].detail,
            {"principal": TARGET, "scope": "below", "rows": 2},
        )

    def test_revoke_below_root_includes_the_root_and_every_descendant(self):
        descendant = self._child(self.folder.name, "Descendant")
        other_root = create_root(kind="Personal", title="Other root", user=MANAGER)
        for node in (self.root, self.folder, descendant):
            frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": node.name,
                    "principal": MANAGER,
                    "role": READ,
                }
            ).insert(ignore_permissions=True)

        self.assertEqual(revoke_below(self.root.name, MANAGER, self.admin), 3)
        self.assertTrue(frappe.db.exists("Drive Grant", {"node": other_root.name, "principal": MANAGER}))
        self.assertEqual(self._activity(self.root.name)[0].detail["rows"], 3)

    def test_explain_is_authorized_ordered_fresh_and_includes_unheld_rows(self):
        for principal, role in (
            ("$GROUP:manage", MANAGE),
            ("$GROUP:read", READ),
            (UNHELD, EDIT),
        ):
            frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": self.root.name,
                    "principal": principal,
                    "role": role,
                }
            ).insert(ignore_permissions=True)
        manager = Principals(
            MANAGER,
            (MANAGER, "$GROUP:manage", "$GROUP:read"),
            ("$PUBLIC",),
        )

        first = explain(self.folder, manager)
        frappe.db.set_value(
            "Drive Grant",
            {"node": self.root.name, "principal": "$GROUP:read"},
            "role",
            EDIT,
        )
        second = explain(self.folder, manager)

        self.assertEqual(first["role"], MANAGE)
        self.assertEqual(first["source"], "grant")
        self.assertEqual(first["rows"][0]["depth"], 0)
        self.assertEqual(
            next(row for row in first["rows"] if row["principal"] == UNHELD)["held"],
            False,
        )
        self.assertTrue(next(row for row in first["rows"] if row["principal"] == "$GROUP:manage")["winner"])
        self.assertEqual(
            next(row for row in second["rows"] if row["principal"] == "$GROUP:read")["role"],
            EDIT,
        )

        outsider = Principals(UNHELD, (UNHELD,), ("$PUBLIC",))
        with self.assertRaises(DriveForbidden):
            explain(self.folder, outsider)
        self.assertEqual(
            explain(self.folder, self.admin),
            {"role": MANAGE, "source": "site admin", "rows": []},
        )

    def test_expired_positive_deny_and_link_rows_are_retained_but_inert(self):
        principals = (MANAGER, "$GENERAL", "$PUBLIC", "$LINK:AbCdEfGhIjKlMnOpQrSt12")
        for principal in principals:
            row = frappe.get_doc(
                {
                    "doctype": "Drive Grant",
                    "node": self.folder.name,
                    "principal": principal,
                    "role": READ,
                    "expires_on": "2000-01-01 00:00:00",
                }
            ).insert(ignore_permissions=True)
            self.assertTrue(frappe.db.exists("Drive Grant", row.name))
        deny = frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": self.folder.name,
                "principal": "$GROUP:expired-deny",
                "role": NONE,
                "expires_on": "2000-01-01 00:00:00",
            }
        ).insert(ignore_permissions=True)

        holder = Principals(
            MANAGER,
            (MANAGER, "$GROUP:expired-deny", "$GENERAL"),
            ("$PUBLIC",),
        )
        self.assertEqual(effective_role(self.folder, holder), NONE)
        self.assertTrue(frappe.db.exists("Drive Grant", deny.name))


class TestShareLinks(_GrantFixture):
    def _create_password_link(self, password="correct horse", expires_on=None):
        return grant(
            self.folder.name,
            "$LINK",
            EDIT,
            self.admin,
            password=password,
            expires_on=expires_on,
        )

    def _link_principals(self, principal, ticket=None):
        proof = ()
        if ticket:
            exp, mac = ticket.split(".")
            proof = ((principal, exp, mac),)
        return Principals("Guest", (), ("$PUBLIC", principal), link_tickets=proof)

    def test_mint_stores_clear_base62_token_and_only_a_password_hash(self):
        result = self._create_password_link()
        token = result["principal"].removeprefix("$LINK:")
        stored = frappe.db.get_value(
            "Drive Grant",
            result["name"],
            ["principal", "password_hash"],
            as_dict=True,
        )

        self.assertEqual(len(token), 22)
        self.assertTrue(token.isascii() and token.isalnum())
        self.assertEqual(stored.principal, result["principal"])
        self.assertNotEqual(stored.password_hash, "correct horse")
        self.assertTrue(passlibctx.verify("correct horse", stored.password_hash))
        self.assertNotIn("password_hash", result)
        self.assertEqual(result["url"], f"/drive/l/{token}")
        self.assertEqual(len(self._activity(self.folder.name)), 1)

    def test_bare_password_link_is_locked_and_a_current_ticket_authorizes(self):
        result = self._create_password_link()
        token = result["principal"].removeprefix("$LINK:")
        bare = self._link_principals(result["principal"])
        with self.assertRaises(DriveLocked):
            require(self.folder, READ, bare)

        unlocked = unlock_link(token, "correct horse")
        proved = self._link_principals(result["principal"], unlocked["ticket"])
        self.assertEqual(effective_role(self.folder, proved), EDIT)
        require(self.folder, EDIT, proved)
        self.assertEqual(unlocked["ticket"].split(".")[0], str(unlocked["expires"]))

    def test_each_protected_link_ticket_is_checked_once_per_require(self):
        result = self._create_password_link()
        invalid = self._link_principals(
            result["principal"],
            f"{int(datetime.now().timestamp()) + 3600}.{'0' * 64}",
        )
        with patch("suite.drive._core.access.ticket_ok", wraps=ticket_ok) as checked:
            with self.assertRaises(DriveLocked):
                require(self.folder, READ, invalid)
            self.assertEqual(checked.call_count, 1)

        token = result["principal"].removeprefix("$LINK:")
        proved = self._link_principals(result["principal"], unlock_link(token, "correct horse")["ticket"])
        with patch("suite.drive._core.access.ticket_ok", wraps=ticket_ok) as checked:
            with self.assertRaises(DriveForbidden):
                require(self.folder, MANAGE, proved)
            self.assertEqual(checked.call_count, 1)

    def test_unlock_uses_the_password_capability_row_when_a_descendant_deny_exists(self):
        result = self._create_password_link()
        descendant = self._child(self.folder.name, "Denied descendant")
        grant(descendant.name, result["principal"], NONE, self.admin)
        token = result["principal"].removeprefix("$LINK:")

        unlocked = unlock_link(token, "correct horse")
        proved = self._link_principals(result["principal"], unlocked["ticket"])

        require(self.folder, EDIT, proved)
        with self.assertRaises(DriveNotFound):
            require(descendant, READ, proved)

    def test_unlock_rejects_multiple_password_capability_rows_as_ambiguous(self):
        result = self._create_password_link()
        descendant = self._child(self.folder.name, "Duplicate capability")
        frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": descendant.name,
                "principal": result["principal"],
                "role": READ,
                "password_hash": passlibctx.hash("other password"),
            }
        ).insert(ignore_permissions=True)

        with self.assertRaises(DriveForbidden):
            unlock_link(result["principal"].removeprefix("$LINK:"), "correct horse")

    def test_locked_and_expired_links_raise_above_inherited_read_but_not_through_own_deny(self):
        result = self._create_password_link()
        bare = self._link_principals(result["principal"])
        grant(self.folder.name, "$PUBLIC", READ, self.admin)

        with self.assertRaises(DriveLocked):
            require(self.folder, EDIT, bare)

        frappe.db.set_value("Drive Grant", result["name"], "expires_on", "2000-01-01 00:00:00")
        with self.assertRaises(DriveLinkExpired):
            require(self.folder, EDIT, bare)

        grant(self.folder.name, MANAGER, NONE, self.admin)
        denied = Principals(
            MANAGER,
            (MANAGER,),
            ("$PUBLIC", result["principal"]),
        )
        with self.assertRaises(DriveNotFound):
            require(self.folder, READ, denied)

    def test_password_change_invalidates_old_ticket_without_deleting_the_row(self):
        result = self._create_password_link()
        token = result["principal"].removeprefix("$LINK:")
        ticket = unlock_link(token, "correct horse")["ticket"]
        grant(
            self.folder.name,
            result["principal"],
            EDIT,
            self.admin,
            password="new password",
        )

        with self.assertRaises(DriveLocked):
            require(self.folder, READ, self._link_principals(result["principal"], ticket))
        self.assertTrue(frappe.db.exists("Drive Grant", result["name"]))

    def test_rotate_keeps_the_same_row_and_settings_but_invalidates_old_credentials(self):
        expiry = add_to_date(now_datetime(), days=1)
        created = self._create_password_link(expires_on=expiry)
        old_principal = created["principal"]
        old_token = old_principal.removeprefix("$LINK:")
        old_ticket = unlock_link(old_token, "correct horse")["ticket"]
        old_hash = frappe.db.get_value("Drive Grant", created["name"], "password_hash")
        before_activity = len(self._activity(self.folder.name))

        rotated = rotate_link(created["name"], self.admin)

        self.assertEqual(rotated["name"], created["name"])
        self.assertNotEqual(rotated["principal"], old_principal)
        self.assertEqual(rotated["role"], EDIT)
        self.assertEqual(getattr(rotated["expires_on"], "date", lambda: None)(), expiry.date())
        self.assertEqual(frappe.db.get_value("Drive Grant", created["name"], "password_hash"), old_hash)
        self.assertFalse(frappe.db.exists("Drive Grant", {"principal": old_principal}))
        with self.assertRaises(DriveNotFound):
            require(self.folder, READ, self._link_principals(old_principal, old_ticket))

        new_principal = rotated["principal"]
        with self.assertRaises(DriveLocked):
            require(self.folder, READ, self._link_principals(new_principal, old_ticket))
        rows = self._activity(self.folder.name)
        self.assertEqual(len(rows), before_activity + 1)
        self.assertEqual(rows[-1].action, "share_edit")
        self.assertEqual(rows[-1].detail["old_principal"], old_principal)
        self.assertEqual(rows[-1].detail["new_principal"], new_principal)

    def test_unlock_fifth_failure_exhausts_bucket_and_sixth_skips_verification(self):
        created = self._create_password_link()
        token = created["principal"].removeprefix("$LINK:")
        cache_key = f"drive:link_unlock:{token}"
        frappe.cache.delete_value(cache_key)
        self.addCleanup(frappe.cache.delete_value, cache_key)

        with patch("suite.drive._core.access.passlibctx.verify", return_value=False) as verify:
            for _ in range(5):
                with self.assertRaises(DriveLocked):
                    unlock_link(token, "wrong")
            self.assertEqual(verify.call_count, 5)
            with self.assertRaises(frappe.RateLimitExceededError):
                unlock_link(token, "correct horse")
            self.assertEqual(verify.call_count, 5)
        raw_key = frappe.cache.make_key(cache_key)
        self.assertEqual(frappe.cache.get(raw_key), b"locked")
        self.assertGreater(frappe.cache.ttl(raw_key), 0)
        self.assertLessEqual(frappe.cache.ttl(raw_key), UNLOCK_WINDOW_SECONDS)

    def test_parallel_failures_atomically_exhaust_one_shared_bucket(self):
        token = "AtomicFailureBucket123"
        cache_key = f"drive:link_unlock:{token}"
        raw_key = frappe.cache.make_key(cache_key)
        frappe.cache.delete_value(cache_key)
        self.addCleanup(frappe.cache.delete_value, cache_key)
        cache = frappe.cache()
        raw_lock_key = frappe.cache.make_key(f"drive:link_unlock:lock:{token}")

        with patch("suite.drive._core.access.passlibctx.verify", return_value=False) as verify:
            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(
                    pool.map(
                        lambda _index: _verify_link_password(
                            cache,
                            raw_key,
                            raw_lock_key,
                            "wrong",
                            "password-hash",
                        ),
                        range(12),
                    )
                )

        self.assertEqual(results.count("failed"), 5)
        self.assertEqual(results.count("locked"), 7)
        self.assertEqual(verify.call_count, 5)
        self.assertEqual(frappe.cache.get(raw_key), b"locked")

    def test_fifth_failure_cannot_be_cleared_by_an_interleaved_success(self):
        token = "InterleavedBoundary12"
        cache_key = f"drive:link_unlock:{token}"
        raw_key = frappe.cache.make_key(cache_key)
        raw_lock_key = frappe.cache.make_key(f"drive:link_unlock:lock:{token}")
        cache = frappe.cache()
        cache.set(raw_key, b"4", ex=UNLOCK_WINDOW_SECONDS)
        self.addCleanup(frappe.cache.delete_value, cache_key)
        failure_verifying = Event()
        allow_failure = Event()

        def verify(password, _password_hash):
            if password == "wrong":
                failure_verifying.set()
                allow_failure.wait(timeout=10)
                return False
            return True

        def attempt(password):
            return _verify_link_password(
                cache,
                raw_key,
                raw_lock_key,
                password,
                "password-hash",
            )

        with patch("suite.drive._core.access.passlibctx.verify", side_effect=verify) as mocked:
            with ThreadPoolExecutor(max_workers=2) as pool:
                failure = pool.submit(attempt, "wrong")
                self.assertTrue(failure_verifying.wait(timeout=10))
                success = pool.submit(attempt, "correct")
                allow_failure.set()
                self.assertEqual(failure.result(timeout=10), "failed")
                self.assertEqual(success.result(timeout=10), "locked")

        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(cache.get(raw_key), b"locked")

    def test_successful_unlock_clears_failures(self):
        created = self._create_password_link()
        token = created["principal"].removeprefix("$LINK:")
        cache_key = f"drive:link_unlock:{token}"
        raw_key = frappe.cache.make_key(cache_key)
        frappe.cache.set(raw_key, b"4", ex=900)

        unlock_link(token, "correct horse")

        self.assertIsNone(frappe.cache.get(raw_key))

    def test_expired_link_is_retained_and_returns_expired_not_locked(self):
        created = self._create_password_link(expires_on=add_to_date(now_datetime(), days=1))
        token = created["principal"].removeprefix("$LINK:")
        frappe.db.set_value("Drive Grant", created["name"], "expires_on", "2000-01-01 00:00:00")

        with self.assertRaises(DriveLinkExpired):
            unlock_link(token, "correct horse")
        with self.assertRaises(DriveLinkExpired):
            require(self.folder, READ, self._link_principals(created["principal"]))
        self.assertTrue(frappe.db.exists("Drive Grant", created["name"]))

    def test_expired_unpassworded_link_also_returns_expired(self):
        created = grant(self.folder.name, "$LINK", READ, self.admin)
        token = created["principal"].removeprefix("$LINK:")
        frappe.db.set_value("Drive Grant", created["name"], "expires_on", "2000-01-01 00:00:00")

        with self.assertRaises(DriveLinkExpired):
            unlock_link(token, "unused")
