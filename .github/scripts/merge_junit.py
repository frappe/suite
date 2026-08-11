#!/usr/bin/env python3

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


def merge_junit(input_path: Path, output_path: Path) -> None:
    contents = input_path.read_bytes()
    contents = re.sub(rb"<\?xml[^?]*\?>", b"", contents)
    fragments = ET.fromstring(b"<fragments>" + contents + b"</fragments>")

    merged = ET.Element("testsuites")
    for fragment in fragments:
        if fragment.tag == "testsuite":
            merged.append(fragment)
        elif fragment.tag == "testsuites":
            merged.extend(fragment)
        else:
            raise ValueError(f"Unexpected JUnit root element: {fragment.tag}")

    ET.indent(merged)
    ET.ElementTree(merged).write(output_path, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge concatenated JUnit XML documents")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    merge_junit(args.input, args.output)
