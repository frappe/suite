import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from merge_junit import merge_junit


class TestMergeJunit(unittest.TestCase):
    def test_merges_concatenated_test_suites(self):
        fragments = b"""\
<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="unit" tests="1"><testcase name="one" /></testsuite>
<?xml version="1.0" encoding="UTF-8"?>
<testsuites><testsuite name="integration" tests="1"><testcase name="two" /></testsuite></testsuites>
"""
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory, "fragments.xml")
            output_path = Path(directory, "junit.xml")
            input_path.write_bytes(fragments)

            merge_junit(input_path, output_path)

            root = ET.parse(output_path).getroot()
            self.assertEqual(root.tag, "testsuites")
            self.assertEqual([suite.attrib["name"] for suite in root], ["unit", "integration"])


if __name__ == "__main__":
    unittest.main()
