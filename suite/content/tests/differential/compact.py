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

from suite.content.compaction import CompactionFailed, compact, load_doc

DIFFERENTIAL_DIR = pathlib.Path(__file__).parent
WRITER_ROOTS = {"default": pycrdt.XmlFragment, "meta": pycrdt.Map}
SLIDES_ROOTS = {"meta": pycrdt.Map, "slides": pycrdt.Map, "provenance": pycrdt.Map}


def roots_of(parts: list[bytes]) -> dict:
    try:
        return SLIDES_ROOTS if "slides" in load_doc(parts).keys() else WRITER_ROOTS
    except Exception:
        # the compaction reports what it cannot read
        return WRITER_ROOTS


def decoded_checkpoint(job: dict) -> bytes | None:
    if job.get("cp"):
        return base64.b64decode(job["cp"])

    return None


def compact_job(job: dict) -> dict:
    checkpoint = decoded_checkpoint(job)
    rows = [base64.b64decode(row) for row in job["rows"]]
    arrivals: list[list[bytes]] = [[]]
    if job.get("heal"):
        arrivals.append([base64.b64decode(job["heal"])])

    parts = list(rows)
    if checkpoint:
        parts.insert(0, checkpoint)

    roots = roots_of(parts)
    outcomes: list[str] = []
    for arriving in arrivals:
        rows += arriving
        try:
            compacted = compact(checkpoint, rows, roots)
            checkpoint = compacted.state
            rows = []
            outcomes.append("compacted")
        except CompactionFailed as error:
            outcomes.append(error.reason)

    fully_compacted = checkpoint and not rows
    encoded_checkpoint = None
    if fully_compacted:
        encoded_checkpoint = base64.b64encode(checkpoint).decode()

    return {"id": job["id"], "outcomes": outcomes, "cp": encoded_checkpoint}


if __name__ == "__main__":
    jobs = []
    for name in ("robust", "emoji"):
        compressed = (DIFFERENTIAL_DIR / f"{name}.json.gz").read_bytes()
        jobs += json.loads(gzip.decompress(compressed))

    results = [compact_job(job) for job in jobs]
    pathlib.Path(sys.argv[1]).write_text(json.dumps(results))
