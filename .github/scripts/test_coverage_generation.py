"""Exercise Python coverage with the config used by the bench test runner."""

import os
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / ".coveragerc"


class CoverageGenerationTest(unittest.TestCase):
    def test_reports_unexecuted_production_code_without_counting_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "suite"
            source.mkdir()
            (source / "workflow.py").write_text(
                "def label(allowed):\n    if allowed:\n        return 'yes'\n    return 'no'\n"
            )
            (source / "unused.py").write_text("value = 1\n")
            (source / "test_document.py").write_text(
                "from workflow import label\nassert label(True) == 'yes'\n"
            )
            tests = source / "tests"
            tests.mkdir()
            (tests / "__init__.py").touch()
            (tests / "fixtures.py").write_text("fixture = 1\n")
            environment = {
                **os.environ,
                "COVERAGE_RCFILE": str(CONFIG),
                "COVERAGE_FILE": str(root / ".coverage"),
            }

            # Frappe passes an explicit run-time omit list. Report exclusions
            # must still apply even when run-time exclusions are overridden.
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "coverage",
                    "run",
                    f"--source={source}",
                    "--omit=*/vendor/*",
                    str(source / "test_document.py"),
                ],
                cwd=root,
                env=environment,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                [sys.executable, "-m", "coverage", "xml"],
                cwd=root,
                env=environment,
                capture_output=True,
                check=True,
            )
            report = ET.parse(root / "coverage.xml").getroot()

        files = {entry.attrib["filename"]: entry for entry in report.findall(".//class")}
        self.assertEqual(set(files), {"suite/workflow.py", "suite/unused.py"})
        self.assertEqual(int(report.attrib["lines-valid"]), 5)
        self.assertEqual(int(report.attrib["lines-covered"]), 3)
        self.assertEqual(int(report.attrib["branches-valid"]), 2)
        self.assertEqual(int(report.attrib["branches-covered"]), 1)
        self.assertTrue(
            all(line.attrib["hits"] == "0" for line in files["suite/unused.py"].findall("./lines/line"))
        )


if __name__ == "__main__":
    unittest.main()
