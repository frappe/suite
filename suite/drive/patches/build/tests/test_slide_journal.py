"""Site-free tests for the durable Slide body preimage journal."""

import hashlib
import importlib.util
import json
import os
import stat
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

# Load the pure module without importing Build's package initializer. That
# initializer wires site ports, which is outside this unit test's boundary.
MODULE_PATH = Path(__file__).parents[1] / "slide_journal.py"
SPEC = importlib.util.spec_from_file_location("_build_slide_journal", MODULE_PATH)
slide_journal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = slide_journal
SPEC.loader.exec_module(slide_journal)

CorruptJournalError = slide_journal.CorruptJournalError
JournalConflictError = slide_journal.JournalConflictError
SlideBody = slide_journal.SlideBody
SlidePreimageJournal = slide_journal.SlidePreimageJournal
UnknownBodyState = slide_journal.UnknownBodyState
body_hash = slide_journal.body_hash
deck_hash = slide_journal.deck_hash
transition_hash = slide_journal.transition_hash

CREATED = "2026-09-08 12:34:56.000000"


class JournalCase(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "private" / "drive-build-slide-preimages"
        self.journal = SlidePreimageJournal(self.root)

    def append(
        self,
        before: SlideBody,
        after: SlideBody,
        *,
        slide: str = "slide-1",
        changed: int = 1,
        created_at: str = CREATED,
    ):
        return self.journal.append(
            presentation="deck-1",
            slide=slide,
            before=before,
            after=after,
            changed_elements=changed,
            created_at=created_at,
        )

    def record_path(self, transition) -> Path:
        return self.root / deck_hash("deck-1") / f"{transition.transition_hash}.json"


class TestIdentity(JournalCase):
    def test_exact_values_determine_both_body_hashes(self):
        compact = SlideBody('[{"src":"/files/a.png"}]', None)
        spaced = SlideBody('[ {"src": "/files/a.png"} ]', None)
        empty_background = SlideBody(compact.elements, "")

        self.assertNotEqual(body_hash(compact), body_hash(spaced))
        self.assertNotEqual(body_hash(compact), body_hash(empty_background))

    def test_ids_and_exact_preimage_determine_the_transition_name(self):
        before = SlideBody("[]", None)

        identity = transition_hash("deck-1", "slide-1", before)

        self.assertEqual(len(identity), 64)
        self.assertNotEqual(identity, transition_hash("deck-2", "slide-1", before))
        self.assertNotEqual(identity, transition_hash("deck-1", "slide-2", before))
        self.assertNotEqual(identity, transition_hash("deck-1", "slide-1", SlideBody("[ ]", None)))
        self.assertEqual(
            deck_hash("deck-1"),
            hashlib.sha256(b"deck-1").hexdigest(),
        )

    def test_null_and_empty_strings_have_different_hashes(self):
        self.assertNotEqual(body_hash(SlideBody(None, None)), body_hash(SlideBody("", None)))
        self.assertNotEqual(body_hash(SlideBody(None, None)), body_hash(SlideBody(None, "")))


class TestDurableAppend(JournalCase):
    def test_record_contains_exact_preimage_and_planned_result(self):
        before = SlideBody(
            '[ { "src": "https://old.test/files/a%20b.png", "attachmentName": "A" } ]\n',
            None,
        )
        after = SlideBody('[{"src":"node-media"}]', "linear-gradient(red, blue)")

        transition = self.append(before, after, changed=1)
        payload = json.loads(self.record_path(transition).read_bytes())

        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["presentation"], "deck-1")
        self.assertEqual(payload["slide"], "slide-1")
        self.assertEqual(payload["before"], {"elements": before.elements, "background": None})
        self.assertEqual(payload["after"], {"elements": after.elements, "background": after.background})
        self.assertEqual(payload["before_hash"], body_hash(before))
        self.assertEqual(payload["after_hash"], body_hash(after))
        self.assertEqual(payload["transition_hash"], transition.transition_hash)
        self.assertEqual(payload["changed_elements"], 1)

    def test_file_and_directory_are_fsynced_and_no_temp_file_remains(self):
        before = SlideBody("[]", None)
        after = SlideBody('[{"src":"media"}]', None)
        kinds = []
        real_fsync = os.fsync

        def recording_fsync(descriptor):
            kinds.append("directory" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file")
            return real_fsync(descriptor)

        with patch.object(slide_journal.os, "fsync", recording_fsync):
            transition = self.append(before, after)

        self.assertIn("file", kinds)
        self.assertIn("directory", kinds)
        directory = self.record_path(transition).parent
        self.assertEqual(list(directory.glob("*.tmp")), [])
        self.assertEqual(list(directory.glob(".*.tmp")), [])

    def test_an_identical_resume_reuses_the_first_record_and_stamp(self):
        before = SlideBody("[]", None)
        after = SlideBody('[{"src":"media"}]', None)
        first = self.append(before, after)
        path = self.record_path(first)
        original = path.read_bytes()

        resumed = self.append(before, after, created_at="later")

        self.assertEqual(resumed.created_at, CREATED)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(len(list(path.parent.glob("*.json"))), 1)

    def test_an_identical_resume_repeats_the_durability_barriers(self):
        before = SlideBody("[]", None)
        after = SlideBody('[{"src":"media"}]', None)
        self.append(before, after)
        calls = []
        real_fsync = os.fsync

        def recording_fsync(descriptor):
            calls.append("directory" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file")
            return real_fsync(descriptor)

        with patch.object(slide_journal.os, "fsync", recording_fsync):
            self.append(before, after, created_at="later")

        self.assertEqual(calls, ["file", "directory"])

    def test_the_same_preimage_cannot_be_replaced_by_another_result(self):
        before = SlideBody("[]", None)
        first = self.append(before, SlideBody('[{"src":"one"}]', None))
        path = self.record_path(first)
        original = path.read_bytes()

        with self.assertRaises(JournalConflictError):
            self.append(before, SlideBody('[{"src":"two"}]', None))

        self.assertEqual(path.read_bytes(), original)

    def test_a_later_transition_must_continue_the_terminal_state(self):
        before = SlideBody("[]", None)
        after = SlideBody('[{"src":"one"}]', None)
        self.append(before, after)

        with self.assertRaises(JournalConflictError):
            self.append(SlideBody('[{"src":"unknown"}]', None), SlideBody("[]", "blue"))


class TestCrashRecovery(JournalCase):
    def test_a_crash_before_sql_leaves_one_pending_transition(self):
        before = SlideBody('[ {"attachmentName": "old.png"} ]', None)
        after = SlideBody("[{}]", None)
        self.append(before, after)

        status = self.journal.status("deck-1", "slide-1", before)

        self.assertEqual(status.applied, ())
        self.assertEqual(len(status.pending), 1)
        self.assertEqual(status.changed_elements, 0)

    def test_a_crash_after_sql_recovers_the_applied_count(self):
        before = SlideBody("[]", None)
        after = SlideBody('[{"src":"media"},{"poster":"media"}]', None)
        transition = self.append(before, after, changed=2)

        status = self.journal.status("deck-1", "slide-1", after)

        self.assertEqual(status.applied, (transition,))
        self.assertEqual(status.pending, ())
        self.assertEqual(status.changed_elements, 2)
        self.assertEqual(
            self.journal.recover_changed_elements("deck-1", {"slide-1": after}),
            2,
        )

    def test_count_recovery_sums_only_each_slides_applied_prefix(self):
        one_before = SlideBody("[]", None)
        one_after = SlideBody('[{"src":"one"}]', None)
        two_before = SlideBody('[{"attachmentName":"two"}]', None)
        two_after = SlideBody("[{}]", None)
        self.append(one_before, one_after, slide="slide-1", changed=1)
        self.append(two_before, two_after, slide="slide-2", changed=3)

        recovered = self.journal.recover_changed_elements(
            "deck-1",
            {"slide-1": one_after, "slide-2": two_before},
        )

        self.assertEqual(recovered, 1)

    def test_a_background_only_transition_recovers_zero_elements(self):
        before = SlideBody("[]", "/files/background.png")
        after = SlideBody("[]", "media-background")
        self.append(before, after, changed=0)

        status = self.journal.status("deck-1", "slide-1", after)

        self.assertEqual(status.changed_elements, 0)


class TestRollback(JournalCase):
    def test_two_applied_rewrites_plan_two_byte_exact_reverse_steps(self):
        initial = SlideBody(
            '[ {"src":"/files/a%20b.png", "attachmentName":"a b.png"} ]\n',
            None,
        )
        middle = SlideBody('[{"src":"media-1"}]', None)
        final = SlideBody('[{"src":"media-2"}]', "")
        first = self.append(initial, middle, changed=1)
        second = self.append(middle, final, changed=1)

        plan = self.journal.plan_slide_rollback("deck-1", "slide-1", final)

        self.assertEqual(
            [step.transition_hash for step in plan], [second.transition_hash, first.transition_hash]
        )
        self.assertEqual(plan[0].expected, final)
        self.assertEqual(plan[0].restore, middle)
        self.assertEqual(plan[1].expected, middle)
        self.assertEqual(plan[1].restore, initial)
        self.assertEqual(plan[-1].restore.elements, initial.elements)
        self.assertIsNone(plan[-1].restore.background)

    def test_a_pending_tail_is_not_in_the_rollback_plan(self):
        initial = SlideBody("[]", None)
        middle = SlideBody('[{"src":"one"}]', None)
        final = SlideBody('[{"src":"two"}]', None)
        first = self.append(initial, middle)
        self.append(middle, final)

        plan = self.journal.plan_slide_rollback("deck-1", "slide-1", middle)

        self.assertEqual([step.transition_hash for step in plan], [first.transition_hash])

    def test_rollback_refuses_an_unknown_current_body(self):
        self.append(SlideBody("[]", None), SlideBody('[{"src":"one"}]', None))

        with self.assertRaises(UnknownBodyState):
            self.journal.plan_slide_rollback(
                "deck-1",
                "slide-1",
                SlideBody('[{"src":"user-edit"}]', None),
            )

    def test_deck_rollback_refuses_a_missing_current_slide(self):
        self.append(SlideBody("[]", None), SlideBody('[{"src":"one"}]', None))

        with self.assertRaises(UnknownBodyState):
            self.journal.plan_rollback("deck-1", {})


class TestCorruption(JournalCase):
    def test_invalid_json_is_quarantined_and_refused(self):
        directory = self.root / deck_hash("deck-1")
        directory.mkdir(parents=True)
        path = directory / f"{'a' * 64}.json"
        path.write_text("{broken", encoding="utf-8")

        with self.assertRaises(CorruptJournalError) as caught:
            self.journal.transitions("deck-1")

        self.assertFalse(path.exists())
        self.assertIsNotNone(caught.exception.quarantined)
        self.assertEqual(caught.exception.quarantined.read_text(encoding="utf-8"), "{broken")
        self.assertEqual(self.journal.transitions("deck-1"), ())

    def test_invalid_utf8_is_quarantined_and_refused(self):
        directory = self.root / deck_hash("deck-1")
        directory.mkdir(parents=True)
        path = directory / f"{'b' * 64}.json"
        path.write_bytes(b"\xff\xfe")

        with self.assertRaises(CorruptJournalError) as caught:
            self.journal.transitions("deck-1")

        self.assertFalse(path.exists())
        self.assertEqual(caught.exception.quarantined.read_bytes(), b"\xff\xfe")

    def test_a_hash_mismatch_is_quarantined_and_refused(self):
        before = SlideBody("[]", None)
        transition = self.append(before, SlideBody('[{"src":"one"}]', None))
        path = self.record_path(transition)
        payload = json.loads(path.read_bytes())
        payload["before_hash"] = "0" * 64
        path.write_text(json.dumps(payload), encoding="utf-8")

        with self.assertRaises(CorruptJournalError) as caught:
            self.journal.status("deck-1", "slide-1", before)

        self.assertFalse(path.exists())
        self.assertIsNotNone(caught.exception.quarantined)
        self.assertIn("before_hash", caught.exception.reason)


if __name__ == "__main__":
    unittest.main()
