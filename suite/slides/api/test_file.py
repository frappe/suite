# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from contextlib import contextmanager

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.exceptions import Forbidden, NotFound, RequestedRangeNotSatisfiable
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive.overrides.file import File as DriveFile
from suite.slides.api.file import get_media_response, get_reference_presentations, validate_media_file
from suite.slides.tests.utils import (
    PNG_1PX,
    make_presentation,
    make_private,
    make_private_image,
    make_public,
    unique_bytes,
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

    def test_guest_can_access_media_of_a_template(self):
        # a presentation built from a template shows the template's own file urls: the
        # layout is copied over, the File row stays on the template
        _, file = self.make_template("Media Template")

        with self.set_user(OTHER_USER):
            presentation = make_presentation("Built From Template")
            make_public(presentation.name)

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(file.file_url, presentation.name))

    def test_template_media_still_needs_a_readable_presentation(self):
        # a file url is not a credential: naming no presentation, or one the caller
        # cannot read, stays forbidden
        _, file = self.make_template("Gated Template")

        with self.set_user("Guest"):
            with self.assertRaises(Forbidden):
                validate_media_file(file.file_url)
            with self.assertRaises(Forbidden):
                validate_media_file(file.file_url, self.presentation.name)

    def test_a_readable_presentation_does_not_unlock_private_media(self):
        # the template branch must not turn "you may see this presentation" into
        # "you may see any private file"
        with self.set_user(OTHER_USER):
            presentation = make_presentation("Public But Unrelated")
            make_public(presentation.name)

        with self.set_user("Guest"):
            with self.assertRaises(Forbidden):
                validate_media_file(self.file.file_url, presentation.name)

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

    def test_composite_shows_template_media_of_its_references(self):
        # references built from templates carry the template's file urls too, and the
        # composite is the only presentation the viewer ever names
        _, file = self.make_template("Referenced Template")

        with self.set_user(OTHER_USER):
            source = make_presentation("Built From Template Source")
            make_public(source.name)

            composite = make_presentation("Composite Of Templated")
            composite.is_composite = 1
            composite.append("reference_presentations", {"presentation": source.name})
            composite.save()

        with self.set_user("Guest"):
            self.assertIsNone(validate_media_file(file.file_url, composite.name))

    def test_a_reference_made_private_later_keeps_its_own_media_private(self):
        # references are public when the composite is saved but can be made private
        # afterwards; the template branch must not become a way around that
        with self.set_user(OWNER):
            source = make_presentation("Reference Made Private")
            file = make_private_image(source.name)
            make_public(source.name)

            composite = make_presentation("Composite Of Private")
            composite.is_composite = 1
            composite.append("reference_presentations", {"presentation": source.name})
            composite.save()

            make_private(source.name)

        with self.set_user("Guest"):
            with self.assertRaises(Forbidden):
                validate_media_file(file.file_url, composite.name)

    def test_unknown_url_not_found(self):
        with self.set_user(OWNER):
            with self.assertRaises(NotFound):
                validate_media_file("/private/files/no-such-file.png")

    def make_template(self, title):
        """Inserted as a template, so `after_insert` skips `create_drive_file`: the
        shape templates actually have in production, with no backing Drive File."""
        with self.set_user(OWNER):
            template = frappe.get_doc(
                {"doctype": "Presentation", "title": title, "is_template": 1, "slides": [{"elements": "[]"}]}
            ).insert()
            file = make_private_image(template.name)

        self.assertIsNone(DriveFile.get_for_doc("Presentation", template.name))
        return template, file

    def make_shared_url(self, title):
        """Two presentations holding the same image, which frappe stores once and
        references from a File row per presentation."""
        content = unique_bytes(PNG_1PX)
        files = [
            make_private_image(make_presentation(f"{title} {i}").name, content=content) for i in range(2)
        ]
        self.assertEqual(files[0].file_url, files[1].file_url)
        return files


@contextmanager
def media_request(headers=None):
    had_request = hasattr(frappe.local, "request")
    previous = getattr(frappe.local, "request", None)
    frappe.local.request = Request(EnvironBuilder(headers=headers or {}).get_environ())
    try:
        yield
    finally:
        if had_request:
            frappe.local.request = previous
        else:
            del frappe.local.request


def read_body(response):
    response.direct_passthrough = False
    return response.get_data()


class TestMediaRanges(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        cls.content = unique_bytes(PNG_1PX) + bytes(range(256)) * 4
        with cls.set_user(OWNER):
            presentation = make_presentation("Media Range Test")
            cls.file = make_private_image(presentation.name, content=cls.content)

    def respond(self, range_header=None):
        headers = {"Range": range_header} if range_header else {}
        with media_request(headers):
            return get_media_response(self.file.file_url)

    def test_full_file(self):
        response = self.respond()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        self.assertEqual(int(response.headers["Content-Length"]), len(self.content))
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(read_body(response), self.content)

    def assert_range(self, header, start, end):
        response = self.respond(header)
        size = len(self.content)
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["Content-Range"], f"bytes {start}-{end}/{size}")
        self.assertEqual(int(response.headers["Content-Length"]), end - start + 1)
        self.assertEqual(read_body(response), self.content[start : end + 1])

    def test_leading_range(self):
        self.assert_range("bytes=0-99", 0, 99)

    def test_open_ended_range(self):
        self.assert_range("bytes=100-", 100, len(self.content) - 1)

    def test_suffix_range(self):
        size = len(self.content)
        self.assert_range("bytes=-100", size - 100, size - 1)

    def test_single_byte_range(self):
        self.assert_range("bytes=0-0", 0, 0)

    def test_range_past_the_end_is_unsatisfiable(self):
        with self.assertRaises(RequestedRangeNotSatisfiable):
            self.respond(f"bytes={len(self.content)}-")
