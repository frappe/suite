import frappe
from frappe.tests import UnitTestCase
from unittest.mock import patch

from suite.api.framework import HTTP
from suite.api import routes
from suite.composition.tests.http_conformance import HttpConformanceMixin


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestHandlers(UnitTestCase):
    @patch.object(routes.account, "get_logged_in_user")
    def test_account_reduces_roles_to_the_shell_capability(self, get_user):
        get_user.return_value = {
            "name": "alice@example.com",
            "email": "alice@example.com",
            "full_name": "Alice",
            "avatar": None,
            "roles": ["System Manager", "Suite User"],
            "is_jmap_configured": True,
        }
        result = routes.account_get()
        self.assertEqual(result["roles"], {"system_manager": True})
        self.assertTrue(result["is_jmap_configured"])

    @patch.object(
        routes.account,
        "get_workspace",
        return_value={"workspace_name": "Acme", "workspace_logo": ""},
    )
    @patch.object(
        routes.account,
        "get_onboarding_state",
        return_value={"is_onboarded": True, "can_onboard": True},
    )
    def test_site_get_composes_existing_workflows(self, _state, _workspace):
        self.assertEqual(routes.site_get()["workspace_name"], "Acme")
