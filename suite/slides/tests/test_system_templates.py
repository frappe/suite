"""The shipped Light and Dark template decks (§8.10).

`seed_system_templates` runs from `after_install` and `after_migrate`, so the
site it runs on may already hold the decks. The seeded rows are left in place:
they are what every installed site has, not a fixture.
"""

import frappe
from frappe.tests import IntegrationTestCase

from suite.slides.doctype.presentation.presentation import get_templates
from suite.slides.install import seed_system_templates
from suite.tests.utils import ensure_user

READER = "slides-template-reader@example.com"

# Written from the picker's contract, not from the seed: a shipped deck's
# layouts are drawn from the asset path keyed by its lowercased title.
EXPECTED = {
    "Light": {"background": "#FFFFFFFF", "thumbnail": "/assets/suite/slides/frontend/images/layouts/light/"},
    "Dark": {"background": "#000000FF", "thumbnail": "/assets/suite/slides/frontend/images/layouts/dark/"},
}


class TestSystemTemplates(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        ensure_user(READER)
        self.addCleanup(frappe.set_user, "Administrator")

    def test_seeding_twice_gives_every_user_one_light_and_one_dark_deck_of_seven_layouts(self):
        seed_system_templates()
        seed_system_templates()

        frappe.set_user(READER)
        shipped = [template for template in get_templates() if template["title"] in EXPECTED]

        self.assertEqual(sorted(template["title"] for template in shipped), ["Dark", "Light"])
        for template in shipped:
            with self.subTest(template=template["title"]):
                expected = EXPECTED[template["title"]]
                layouts = template["layouts"]
                self.assertEqual(len(layouts), 7)
                self.assertEqual({layout["background"] for layout in layouts}, {expected["background"]})
                self.assertEqual(
                    [layout["thumbnail"] for layout in layouts],
                    [f"{expected['thumbnail']}thumbnail-{index}.webp" for index in range(1, 8)],
                )
                deck = frappe.get_doc("Presentation", template["name"])
                self.assertFalse(
                    deck.theme, "a template names no theme; a deck made from it names the template"
                )
                self.assertEqual(deck.node_title, template["title"])

    def test_a_logged_out_visitor_sees_no_shipped_template(self):
        seed_system_templates()

        frappe.set_user("Guest")
        titles = {template["title"] for template in get_templates()}

        self.assertFalse(titles & set(EXPECTED))
