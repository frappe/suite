"""`suite.slides.api.media`: a deck's pictures are Drive media nodes below the deck.

The case that matters is the public link: a guest who can read the deck must
get a signed URL for every picture it shows (T3-21). The refusals pin who may
add media at all. A still PNG or JPEG is stored as WebP; other media, and any
picture that cannot be converted whole, as uploaded.
"""

from contextlib import contextmanager
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from PIL import Image, ImageCms, ImageFile
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.slides import drive as slides_drive
from suite.slides.api import media
from suite.slides.tests.utils import PNG_1PX, make_presentation, make_public, node_of, share, unique_bytes
from suite.tests.utils import ensure_user

OWNER = "slides-media-owner@example.com"
READER = "slides-media-reader@example.com"


@contextmanager
def upload_request(content: bytes, filename: str, mimetype: str = "image/png"):
    builder = EnvironBuilder(
        path="/api/method/suite.slides.api.media.add",
        method="POST",
        data={"file": (BytesIO(content), filename, mimetype)},
    )
    frappe.local.request = Request(builder.get_environ())
    try:
        yield
    finally:
        del frappe.local.request


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'


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


def animated_gif() -> bytes:
    return animated("GIF")


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
            ("spinner.gif", "image/gif", animated_gif()),
            ("spinner.png", "image/png", animated("PNG")),
        ):
            with self.subTest(filename):
                self.assertStoredAsUploaded(content, filename, mimetype)

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
