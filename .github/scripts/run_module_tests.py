"""Run one Suite product's test files from the bench's sites directory."""

import argparse
import multiprocessing
import os
from pathlib import Path

import frappe
from frappe.commands.testing import main
from merge_junit import merge_junit


def run_module(site: str, module: str, report: Path) -> None:
    fragments = report.with_name(f"{report.stem}-fragments.xml")
    with frappe.init_site(site):
        if not frappe.conf.allow_tests:
            raise RuntimeError(f"Tests are disabled on {site}")
        try:
            main(site=site, module=module, junit_xml_output=str(fragments))
        finally:
            merge_junit(fragments, report)
            fragments.unlink()


def run(product: str, site: str, workspace: Path) -> int:
    files = sorted((workspace / "suite" / product / "tests").glob("test_*.py"))
    if not files:
        raise ValueError(f"No test files for {product}")

    results = workspace / "test-results" / product
    results.mkdir(parents=True, exist_ok=True)
    context = multiprocessing.get_context("forkserver")
    context.set_forkserver_preload(["frappe", "frappe.commands.testing"])
    status = 0
    for path in files:
        module = ".".join(path.relative_to(workspace).with_suffix("").parts)
        print(f"::group::{module}", flush=True)
        try:
            process = context.Process(target=run_module, args=(site, module, results / f"{module}.xml"))
            process.start()
            process.join()
            if process.exitcode:
                status = 1
            process.close()
        finally:
            print("::endgroup::", flush=True)
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("product", choices=["mail", "calendar"])
    parser.add_argument("--site", default="test_site")
    args = parser.parse_args()
    raise SystemExit(run(args.product, args.site, Path(os.environ["GITHUB_WORKSPACE"])))
