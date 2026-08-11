import unittest
from unittest.mock import patch

import frappe

from suite import hooks
from suite.tests.ci_smoke import SCHEDULER_SMOKE_METHOD, _scheduler_smoke_job_name


class TestSchedulerEvents(unittest.TestCase):
    def test_registered_methods_resolve(self):
        methods = []
        for event, entries in hooks.scheduler_events.items():
            if event == "cron":
                methods.extend(method for cron_entries in entries.values() for method in cron_entries)
            else:
                methods.extend(entries)

        for method in methods:
            with self.subTest(method=method):
                self.assertTrue(callable(frappe.get_attr(method)))

    def test_scheduler_smoke_requires_registered_job(self):
        with (
            patch("suite.tests.ci_smoke.frappe.db.get_value", return_value=None),
            self.assertRaisesRegex(RuntimeError, SCHEDULER_SMOKE_METHOD),
        ):
            _scheduler_smoke_job_name()
