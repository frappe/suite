import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.api.storage import (
    MEGA_BYTE,
    create_storage_reservation,
    get_storage_reservation,
    get_storage_usage,
    grow_storage_reservation,
    reduce_storage_reservation,
    release_storage_reservation,
)
from suite.tests.utils import ensure_user

OWNER = "storage-reservation-owner@example.com"
OTHER_OWNER = "storage-reservation-other@example.com"


class TestStorageReservations(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_OWNER)

    def setUp(self):
        frappe.db.delete("Drive Storage Reservation", {"storage_owner": ["in", [OWNER, OTHER_OWNER]]})
        frappe.db.set_value("Drive Settings", OWNER, "quota", 1, update_modified=False)

    def test_usage_always_includes_explicit_reserved_size(self):
        usage = get_storage_usage(OWNER)
        self.assertEqual(usage["reserved_size"], 0)

        create_storage_reservation(OWNER, "usage", 1234)

        usage = get_storage_usage(OWNER)
        self.assertEqual(usage["reserved_size"], 1234)
        self.assertEqual(usage["total_size"], 1234)

    def test_reservations_are_not_mutable_through_generic_doctype_permissions(self):
        permission = next(
            permission
            for permission in frappe.get_meta("Drive Storage Reservation").permissions
            if permission.role == "System Manager"
        )
        self.assertTrue(permission.read)
        self.assertFalse(permission.create)
        self.assertFalse(permission.write)
        self.assertFalse(permission.delete)

    def test_exact_create_retry_is_idempotent(self):
        created = create_storage_reservation(OWNER, "create-retry", 100)
        retried = create_storage_reservation(OWNER, "create-retry", 100)

        self.assertEqual(retried.name, created.name)
        self.assertEqual(frappe.db.count("Drive Storage Reservation", {"name": "create-retry"}), 1)

    def test_create_rejects_owner_and_amount_conflicts(self):
        create_storage_reservation(OWNER, "create-conflict", 100)

        with self.assertRaisesRegex(ValueError, "different amount"):
            create_storage_reservation(OWNER, "create-conflict", 101)
        with self.assertRaisesRegex(ValueError, "different owner"):
            create_storage_reservation(OTHER_OWNER, "create-conflict", 100)

    def test_growth_validates_only_the_delta_and_is_idempotent(self):
        create_storage_reservation(OWNER, "grow", MEGA_BYTE - 100)

        grown = grow_storage_reservation(OWNER, "grow", MEGA_BYTE)
        retried = grow_storage_reservation(OWNER, "grow", MEGA_BYTE)

        self.assertEqual(grown.reserved_bytes, MEGA_BYTE)
        self.assertEqual(retried.reserved_bytes, MEGA_BYTE)

    def test_growth_rejects_quota_overage_and_decrease(self):
        create_storage_reservation(OWNER, "grow-reject", MEGA_BYTE)

        with self.assertRaisesRegex(ValueError, "out of storage"):
            grow_storage_reservation(OWNER, "grow-reject", MEGA_BYTE + 1)
        with self.assertRaisesRegex(ValueError, "only grow"):
            grow_storage_reservation(OWNER, "grow-reject", MEGA_BYTE - 1)

        self.assertEqual(get_storage_reservation("grow-reject").reserved_bytes, MEGA_BYTE)

    def test_reduce_only_decreases(self):
        create_storage_reservation(OWNER, "reduce", 100)

        self.assertEqual(reduce_storage_reservation(OWNER, "reduce", 40).reserved_bytes, 40)
        self.assertEqual(reduce_storage_reservation(OWNER, "reduce", 40).reserved_bytes, 40)
        with self.assertRaisesRegex(ValueError, "only reduce"):
            reduce_storage_reservation(OWNER, "reduce", 41)

    def test_release_is_idempotent_and_checks_owner(self):
        release_storage_reservation(OWNER, "missing")
        create_storage_reservation(OWNER, "release", 100)

        with self.assertRaisesRegex(ValueError, "different owner"):
            release_storage_reservation(OTHER_OWNER, "release")
        release_storage_reservation(OWNER, "release")
        release_storage_reservation(OWNER, "release")

        self.assertIsNone(get_storage_reservation("release"))

    def test_amounts_must_be_nonnegative_integers(self):
        for value in (True, -1, 1.5, "1"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "nonnegative integer"):
                create_storage_reservation(OWNER, f"invalid-{value}", value)
