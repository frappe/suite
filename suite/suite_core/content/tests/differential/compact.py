"""Compact every history in the differential sets with the server's compaction, for `judge.cjs` to check against Yjs.

Usage: python compact.py <out.json>. A history whose compaction is refused keeps its
rows and is compacted again once more rows arrive (`heal`), as the job would be.
"""

import base64
import gzip
import json
import pathlib
import sys

import pycrdt

from suite.suite_core.content.compaction import CompactionFailed, compact, load

HERE = pathlib.Path(__file__).parent
WRITER = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
SLIDES = {"meta": pycrdt.Map, "slides": pycrdt.Map, "provenance": pycrdt.Map}


def roots_of(parts: list[bytes]) -> dict:
    try:
        return SLIDES if "slides" in load(parts).keys() else WRITER
    except Exception:
        return WRITER  # the compaction reports what it cannot read


def run(job: dict) -> dict:
    decode = base64.b64decode
    checkpoint = decode(job["cp"]) if job.get("cp") else None
    rows = [decode(row) for row in job["rows"]]
    stages = [[], [decode(job["heal"])]] if job.get("heal") else [[]]
    parts = ([checkpoint] if checkpoint else []) + rows
    roots = roots_of(parts)
    outcomes = []
    for arriving in stages:
        rows += arriving
        try:
            compacted = compact(checkpoint, rows, roots)
            checkpoint, rows = compacted.state, []
            outcomes.append("compacted")
        except CompactionFailed as failed:
            outcomes.append(failed.reason)

    fully_compacted = checkpoint and not rows
    return {
        "id": job["id"],
        "outcomes": outcomes,
        "cp": base64.b64encode(checkpoint).decode() if fully_compacted else None,
    }


if __name__ == "__main__":
    jobs = []
    for name in ("robust", "emoji"):
        compressed = (HERE / f"{name}.json.gz").read_bytes()
        jobs += json.loads(gzip.decompress(compressed))

    results = [run(job) for job in jobs]
    pathlib.Path(sys.argv[1]).write_text(json.dumps(results))
