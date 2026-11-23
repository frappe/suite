"""The Suite resource names belong to the Suite table (spec §4.2)."""

import unittest

from suite.api.admin_lifecycle import ROUTES as LIFECYCLE_ROUTES
from suite.api.admin_storage import ROUTES as STORAGE_ROUTES
from suite.api.admin_transfer import ROUTES as TRANSFER_ROUTES
from suite.api.routes import ROUTES as SUITE_ROUTES
from suite.composition.registrations import (
    HTTP_OWNERS,
    SUITE_RESOURCES,
    SUITE_TABLE,
    check_suite_resources,
)


class TestSuiteResourceNames(unittest.TestCase):
    def test_every_suite_resource_reaches_the_suite_table(self):
        for name in SUITE_RESOURCES:
            with self.subTest(name=name):
                self.assertEqual(HTTP_OWNERS[name], SUITE_TABLE)

    def test_a_product_owner_cannot_take_a_suite_resource_name(self):
        for name in SUITE_RESOURCES:
            with self.subTest(name=name):
                owners = {**HTTP_OWNERS, name: "suite.drive.framework.HTTP"}
                with self.assertRaises(ValueError):
                    check_suite_resources(owners)

    def test_a_table_without_a_suite_resource_is_refused(self):
        for name in SUITE_RESOURCES:
            with self.subTest(name=name):
                owners = {key: value for key, value in HTTP_OWNERS.items() if key != name}
                with self.assertRaises(ValueError):
                    check_suite_resources(owners)

    def test_every_suite_table_route_is_dispatchable(self):
        """A route whose first path segment no owner claims 404s forever.

        The admin/health route shipped like that once: the Suite table knew it,
        the dispatcher did not, and every Overview load reported failed checks
        that no browser refresh could ever fix.
        """

        for routes in (SUITE_ROUTES, LIFECYCLE_ROUTES, STORAGE_ROUTES, TRANSFER_ROUTES):
            for route in routes:
                first = route.path.split("/", 1)[0]
                with self.subTest(path=route.path):
                    self.assertIn(first, HTTP_OWNERS)
                    self.assertEqual(HTTP_OWNERS[first], SUITE_TABLE)
