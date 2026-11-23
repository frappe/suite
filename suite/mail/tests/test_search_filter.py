# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""How a search's filter reaches JMAP. `with` is a filter of ours, for mail exchanged with someone:
JMAP only knows the headers, so it has to arrive as any one of them."""

from frappe.tests import UnitTestCase

from suite.mail.api.mail import normalize_filter

EXCHANGED_WITH_ANN = {
    "operator": "OR",
    "conditions": [{"from": "ann@example.com"}, {"to": "ann@example.com"}, {"cc": "ann@example.com"}],
}


class TestSearchFilter(UnitTestCase):
    def test_with_finds_mail_from_to_or_copied_to_the_address(self):
        self.assertEqual(
            normalize_filter({"with": "ann@example.com"}),
            {"operator": "AND", "conditions": [EXCHANGED_WITH_ANN]},
        )

    def test_with_narrows_the_other_filters_rather_than_widening_them(self):
        self.assertEqual(
            normalize_filter({"subject": "offsite", "with": " ann@example.com "}),
            {"operator": "AND", "conditions": [{"subject": "offsite"}, EXCHANGED_WITH_ANN]},
        )

    def test_a_blank_with_is_no_filter(self):
        self.assertEqual(
            normalize_filter({"subject": "offsite", "with": " "}),
            {"operator": "AND", "conditions": [{"subject": "offsite"}]},
        )
