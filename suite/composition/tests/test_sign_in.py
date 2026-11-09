"""One-time sign-in links."""

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from suite.composition.sign_in import find_sign_in_user, sign_in_link, use_sign_in_key


def new_person() -> str:
    user = frappe.new_doc("User")
    user.email = f"sign-in-{uuid4().hex[:8]}@example.com"
    user.first_name = "Sign In Test"
    user.insert(ignore_permissions=True)
    return user.name


def key_of(link: str) -> str:
    return parse_qs(urlparse(link).query)["key"][0]


class TestSignInLink(IntegrationTestCase):
    def test_a_link_is_a_suite_address_and_signs_its_person_in_once(self):
        person = new_person()
        link = sign_in_link(person)

        self.assertEqual(urlparse(link).path, "/api/suite/account/sign-in")
        key = key_of(link)
        # Opening the link, as a link preview would, leaves the key for the person.
        self.assertEqual(find_sign_in_user(key), person)
        self.assertEqual(find_sign_in_user(key), person)
        self.assertEqual(use_sign_in_key(key), person)
        self.assertIsNone(use_sign_in_key(key))

    def test_a_link_stops_working_when_its_person_is_disabled(self):
        person = new_person()
        key = key_of(sign_in_link(person))
        frappe.db.set_value("User", person, "enabled", 0)

        self.assertIsNone(use_sign_in_key(key))

    def test_an_unknown_key_signs_nobody_in(self):
        self.assertIsNone(use_sign_in_key(""))
        self.assertIsNone(use_sign_in_key(frappe.generate_hash()))
