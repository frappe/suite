"""`suite.slides.api.media`: a deck's pictures are Drive media nodes below the deck.

The case that matters is the public link: a guest who can read the deck must
get a signed URL for every picture it shows (T3-21). The refusals pin who may
add media at all. A still PNG or JPEG is stored as WebP; other media, and any
picture that cannot be converted whole, as uploaded.
"""

import os
import time
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.storage.blob import SNIFF_BYTES
from frappe.tests import IntegrationTestCase
from PIL import Image, ImageCms, ImageFile

from suite import drive
from suite.slides import drive as slides_drive
from suite.slides.api import media
from suite.slides.tests.utils import (
    PNG_1PX,
    make_presentation,
    make_public,
    node_of,
    share,
    unique_bytes,
    upload_request,
)
from suite.tests.utils import ensure_user

OWNER = "slides-media-owner@example.com"
READER = "slides-media-reader@example.com"


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
# The first bytes each format starts with, as cameras and encoders write them
MP4_START = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
MOV_START = b"\x00\x00\x00\x14ftypqt  \x00\x00\x02\x00qt  "
WEBM_START = (
    b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08"
    b"\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02"
)


def gradient(size: tuple[int, int] = (256, 256)) -> Image.Image:
    """A photo-like picture, the kind a deck shows."""
    width, height = size
    image = Image.new("RGB", size)
    image.putdata([(x % 256, y % 256, (x + y) // 2 % 256) for y in range(height) for x in range(width)])
    return image


def encoded(image: Image.Image, image_format: str = "PNG", **options) -> bytes:
    output = BytesIO()
    image.save(output, format=image_format, **options)
    return output.getvalue()


def with_a_flipped_idat_byte(png: bytes) -> bytes:
    start = png.index(b"IDAT") + 4
    return png[:start] + bytes([png[start] ^ 0xFF]) + png[start + 1 :]


def animated(image_format: str) -> bytes:
    frames = [Image.new("RGB", (8, 8), colour) for colour in ("red", "blue")]
    return encoded(frames[0], image_format, save_all=True, append_images=frames[1:], duration=100, loop=0)


class TestSlidesMedia(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(READER)

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Media {frappe.generate_hash(6)}")
        # A worker that has imported `frappe.utils.image` runs with this on.
        truncated_images = patch.object(ImageFile, "LOAD_TRUNCATED_IMAGES", True)
        truncated_images.start()
        self.addCleanup(truncated_images.stop)

    def upload(self, filename="banner.png", mimetype="image/png", content=None):
        with upload_request(content or unique_bytes(PNG_1PX), filename, mimetype):
            return media.add(self.deck.name)

    def assertStoredAsUploaded(self, content: bytes, filename: str = "kept.png", mimetype: str = "image/png"):
        answer = self.upload(filename, mimetype, content)

        self.assertEqual(drive.read_file(answer["file_url"])[0].read(), content)
        self.assertEqual(answer["file_name"], filename)

    def stored_picture(self, content: bytes, filename: str = "photo.jpg", mimetype: str = "image/jpeg"):
        """Answer the WebP stored for an upload, opened."""
        answer = self.upload(filename, mimetype, content)
        self.assertEqual(answer["file_name"], f"{filename.rsplit('.', 1)[0]}.webp")
        stored = Image.open(BytesIO(drive.read_file(answer["file_url"])[0].read()))
        self.addCleanup(stored.close)
        self.assertEqual(stored.format, "WEBP")
        return stored

    def test_a_public_link_guest_can_read_an_uploaded_picture(self):
        picture = self.upload(content=unique_bytes(PNG_1PX))["file_url"]
        stored = drive.read_file(picture)[0].read()
        make_public(self.deck.name)

        frappe.set_user("Guest")
        stream, mime = drive.read_file(picture)

        self.assertEqual(stream.read(), stored)
        self.assertEqual(mime, "image/webp")

    def test_a_png_is_stored_as_a_smaller_webp(self):
        png = encoded(gradient())
        answer = self.upload("photo.png", content=png)

        stream, mime = drive.read_file(answer["file_url"])
        stored = stream.read()

        self.assertEqual(mime, "image/webp")
        self.assertEqual((stored[:4], stored[8:12]), (b"RIFF", b"WEBP"))
        self.assertLess(len(stored), len(png))
        self.assertEqual(answer["file_name"], "photo.webp")
        self.assertEqual(frappe.db.get_value("Drive Node", answer["file_url"], "title"), "photo.webp")

    def test_an_svg_or_an_animated_gif_is_stored_as_uploaded(self):
        for filename, mimetype, content in (
            ("logo.svg", "image/svg+xml", SVG),
            ("spinner.gif", "image/gif", animated("GIF")),
            ("spinner.png", "image/png", animated("PNG")),
        ):
            with self.subTest(filename):
                self.assertStoredAsUploaded(content, filename, mimetype)

    def test_an_svg_after_a_bom_a_comment_or_a_doctype_is_stored_as_uploaded(self):
        # Longer than the bytes a sniff reads, so the whole file must be stored
        drawing = SVG.replace(b"/>", b"/>" + b"<!-- padding -->" * 1024, 1)
        doctype = b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
        cases = {
            "a BOM": b"\xef\xbb\xbf" + drawing,
            "a comment": b"<!-- Made in a drawing app -->\n" + drawing,
            "a DOCTYPE": doctype + b"\n" + drawing,
        }
        for case, content in cases.items():
            with self.subTest(case):
                self.assertStoredAsUploaded(content, "logo.svg", "image/svg+xml")

    def test_an_svg_whose_doctype_declares_entities_is_stored_as_uploaded(self):
        # As Illustrator's Save As SVG writes one, its root past Frappe's look for it
        entities = b""
        for index in range(12):
            entities += b'\t<!ENTITY ns_%d "http://ns.adobe.com/Extensibility/%d.0/">\n' % (index, index)

        drawing = (
            b'<?xml version="1.0" encoding="utf-8"?>\n'
            b"<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In -->\n"
            b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n'
            + entities
            + b"]>\n"
            + SVG
        )
        self.assertGreater(drawing.index(b"<svg"), 512)

        self.assertStoredAsUploaded(drawing, "logo.svg", "image/svg+xml")

    def test_a_video_is_stored_as_uploaded(self):
        for filename, mimetype, start in (
            ("talk.mp4", "video/mp4", MP4_START),
            ("talk.mov", "video/quicktime", MOV_START),
            ("talk.webm", "video/webm", WEBM_START),
        ):
            with self.subTest(filename):
                self.assertStoredAsUploaded(start + frappe.generate_hash(32).encode(), filename, mimetype)

    def test_a_jpeg_sent_as_a_png_is_stored_as_a_webp(self):
        jpeg = encoded(gradient(), "JPEG")

        self.assertEqual(self.stored_picture(jpeg, "photo.png", "image/png").size, (256, 256))

    def test_a_gif_longer_than_a_sniff_is_stored_whole(self):
        noise = Image.frombytes("L", (128, 128), os.urandom(128 * 128))
        gif = encoded(noise, "GIF")
        self.assertGreater(len(gif), SNIFF_BYTES)

        self.assertStoredAsUploaded(gif, "noise.gif", "image/gif")

    def test_a_damaged_picture_is_stored_as_uploaded_whatever_pillows_flag_says(self):
        png = encoded(gradient())
        jpeg = encoded(gradient(), "JPEG")
        progressive = encoded(gradient(), "JPEG", progressive=True)
        for flag in (True, False):
            for filename, mimetype, content in (
                ("cut.png", "image/png", png[: len(png) // 2]),
                ("crc.png", "image/png", with_a_flipped_idat_byte(png)),
                ("cut.jpg", "image/jpeg", jpeg[: len(jpeg) // 2]),
                ("cut-progressive.jpg", "image/jpeg", progressive[: len(progressive) // 2]),
            ):
                with (
                    self.subTest(filename, flag=flag),
                    patch.object(ImageFile, "LOAD_TRUNCATED_IMAGES", flag),
                ):
                    self.assertStoredAsUploaded(content, filename, mimetype)

    def test_a_cut_jpeg_is_kept_even_with_a_whole_thumbnail_in_its_header(self):
        thumbnail = encoded(gradient((16, 16)), "JPEG")
        jpeg = encoded(gradient(), "JPEG", exif=b"Exif\x00\x00" + thumbnail)
        self.assertIn(b"\xff\xd9", jpeg[: len(jpeg) // 2])

        self.assertStoredAsUploaded(jpeg[: len(jpeg) // 2], "cut.jpg", "image/jpeg")

    def test_a_picture_wider_than_webp_allows_is_stored_as_uploaded(self):
        self.assertStoredAsUploaded(encoded(Image.new("RGB", (17000, 10))), "banner.png")

    def test_a_picture_above_the_pixel_limit_is_stored_as_uploaded(self):
        self.assertStoredAsUploaded(encoded(Image.new("1", (8100, 8100))), "poster.png")

    def test_a_picture_webp_would_change_is_stored_as_uploaded(self):
        grey_ramp = Image.new("I;16", (7, 1))
        grey_ramp.putdata([0, 1, 2, 64, 128, 200, 255])
        colour_key = Image.new("RGB", (8, 8), (1, 2, 3))
        for filename, mimetype, content in (
            ("ramp.png", "image/png", encoded(grey_ramp)),
            ("key.png", "image/png", encoded(colour_key, transparency=(1, 2, 3))),
            ("print.jpg", "image/jpeg", encoded(Image.new("CMYK", (8, 8), (255, 0, 0, 0)), "JPEG")),
        ):
            with self.subTest(filename):
                self.assertStoredAsUploaded(content, filename, mimetype)

    def test_a_grey_png_keeps_its_transparent_shade_as_a_webp(self):
        grey = Image.new("L", (64, 8), 200)
        grey.paste(10, (0, 0, 32, 8))

        stored = self.stored_picture(encoded(grey, transparency=10), "grey.png", "image/png").convert("RGBA")

        self.assertEqual(stored.getpixel((8, 4))[3], 0)
        self.assertEqual(stored.getpixel((56, 4))[3], 255)

    def test_a_multi_picture_jpeg_is_stored_as_a_webp_of_its_first_picture(self):
        first, second = gradient((32, 16)), gradient((8, 8))
        jpeg = encoded(first, "MPO", save_all=True, append_images=[second])

        self.assertEqual(self.stored_picture(jpeg).size, (32, 16))

    def test_a_jpeg_is_stored_upright_from_its_exif_orientation(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # rotated a quarter turn
        jpeg = encoded(gradient((64, 32)), "JPEG", exif=exif)

        self.assertEqual(self.stored_picture(jpeg).size, (32, 64))

    def test_a_picture_keeps_its_colour_profile(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        jpeg = encoded(gradient(), "JPEG", icc_profile=profile)

        self.assertEqual(self.stored_picture(jpeg).info.get("icc_profile"), profile)

    def test_the_picture_lives_below_the_deck_and_counts_as_used_once_shown(self):
        picture = self.upload()["file_url"]
        slide = self.deck.slides[0]
        frappe.db.set_value(
            "Slide", slide.name, "elements", frappe.as_json([{"type": "image", "src": picture}])
        )

        self.assertEqual(frappe.db.get_value("Drive Node", picture, "parent_node"), node_of(self.deck.name))
        self.assertIn(picture, slides_drive.used_nodes(self.deck.name))

    def test_a_reader_cannot_add_media(self):
        share(self.deck.name, READER)

        frappe.set_user(READER)
        with self.assertRaises(drive.DriveForbidden):
            self.upload()

    def test_a_file_that_is_not_a_picture_or_video_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self.upload("notes.txt", "text/plain")

    def test_a_file_sent_as_a_picture_that_is_not_one_is_refused(self):
        for filename, mimetype, content in (
            ("notes.png", "image/png", b"Plain words, not a picture"),
            ("page.png", "image/png", b"<!doctype html><p>Not a picture</p>"),
            ("talk.mp4", "video/mp4", b"Plain words, not a video"),
            ("logo.svg", "image/svg+xml", b"Plain words, not a drawing"),
            ("logo.svg", "image/svg+xml", b"<html><body>Not a drawing</body></html>"),
            ("logo.svg", "image/svg+xml", b"<!-- Made by hand -->\n<html><p>Not a drawing</p></html>"),
        ):
            with self.subTest(filename), self.assertRaises(frappe.ValidationError):
                self.upload(filename, mimetype, content)

        self.assertFalse(
            frappe.db.exists("Drive Node", {"parent_node": node_of(self.deck.name), "kind": "file"})
        )

    def test_words_after_a_sniff_of_spaces_or_comments_are_refused_at_once(self):
        for case, content in (
            ("spaces", b" " * SNIFF_BYTES + b"Plain words"),
            ("empty comments", b"<!---->" * 500 + b"Plain words"),
        ):
            started = time.monotonic()
            with self.subTest(case), self.assertRaises(frappe.ValidationError):
                self.upload("logo.svg", "image/svg+xml", content)

            # A pattern that backtracks takes minutes on these
            self.assertLess(time.monotonic() - started, 2)
