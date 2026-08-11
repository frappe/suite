# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.exceptions import Forbidden, NotFound

from suite.slides.api.file import get_reference_presentations, validate_media_file
from suite.slides.tests.utils import (
    make_presentation,
    make_private_image,
    make_public,
    unique_image_content,
)
from suite.tests.utils import ensure_user

OWNER = "media-owner@example.com"
OTHER_USER = "media-other@example.com"


class TestMediaFileAccess(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

        with cls.set_user(OWNER):
            cls.presentation = make_presentation("Media Access Test")
            cls.file = make_private_image(cls.presentation.name)

    def test_owner_can_access(self):
        with self.set_user(OWNER):
            self.assertIsNone(validate_media_file(self.file.file_url, self.presentation.name))

    def test_other_user_forbidden(self):
        with self.set_user(OTHER_USER):
            with self.assertRaises(Forbidden):
                validate_media_file(self.file.file_url, self.presentation.name)

    def test_guest_forbidden(self):
        with self.set_user("Guest"):
            with self.assertRaises(Forbidden):
                validate_media_file(self.file.file_url, self.presentation.name)

    def test_guest_can_access_file_of_public_presentation(self):
        # own fixtures: making the shared presentation public would break the deny tests
        with self.set_user(OWNER):
            presentation = make_presentation("Public Media Test")
            file = make_private_image(presentation.name)
            make_public(presentation.name)

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(file.file_url, presentation.name))

    def test_missing_presentation_is_forbidden(self):
        with self.set_user(OWNER):
            self.assertRaises(Forbidden, validate_media_file, self.file.file_url)

    def test_a_public_presentation_sharing_the_url_grants_nothing(self):
        # frappe stores one copy of the bytes, so a public presentation can hold the
        # same url as a private one; only the presentation being viewed decides
        with self.set_user(OWNER):
            files = self.make_shared_url("Sibling Media")
            make_public(files[1].attached_to_name)

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(files[1].file_url, files[1].attached_to_name))
            with self.assertRaises(Forbidden):
                validate_media_file(files[0].file_url, files[0].attached_to_name)

    def test_presentation_arg_grants_nothing_on_its_own(self):
        with self.set_user(OTHER_USER):
            own = make_presentation("Unrelated Presentation")
            with self.assertRaises(Forbidden):
                validate_media_file(self.file.file_url, own.name)

    def test_guest_can_access_a_template_being_viewed(self):
        with self.set_user(OWNER):
            presentation = make_presentation("Viewed Template")
            file = make_private_image(presentation.name)
            frappe.db.set_value("Presentation", presentation.name, "is_template", 1)

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(file.file_url, presentation.name))

    def test_composite_resolves_to_the_presentations_it_shows(self):
        # a composite's media hangs off the presentations it references, not off itself
        with self.set_user(OWNER):
            source = make_presentation("Composite Source")
            file = make_private_image(source.name)
            make_public(source.name)

            composite = make_presentation("Composite")
            composite.is_composite = 1
            composite.append("reference_presentations", {"presentation": source.name})
            composite.save()

        self.assertEqual(get_reference_presentations(composite.name), {source.name})

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(file.file_url, composite.name))

    def test_unknown_url_not_found(self):
        with self.set_user(OWNER):
            with self.assertRaises(NotFound):
                validate_media_file("/private/files/no-such-file.png")

    def make_shared_url(self, title):
        """Two presentations holding the same image, which frappe stores once and
        references from a File row per presentation."""
        content = unique_image_content()
        files = [
            make_private_image(make_presentation(f"{title} {i}").name, content=content) for i in range(2)
        ]
        self.assertEqual(files[0].file_url, files[1].file_url)
        return files
