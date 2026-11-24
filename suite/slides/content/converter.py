"""Slides' converter bundle, run in a request."""

from suite.content import convert
from suite.slides.content import CONVERTER_BUILD, CONVERTER_VERSION

NEEDS_BUILD = "the Slides converter needs Node and its built bundle"


def run(legacy: dict) -> convert.Converted | convert.Refused:
    """Convert the old deck `legacy` in a request, where a site without Node or the bundle is a fault."""
    answer = convert.convert(CONVERTER_BUILD, CONVERTER_VERSION, legacy)
    if answer is None:
        raise RuntimeError(NEEDS_BUILD)

    return answer
