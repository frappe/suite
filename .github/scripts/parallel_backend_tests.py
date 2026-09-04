#!/usr/bin/env python3
"""Run Suite backend tests on one frappe parallel-runner shard.

Mirrors frappe's own CI helper (apps/frappe/.github/helper/ci.py) with three
suite-specific additions:

- discovery prunes dot-directories, which the stock ParallelTestRunner walker
  misses: it would import .github/scripts/test_*.py as frappe tests while
  `bench run-tests` skips them, so this keeps the shard test set identical to
  the non-parallel run
- junit XML documents are appended per test file, in the exact format
  `.github/scripts/merge_junit.py` already consumes
- each shard writes its own coverage data file plus a `.coveragerc` carrying
  frappe's omit list, so the `backend-coverage` job can combine shards on a
  machine that has no bench (via the [paths] alias back to the checkout)

Runs inside the bench env from the sites directory:

    cd sites && ../env/bin/python ../apps/suite/.github/scripts/parallel_backend_tests.py

Environment:
    BUILD_NUMBER / TOTAL_BUILDS  shard coordinates (required)
    SITE / APP                   defaults: test_site / suite
    CAPTURE_COVERAGE             "false" to skip coverage (default: true)
    COVERAGE_RCFILE              picked up by coverage.py (branch = true etc.)
    COVERAGE_DATA_FILE           where this shard's coverage data is written
    JUNIT_OUTPUT                 junit fragments path; plain console output if unset
    DRY_RUN                      any value: list the shard's test files and exit
"""

import faulthandler
import json
import os
import signal
import sys
import unittest
import warnings

with_coverage = json.loads(os.environ.get("CAPTURE_COVERAGE", "true").lower())
build_number = int(os.environ["BUILD_NUMBER"])
total_builds = int(os.environ["TOTAL_BUILDS"])
app = os.environ.get("APP", "suite")
site = os.environ.get("SITE", "test_site")
junit_output = os.environ.get("JUNIT_OUTPUT")
coverage_data_file = os.environ.get("COVERAGE_DATA_FILE")

bench_dir = os.path.dirname(os.getcwd())  # expected cwd: <bench>/sites

coverage = None
junit_stream = None

if with_coverage:
    # started before importing frappe so import-time lines are measured
    from coverage import Coverage

    coverage = Coverage(
        source=[os.path.join(bench_dir, "apps", app)],
        data_file=coverage_data_file,
    )
    coverage.start()

import click
import frappe
import frappe.parallel_test_runner as parallel_runner

warnings.simplefilter("ignore")


def pruned_get_all_tests(app):
    """parallel_runner.get_all_tests, but skipping dot-directories like the
    `bench run-tests` discovery does."""
    test_file_list = []
    for path, folders, files in os.walk(frappe.get_app_path(app)):
        folders[:] = [f for f in folders if not f.startswith(".")]
        for dontwalk in ("node_modules", "locals", "public", "__pycache__"):
            if dontwalk in folders:
                folders.remove(dontwalk)
        folders.sort()
        files.sort()
        if os.path.sep.join(["doctype", "doctype", "boilerplate"]) in path:
            continue
        test_file_list.extend(
            [path, filename]
            for filename in files
            if filename.startswith("test_") and filename.endswith(".py") and filename != "test_runner.py"
        )
    return test_file_list


parallel_runner.get_all_tests = pruned_get_all_tests


class SuiteParallelTestRunner(parallel_runner.ParallelTestRunner):
    """ParallelTestRunner that appends one junit XML document per test file and
    aggregates the results of the whole shard."""

    def run_tests(self):
        self.results = []
        global junit_stream
        if junit_output:
            import xmlrunner

            junit_stream = open(junit_output, "wb")
            runner = xmlrunner.XMLTestRunner(output=junit_stream, stream=sys.stderr, verbosity=2)
        else:
            runner = unittest.TextTestRunner(stream=sys.stderr, verbosity=2)

        frappe.set_user("Administrator")

        for file_info in self.test_file_list:
            if not file_info:
                continue
            if self.dry_run:
                print("running tests from", "/".join(file_info))
                continue
            path, filename = file_info
            module = self.get_module(path, filename)
            if not self.lightmode:
                from frappe.deprecation_dumpster import compat_preload_test_records_upfront

                compat_preload_test_records_upfront([(module, path, filename)])
            suite = unittest.TestSuite()
            suite.addTest(unittest.TestLoader().loadTestsFromModule(module))
            self.results.append(runner.run(suite))

    def print_result(self):
        # hang guard after completion, mirrors the upstream runner
        signal.alarm(60)
        faulthandler.register(signal.SIGALRM)

        for result in self.results:
            result.printErrors()
            click.echo(result)
        if any(not result.wasSuccessful() for result in self.results):
            sys.exit(1)


def write_report_rcfile():
    """Emit the coverage config the wrap-up job needs to merge shards on a
    machine without bench: [paths] aliases the bench app path back to the
    checkout, [report] omits the same files frappe's coverage omits."""
    from frappe.coverage import STANDARD_EXCLUSIONS

    omit = "\n".join(f"    {pattern}" for pattern in STANDARD_EXCLUSIONS)
    with open(os.path.join(os.getcwd(), ".coveragerc"), "w") as f:
        f.write(f"[paths]\nsource =\n    .\n    */apps/{app}\n\n[report]\nomit =\n{omit}\n")


try:
    runner = SuiteParallelTestRunner(
        app,
        site=site,
        build_number=build_number,
        total_builds=total_builds,
        dry_run=bool(os.environ.get("DRY_RUN")),
    )
    runner.setup_and_run()
finally:
    if coverage:
        coverage.stop()
        coverage.save()
        write_report_rcfile()
    if junit_stream:
        junit_stream.close()
