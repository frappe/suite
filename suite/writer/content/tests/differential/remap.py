"""Compact each history from `remap.cjs generate` with the server's compaction and remap it, for `remap.cjs judge`.

Usage: python remap.py <in.json> <out.json>. The rule is Writer's own (`suite.writer.content.files`).
"""

import base64
import json
import sys

import pycrdt

from suite.content.compaction import compact
from suite.content.updates import rewrite_values
from suite.writer.content.files import value_rewriter

WRITER_ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}


def remap_trial(trial: dict, rule) -> dict:
    rows = [base64.b64decode(row) for row in trial["rows"]]
    try:
        state = compact(None, rows, WRITER_ROOTS).state
        remapped = rewrite_values(state, rule)
    except Exception as error:
        return {**trial, "error": repr(error)}

    remapped_twice = rewrite_values(remapped, rule)
    return {
        **trial,
        "remapped": base64.b64encode(remapped).decode(),
        "rerun_unchanged": remapped_twice == remapped,
    }


if __name__ == "__main__":
    source, target = sys.argv[1:]
    with open(source) as source_file:
        generated = json.load(source_file)

    rule = value_rewriter(generated["map"])
    with open(target, "w") as target_file:
        json.dump([remap_trial(trial, rule) for trial in generated["trials"]], target_file)
