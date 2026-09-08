# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.client import set_value
from frappe.tests import IntegrationTestCase

from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.slides.doctype.presentation import presentation as presentation_module
from suite.slides.doctype.presentation.presentation import (
    create_presentation,
    delete_presentation,
    get_composite_presentation,
    get_presentation_thumbnail,
    get_presentations,
    get_public_presentation,
    get_templates,
    get_updated_json,
    save_base64_image,
    save_presentation_thumbnail,
    update_slide_attachments,
    update_title,
)
from suite.slides.tests.utils import (
    PNG_1PX,
    make_presentation,
    make_private,
    make_private_image,
    make_public,
    make_thumbnail_data,
    node_of,
    share,
    title_of,
    trash,
)
from suite.tests.utils import ensure_user

SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="

OWNER = "slides-owner@example.com"
OTHER_USER = "slides-other@example.com"


class TestPresentationSecurity(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

        with cls.set_user(OWNER):
            cls.owner_presentation = make_presentation("Owner Presentation").name
            cls.private_file = make_private_image(cls.owner_presentation)

        with cls.set_user(OTHER_USER):
            cls.other_presentation = make_presentation("Other User Presentation").name

    def _write_calls(self, deck):
        """The three endpoints a linked deck still answers, bound to one deck."""
        return (
            (update_slide_attachments, deck, {"elements": "[]"}),
            (get_updated_json, deck, []),
            (save_presentation_thumbnail, deck, make_thumbnail_data()),
        )

    def test_endpoints_still_answered_hide_a_deck_from_a_stranger(self):
        """The endpoints a linked deck still answers, asked by somebody with no grant.

        `update_slide_attachments`, `get_updated_json`, and
        `save_presentation_thumbnail` reach Drive for a linked deck, so the
        refusal comes from `Drive Grant` rather than from a `File`. Below Read
        §5.4 refuses to say the deck exists at all, so the answer is
        `DriveNotFound`, not `DriveForbidden`; both are `ValidationError` and
        neither is a `PermissionError` (§11.6). `get_public_presentation`
        keeps its own `PermissionError`, because it answers a page and its
        refusal is what `ErrorPage.vue` reads.
        """
        for func, *args in self._write_calls(self.owner_presentation):
            with self.subTest(func.__name__), self.set_user(OTHER_USER):
                with self.assertRaises(DriveNotFound):
                    func(*args)

        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                get_public_presentation(self.owner_presentation)

    def test_endpoints_still_answered_refuse_a_reader(self):
        """The same three, asked by somebody who may read the deck but not write it.

        A reader is told no, not told nothing: §5.4 hides a node only below
        Read. This is the arm that proves the gate is the role and not merely
        the existence of a grant — a Read grant is not UPLOAD and not EDIT.
        """
        with self.set_user(OWNER):
            readable = make_presentation("Readable Not Writable").name
            share(readable, OTHER_USER)

        for func, *args in self._write_calls(readable):
            with self.subTest(func.__name__), self.set_user(OTHER_USER):
                with self.assertRaises(DriveForbidden):
                    func(*args)

    def test_legacy_endpoints_refuse_a_linked_deck_outright(self):
        """The four §14.7 retires. They refuse the owner too, not only a stranger.

        A linked deck never falls back to the `File`: that would be a way
        around `Drive Grant` (§1). Each refusal names the Drive workflow that
        replaces it, and `suite.slides.tests.test_drive_adoption` pins the
        whole list; these four are the ones this module used to reach through
        a permission check.
        """
        for func, *args in (
            (save_base64_image, PNG_1PX, self.owner_presentation, "x"),
            (update_title, self.owner_presentation, "Hijacked"),
            (delete_presentation, self.owner_presentation),
            (get_presentation_thumbnail, self.owner_presentation),
        ):
            with self.subTest(func.__name__), self.set_user(OWNER):
                with self.assertRaises(frappe.ValidationError):
                    func(*args)

    def test_duplicate_requires_read(self):
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                create_presentation(duplicate_from=self.owner_presentation)

    def test_create_rejects_a_template_that_no_longer_exists(self):
        for template in ("this-template-was-deleted", None, ""):
            with self.subTest(template=template):
                with self.assertRaises(frappe.DoesNotExistError):
                    create_presentation(template=template)

    def test_create_rejects_a_presentation_that_is_not_a_template(self):
        # readable is not enough. `theme` has to name a template or the editor cannot
        # resolve layouts for the slides added later, and the same throw covers a deck
        # the caller cannot read so neither answer leaks whether it exists
        with self.set_user(OWNER):
            own = make_presentation("Not A Template").name

        for presentation in (own, self.other_presentation):
            with self.subTest(presentation=presentation):
                with self.set_user(OWNER):
                    with self.assertRaises(frappe.DoesNotExistError):
                        create_presentation(template=presentation)

    def test_updated_json_adopts_nothing_it_was_not_granted(self):
        """A foreign picture must not travel into a deck on the strength of its URL.

        A linked deck names its media by node id (§10.7), so a legacy
        `/private/files/` URL is not a media reference at all: `adopt_media`
        is given no id, adopts nothing, and hands the element list back with
        the foreign URL still in it and no `attachmentName` beside it. The
        legacy path answered `PermissionError` from the `File` row; the
        property both protect is the same one, and it is the one asserted.
        """
        exfil = [{"type": "image", "src": self.private_file.file_url}]
        with self.set_user(OTHER_USER):
            answer = get_updated_json(self.other_presentation, exfil)

        self.assertEqual([element.get("attachmentName") for element in answer], [None])
        self.assertFalse(
            frappe.db.exists(
                "File",
                {"file_url": self.private_file.file_url, "attached_to_name": self.other_presentation},
            ),
            "the foreign picture must not be copied onto the caller's own deck",
        )

    def test_image_payload_is_validated_before_anything_is_stored(self):
        """The data-URI validator, on the path that still reaches it.

        `save_base64_image` is legacy-only now, so the three cases that used
        to reach the validator through it reach it through
        `save_presentation_thumbnail` instead, which is the shape a linked
        deck still accepts. Neither a URI that is not one nor an SVG gets as
        far as a stored byte.
        """
        for payload in ("not-a-data-uri", SVG, PNG_1PX):
            with self.subTest(payload=payload[:20]), self.set_user(OWNER):
                with self.assertRaises(frappe.ValidationError):
                    save_presentation_thumbnail(self.owner_presentation, payload)

    def test_composite_blocks_private_presentation(self):
        with self.set_user("Guest"):
            with self.assertRaises(frappe.PermissionError):
                get_composite_presentation(self.owner_presentation)

    def test_composite_serves_public_presentation_to_guest(self):
        with self.set_user(OWNER):
            ref = make_presentation("Public Reference")
            make_public(ref.name)
            composite = make_presentation(
                "Composite Presentation",
                is_composite=1,
                reference_presentations=[{"presentation": ref.name}],
            )
            make_public(composite.name)

        with self.set_user("Guest"):
            result = get_composite_presentation(composite.name)

        self.assertEqual(len(result["slides"]), len(ref.slides))

    def test_thumbnail_becomes_the_decks_drive_preview(self):
        """§14.7 retires the thumbnail `File` and the `thumbnail` column.

        The four cases this replaces all described the legacy thumbnail file:
        that it was attached to the `thumbnail` field, that resaving the deck
        did not clone it, and what a duplicate inherited. A linked deck pushes
        the browser capture through Drive instead, which replaces one
        `Drive Node Preview` row without stamping the deck ([012 §8]), and the
        column it used to write stays empty for good.
        """
        with self.set_user(OWNER):
            presentation = make_presentation("Linked Thumbnail")
            answer = save_presentation_thumbnail(presentation.name, make_thumbnail_data())

        self.assertEqual(answer, "", "no legacy file url is minted for a linked deck")
        self.assertEqual(frappe.db.get_value("Presentation", presentation.name, "thumbnail"), None)
        self.assertTrue(frappe.db.exists("Drive Node Preview", {"node": node_of(presentation.name)}))
        self.assertFalse(
            frappe.db.exists(
                "File", {"attached_to_name": presentation.name, "attached_to_field": "thumbnail"}
            )
        )

    def test_a_second_capture_replaces_the_one_preview(self):
        """One deck holds one preview row, however often the browser captures it."""
        with self.set_user(OWNER):
            presentation = make_presentation("Recaptured Thumbnail")
            save_presentation_thumbnail(presentation.name, make_thumbnail_data())
            save_presentation_thumbnail(presentation.name, make_thumbnail_data())

        self.assertEqual(frappe.db.count("Drive Node Preview", {"node": node_of(presentation.name)}), 1)

    def test_a_duplicate_carries_the_sources_preview(self):
        """§8.9 copies the preview row itself, so a copy opens with a picture."""
        with self.set_user(OWNER):
            source = make_presentation("Duplicated Thumbnail")
            save_presentation_thumbnail(source.name, make_thumbnail_data())
            copy = create_presentation(duplicate_from=source.name)

        self.assertEqual(copy.thumbnail, None, "the legacy column is frozen for a linked deck")
        self.assertTrue(frappe.db.exists("Drive Node Preview", {"node": node_of(copy.name)}))

    def test_composite_excludes_reference_made_private_later(self):
        with self.set_user(OWNER):
            ref = make_presentation("Later Private Reference")
            make_public(ref.name)
            composite = make_presentation(
                "Stale Composite",
                is_composite=1,
                reference_presentations=[{"presentation": ref.name}],
            )
            make_public(composite.name)
            make_private(ref.name)

        with self.set_user("Guest"):
            result = get_composite_presentation(composite.name)

        self.assertEqual(result["slides"], [])


class TestTemplates(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

        # A linked deck carries `is_template` on its node, never on the frozen
        # legacy column (§8.10), so the fixture asks Drive for a template node
        # rather than stamping the column `get_templates` no longer reads.
        with cls.set_user(OWNER):
            cls.one_layout = make_presentation("One Layout Template", is_template=True)

            cls.three_layouts = make_presentation("Three Layout Template", is_template=True)
            cls.three_layouts.append("slides", {"elements": "[]"})
            cls.three_layouts.append("slides", {"elements": "[]"})
            cls.three_layouts.save()

    def test_layouts_are_grouped_per_template_in_idx_order(self):
        # one bulk query feeds every template, so a grouping slip shows up only when the
        # templates differ in size
        by_name = {template["name"]: template for template in get_templates()}

        self.assertEqual(len(by_name[self.one_layout.name]["layouts"]), 1)

        layouts = by_name[self.three_layouts.name]["layouts"]
        self.assertEqual([layout["idx"] for layout in layouts], [1, 2, 3])
        self.assertEqual(
            [layout["name"] for layout in layouts],
            [slide.name for slide in self.three_layouts.slides],
        )
        # the editor spreads a layout into a new child row, which needs its doctype
        self.assertEqual({layout["doctype"] for layout in layouts}, {"Slide"})


class TestSlideRows(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def test_slide_resent_without_a_name_is_reinserted(self):
        """Undoing a delete restores a slide whose row an autosave already dropped, so
        the editor blanks the row name and the next save has to insert it again."""
        with self.set_user(OWNER):
            presentation = make_presentation("Undo Delete Presentation")
            presentation.append("slides", {"elements": "[]"})
            presentation.save()
            kept, removed = (slide.as_dict() for slide in presentation.slides)

            set_value("Presentation", presentation.name, {"slides": [kept]})
            self.assertFalse(frappe.db.exists("Slide", removed.name))

            restored = removed.copy()
            restored.name = ""
            set_value("Presentation", presentation.name, {"slides": [kept, restored]})

        slides = frappe.get_doc("Presentation", presentation.name).slides
        self.assertEqual(len(slides), 2)
        self.assertEqual(slides[0].name, kept.name)
        self.assertNotIn(slides[1].name, ("", removed.name))


class TestDeckList(IntegrationTestCase):
    """`get_presentations` answers the Home cards off both stores.

    Drive owns a linked deck's title, its template flag, and its lifecycle,
    with no mirror on the frozen legacy columns (§10.2), so the columns alone
    named every deck blank and listed trashed decks and templates as ordinary
    ones.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Deck {frappe.generate_hash(6)}")

    def _rows(self) -> dict:
        frappe.set_user(OWNER)
        return {row["name"]: row for row in get_presentations()}

    def test_a_deck_is_named_by_its_node_not_by_the_frozen_column(self):
        self.assertFalse(frappe.db.get_value("Presentation", self.deck.name, "title"))
        self.assertEqual(self._rows()[self.deck.name]["title"], title_of(self.deck.name))

    def test_a_linked_deck_publishes_no_thumbnail_here(self):
        """Its preview is a `Drive Node Preview` on §6.8's signed byte path,
        which this payload has no field for. Blank, never a stale legacy
        path."""
        save_presentation_thumbnail(self.deck.name, make_thumbnail_data())
        self.assertEqual(self._rows()[self.deck.name]["thumbnail"], "")

    def test_a_trashed_deck_leaves_the_list(self):
        trash(self.deck.name)
        self.assertNotIn(self.deck.name, self._rows())

    def test_a_template_is_not_listed_as_an_ordinary_deck(self):
        template = make_presentation(f"Template {frappe.generate_hash(6)}", is_template=True)
        self.assertNotIn(template.name, self._rows())

    def test_the_slide_count_is_still_reported(self):
        self.assertEqual(self._rows()[self.deck.name]["slide_count"], 1)


class TestTemplatePicker(IntegrationTestCase):
    """§8.10: who may use a template is the grant on its node."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.template = make_presentation(f"Deck Template {frappe.generate_hash(6)}", is_template=True)

    def _offered_to(self, user) -> dict:
        frappe.set_user(user)
        return {row["name"]: row for row in get_templates()}

    def test_the_owner_is_offered_their_own_template(self):
        self.assertIn(self.template.name, self._offered_to(OWNER))

    def test_a_template_is_named_and_slugged_from_its_node(self):
        row = self._offered_to(OWNER)[self.template.name]
        self.assertEqual(row["title"], title_of(self.template.name))
        self.assertTrue(row["slug"])

    def test_a_stranger_is_not_offered_a_template_they_cannot_read(self):
        self.assertNotIn(self.template.name, self._offered_to(OTHER_USER))

    def test_a_grant_is_what_offers_it(self):
        share(self.template.name, OTHER_USER)
        self.assertIn(self.template.name, self._offered_to(OTHER_USER))

    def test_a_trashed_template_is_offered_to_nobody(self):
        trash(self.template.name)
        self.assertNotIn(self.template.name, self._offered_to(OWNER))


class TestCreateIsAtomic(IntegrationTestCase):
    """A new deck and the theme its layouts resolve through are one write.

    `drive.create_document` closes its own savepoint before returning, so the
    `theme` write sits outside it. `create_presentation` holds both in one
    savepoint of its own; without it a failure after the node is written would
    leave a deck the editor cannot add a slide to.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.template = make_presentation(f"Rollback Template {frappe.generate_hash(6)}", is_template=True)

    def _decks(self) -> int:
        return frappe.db.count("Drive Node", {"content_doctype": "Presentation", "state": "Active"})

    def test_a_new_deck_names_the_template_it_started_from(self):
        deck = create_presentation(template=self.template.name)
        self.assertEqual(frappe.db.get_value("Presentation", deck.name, "theme"), self.template.name)

    def test_a_create_that_fails_after_the_node_leaves_no_node_behind(self):
        before = self._decks()
        with patch.object(presentation_module.slides_drive, "docname_for_node", return_value=None):
            with self.assertRaises(frappe.ValidationError):
                create_presentation(template=self.template.name)
        self.assertEqual(self._decks(), before)
