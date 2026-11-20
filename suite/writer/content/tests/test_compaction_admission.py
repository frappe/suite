import io
import os
import resource
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import frappe
from frappe.utils.background_jobs import get_redis_conn
from rq.job import Job

from suite.content import admission
from suite.writer.content.tests.compaction_case import CompactionCase


class TestCompactionAdmission(CompactionCase):
    def test_with_every_place_taken_a_compaction_waits_without_counting_a_failure(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        redis = get_redis_conn()
        for index in range(admission.PLACES):
            redis.set(f"{admission.KEY_PREFIX}compaction:{index}", "elsewhere", ex=60)

        self.addCleanup(self.release_places)

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual((self.checkpoints_of(node), doc.compaction_failures), ([], 0))
        self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())

    def test_a_large_state_paces_the_next_compaction(self):
        node = self.new_document()
        filler = os.urandom(300 * 1024).hex()
        self.type_into(node, [filler[: len(filler) // 2], filler[len(filler) // 2 :]])

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(doc.body_rev, 2)
        wait = (doc.next_compaction_at - frappe.utils.now_datetime()).total_seconds()
        self.assertGreater(wait, 50)

    def test_one_document_compacts_in_one_job_at_a_time(self):
        self.addCleanup(self.release_places)
        first = admission.take_place("writer", "doc-a")

        self.assertIsNone(admission.take_place("writer", "doc-a"))
        self.assertIsNotNone(admission.take_place("writer", "doc-b"))
        admission.free_place(first)
        self.assertIsNotNone(admission.take_place("writer", "doc-a"))

    def test_a_place_held_by_a_live_job_does_not_block_a_test(self):
        redis = get_redis_conn()
        live_place = "suite:collab:compaction:0"
        redis.set(live_place, "a-live-job", nx=True, ex=5)
        self.addCleanup(redis.eval, admission.RELEASE_SCRIPT, 1, live_place, "a-live-job")
        self.addCleanup(self.release_places)

        self.assertIsNotNone(admission.take_place("writer", "doc-a"))
        self.assertIsNotNone(admission.take_place("writer", "doc-b"))

    def test_a_job_that_outlived_its_lease_frees_nothing_of_the_next(self):
        self.addCleanup(self.release_places)
        stale = admission.take_place("writer", "doc-a")
        # The lease ran out
        self.release_places()
        current = admission.take_place("writer", "doc-a")

        admission.free_place(stale)

        self.assertIsNone(admission.take_place("writer", "doc-a"))
        admission.free_place(current)
        self.assertIsNotNone(admission.take_place("writer", "doc-a"))

    def test_a_host_short_of_memory_keeps_every_row_and_retries_later(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        cgroup = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, cgroup)
        one_gib = 2**30
        with open(f"{cgroup}/memory.max", "w") as limit_file:
            limit_file.write(f"{one_gib}\n")

        # Two places at 240 MB each on top of what the container already holds must leave a fifth free
        for anon, compacts in ((400 * 2**20, False), (200 * 2**20, True)):
            with open(f"{cgroup}/memory.stat", "w") as stat_file:
                stat_file.write(f"file 999\nanon {anon}\n")

            self.set_doc(node, next_compaction_at=None)
            with patch.object(admission, "CGROUP", cgroup):
                self.compact(node)

            doc = self.doc_row(node)
            self.assertEqual(doc.body_rev == 1, compacts)
            if not compacts:
                self.assertEqual(
                    (doc.last_compaction_error, self.row_count(node)), ("insufficient_memory", 1)
                )
                self.assertGreater(doc.next_compaction_at, frappe.utils.now_datetime())

    def test_a_job_on_a_worker_thread_leaves_the_process_address_space_alone(self):
        job = Job.create(admission.limit_memory, connection=get_redis_conn())
        size_kb = 2**30
        status = io.StringIO(f"VmSize:\t{size_kb} kB\n")

        # As frappe's runner runs jobs: on a thread of the site process
        with (
            patch.object(admission, "open", create=True, return_value=status),
            patch.object(resource, "setrlimit") as setrlimit,
            ThreadPoolExecutor(1) as worker,
        ):
            worker.submit(job.perform).result()

        setrlimit.assert_not_called()

    def test_a_job_in_a_horse_forked_for_it_caps_its_address_space(self):
        job = Job.create(admission.limit_memory, connection=get_redis_conn())
        size_kb = 2**30
        status = io.StringIO(f"VmSize:\t{size_kb} kB\n")

        # As RQ leaves the horse it forked for a job
        with (
            patch.dict(os.environ, RQ_JOB_ID=job.id),
            patch.object(admission, "open", create=True, return_value=status),
            patch.object(resource, "setrlimit") as setrlimit,
        ):
            job.perform()

        setrlimit.assert_called_once_with(
            resource.RLIMIT_AS, (size_kb * 1024 + admission.PER_COMPACTION, resource.RLIM_INFINITY)
        )

    def test_a_job_under_another_jobs_horse_id_leaves_the_process_address_space_alone(self):
        job = Job.create(admission.limit_memory, connection=get_redis_conn())
        size_kb = 2**30
        status = io.StringIO(f"VmSize:\t{size_kb} kB\n")

        # RQ sets RQ_JOB_ID in the forking worker too, so a process can carry the id of a horse it forked earlier
        with (
            patch.dict(os.environ, RQ_JOB_ID="an-earlier-job"),
            patch.object(admission, "open", create=True, return_value=status),
            patch.object(resource, "setrlimit") as setrlimit,
            ThreadPoolExecutor(1) as worker,
        ):
            worker.submit(job.perform).result()

        setrlimit.assert_not_called()

    def test_outside_a_job_leaves_the_process_address_space_alone(self):
        size_kb = 2**30
        status = io.StringIO(f"VmSize:\t{size_kb} kB\n")

        # As a web request runs it, with no RQ job but a horse's id left in the environment
        with (
            patch.dict(os.environ, RQ_JOB_ID="an-earlier-job"),
            patch.object(admission, "open", create=True, return_value=status),
            patch.object(resource, "setrlimit") as setrlimit,
        ):
            admission.limit_memory()

        setrlimit.assert_not_called()
