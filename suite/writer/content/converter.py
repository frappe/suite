"""Writer's converter: the Node bundle that turns an old document into a collaborative one, and a run of it."""

import json
from pathlib import Path

from suite.content import convert

# The Node converter `bench build` makes
CONVERTER_BUILD = Path(__file__).with_name("dist") / "converter.cjs"
CONVERTER_VERSION = json.loads(Path(__file__).with_name("converter-version.json").read_text())["version"]


def run(legacy: dict) -> convert.Converted | convert.Refused:
    """Convert the old body `legacy` in a request, where a site without Node or the bundle is a fault."""
    answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)
    if answer is None:
        raise RuntimeError("the Writer converter needs Node and its built bundle")

    return answer
