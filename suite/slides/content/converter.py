"""Slides' converter bundle, run in a request: old deck JSON in, and a presentation's doc back out as it."""

from collections.abc import Sequence

from suite.content import checker, convert
from suite.slides.content import CONVERTER_BUILD, CONVERTER_VERSION

NEEDS_BUILD = "the Slides converter needs Node and its built bundle"


def run(legacy: dict) -> convert.Converted | convert.Refused:
    """Convert the old deck `legacy` in a request, where a site without Node or the bundle is a fault."""
    answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)
    if answer is None:
        raise RuntimeError(NEEDS_BUILD)

    return answer


def deck_json(checkpoint: bytes | None, rows: Sequence[bytes]) -> dict:
    """Answer the presentation a log's `checkpoint` and `rows` make as the old JSON the converter takes."""
    answer = checker.ask(CONVERTER_BUILD, {"deck": True}, checkpoint, rows, minimum=convert.NODE_MIN)
    if answer is None or "deck" not in answer:
        raise RuntimeError(NEEDS_BUILD)

    return answer["deck"]
