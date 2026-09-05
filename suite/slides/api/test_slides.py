import frappe
from frappe.utils import cstr
from frappe.tests import IntegrationTestCase

from suite.slides.api.slides import save_slides
from suite.slides.tests.utils import make_presentation
from suite.tests.utils import ensure_user

OWNER = "slides-save-owner@example.com"
OTHER_USER = "slides-save-other@example.com"


def slide(client_id, background="#ffffffff"):
    return {"client_id": client_id, "background": background, "elements": "[]"}


def row_names(presentation):
    return frappe.get_all(
        "Slide",
        {"parent": presentation, "parenttype": "Presentation"},
        pluck="name",
        order_by="idx",
    )


class TestSaveSlides(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

    def setUp(self):
        with self.set_user(OWNER):
            self.presentation = make_presentation("Save Slides").name

    def modified(self):
        return cstr(frappe.db.get_value("Presentation", self.presentation, "modified"))

    def save(self, slides, base_modified=None):
        with self.set_user(OWNER):
            return save_slides(self.presentation, slides, base_modified or self.modified())

    def test_rows_keep_their_name_across_saves(self):
        self.save([slide("a"), slide("b")])
        first = row_names(self.presentation)

        self.save([slide("a", "#000000ff"), slide("b")])

        self.assertEqual(row_names(self.presentation), first)
        self.assertEqual(frappe.db.get_value("Slide", first[0], "background"), "#000000ff")

    def test_rows_follow_the_editor_list(self):
        self.save([slide("a"), slide("b")])
        a_name, b_name = row_names(self.presentation)

        self.save([slide("c"), slide("a")])

        names = row_names(self.presentation)
        self.assertEqual(names[1], a_name)
        self.assertNotIn(b_name, names)
        self.assertEqual(frappe.db.get_value("Slide", names[0], "client_id"), "c")

    def test_duplicate_client_id_keeps_both_slides(self):
        self.save([slide("a"), slide("a")])
        self.assertEqual(len(row_names(self.presentation)), 2)

    def test_stale_snapshot_is_refused_and_changes_nothing(self):
        self.save([slide("a")])
        stale = self.modified()
        self.save([slide("a"), slide("b")])
        before = row_names(self.presentation)

        with self.assertRaises(frappe.TimestampMismatchError):
            self.save([slide("a")], base_modified=stale)

        self.assertEqual(row_names(self.presentation), before)

    def test_returns_the_new_version(self):
        result = self.save([slide("a")])
        self.assertEqual(cstr(result["modified"]), self.modified())

    def test_framework_fields_are_not_editable(self):
        self.save([slide("a")])
        (name,) = row_names(self.presentation)

        self.save([{**slide("a"), "name": "forged", "parent": "other", "owner": OTHER_USER}])

        self.assertEqual(row_names(self.presentation), [name])
        self.assertEqual(frappe.db.get_value("Slide", name, "owner"), OWNER)

    def test_requires_write_permission(self):
        with self.set_user(OTHER_USER), self.assertRaises(frappe.PermissionError):
            save_slides(self.presentation, [slide("a")], self.modified())
