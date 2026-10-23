"""Stored times are site-naive; the wire carries RFC 3339 in UTC (§11.3)."""

from datetime import UTC, date, datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core import times

KOLKATA = ZoneInfo("Asia/Kolkata")  # +05:30, no DST: every expected value below is exact


class TestTimes(UnitTestCase):
    def setUp(self):
        super().setUp()
        zone = patch("suite.drive._core.times.site_zone", return_value=KOLKATA)
        zone.start()
        self.addCleanup(zone.stop)

    def test_a_stored_time_is_published_as_utc_to_the_second(self):
        cases = (
            (datetime(2026, 10, 3, 12, 0, 0, 999_999), "2026-10-03T06:30:00Z"),
            ("2026-10-03 12:00:00", "2026-10-03T06:30:00Z"),
            ("2026-10-03 12:00:00.123456", "2026-10-03T06:30:00Z"),
            (date(2026, 10, 3), "2026-10-02T18:30:00Z"),
            (datetime(2026, 10, 3, 6, 30, tzinfo=UTC), "2026-10-03T06:30:00Z"),
            (datetime(2026, 10, 3, 2, 30, tzinfo=timezone(timedelta(hours=-4))), "2026-10-03T06:30:00Z"),
        )
        for stored, wire in cases:
            with self.subTest(stored=stored):
                self.assertEqual(times.publish(stored), wire)

    def test_an_absent_time_publishes_as_none(self):
        self.assertIsNone(times.publish(None))
        self.assertIsNone(times.publish(""))

    def test_a_wire_time_is_stored_site_naive(self):
        for wire in ("2026-10-03T06:30:00Z", "2026-10-03T06:30:00+00:00", "2026-10-03T12:00:00+05:30"):
            with self.subTest(wire=wire):
                stored = times.parse(wire, "at")
                self.assertEqual(stored, datetime(2026, 10, 3, 12, 0, 0))
                self.assertIsNone(stored.tzinfo)

    def test_a_wire_time_without_an_offset_is_refused(self):
        for bad in ("2026-10-03T06:30:00", "2026-10-03", datetime(2026, 10, 3, 6, 30), 1_700_000_000, None):
            with self.subTest(bad=bad):
                with self.assertRaises(frappe.ValidationError):
                    times.parse(bad, "at")

    def test_the_two_directions_agree(self):
        stored = datetime(2026, 10, 3, 12, 0, 0)
        self.assertEqual(times.parse(times.publish(stored), "at"), stored)
        self.assertEqual(times.to_site_naive(times.to_utc(stored)), stored)
        self.assertEqual(times.to_site_naive(stored), stored)
