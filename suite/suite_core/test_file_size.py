import frappe
from frappe.core.api.file import get_max_file_size
from frappe.core.doctype.system_settings.system_settings import clear_system_settings_cache
from frappe.tests import IntegrationTestCase

from suite.suite_core.patches.set_default_max_file_size import execute

GIGABYTE = 1024 * 1024 * 1024


class DefaultMaxFileSize(IntegrationTestCase):
    """The install hook and the patch give a site 1 GB files, unless it chose a limit."""

    def setUp(self):
        self.saved_setting = frappe.db.get_single_value("System Settings", "max_file_size")
        self.saved_config = frappe.conf.get("max_file_size")
        frappe.conf.pop("max_file_size", None)

    def tearDown(self):
        self.set_setting(self.saved_setting)
        if self.saved_config is None:
            frappe.conf.pop("max_file_size", None)
        else:
            frappe.conf["max_file_size"] = self.saved_config

    def set_setting(self, megabytes):
        frappe.db.set_single_value("System Settings", "max_file_size", megabytes)
        clear_system_settings_cache()

    def stored_setting(self):
        return frappe.db.get_single_value("System Settings", "max_file_size", cache=False)

    def test_an_unset_site_gets_one_gigabyte(self):
        self.set_setting(0)
        execute()
        self.assertEqual(self.stored_setting(), 1024)
        self.assertEqual(get_max_file_size(), GIGABYTE)

    def test_an_admin_value_stays_whether_larger_or_smaller(self):
        for megabytes in (5, 4096):
            with self.subTest(megabytes=megabytes):
                self.set_setting(megabytes)
                execute()
                self.assertEqual(self.stored_setting(), megabytes)
                self.assertEqual(get_max_file_size(), megabytes * 1024 * 1024)

    def test_a_site_config_value_stays(self):
        self.set_setting(0)
        frappe.conf["max_file_size"] = 10 * 1024 * 1024
        execute()
        self.assertEqual(self.stored_setting(), 0)
        self.assertEqual(get_max_file_size(), 10 * 1024 * 1024)

    def test_running_again_changes_nothing(self):
        self.set_setting(0)
        execute()
        execute()
        self.assertEqual(self.stored_setting(), 1024)
        self.assertEqual(get_max_file_size(), GIGABYTE)
