# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import json
import os

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.exceptions import Forbidden

from suite.drive.overrides.file import File as DriveFile
from suite.slides.api.file import validate_media_file
from suite.slides.doctype.presentation.presentation import get_updated_json, update_slide_attachments
from suite.slides.tests.utils import make_presentation, make_private_image
from suite.tests.utils import ensure_user

OWNER = "pasted-media-owner@example.com"
VIEWER = "pasted-media-viewer@example.com"


def share_read(presentation_name, user):
    entity = DriveFile.get_for_doc("Presentation", presentation_name)
    frappe.get_doc({"doctype": "Drive Permission", "entity": entity, "user": user, "read": 1}).insert(
        ignore_permissions=True
    )


def attached_to(file_url):
    return set(frappe.get_all("File", {"file_url": file_url}, pluck="attached_to_name", order_by=None))


class TestPastedMedia(IntegrationTestCase):
    """Media pasted from another presentation must end up attached to the destination,
    or viewers of the destination get a 403 for it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(VIEWER)
        with cls.set_user(OWNER):
            cls.source = make_presentation("Paste Source").name
            cls.image_url = make_private_image(cls.source).file_url
            cls.poster_url = make_private_image(cls.source).file_url

    def make_destination(self, title):
        with self.set_user(OWNER):
            name = make_presentation(title).name
        share_read(name, VIEWER)
        return name

    def assert_viewer_sees(self, url, presentation):
        with self.set_user(VIEWER):
            self.assertIsNone(validate_media_file(url, presentation))

    def test_element_paste_attaches_src_and_poster(self):
        destination = self.make_destination("Element Paste Destination")
        video = {"type": "video", "src": self.image_url, "poster": self.poster_url}

        with self.set_user(VIEWER):
            with self.assertRaises(Forbidden):
                validate_media_file(self.image_url, destination)

        with self.set_user(OWNER):
            elements = get_updated_json(destination, [video])

        self.assertEqual(elements[0]["src"], self.image_url)
        self.assertIn(destination, attached_to(self.image_url))
        self.assertIn(destination, attached_to(self.poster_url))
        self.assert_viewer_sees(self.image_url, destination)
        self.assert_viewer_sees(self.poster_url, destination)

    def test_slide_paste_attaches_poster(self):
        destination = self.make_destination("Slide Paste Destination")
        slide = {
            "elements": json.dumps([{"type": "video", "src": self.image_url, "poster": self.poster_url}])
        }

        with self.set_user(OWNER):
            update_slide_attachments(destination, slide)

        self.assertIn(destination, attached_to(self.poster_url))
        self.assert_viewer_sees(self.poster_url, destination)

    def test_broken_poster_does_not_fail_the_paste(self):
        destination = self.make_destination("Broken Poster Destination")
        with self.set_user(OWNER):
            gone = make_private_image(self.source)
            os.remove(gone.get_full_path())
            legacy = {"type": "video", "src": self.image_url, "poster": {"posterURL": gone.file_url}}
            missing = {"type": "video", "src": self.image_url, "poster": gone.file_url}

            elements = get_updated_json(destination, [legacy, missing])

        self.assertEqual(len(elements), 2)
        self.assertIn(destination, attached_to(self.image_url))
        self.assertNotIn(destination, attached_to(gone.file_url))
