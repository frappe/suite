# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.tests import IntegrationTestCase

from suite.calendar.api import _is_before, _moment_before, _occurrences_before

WEEKLY_FROM_MONDAY = "2026-09-07T08:00:00"


class TestSplitArithmetic(IntegrationTestCase):
    """Cutting a series in two is arithmetic on its rule, done before either half is written.

    The count a series was given belongs to the occurrences that already happened; what is left
    of it belongs to the half starting at the split. Getting this wrong is not a visible error —
    it is a series that quietly runs the wrong number of times.
    """

    def test_counts_occurrences_before_the_split(self):
        weekly = {"@type": "RecurrenceRule", "frequency": "weekly", "count": 6}

        self.assertEqual(_occurrences_before(weekly, WEEKLY_FROM_MONDAY, "2026-09-28T08:00:00"), 3)

    def test_the_first_occurrence_has_nothing_before_it(self):
        weekly = {"frequency": "weekly", "count": 6}

        self.assertEqual(_occurrences_before(weekly, WEEKLY_FROM_MONDAY, WEEKLY_FROM_MONDAY), 0)

    def test_an_endless_rule_still_answers(self):
        """The window is bounded by the split, so expanding a rule with no end terminates."""

        self.assertEqual(
            _occurrences_before({"frequency": "daily"}, WEEKLY_FROM_MONDAY, "2026-09-11T08:00:00"), 4
        )

    def test_selected_weekdays_are_counted_not_assumed(self):
        """A Mon/Wed series has three occurrences before the 16th, not the two a weekly count gives."""

        rule = {"frequency": "weekly", "byDay": [{"day": "mo"}, {"day": "we"}], "count": 10}

        self.assertEqual(_occurrences_before(rule, WEEKLY_FROM_MONDAY, "2026-09-16T08:00:00"), 3)

    def test_an_unreadable_rule_gives_no_answer(self):
        """No count rather than a wrong one: the caller falls back to an `until` it can trust."""

        self.assertIsNone(_occurrences_before({}, WEEKLY_FROM_MONDAY, "2026-09-28T08:00:00"))
        self.assertIsNone(_occurrences_before({"frequency": "weekly"}, "not a date", "2026-09-28T08:00:00"))

    def test_the_old_half_stops_a_second_before_the_split(self):
        """`until` includes the moment it names, so the split occurrence must fall after it."""

        self.assertEqual(_moment_before("2026-09-28T08:00:00"), "2026-09-28T07:59:59")

    def test_an_occurrence_is_not_before_itself(self):
        self.assertTrue(_is_before("2026-09-21T08:00:00", "2026-09-28T08:00:00"))
        self.assertFalse(_is_before("2026-09-28T08:00:00", "2026-09-28T08:00:00"))
        self.assertFalse(_is_before("2026-10-05T08:00:00", "2026-09-28T08:00:00"))
