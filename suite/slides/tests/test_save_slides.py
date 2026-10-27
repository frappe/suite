"""`save_slides` keeps the deck's history: autosaves take throttled automatic versions."""

from datetime import timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite import drive
from suite.slides.api.slides import AUTO_VERSION_SECS, save_slides
from suite.slides.tests.utils import make_presentation, node_of
from suite.tests.utils import ensure_user

EDITOR = "slides-autoversion@example.com"


class TestSaveSlidesTakesAutomaticVersions(IntegrationTestCase):
    def setUp(self):
        ensure_user(EDITOR)
        frappe.set_user(EDITOR)
        self.deck = make_presentation("[TEST] autoversion deck")
        self.node = node_of(self.deck.name)

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()

    def save(self, background):
        modified = frappe.db.get_value("Presentation", self.deck.name, "modified")
        save_slides(self.deck.name, [{"client_id": "s1", "background": background}], str(modified))

    def automatic_versions(self):
        rows = drive.list_versions(self.node)["rows"]
        return [row for row in rows if row["kind"] == "auto"]

    def test_saves_close_together_share_one_automatic_version_and_a_later_save_takes_another(self):
        self.save("#ffffffff")
        self.save("#000000ff")
        close_together = len(self.automatic_versions())

        older = now_datetime() - timedelta(seconds=AUTO_VERSION_SECS + 5)
        frappe.db.set_value("Drive Node Version", {"node": self.node}, "creation", older)
        self.save("#ff0000ff")

        self.assertEqual([close_together, len(self.automatic_versions())], [1, 2])
