import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


def load(name: str):
    path = Path(__file__).with_name(f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coverage_report = load("coverage_report")
update_pr_coverage = load("update_pr_coverage")


class CoverageReportTest(unittest.TestCase):
    def test_parses_cobertura_totals(self):
        with tempfile.NamedTemporaryFile() as report:
            report.write(
                b'<coverage lines-covered="8" lines-valid="10" branches-covered="3" branches-valid="4"/>'
            )
            report.flush()
            coverage = coverage_report.parse_coverage(report.name)

        self.assertEqual((coverage.covered, coverage.total), (8, 10))
        self.assertEqual((coverage.branches_covered, coverage.branches_total), (3, 4))

    def test_rejects_entity_declarations(self):
        with tempfile.NamedTemporaryFile() as report:
            report.write(b'<!DOCTYPE coverage [<!ENTITY x "x">]><coverage/>')
            report.flush()
            self.assertIsNone(coverage_report.parse_coverage(report.name))

    def test_renders_delta_in_collapsed_section(self):
        current = coverage_report.Coverage(85, 100, 70, 100)
        baseline = coverage_report.Coverage(80, 100, 72, 100)

        markdown = coverage_report.render(
            current,
            current,
            baseline,
            baseline,
            "develop",
            "https://example.test/run",
            "abcdef123456",
        )

        self.assertIn("<details>", markdown)
        self.assertIn("Backend 85.0% (+5.0%)", markdown)
        self.assertIn("**70.0%** (70 / 100) (-2.0%)", markdown)


class UpdatePrCoverageTest(unittest.TestCase):
    def test_appends_and_replaces_one_block(self):
        first = update_pr_coverage.replace_coverage("Human description\n", "## Test coverage\n10%")
        second = update_pr_coverage.replace_coverage(first, "## Test coverage\n20%")

        self.assertIn("Human description", second)
        self.assertNotIn("10%", second)
        self.assertEqual(second.count(update_pr_coverage.START), 1)
        self.assertIn("20%", second)


if __name__ == "__main__":
    unittest.main()
