"""Writer's converter: the Node bundle that turns an old document into a collaborative one, and a run of it."""

import json
from collections.abc import Sequence
from pathlib import Path

from suite.content import checker, convert

# The Node converter `bench build` makes
CONVERTER_BUILD = Path(__file__).with_name("dist") / "converter.cjs"
CONVERTER_VERSION = json.loads(Path(__file__).with_name("converter-version.json").read_text())["version"]
NEEDS_BUILD = "the Writer converter needs Node and its built bundle"


def run(legacy: dict) -> convert.Converted | convert.Refused:
    """Convert the old body `legacy` in a request, where a site without Node or the bundle is a fault."""
    answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)
    if answer is None:
        raise RuntimeError(NEEDS_BUILD)

    return answer


def markdown_of(checkpoint: bytes | None, rows: Sequence[bytes]) -> str:
    """Answer the document a log's `checkpoint` and `rows` make as Markdown, as the browser's download writes it."""
    answer = checker.ask(CONVERTER_BUILD, {"markdown": True}, checkpoint, rows, minimum=convert.NODE_MIN)
    if answer is None or "markdown" not in answer:
        raise RuntimeError(NEEDS_BUILD)

    return answer["markdown"]
