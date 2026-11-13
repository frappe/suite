"""A new deck under a log opens on one blank slide, written once by the server (Q179)."""

import json
import uuid

from suite import content, drive
from suite.content import checkpoints, compaction, ingest
from suite.content.http import routes
from suite.slides.content import APP, PART_MAP, SCHEMA, blank_state
from suite.slides.content.tests.support import (
    LoggedDeckCase,
    call_route,
    delete_log,
    opened,
    owner_folder,
)
from suite.slides.content.tests.test_registration import admitted


def slide_ids(state: bytes) -> list[str]:
    doc = compaction.load_doc([state])
    return list(doc.get("slides", type=PART_MAP["slides"]).keys())


class TestNewDeck(LoggedDeckCase):
    def test_new_deck_opens_on_one_slide_at_the_first_rev(self):
        node = self.new_deck()

        self.assertEqual(content.find(APP, node).head_rev, 1)
        _, state = opened(node)
        self.assertEqual(len(slide_ids(state)), 1)

    def test_two_decks_get_different_slide_ids(self):
        _, first = opened(self.new_deck())
        _, second = opened(self.new_deck())

        self.assertNotEqual(slide_ids(first), slide_ids(second))

    def test_the_blank_passes_the_push_check(self):
        state = blank_state()
        (writer,) = ingest.next_clocks([state])

        row = admitted(state, writer)

        self.assertEqual(row.clock_from, 0)

    def test_start_is_refused_once_a_session_has_opened(self):
        node = self.new_deck()
        call_route(routes.sessions_post, node, json.dumps({"sid": uuid.uuid4().hex}).encode())
        log = content.find(APP, node)

        with self.assertRaises(ValueError):
            checkpoints.replace_start(APP, log.id, blank_state(), SCHEMA.version)

        _, state = opened(node)
        self.assertEqual(len(slide_ids(state)), 1)

    def test_copy_keeps_the_source_slide_and_adds_no_blank(self):
        source = self.new_deck()
        _, source_state = opened(source)

        copied = drive.copy(source, owner_folder(), title=f"{self._testMethodName} copy")
        self.addCleanup(delete_log, copied)

        _, copy_state = opened(copied)
        self.assertEqual(slide_ids(copy_state), slide_ids(source_state))
