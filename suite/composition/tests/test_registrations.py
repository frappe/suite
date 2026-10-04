"""The Suite resource names belong to the Suite table (spec §4.2)."""

import unittest

from suite.composition.registrations import (
    HTTP_OWNERS,
    SUITE_TABLE,
    check_suite_resources,
)


class TestSuiteResourceNames(unittest.TestCase):
    def test_every_suite_resource_reaches_the_suite_table(self):
        for name in ("account", "site", "users", "invitations", "people"):
            with self.subTest(name=name):
                self.assertEqual(HTTP_OWNERS[name], SUITE_TABLE)

    def test_a_product_owner_cannot_take_a_suite_resource_name(self):
        for name in ("account", "site", "users", "invitations", "people"):
            with self.subTest(name=name):
                owners = {**HTTP_OWNERS, name: "suite.drive.framework.HTTP"}
                with self.assertRaises(ValueError):
                    check_suite_resources(owners)

    def test_a_table_without_a_suite_resource_is_refused(self):
        owners = {key: value for key, value in HTTP_OWNERS.items() if key != "people"}
        with self.assertRaises(ValueError):
            check_suite_resources(owners)
