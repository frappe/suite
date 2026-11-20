import frappe
from frappe.tests import IntegrationTestCase

from suite.slides.api.recovery import recovery_names
from suite.slides.tests.utils import make_presentation, node_of, share
from suite.tests.utils import ensure_user

OWNER = "recovery-owner@example.com"
READER = "recovery-reader@example.com"
STRANGER = "recovery-stranger@example.com"


class TestRecoveryNames(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, READER, STRANGER):
            ensure_user(user)

        with cls.set_user(OWNER):
            cls.shared = make_presentation("Quarterly Plan")
            cls.private = make_presentation("Salary Review")
            share(cls.shared.name, READER)

    def test_a_readable_presentation_answers_its_node_and_title(self):
        with self.set_user(READER):
            names = recovery_names([self.shared.name], [])

        self.assertEqual(
            names,
            [
                {
                    "presentation": self.shared.name,
                    "node": node_of(self.shared.name),
                    "title": "Quarterly Plan",
                    "can_edit": False,
                }
            ],
        )

    def test_a_presentation_the_person_cannot_read_answers_nothing(self):
        with self.set_user(READER):
            names = recovery_names([self.private.name, self.shared.name], [])

        self.assertEqual([name["presentation"] for name in names], [self.shared.name])
        self.assertNotIn("Salary Review", frappe.as_json(names))

    def test_a_node_answers_its_presentation_and_title(self):
        with self.set_user(READER):
            names = recovery_names([], [node_of(self.shared.name), node_of(self.private.name)])

        self.assertEqual(
            names,
            [
                {
                    "presentation": self.shared.name,
                    "node": node_of(self.shared.name),
                    "title": "Quarterly Plan",
                    "can_edit": False,
                }
            ],
        )

    def test_an_editor_is_told_they_can_edit(self):
        with self.set_user(OWNER):
            names = recovery_names([self.shared.name], [node_of(self.private.name)])

        self.assertEqual([name["can_edit"] for name in names], [True, True])

    def test_a_missing_presentation_answers_nothing(self):
        with self.set_user(OWNER):
            self.assertEqual(recovery_names(["no-such-presentation"], ["no-such-node"]), [])

    def test_a_guest_reads_no_title(self):
        with self.set_user("Guest"):
            self.assertEqual(recovery_names([self.shared.name, self.private.name], []), [])

    def test_a_stranger_reads_none_of_them(self):
        with self.set_user(STRANGER):
            self.assertEqual(recovery_names([self.shared.name, self.private.name], []), [])

    def test_too_many_names_are_refused(self):
        with self.set_user(OWNER):
            self.assertRaises(frappe.ValidationError, recovery_names, ["x"] * 101, ["y"] * 100)
