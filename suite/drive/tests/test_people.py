from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.people import people, person
from suite.tests.utils import ensure_user

KNOWN = "drive-people-known@example.com"
STRANGER = "drive-people-nobody@example.com"


class TestPeople(IntegrationTestCase):
    """One lookup publishes every user a response names, and never fails on a missing one."""

    def setUp(self):
        super().setUp()
        ensure_user(KNOWN)
        frappe.db.set_value("User", KNOWN, {"full_name": "Known Person", "user_image": "/files/known.png"})

    def test_one_query_answers_every_distinct_id_and_a_stranger_falls_back_to_their_id(self):
        with patch.object(frappe, "get_all", wraps=frappe.get_all) as lookup:
            answer = people([KNOWN, None, KNOWN, STRANGER, ""])
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(
            answer,
            {
                KNOWN: {"id": KNOWN, "full_name": "Known Person", "user_image": "/files/known.png"},
                STRANGER: {"id": STRANGER, "full_name": STRANGER, "user_image": None},
            },
        )

    def test_no_ids_means_no_query(self):
        with patch.object(frappe, "get_all", wraps=frappe.get_all) as lookup:
            self.assertEqual(people([None, ""]), {})
        lookup.assert_not_called()

    def test_a_blank_name_or_image_is_the_id_and_null(self):
        self.assertEqual(
            person("x@example.com", "", ""),
            {"id": "x@example.com", "full_name": "x@example.com", "user_image": None},
        )
