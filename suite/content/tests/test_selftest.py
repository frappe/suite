import json
import os
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils.background_jobs import get_redis_conn
from rq.job import Job

from suite.content import checker, compaction, selftest
from suite.tests.utils import ensure_user


class TestCollabSelfTest(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        # The self-test commits its record, so the site's own last result is put back afterwards
        fields = ("self_test_at", "self_test_passed", "self_test_report")
        previous_settings: dict[str, object] = {}
        for field in fields:
            previous_settings[field] = frappe.db.get_single_value("Suite Collab Settings", field)

        self.addCleanup(self.restore, previous_settings)

    def restore(self, previous_settings: dict):
        frappe.db.set_single_value("Suite Collab Settings", previous_settings)
        frappe.db.commit()

    def recorded(self) -> tuple[int, dict]:
        settings = frappe.get_single("Suite Collab Settings")
        return settings.self_test_passed, json.loads(settings.self_test_report)

    def test_a_passing_run_records_the_compaction_and_the_platform_facts(self):
        selftest.self_test()

        passed, report = self.recorded()
        self.assertEqual(passed, 1)
        self.assertEqual((report["pycrdt"], report["compaction"]), ("0.14.8", "pass"))
        database = report["database"]
        self.assertEqual(set(database), set(selftest.DATABASE_VARIABLES))
        self.assertNotIn("absent", (database["innodb_flush_log_at_trx_commit"], database["version"]))
        self.assertTrue({database["tx_isolation"], database["transaction_isolation"]} - {"absent"})
        self.assertIn("node", report)

    def test_a_host_without_a_usable_node_is_recorded(self):
        with patch.object(checker, "usable_node", return_value=None):
            selftest.self_test()

        _passed, report = self.recorded()
        self.assertIs(report["node_checks"], False)

    def test_a_job_run_in_the_site_process_is_recorded_as_not_forked(self):
        job = Job.create(selftest.self_test, connection=get_redis_conn())

        # As Pilot's lite runner runs jobs: no fork, no no-fork switch, a horse's id left in the environment
        with patch.dict(os.environ, RQ_JOB_ID="an-earlier-job"):
            os.environ.pop("FRAPPE_BACKGROUND_WORKERS_NOFORK", None)
            job.perform()

        _passed, report = self.recorded()
        self.assertIs(report["nofork"], True)

    def test_a_job_in_a_horse_forked_for_it_is_recorded_as_forked(self):
        job = Job.create(selftest.self_test, connection=get_redis_conn())

        with patch.dict(os.environ, RQ_JOB_ID=job.id):
            job.perform()

        _passed, report = self.recorded()
        self.assertIs(report["nofork"], False)

    def test_another_pycrdt_version_fails_the_run(self):
        with patch.object(pycrdt, "__version__", "0.15.0"):
            selftest.self_test()

        passed, report = self.recorded()
        self.assertEqual((passed, report["pycrdt"], report["compaction"]), (0, "0.15.0", "kernel_version"))

    def test_a_compaction_that_loses_a_change_fails_the_run(self):
        real_compact = compaction.compact

        def drops_the_last_row(checkpoint, rows, part_map):
            return real_compact(checkpoint, rows[:-1], part_map)

        with patch.object(compaction, "compact", drops_the_last_row):
            selftest.self_test()

        passed, report = self.recorded()
        self.assertEqual((passed, report["compaction"]), (0, "content_mismatch"))

    def test_only_a_system_manager_can_start_it(self):
        ensure_user("collab-self-test-outsider@example.com")
        frappe.set_user("collab-self-test-outsider@example.com")
        self.addCleanup(frappe.set_user, "Administrator")
        with patch.object(frappe, "enqueue") as enqueue, self.assertRaises(frappe.PermissionError):
            selftest.run_self_test()

        enqueue.assert_not_called()

        frappe.set_user("Administrator")
        with patch.object(frappe, "enqueue") as enqueue:
            selftest.run_self_test()

        self.assertEqual(enqueue.call_args.args, ("suite.content.selftest.self_test",))
