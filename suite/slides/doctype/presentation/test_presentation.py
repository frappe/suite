# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import io
import json
from unittest.mock import patch

import frappe
from frappe.client import get as client_get
from frappe.client import get_list, get_value, set_value
from frappe.desk import reportview
from frappe.tests import IntegrationTestCase
from frappe.utils import cstr

from suite import drive
from suite.drive import EDIT
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.slides import drive as slides_drive
from suite.slides.content.tests.support import (
    LoggedDeckCase,
    delete_log,
    opened,
    owner_folder,
    trash_template,
)
from suite.slides.doctype.presentation import presentation as presentation_module
from suite.slides.doctype.presentation.presentation import (
    apply_theme,
    create_presentation,
    get_composite_presentation,
    get_presentations,
    get_public_presentation,
    get_templates,
    get_updated_json,
    update_slide_attachments,
    update_theme,
)
from suite.slides.tests.utils import (
    PNG_1PX,
    make_presentation,
    make_private,
    make_private_image,
    make_public,
    node_of,
    push_capture,
    share,
    title_of,
    trash,
    unique_bytes,
)
from suite.tests.utils import ensure_user

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
        """The two endpoints a linked deck still answers, bound to one deck."""
        return (
            (update_slide_attachments, deck, {"elements": "[]"}),
            (get_updated_json, deck, []),
        )

    def test_endpoints_still_answered_hide_a_deck_from_a_stranger(self):
        """The endpoints a linked deck still answers, asked by somebody with no grant.

        `update_slide_attachments` and `get_updated_json` reach Drive for a
        linked deck, so the refusal comes from `Drive Grant` rather than from a `File`. Below Read
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
        """The same two, asked by somebody who may read the deck but not write it.

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
        `Drive Node Preview` row without stamping the deck ([012 §8]). The
        `thumbnail` field itself left the DocType (Q19').
        """
        with self.set_user(OWNER):
            presentation = make_presentation("Linked Thumbnail")
            push_capture(presentation.name)

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
            push_capture(presentation.name)
            push_capture(presentation.name)

        self.assertEqual(frappe.db.count("Drive Node Preview", {"node": node_of(presentation.name)}), 1)

    def test_a_duplicate_carries_the_sources_preview(self):
        """§8.9 copies the preview row itself, so a copy opens with a picture."""
        with self.set_user(OWNER):
            source = make_presentation("Duplicated Thumbnail")
            push_capture(source.name)
            copy = create_presentation(duplicate_from=source.name)

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


class TestVersionHandshake(IntegrationTestCase):
    """Product-owned updates report the row version they saved over."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def test_update_theme_reports_the_base_it_saved_over(self):
        with self.set_user(OWNER):
            theme = make_presentation("Version Handshake Theme", is_template=True).name
            presentation = make_presentation("Version Handshake Presentation")
            before = cstr(presentation.modified)
            result = update_theme(presentation.name, theme)

        self.assertEqual(cstr(result["base_modified"]), before)
        self.assertNotEqual(cstr(result["modified"]), before)
        self.assertEqual(
            cstr(result["modified"]),
            cstr(frappe.db.get_value("Presentation", presentation.name, "modified")),
        )


class TestApplyTheme(IntegrationTestCase):
    """A deck takes the theme picked for it: a new one as develop's create did, any one through a change."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)
        with cls.set_user(OWNER):
            dark = make_presentation("Dark", is_template=True)
            dark.slides[0].elements = json.dumps([{"id": "layout-0", "type": "text", "content": "Layout 0"}])
            for index in (1, 2):
                layout = [{"id": f"layout-{index}", "type": "text", "content": f"Layout {index}"}]
                dark.append("slides", {"elements": json.dumps(layout)})

            dark.save()
            cls.dark = dark.name
            cls.pictures, cls.picture_media = cls.make_picture_template()

        with cls.set_user(OTHER_USER):
            cls.unshared = make_presentation("Theme Nobody Shared", is_template=True).name
            short_dark = make_presentation("Dark", is_template=True)
            short_dark.slides[0].elements = json.dumps(
                [{"id": "short-0", "type": "text", "content": "Short 0"}]
            )
            short_dark.append("slides", {"elements": "[]"})
            short_dark.save()
            cls.short_dark = short_dark.name
            share(cls.short_dark, OWNER)

    @classmethod
    def make_picture_template(cls) -> tuple[str, tuple[str, str]]:
        template = make_presentation("Pictures", is_template=True)
        parent = node_of(template.name)
        background = drive.store_file(parent, "background.png", io.BytesIO(unique_bytes(PNG_1PX)))
        photo = drive.store_file(parent, "photo.png", io.BytesIO(unique_bytes(PNG_1PX)))
        template.slides[0].background = background
        template.slides[0].elements = json.dumps([{"id": "photo", "type": "image", "src": photo}])
        for index in (1, 2):
            template.append("slides", {"elements": json.dumps([{"id": f"later-{index}", "type": "text"}])})

        template.save()
        return template.name, (background, photo)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        suffix = frappe.generate_hash(6)
        self.deck = make_presentation(f"New Deck {suffix}").name

    def body_of_deck(self) -> tuple:
        deck = frappe.get_doc("Presentation", self.deck)
        return deck.theme, [slide.elements for slide in deck.slides]

    def test_a_new_deck_takes_the_themes_first_layout(self):
        apply_theme(self.deck, self.dark)

        theme, slides = self.body_of_deck()
        self.assertEqual(theme, self.dark)
        self.assertEqual(len(slides), 1)
        [element] = json.loads(slides[0])
        self.assertEqual(element["content"], "Layout 2")
        self.assertNotEqual(element["id"], "layout-2")

    def test_a_deck_with_content_is_refused_and_left_alone(self):
        deck = frappe.get_doc("Presentation", self.deck)
        deck.slides[0].elements = json.dumps([{"id": "mine", "type": "text", "content": "Mine"}])
        deck.save()
        before = self.body_of_deck()

        with self.assertRaises(frappe.ValidationError):
            apply_theme(self.deck, self.dark)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_theme_that_is_not_a_template_is_refused(self):
        plain = make_presentation("Not A Theme").name
        before = self.body_of_deck()

        with self.assertRaises(frappe.DoesNotExistError):
            apply_theme(self.deck, plain)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_change_of_theme_keeps_the_slides(self):
        deck = frappe.get_doc("Presentation", self.deck)
        deck.slides[0].elements = json.dumps([{"id": "mine", "type": "text", "content": "Mine"}])
        deck.save()
        _, slides = self.body_of_deck()

        update_theme(self.deck, self.dark)

        self.assertEqual(self.body_of_deck(), (self.dark, slides))

    def test_a_change_to_a_theme_that_is_not_a_template_is_refused(self):
        plain = make_presentation("Not A Theme To Change To").name
        before = self.body_of_deck()

        with self.assertRaises(frappe.DoesNotExistError):
            update_theme(self.deck, plain)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_template_the_caller_cannot_read_is_refused(self):
        before = self.body_of_deck()
        for endpoint in (apply_theme, update_theme):
            with self.subTest(endpoint.__name__):
                self.assertRaises(frappe.DoesNotExistError, endpoint, self.deck, self.unshared)
                self.assertEqual(self.body_of_deck(), before)

    def test_a_trashed_template_is_refused(self):
        gone = make_presentation("Theme Gone To Trash", is_template=True).name
        trash(gone)
        frappe.set_user(OWNER)
        before = self.body_of_deck()

        with self.assertRaises(frappe.DoesNotExistError):
            apply_theme(self.deck, gone)

        self.assertEqual(self.body_of_deck(), before)

    def test_the_themes_pictures_are_the_decks_own(self):
        apply_theme(self.deck, self.pictures)

        slide = frappe.get_doc("Presentation", self.deck).slides[0]
        [photo] = json.loads(slide.elements)
        background, photo_original = self.picture_media
        deck_node = node_of(self.deck)
        for media, original in ((slide.background, background), (photo["src"], photo_original)):
            self.assertNotEqual(media, original)
            self.assertEqual(frappe.db.get_value("Drive Node", media, "parent_node"), deck_node)

        layout = frappe.get_doc("Presentation", self.pictures).slides[0]
        [layout_photo] = json.loads(layout.elements)
        self.assertEqual(layout.background, background)
        self.assertEqual(layout_photo["src"], photo_original)
        for original in self.picture_media:
            self.assertEqual(
                frappe.db.get_value("Drive Node", original, "parent_node"), node_of(self.pictures)
            )

    def test_a_template_that_is_not_a_system_one_gives_its_first_layout(self):
        apply_theme(self.deck, self.pictures)

        [element] = json.loads(frappe.get_doc("Presentation", self.deck).slides[0].elements)
        self.assertEqual(element["type"], "image")

    def test_a_system_template_too_short_for_its_usual_layout_gives_its_first(self):
        apply_theme(self.deck, self.short_dark)

        _, [elements] = self.body_of_deck()
        [element] = json.loads(elements)
        self.assertEqual(element["content"], "Short 0")

    def test_two_empty_slides_are_refused_and_left_alone(self):
        deck = frappe.get_doc("Presentation", self.deck)
        deck.append("slides", {"elements": "[]"})
        deck.save()
        before = self.body_of_deck()

        with self.assertRaises(frappe.ValidationError):
            apply_theme(self.deck, self.dark)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_template_cannot_take_a_theme(self):
        self.deck = make_presentation("Blank Template", is_template=True).name
        before = self.body_of_deck()

        with self.assertRaises(frappe.ValidationError):
            apply_theme(self.deck, self.dark)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_theme_with_no_slides_is_refused(self):
        empty = make_presentation("Theme With No Slides", is_template=True)
        frappe.db.delete("Slide", {"parent": empty.name, "parenttype": "Presentation"})
        before = self.body_of_deck()

        with self.assertRaises(frappe.ValidationError):
            apply_theme(self.deck, empty.name)

        self.assertEqual(self.body_of_deck(), before)

    def test_a_reader_cannot_theme_the_deck(self):
        share(self.deck, OTHER_USER)
        share(self.dark, OTHER_USER)
        before = self.body_of_deck()

        frappe.set_user(OTHER_USER)
        with self.assertRaises(DriveForbidden):
            apply_theme(self.deck, self.dark)

        self.assertEqual(self.body_of_deck(), before)


class TestThemeOfAConvertedDeck(LoggedDeckCase):
    """A converted deck's theme pick: the tab fills its live slide, the row only names the theme (Q1)."""

    def setUp(self):
        super().setUp()
        self.node = self.new_deck()
        self.deck = slides_drive.docname_for_node(self.node)
        suffix = frappe.generate_hash(6)
        theme_node = drive.create_document(
            owner_folder(), f"Theme {suffix}", content_doctype="Presentation", is_template=True
        )
        self.addCleanup(trash_template, theme_node)
        self.addCleanup(delete_log, theme_node)
        self.theme = slides_drive.docname_for_node(theme_node)

    def test_the_row_takes_the_theme_and_the_live_deck_is_left_alone(self):
        _header, before = opened(self.node)

        update_theme(self.deck, self.theme)

        self.assertEqual(frappe.db.get_value("Presentation", self.deck, "theme"), self.theme)
        _header, after = opened(self.node)
        self.assertEqual(after, before)

    def test_the_server_never_fills_its_slide(self):
        _header, before = opened(self.node)
        theme_before = frappe.db.get_value("Presentation", self.deck, "theme")

        with self.assertRaises(DriveConflict):
            apply_theme(self.deck, self.theme)

        self.assertEqual(frappe.db.get_value("Presentation", self.deck, "theme"), theme_before)
        _header, after = opened(self.node)
        self.assertEqual(after, before)


class TestTemplatesOnTheLayer(LoggedDeckCase):
    """A converted template's layouts are its saved slides, which the tab reads itself (Q2)."""

    def new_template(self, title: str, parent: str | None = None) -> str:
        node = drive.create_document(
            parent or owner_folder(), title, content_doctype="Presentation", is_template=True
        )
        self.addCleanup(trash_template, node)
        self.addCleanup(delete_log, node)
        return slides_drive.docname_for_node(node)

    def offered(self) -> dict:
        return {row["name"]: row for row in get_templates()}

    def test_a_converted_template_names_its_node_and_sends_no_rows(self):
        suffix = frappe.generate_hash(6)
        template = self.new_template(f"Brand {suffix}")

        row = self.offered()[template]

        self.assertEqual(row["node"], node_of(template))
        self.assertTrue(row["is_converted"])
        self.assertEqual(row["layouts"], [])

    def test_a_template_still_on_its_rows_sends_them(self):
        suffix = frappe.generate_hash(6)
        template = self.new_template(f"Old brand {suffix}")
        # An old site's template that never converted has its rows and no log
        delete_log(node_of(template))

        row = self.offered()[template]

        self.assertFalse(row["is_converted"])
        self.assertEqual(len(row["layouts"]), 1)

    def test_only_a_system_template_names_its_pictures(self):
        # a system template is known by its title, which a folder holds once
        suffix = frappe.generate_hash(6)
        light = self.new_template("Light", drive.ensure_folder(owner_folder(), f"System {suffix}"))
        brand = self.new_template(f"Brand {suffix}")

        rows = self.offered()

        # the seven pictures shipped under public/slides/frontend/images/layouts/light
        pictures: list[str] = []
        for number in range(1, 8):
            pictures.append(f"/assets/suite/slides/frontend/images/layouts/light/thumbnail-{number}.webp")

        self.assertEqual(rows[light]["thumbnails"], pictures)
        self.assertEqual(rows[brand]["thumbnails"], [])


class TestDeckList(IntegrationTestCase):
    """`get_presentations` answers the Home cards off both stores.

    Drive owns a deck's title, its template flag, and its lifecycle on the
    node (§10.2); the `Presentation` row carries none of them.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.title = f"Deck {frappe.generate_hash(6)}"
        self.deck = make_presentation(self.title)

    def _rows(self) -> dict:
        frappe.set_user(OWNER)
        return {row["name"]: row for row in get_presentations()}

    def test_a_deck_is_listed_under_the_title_it_was_created_with(self):
        self.assertEqual(self._rows()[self.deck.name]["title"], self.title)

    def test_a_linked_deck_publishes_no_thumbnail_here(self):
        """Its preview is a `Drive Node Preview` on §6.8's signed byte path,
        which this payload has no field for. No legacy path either (Q19')."""
        push_capture(self.deck.name)
        self.assertNotIn("thumbnail", self._rows()[self.deck.name])

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


class TestConvertedRowsAreNotSlides(LoggedDeckCase):
    """A converted deck's rows stopped at its conversion, so no reader gets them as its slides (Q20')."""

    def setUp(self):
        super().setUp()
        self.node = self.new_deck()
        self.deck = slides_drive.docname_for_node(self.node)
        self.theme = frappe.db.get_value("Presentation", self.deck, "theme")
        # the rows are still there to leak
        self.assertTrue(frappe.get_all("Slide", filters={"parent": self.deck}))

    def test_a_desk_or_rest_read_carries_no_slides(self):
        from frappe.desk.form.load import getdoc

        getdoc("Presentation", self.deck)
        reads = {"desk": frappe.response.docs[0], "rest": client_get("Presentation", self.deck)}
        for route, answer in reads.items():
            with self.subTest(route):
                self.assertFalse(answer.get("slides"))
                self.assertEqual(answer.get("theme"), self.theme)

    def test_the_opening_answer_carries_no_slides_and_still_names_the_deck(self):
        answer = get_public_presentation(self.deck)

        self.assertNotIn("slides", answer)
        self.assertTrue(answer["is_converted"])
        self.assertEqual(answer["theme"], self.theme)
        self.assertEqual(answer["node"], self.node)

    def test_the_converted_deck_still_opens(self):
        header, state = opened(self.node)

        self.assertTrue(header["lineage"])
        self.assertTrue(state)

    def test_a_deck_still_on_its_rows_keeps_them(self):
        delete_log(self.node)

        self.assertEqual(len(get_public_presentation(self.deck)["slides"]), 1)
        self.assertEqual(len(client_get("Presentation", self.deck)["slides"]), 1)


class TestDeckBodyStaysServerSide(IntegrationTestCase):
    """The stored Yjs state reaches no reader and takes no generic write (R1011)."""

    BODY = "c3RvcmVkLXlqcy1zdGF0ZQ=="

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

    def setUp(self):
        with self.set_user(OWNER):
            self.deck = make_presentation(self._testMethodName).name

        frappe.db.set_value("Presentation", self.deck, "content", self.BODY, update_modified=False)

    def stored(self):
        return frappe.db.get_value("Presentation", self.deck, "content")

    def read_through_reportview(self):
        frappe.local.form_dict.update(
            doctype="Presentation",
            fields=json.dumps(["name", "content"]),
            filters=json.dumps({"name": self.deck}),
        )
        self.addCleanup(frappe.local.form_dict.clear)
        return reportview.get()

    def test_no_generic_read_gives_a_viewer_the_body(self):
        share(self.deck, OTHER_USER)

        def read_answer(read):
            try:
                return read()
            except frappe.PermissionError:
                return None

        reads = {
            "get_value": lambda: get_value("Presentation", "content", self.deck),
            "get_list": lambda: get_list(
                "Presentation", fields=["name", "content"], filters={"name": self.deck}
            ),
            "reportview": self.read_through_reportview,
            "client_get": lambda: client_get("Presentation", self.deck),
        }
        for route, read in reads.items():
            with self.subTest(route), self.set_user(OTHER_USER):
                self.assertNotIn(self.BODY, frappe.as_json(read_answer(read)))

    def test_deck_routes_answer_without_the_body(self):
        share(self.deck, OTHER_USER)
        with self.set_user(OTHER_USER):
            self.assertNotIn("content", get_public_presentation(self.deck))

        with self.set_user(OWNER):
            composite = make_presentation(
                "Composite With A Body",
                is_composite=1,
                reference_presentations=[{"presentation": self.deck}],
            )
            frappe.db.set_value("Presentation", composite.name, "content", self.BODY, update_modified=False)
            answer = get_composite_presentation(composite.name)
            self.assertNotIn("content", answer)
            self.assertNotIn("content", create_presentation(duplicate_from=self.deck))

    def test_a_writer_cannot_set_the_body(self):
        share(self.deck, OTHER_USER, role=EDIT)
        with self.set_user(OTHER_USER):
            try:
                set_value("Presentation", self.deck, "content", "overwritten")
            except frappe.PermissionError:
                pass

        self.assertEqual(self.stored(), self.BODY)
