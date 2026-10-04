# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.tests import IntegrationTestCase

from suite.calendar.doctype.calendar_event.invitations import (
    _format_when,
    _occurrence_view,
    _rsvp_expiry,
)

SERIES_START = "2026-09-08T18:00:00"
MOVED_TO = "2026-09-11T18:00:00"


def weekly_series(overrides: dict | None = None) -> dict:
    return {
        "id": "E1",
        "title": "Catch up",
        "start": SERIES_START,
        "duration": "PT1H",
        "timeZone": "Asia/Kolkata",
        "recurrenceRule": {"frequency": "weekly", "byDay": [{"day": "tu"}]},
        "recurrenceOverrides": overrides or {},
    }


class TestInviteOccurrenceView(IntegrationTestCase):
    """What an email about one occurrence of a series says about it.

    A rescheduled occurrence does not move the series: the master keeps its start and its rule,
    and the new date lives in an override keyed by the date the occurrence used to fall on. An
    email built from the series would name that old date — which is what the .ics does not do,
    so the reader's calendar and the mail beside it disagreed.
    """

    def test_the_series_speaks_for_itself_when_no_occurrence_is_named(self):
        event = weekly_series()

        self.assertIs(_occurrence_view(event, None), event)

    def test_a_moved_occurrence_is_named_by_where_it_moved_to(self):
        event = weekly_series({SERIES_START: {"start": MOVED_TO}})

        self.assertEqual(_occurrence_view(event, SERIES_START)["start"], MOVED_TO)
        self.assertEqual(_format_when(_occurrence_view(event, SERIES_START)), "Friday, 11 Sep 2026, 06:00 PM")

    def test_an_occurrence_that_did_not_move_is_named_by_its_own_date(self):
        """Its override says nothing about the start, so the date it was expanded at is the date."""

        event = weekly_series({MOVED_TO: {"title": "Catch up (moved)"}})
        view = _occurrence_view(event, MOVED_TO)

        self.assertEqual(view["start"], MOVED_TO)
        self.assertEqual(view["title"], "Catch up (moved)")

    def test_an_occurrence_with_no_override_at_all_is_still_its_own_date(self):
        view = _occurrence_view(weekly_series(), "2026-09-15T18:00:00")

        self.assertEqual(view["start"], "2026-09-15T18:00:00")
        self.assertEqual(view["title"], "Catch up")

    def test_the_series_is_left_as_it_was(self):
        """The view is a copy: the event belongs to the caller, which sends the series' own .ics."""

        event = weekly_series({SERIES_START: {"start": MOVED_TO, "title": "Moved"}})
        _occurrence_view(event, SERIES_START)["title"] = "Rewritten"

        self.assertEqual(event["title"], "Catch up")
        self.assertEqual(event["start"], SERIES_START)

    def test_rsvp_links_outlive_the_occurrence_they_were_sent_for(self):
        """Expiry follows the occurrence, not the series' first date — or a link mailed about a
        later occurrence would arrive already expired."""

        event = weekly_series({SERIES_START: {"start": MOVED_TO}})

        self.assertGreater(_rsvp_expiry(_occurrence_view(event, SERIES_START)), _rsvp_expiry(weekly_series()))
