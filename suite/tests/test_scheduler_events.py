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

    def test_exactly_five_drive_daily_jobs_are_wired(self):
        """§2.2: `suite/drive/jobs.py` is the sole scheduler adapter.

        The legacy File-status sweeps in `suite.drive.api.scripts` are
        superseded by `jobs.purge_trashed_nodes` and must not be scheduled.
        """
        from suite.drive import jobs

        drive_package = jobs.__name__.rsplit(".", 1)[0] + "."
        daily_drive_jobs = [
            method for method in hooks.scheduler_events["daily"] if method.startswith(drive_package)
        ]
        expected_targets = {
            name
            for name, value in vars(jobs).items()
            if callable(value) and getattr(value, "__module__", None) == jobs.__name__
        }
        self.assertEqual(len(daily_drive_jobs), 5)
        for method in daily_drive_jobs:
            module_name, _, attr = method.rpartition(".")
            with self.subTest(method=method):
                self.assertEqual(module_name, jobs.__name__)
                self.assertIn(attr, expected_targets)
        self.assertEqual({method.rpartition(".")[2] for method in daily_drive_jobs}, expected_targets)
