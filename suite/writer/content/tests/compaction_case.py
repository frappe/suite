"""A test case that frees compaction places, compacts without installing and opens a document."""

import secrets
from dataclasses import dataclass
from unittest.mock import patch

import frappe
from frappe.utils.background_jobs import get_redis_conn

from suite.content import admission, compaction, jobs
from suite.content.http import routes
from suite.writer import content as writer_content
from suite.writer.content.tests.support import CheckpointCase, call_route, read_open


@dataclass(frozen=True)
class Opened:
    header: dict
    revs: list[int]
    text: str


class CompactionCase(CheckpointCase):
    def setUp(self):
        super().setUp()
        self.requested: list[tuple[str, str]] = []
        real_enqueue = frappe.enqueue

        def enqueue(method, **kwargs):
            if method not in {jobs.COMPACT, jobs.JUDGE}:
                return real_enqueue(method, **kwargs)

            self.requested.append((method, kwargs["doc_id"]))

        # The bench's live workers take places and run queued jobs, so each test keeps its own
        tag = secrets.token_hex(4)
        for patcher in (
            patch.object(admission, "KEY_PREFIX", f"suite:collab:test-{tag}:"),
            patch.object(frappe, "enqueue", enqueue),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def release_places(self):
        redis = get_redis_conn()
        for key in redis.keys(f"{admission.KEY_PREFIX}compact*"):
            redis.delete(key)

    def compacted(self, node: str, *, integrated: bool = True) -> tuple[dict, compaction.Compacted]:
        snapshot = routes.content.read("writer", self.doc_row(node).id)
        rows = snapshot.payloads()
        compacted = compaction.compact(snapshot.checkpoint, rows, writer_content.PART_MAP)
        if not integrated:
            merged = compaction.pycrdt.merge_updates(*rows)
            compacted = compaction.Compacted(merged, integrated=False)

        compacted.ms = 1
        return snapshot, compacted

    def opened(self, node: str) -> Opened:
        frame = read_open(call_route(routes.document_get, node).get_data())
        parts: list[bytes] = []
        if frame.checkpoint:
            parts.append(frame.checkpoint)

        revs = [rev for rev, _ in frame.rows]
        state = compaction.pycrdt.merge_updates(*parts, *(payload for _, payload in frame.rows))
        text = self.text_of(state)
        return Opened(frame.header, revs, text)
