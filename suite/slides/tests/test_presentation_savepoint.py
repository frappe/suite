"""`create_presentation` reports its deadlock, not a lost savepoint.

`slides ... presentation.create_presentation` opens its own savepoint, calls `drive.create_document` inside it, and
rolls back on any failure. That Drive workflow takes `FOR UPDATE` locks, so
this request can be the InnoDB deadlock victim, and InnoDB discards the
victim's savepoints along with its transaction. A bare
`frappe.db.rollback(save_point=...)` in the `except` arm then raises "SAVEPOINT
does not exist" over the `QueryDeadlockError` the caller has to retry on.

The rollback goes through `drive.rollback_savepoint`, the helper Drive exports
on its package-root interface for exactly this (ARCHITECTURE.md rule 2.2).
`suite/drive/tests/test_savepoint_discipline.py` holds the static sweep that
keeps the bare call from coming back, and the Drive-side runtime cases.
"""

from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase


class _LostSavepoint:
    """The database an InnoDB deadlock victim is left holding.

    Only the victim's savepoints go, and only from the moment the deadlock is
    raised, so a rollback taken before `arm()` still works.
    """

    def __init__(self, db):
        self.lost = False
        db.rollback.side_effect = self._rollback

    def arm(self, error):
        self.lost = True
        raise error

    def _rollback(self, save_point=None):
        if save_point and self.lost:
            raise Exception("SAVEPOINT does not exist")


class TestThePresentationCreateReportsItsDeadlock(UnitTestCase):
    def setUp(self):
        missing = object()
        previous = getattr(frappe.local, "db", missing)
        self.db = MagicMock()
        frappe.local.db = self.db
        self.database = _LostSavepoint(self.db)
        self.deadlock = frappe.QueryDeadlockError("victim")

        def restore():
            if previous is missing:
                del frappe.local.db
            else:
                frappe.local.db = previous

        self.addCleanup(restore)

    def deadlocked(self, *args, **kwargs):
        self.database.arm(self.deadlock)

    def test_a_deadlocked_create_reports_the_deadlock_not_the_lost_savepoint(self):
        from suite.slides.doctype.presentation import presentation

        with (
            patch.object(presentation.frappe, "has_permission", return_value=True),
            patch.object(presentation.slides_drive, "node_of", return_value="source"),
            patch.object(presentation.slides_drive, "node_title_of", return_value="Deck"),
            patch.object(presentation, "_home_folder", return_value="root"),
            patch.object(presentation.drive, "create_document", side_effect=self.deadlocked),
            self.assertRaises(frappe.QueryDeadlockError) as raised,
        ):
            presentation.create_presentation(duplicate_from="deck-1")

        self.assertIs(raised.exception, self.deadlock)
        # The full rollback is what resets a handle InnoDB already emptied.
        self.assertIn(((), {}), [(c.args, c.kwargs) for c in self.db.rollback.call_args_list])

    def test_an_ordinary_refusal_still_rolls_back_narrowly(self):
        """The repair must not widen the rollback for every other error."""
        from suite.slides.doctype.presentation import presentation

        class Refused(Exception):
            pass

        with (
            patch.object(presentation.frappe, "has_permission", return_value=True),
            patch.object(presentation.slides_drive, "node_of", return_value="source"),
            patch.object(presentation.slides_drive, "node_title_of", return_value="Deck"),
            patch.object(presentation, "_home_folder", return_value="root"),
            patch.object(presentation.drive, "create_document", side_effect=Refused("refused")),
            self.assertRaises(Refused),
        ):
            presentation.create_presentation(duplicate_from="deck-1")

        narrow = [c for c in self.db.rollback.call_args_list if c.kwargs.get("save_point")]
        self.assertEqual(len(narrow), 1)
        self.assertEqual(self.db.rollback.call_count, 1)
