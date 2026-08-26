import unittest
from unittest import mock

from suite.www import suite as www


class SuiteBoot(unittest.TestCase):
    def setUp(self):
        self.frappe = self.enterContext(mock.patch("suite.www.suite.frappe"))
        self.frappe.session.user = "alice@example.com"
        self.frappe.local.site = "test.localhost"
        self.frappe.get_system_settings.return_value = 0
        self.frappe.conf.get.side_effect = lambda key, default=None: default
        self.frappe.conf.developer_mode = 0
        self.frappe._dict.side_effect = lambda d: d

        self.get_onboarding_state = self.enterContext(
            mock.patch(
                "suite.www.suite.get_onboarding_state",
                return_value={"is_onboarded": True, "can_onboard": True},
            )
        )
        self.get_workspace = self.enterContext(
            mock.patch(
                "suite.www.suite.get_workspace",
                return_value={"workspace_name": "Acme", "workspace_logo": "/files/logo.png"},
            )
        )

    def test_logged_in_boot_shape(self):
        boot = www.get_boot()
        self.assertEqual(boot["suite_workspace_name"], "Acme")
        self.assertEqual(boot["suite_workspace_logo"], "/files/logo.png")
        self.assertEqual(boot["site_name"], "test.localhost")
        self.assertEqual(boot["socketio_port"], 9000)
        self.assertEqual(boot["push_relay_server_url"], "")
        self.assertIs(boot["disable_slides_service_worker"], False)

    def test_kill_switch_reaches_the_boot(self):
        self.frappe.conf.get.side_effect = lambda key, default=None: (
            1 if key == "disable_slides_service_worker" else default
        )
        self.assertIs(www.get_boot()["disable_slides_service_worker"], True)

    def test_guest_boot_is_redacted(self):
        self.frappe.session.user = "Guest"
        boot = www.get_boot()
        self.assertIs(boot["suite_is_onboarded"], False)
        self.assertIs(boot["suite_can_onboard"], False)
        self.assertEqual(boot["suite_workspace_name"], "")
        self.assertEqual(boot["suite_workspace_logo"], "")
        self.get_onboarding_state.assert_not_called()
        self.get_workspace.assert_not_called()
