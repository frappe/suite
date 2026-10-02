from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Barrier
from unittest.mock import call, patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.errors import DriveForbidden, DriveNotFound, DriveOverQuota
from suite.drive._core.quota import (
    ADMIT_SQL,
    RELEASE_SQL,
    admit,
    bind_legacy_storage_reservation,
    create_storage_reservation,
    effective_quota,
    get_storage_reservation,
    get_storage_usage,
    grow_storage_reservation,
    preflight,
    recompute_usage,
    reduce_storage_reservation,
    release,
    release_storage_reservation,
    root_for_node,
    site_quota_bytes,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roots import LARGEST_FILES, create_root, personal_root_for, usage_for
from suite.drive.jobs import recompute_root_usage
from suite.hooks import scheduler_events


def scan_active_and_archived_roots(doctype, filters=None, pluck=None):
    """Answer only the daily scan's own query, so a changed filter fails here."""
    if (doctype, filters, pluck) != (
        "Drive Root",
        {"state": ["in", ("Active", "Archived")]},
        "name",
    ):
        raise AssertionError(f"unexpected root scan: {doctype}, {filters}, {pluck}")
    return ["active", "archived", "broken"]


class TestQuotaContract(UnitTestCase):
    @patch("suite.drive._core.quota.frappe.db.get_singles_dict")
    def test_effective_quota_prefers_override_then_kind_default(self, get_settings):
        get_settings.return_value = frappe._dict(default_personal_quota=100, shared_quota=200)

        self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 50}), 50)
        self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 0}), 100)
        self.assertEqual(effective_quota({"kind": "Shared", "quota_bytes": 0}), 200)

    @patch("suite.drive._core.quota.frappe.db.get_singles_dict")
    def test_effective_quota_reads_raw_site_defaults(self, get_settings):
        get_settings.return_value = frappe._dict(default_personal_quota="0", shared_quota="20480")

        self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 0}), 0)
        self.assertEqual(effective_quota({"kind": "Shared", "quota_bytes": 0}), 20480)

    @patch("suite.drive._core.quota.frappe.db.get_singles_dict")
    def test_a_malformed_site_default_is_refused_not_read_as_unlimited(self, get_settings):
        for stored in ("5GB", "1.5", "-1", "0x10", "1_000"):
            with self.subTest(stored=stored):
                get_settings.return_value = frappe._dict(default_personal_quota=stored)
                with self.assertRaises(frappe.ValidationError):
                    effective_quota({"kind": "Personal", "quota_bytes": 0})

    @patch("suite.drive._core.quota.frappe.db.get_singles_dict")
    def test_an_unset_site_default_is_unlimited(self, get_settings):
        for stored in (None, "", "   ", 0):
            with self.subTest(stored=stored):
                get_settings.return_value = frappe._dict(default_personal_quota=stored)
                self.assertEqual(effective_quota({"kind": "Personal", "quota_bytes": 0}), 0)

    def test_site_quota_bytes_takes_the_stored_form_and_nothing_else(self):
        self.assertEqual(site_quota_bytes("0", "Site quota"), 0)
        self.assertEqual(site_quota_bytes(" 10240 ", "Site quota"), 10240)
        self.assertEqual(site_quota_bytes("+10240", "Site quota"), 10240)
        self.assertEqual(site_quota_bytes(10240, "Site quota"), 10240)
        self.assertEqual(site_quota_bytes(None, "Site quota"), 0)
        for refused in ("abc", "1e3", "-1", -1, 1.5, True):
            with self.subTest(refused=refused):
                with self.assertRaises(frappe.ValidationError):
                    site_quota_bytes(refused, "Site quota")

    def test_unknown_root_kind_is_not_treated_as_personal(self):
        with self.assertRaises(frappe.ValidationError):
            effective_quota({"kind": "Unknown", "quota_bytes": 0})

    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    def test_preflight_is_read_only_and_uses_declared_bytes(self, _effective):
        preflight({"used_bytes": 60}, 40)
        with self.assertRaises(DriveOverQuota):
            preflight({"used_bytes": 60}, 41)

    @patch("suite.drive._core.quota._", side_effect=lambda message: message)
    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    @patch("suite.drive._core.quota.frappe.db.get_value")
    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_admit_is_one_conditional_counter_update(self, sql, get_value, _effective, _translate):
        get_value.return_value = frappe._dict(name="root", kind="Personal", quota_bytes=0)
        sql.side_effect = [None, [(1,)]]

        admit("root", 25)

        self.assertEqual(
            sql.call_args_list[0],
            call(ADMIT_SQL, {"root": "root", "delta": 25, "effective_quota": 100}),
        )
        self.assertEqual(sql.call_args_list[1], call("SELECT ROW_COUNT()"))

    @patch("suite.drive._core.quota._", side_effect=lambda message: message)
    @patch("suite.drive._core.quota.effective_quota", return_value=100)
    @patch("suite.drive._core.quota.frappe.db.get_value")
    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_admit_refuses_a_lost_size_race(self, sql, get_value, _effective, _translate):
        get_value.return_value = frappe._dict(name="root", kind="Personal", quota_bytes=0)
        sql.side_effect = [None, [(0,)]]

        with self.assertRaises(DriveOverQuota):
            admit("root", 25)

    @patch("suite.drive._core.quota.frappe.db.sql")
    @patch("suite.drive._core.quota.frappe.db.get_value")
    def test_zero_admission_does_not_depend_on_changed_row_count(self, get_value, sql):
        admit("root", 0)
        get_value.assert_not_called()
        sql.assert_not_called()

    @patch("suite.drive._core.quota.frappe.db.sql")
    def test_release_uses_a_floored_decrement(self, sql):
        release("root", 12)
        sql.assert_called_once_with(RELEASE_SQL, {"root": "root", "delta": 12})
        self.assertIn("GREATEST", RELEASE_SQL)

    @patch("suite.drive._core.quota.validate_root_pair")
    def test_malformed_root_pair_is_not_an_accounting_target(self, validate_pair):
        validate_pair.side_effect = frappe.ValidationError("malformed")
        with self.assertRaises(DriveNotFound):
            root_for_node({"name": "root", "kind": "root"})
        validate_pair.assert_called_once_with("root")

    @patch("suite.drive.jobs.frappe.db.rollback")
    @patch("suite.drive.jobs.frappe.db.commit")
    @patch("suite.drive.jobs.frappe.log_error")
    @patch("suite.drive.jobs.recompute_usage")
    @patch("suite.drive.jobs.frappe.get_all", side_effect=scan_active_and_archived_roots)
    def test_daily_recompute_isolates_roots_and_logs_drift(
        self, _get_all, recompute, log_error, commit, rollback
    ):
        recompute.side_effect = [
            frappe._dict(root="active", drift=0),
            frappe._dict(root="archived", drift=9),
            RuntimeError("broken"),
        ]

        result = recompute_root_usage()

        self.assertEqual(result, {"roots": 3, "corrected": 1, "failed": 1})
        self.assertEqual(commit.call_count, 2)
        rollback.assert_called_once_with()
        self.assertEqual(log_error.call_count, 2)

    @patch("suite.drive.jobs.frappe.db.commit")
    @patch("suite.drive.jobs.recompute_usage", return_value=frappe._dict(root="archived", drift=0))
    @patch("suite.drive.jobs.frappe.get_all", return_value=["archived"])
    def test_the_daily_scan_reads_archived_roots_as_well_as_active_ones(self, get_all, recompute, _commit):
        recompute_root_usage()

        get_all.assert_called_once_with(
            "Drive Root", filters={"state": ["in", ("Active", "Archived")]}, pluck="name"
        )
        recompute.assert_called_once_with("archived")

    def test_the_recompute_is_registered_once_as_a_daily_scheduler_event(self):
        job = "suite.drive.jobs.recompute_root_usage"
        registered = []
        for events in scheduler_events.values():
            if isinstance(events, dict):
                for schedule in events.values():
                    registered.extend(schedule)
            else:
                registered.extend(events)
        self.assertIn(job, scheduler_events["daily"])
        self.assertEqual(registered.count(job), 1)
        module_path, _, attribute = job.rpartition(".")
        self.assertIs(getattr(import_module(module_path), attribute), recompute_root_usage)


class TestSiteDefaultQuota(IntegrationTestCase):
    """The site defaults on a root with no override, read off the real Single.

    `Drive Disk Settings` is a Single, so `default_personal_quota` and
    `shared_quota` live in `tabSingles.value`. Quota checks read the raw text
    to reject malformed values before Frappe casts them to zero.
    """

    user = "Administrator"

    def setUp(self):
        super().setUp()
        self.previous = {
            field: frappe.db.get_single_value("Drive Disk Settings", field)
            for field in ("default_personal_quota", "shared_quota")
        }
        self.root = create_root(kind="Personal", title="Site default root", user=self.user).name

    def tearDown(self):
        for field, value in self.previous.items():
            self._set_site_default(field, value)
        frappe.db.delete("Drive Grant", {"node": self.root})
        frappe.db.delete("Drive Root", self.root)
        frappe.db.delete("Drive Node", self.root)
        super().tearDown()

    def _set_site_default(self, field, value):
        frappe.db.set_single_value("Drive Disk Settings", field, value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")

    def _root_row(self):
        return frappe.db.get_value("Drive Root", self.root, ["name", "kind", "quota_bytes"], as_dict=True)

    def test_the_installed_zero_default_is_unlimited(self):
        """The gate failed here: a six-byte write into a root on the site default."""
        self._set_site_default("default_personal_quota", 0)

        self.assertEqual(effective_quota(self._root_row()), 0)
        admit(self.root, 6)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 6)

    def test_a_site_default_still_bounds_a_root_with_no_override(self):
        self._set_site_default("default_personal_quota", 10)

        self.assertEqual(effective_quota(self._root_row()), 10)
        admit(self.root, 10)
        with self.assertRaises(DriveOverQuota):
            admit(self.root, 1)

    def test_a_malformed_site_default_refuses_the_write(self):
        self._set_site_default("default_personal_quota", "5GB")

        with self.assertRaises(frappe.ValidationError):
            effective_quota(self._root_row())

    def test_saving_the_settings_normalizes_the_stored_quotas(self):
        settings = frappe.get_doc("Drive Disk Settings")
        settings.save()

        self.assertIsInstance(settings.default_personal_quota, int)
        self.assertIsInstance(settings.shared_quota, int)

        settings.default_personal_quota = "-1"
        with self.assertRaises(frappe.ValidationError):
            settings.save()
        settings.reload()


class TestRootReservationsAndRecompute(IntegrationTestCase):
    user = "Administrator"

    def setUp(self):
        super().setUp()
        self.root = create_root(
            kind="Personal", title="Reservation root", user=self.user, quota_bytes=100
        ).name

    def tearDown(self):
        node_ids = tuple(frappe.get_all("Drive Node", filters={"root": self.root}, pluck="name"))
        if node_ids:
            frappe.db.delete("Drive Node Version", {"node": ["in", node_ids]})
            frappe.db.delete("Drive Node", {"name": ["in", node_ids]})
        frappe.db.delete("Drive Storage Reservation", {"root": self.root})
        frappe.db.delete("Drive Grant", {"node": self.root})
        frappe.db.delete("Drive Root", self.root)
        frappe.db.delete("Drive Node", self.root)
        super().tearDown()

    def test_create_resize_release_are_root_keyed_idempotent_and_charged(self):
        self.assertTrue(frappe.db.has_index("tabDrive Storage Reservation", "root_index"))
        created = create_storage_reservation(self.root, "quota-test", 60)
        retried = create_storage_reservation(self.root, "quota-test", 60)
        self.assertEqual(created, retried)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 60)

        with self.assertRaises(DriveOverQuota):
            grow_storage_reservation(self.root, "quota-test", 101)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 60)

        reduced = reduce_storage_reservation(self.root, "quota-test", 25)
        self.assertEqual(reduced.reserved_bytes, 25)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 25)
        release_storage_reservation(self.root, "quota-test")
        release_storage_reservation(self.root, "quota-test")
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 0)

    def _charge_a_node_a_version_and_a_reservation(self, key: str) -> None:
        """Charge 7 node bytes, 5 version bytes, and 11 reserved bytes to the root."""
        child = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": "Charged node",
                "parent": self.root,
                "root": self.root,
                "path": "",
                "kind": "folder",
                "state": "Active",
                "size": 0,
                "is_template": 0,
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("Drive Node", child.name, "size", 7, update_modified=False)
        frappe.get_doc(
            {
                "doctype": "Drive Node Version",
                "node": child.name,
                "seq": 1,
                "kind": "auto",
                "size": 5,
            }
        ).insert(ignore_permissions=True)
        create_storage_reservation(self.root, key, 11)

    def test_recompute_repairs_nodes_versions_and_reservations(self):
        self._charge_a_node_a_version_and_a_reservation("recompute-test")
        frappe.db.set_value("Drive Root", self.root, "used_bytes", 999, update_modified=False)

        result = recompute_usage(self.root)

        self.assertEqual((result.nodes, result.versions, result.reserved), (7, 5, 11))
        self.assertEqual(result.after, 23)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 23)

    def test_the_daily_pass_recomputes_an_archived_root(self):
        """The daily job must reach an Archived root, not only an Active one.

        The scan runs against the real table, so the state filter is proved
        here. Only this root is recomputed for real: every other root on the
        site is stubbed, so the pass stays inside the test's own data.
        """
        self._charge_a_node_a_version_and_a_reservation("archived-recompute")
        frappe.db.set_value(
            "Drive Root", self.root, {"state": "Archived", "used_bytes": 999}, update_modified=False
        )
        scanned = []
        repair = recompute_usage

        def recompute_this_root_only(root):
            scanned.append(root)
            return repair(root) if root == self.root else frappe._dict(root=root, drift=0)

        with (
            patch("suite.drive.jobs.recompute_usage", side_effect=recompute_this_root_only),
            patch("suite.drive.jobs.frappe.db.commit"),
        ):
            result = recompute_root_usage()

        self.assertIn(self.root, scanned)
        self.assertEqual((result["corrected"], result["failed"]), (1, 0))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 23)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "state"), "Archived")

    def test_every_operation_stays_on_the_bound_root_once_it_is_archived(self):
        """Archive then reprovision must not move a charged reservation.

        This is the Meet recording case: the room owner is offboarded while a
        recording is running, a same-email replacement gets a fresh Active
        root, and every remaining call on the running reservation has to keep
        finding and charging the archived root.
        """
        create_storage_reservation(self.root, "archived-recovery", 40)
        frappe.db.set_value("Drive Root", self.root, "state", "Archived", update_modified=False)
        replacement = create_root(kind="Personal", title="Replacement", user=self.user, quota_bytes=100)
        self.addCleanup(self._drop_root, replacement.name)

        self.assertEqual(personal_root_for(self.user), replacement.name)
        self.assertEqual(get_storage_reservation("archived-recovery").root, self.root)

        usage = get_storage_usage(self.root)
        self.assertEqual((usage.used_bytes, usage.reserved_bytes), (40, 40))

        grown = grow_storage_reservation(None, "archived-recovery", 60)
        reduced = reduce_storage_reservation(None, "archived-recovery", 25)
        release_storage_reservation(None, "archived-recovery")

        self.assertEqual((grown.root, grown.reserved_bytes), (self.root, 60))
        self.assertEqual((reduced.root, reduced.reserved_bytes), (self.root, 25))
        self.assertFalse(frappe.db.exists("Drive Storage Reservation", "archived-recovery"))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 0)
        self.assertEqual(frappe.db.get_value("Drive Root", replacement.name, "used_bytes"), 0)

    def test_a_grow_beyond_the_archived_root_quota_is_still_refused(self):
        create_storage_reservation(self.root, "archived-limit", 60)
        frappe.db.set_value("Drive Root", self.root, "state", "Archived", update_modified=False)

        with self.assertRaises(DriveOverQuota):
            grow_storage_reservation(None, "archived-limit", 101)

        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 60)
        release_storage_reservation(None, "archived-limit")

    def test_binding_a_legacy_reservation_charges_it_once_and_never_rebinds(self):
        frappe.get_doc(
            {
                "doctype": "Drive Storage Reservation",
                "name": "legacy-adopt",
                "storage_owner": self.user,
                "reserved_bytes": 30,
            }
        ).insert(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 0)

        adopted = bind_legacy_storage_reservation(self.root, "legacy-adopt", 30)

        self.assertEqual((adopted.root, adopted.reserved_bytes), (self.root, 30))
        self.assertIsNone(frappe.db.get_value("Drive Storage Reservation", "legacy-adopt", "storage_owner"))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 30)

        other = create_root(kind="Shared", title="Other root", quota_bytes=100)
        self.addCleanup(self._drop_root, other.name)

        # A rerun against a different root keeps the original binding and only
        # corrects the amount, so neither counter is charged twice.
        rebound = bind_legacy_storage_reservation(other.name, "legacy-adopt", 45)

        self.assertEqual((rebound.root, rebound.reserved_bytes), (self.root, 45))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 45)
        self.assertEqual(frappe.db.get_value("Drive Root", other.name, "used_bytes"), 0)

        release_storage_reservation(None, "legacy-adopt")
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 0)

    def test_releasing_an_unbound_legacy_reservation_charges_no_root(self):
        frappe.get_doc(
            {
                "doctype": "Drive Storage Reservation",
                "name": "legacy-release",
                "storage_owner": self.user,
                "reserved_bytes": 30,
            }
        ).insert(ignore_permissions=True)

        release_storage_reservation(None, "legacy-release")
        release_storage_reservation(None, "legacy-release")

        self.assertFalse(frappe.db.exists("Drive Storage Reservation", "legacy-release"))
        self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 0)

    def _drop_root(self, root: str) -> None:
        frappe.db.delete("Drive Storage Reservation", {"root": root})
        frappe.db.delete("Drive Grant", {"node": root})
        frappe.db.delete("Drive Root", root)
        frappe.db.delete("Drive Node", root)

    def test_concurrent_reservations_admit_exactly_one_near_quota(self):
        marker = uuid4().hex
        keys = (f"reservation-race:{marker}:1", f"reservation-race:{marker}:2")
        frappe.db.set_value(
            "Drive Root", self.root, {"quota_bytes": 10, "used_bytes": 0}, update_modified=False
        )
        frappe.db.commit()
        site = frappe.local.site
        barrier = Barrier(2)

        def attempt(key):
            frappe.init(site, force=True)
            frappe.connect()
            try:
                barrier.wait(timeout=10)
                try:
                    create_storage_reservation(self.root, key, 6)
                    frappe.db.commit()
                    return "admitted"
                except DriveOverQuota:
                    frappe.db.rollback()
                    return "refused"
            finally:
                frappe.destroy()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = (pool.submit(attempt, keys[0]), pool.submit(attempt, keys[1]))
                results = [future.result(timeout=30) for future in futures]
            frappe.db.rollback()
            self.assertEqual(sorted(results), ["admitted", "refused"])
            self.assertEqual(frappe.db.count("Drive Storage Reservation", {"name": ["in", keys]}), 1)
            self.assertEqual(frappe.db.get_value("Drive Root", self.root, "used_bytes"), 6)
        finally:
            frappe.db.rollback()
            frappe.db.delete("Drive Storage Reservation", {"name": ["in", keys]})
            frappe.db.delete("Drive Grant", {"node": self.root})
            frappe.db.delete("Drive Root", self.root)
            frappe.db.delete("Drive Node", self.root)
            frappe.db.commit()


BREAKDOWN_OWNER = "drive-breakdown-owner@example.com"
BREAKDOWN_OTHER = "drive-breakdown-other@example.com"
USAGE_KEYS = {"used_bytes", "reserved_bytes", "quota_bytes", "effective_quota"}


class TestRootBreakdown(IntegrationTestCase):
    """`usage_for(..., breakdown=True)`: what one root's Active bytes are made of."""

    def setUp(self):
        super().setUp()
        from suite.drive.tests.fixtures import drop_personal_root
        from suite.tests.utils import ensure_user

        for user in (BREAKDOWN_OWNER, BREAKDOWN_OTHER):
            ensure_user(user)
            drop_personal_root(user)
        self.owner = Principals(BREAKDOWN_OWNER, (BREAKDOWN_OWNER, "$GENERAL"), ("$PUBLIC",))
        self.other = Principals(BREAKDOWN_OTHER, (BREAKDOWN_OTHER, "$GENERAL"), ("$PUBLIC",))
        self.root = create_root(kind="Personal", title="Breakdown root", user=BREAKDOWN_OWNER).name
        self.other_root = create_root(kind="Personal", title="Other root", user=BREAKDOWN_OTHER).name

    def tearDown(self):
        frappe.db.rollback()
        super().tearDown()

    def node(self, title, size, *, kind="file", mime=None, root=None, state="Active", owner=None, **extra):
        """Insert one node straight into a root, then give it bytes and an owner.

        The size, mime, and state are written after the insert: a file node
        with a mime must name a blob, and a trashed node a trash stamp. These
        rows need neither to be counted or skipped.
        """
        root = root or self.root
        row = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": root,
                "root": root,
                "path": "",
                "kind": kind,
                "state": "Active",
                "size": 0,
                "is_template": 0,
                **extra,
            }
        ).insert(ignore_permissions=True, ignore_links=True)
        frappe.db.set_value(
            "Drive Node",
            row.name,
            {"size": size, "mime": mime, "state": state, "owner": owner or BREAKDOWN_OWNER},
            update_modified=False,
        )
        return row.name

    def test_without_the_expansion_the_answer_is_the_four_counters(self):
        self.node("a.pdf", 900, mime="application/pdf")
        self.assertEqual(set(usage_for(self.root, self.owner)), USAGE_KEYS)

    def test_an_empty_root_has_no_types_and_no_files(self):
        usage = usage_for(self.root, self.owner, breakdown=True)
        self.assertEqual(set(usage), USAGE_KEYS | {"by_type", "largest"})
        self.assertEqual((usage.by_type, usage.largest), ([], []))

    def test_active_bytes_group_by_mime_family_and_content_doctype(self):
        pdf = self.node("a.pdf", 900, mime="application/pdf")
        png = self.node("b.png", 300, mime="image/png", owner=BREAKDOWN_OTHER)
        jpeg = self.node("c.jpg", 200, mime="image/jpeg")
        deck = self.node(
            "Deck",
            50,
            kind="document",
            mime="frappe/slides",
            content_doctype="Presentation",
            content_docname="d1",
        )
        # None of these is listed: trash, a folder, a link, an empty file, another root.
        self.node("old.png", 5000, mime="image/png", state="Trashed")
        self.node("Folder", 0, kind="folder")
        self.node("Link", 0, kind="link", url="https://example.com")
        self.node("empty.txt", 0, mime="text/plain")
        self.node("theirs.pdf", 7000, mime="application/pdf", root=self.other_root, owner=BREAKDOWN_OTHER)

        usage = usage_for(self.root, self.owner, breakdown=True)

        self.assertEqual(
            usage.by_type,
            [
                {"type": "PDF", "bytes": 900},
                {"type": "Image", "bytes": 500},
                {"type": "Presentation", "bytes": 50},
            ],
        )
        self.assertEqual(
            usage.largest,
            [
                {
                    "node": pdf,
                    "title": "a.pdf",
                    "size": 900,
                    "mime": "application/pdf",
                    "kind": "file",
                    "type": "PDF",
                },
                {
                    "node": png,
                    "title": "b.png",
                    "size": 300,
                    "mime": "image/png",
                    "kind": "file",
                    "type": "Image",
                },
                {
                    "node": jpeg,
                    "title": "c.jpg",
                    "size": 200,
                    "mime": "image/jpeg",
                    "kind": "file",
                    "type": "Image",
                },
                {
                    "node": deck,
                    "title": "Deck",
                    "size": 50,
                    "mime": "frappe/slides",
                    "kind": "document",
                    "type": "Presentation",
                },
            ],
        )

    def test_the_largest_list_is_capped_but_the_totals_are_not(self):
        count = LARGEST_FILES + 2
        for index in range(count):
            self.node(f"f{index:02}.bin", 100 + index, mime="application/zip")

        usage = usage_for(self.root, self.owner, breakdown=True)

        self.assertEqual(len(usage.largest), LARGEST_FILES)
        self.assertEqual(
            [row["size"] for row in usage.largest],
            sorted((100 + index for index in range(count)), reverse=True)[:LARGEST_FILES],
        )
        self.assertEqual(usage.by_type, [{"type": "Archive", "bytes": sum(100 + i for i in range(count))}])

    def test_the_breakdown_keeps_the_totals_role_rule(self):
        self.node("a.pdf", 900, mime="application/pdf")
        admin = Principals("Administrator", ("Administrator",), ("$PUBLIC",), is_admin=True)
        self.assertEqual(usage_for(self.root, admin, breakdown=True).by_type, [{"type": "PDF", "bytes": 900}])
        with self.assertRaises(DriveNotFound):
            usage_for(self.root, self.other, breakdown=True)

    def test_a_manager_who_does_not_own_the_root_reads_totals_but_not_titles(self):
        from suite.drive._core.access import grant
        from suite.drive._core.roles import MANAGE

        self.node("secret.pdf", 900, mime="application/pdf")
        grant(self.root, BREAKDOWN_OTHER, MANAGE, self.owner)

        self.assertEqual(set(usage_for(self.root, self.other)), USAGE_KEYS)
        with self.assertRaises(DriveForbidden):
            usage_for(self.root, self.other, breakdown=True)

    def test_the_legacy_shim_answers_the_same_aggregates(self):
        from suite.drive.http import shims

        big = self.node("a.pdf", 900, mime="application/pdf", owner=BREAKDOWN_OTHER)
        self.node("b.png", 300, mime="image/png")
        usage = usage_for(self.root, self.owner, breakdown=True)

        with patch.object(shims, "_principals", return_value=self.owner):
            legacy = shims.storage_breakdown()

        # The legacy tab reads `mime_type` and maps it through its own mime table.
        self.assertEqual(
            legacy["total"],
            [
                {"mime_type": "application/pdf", "file_size": 900},
                {"mime_type": "image/png", "file_size": 300},
            ],
        )
        self.assertEqual([row["bytes"] for row in usage.by_type], [900, 300])
        self.assertEqual(
            legacy["entities"],
            [
                {
                    "name": row["node"],
                    "file_name": row["title"],
                    "file_size": row["size"],
                    "file_type": row["type"],
                }
                for row in usage.largest
            ],
        )
        # The file another user put in this root is charged here, so it is listed here.
        self.assertEqual(legacy["entities"][0]["name"], big)
