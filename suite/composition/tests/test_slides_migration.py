import frappe

from suite.drive.tests.test_build_content import LATER, BuildContentCase
from suite.slides.api.slides import save_slides


class TestSlideRewriteAndOpenEditors(BuildContentCase):
    def test_a_push_on_the_old_stamp_is_refused_after_a_rewrite(self):
        deck = self.deck_fixture()
        first = deck["slides"][0]
        old_stamp = frappe.db.get_value("Presentation", deck["docname"], "modified")
        old_elements = frappe.db.get_value("Slide", first, "elements")

        self.convert_all(clock=lambda: LATER)
        rewritten = frappe.db.get_value("Slide", first, "elements")

        self.assertNotEqual(rewritten, old_elements)
        with self.assertRaises(frappe.TimestampMismatchError):
            save_slides(deck["docname"], [{"name": first, "elements": old_elements}], str(old_stamp))

        self.assertEqual(frappe.db.get_value("Slide", first, "elements"), rewritten)
