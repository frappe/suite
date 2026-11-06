"""`move_file_media_to_drive`: a deck's File-backed pictures become media nodes below it."""

from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.slides.patches import move_file_media_to_drive
from suite.slides.patches.move_file_media_to_drive import convert_deck, execute
from suite.slides.tests.utils import make_presentation, make_private_image, node_of
from suite.tests.utils import ensure_user

OWNER = "slides-media-patch@example.com"
OTHER_OWNER = "slides-media-patch-other@example.com"
RETRY = "execute suite.slides.patches.move_file_media_to_drive.execute"


@contextmanager
def deck_transactions():
    # a savepoint stands in for each deck's transaction, so a failed deck really rolls back
    savepoint = "deck_transaction"
    rollback = frappe.db.rollback

    def commit():
        frappe.db.savepoint(savepoint)

    def rollback_deck(*, save_point=None, chain=False):
        rollback(save_point=save_point or savepoint)

    commit()
    with patch.object(frappe.db, "commit", commit), patch.object(frappe.db, "rollback", rollback_deck):
        yield


def failure_logs(docname):
    return frappe.get_all(
        "Error Log",
        filters={"method": f"Slides: could not move the media of {docname} to Drive"},
        pluck="error",
    )


class TestMoveFileMediaToDrive(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        ensure_user(OWNER)
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.deck = make_presentation(f"Legacy media {frappe.generate_hash(6)}")
        self.file = make_private_image(self.deck.name)
        self.slide = self.deck.slides[0].name

    def write_body(self, background, elements):
        frappe.db.set_value(
            "Slide", self.slide, {"background": background, "elements": frappe.as_json(elements)}
        )

    def body(self):
        row = frappe.db.get_value("Slide", self.slide, ["background", "elements"], as_dict=True)
        return row.background, frappe.parse_json(row.elements)

    def reading_the_file_raises(self, error):
        file_class = type(self.file)
        read = file_class._read_content

        def read_or_raise(file):
            if file.name == self.file.name:
                raise error

            return read(file)

        return patch.object(file_class, "_read_content", read_or_raise)

    def test_every_legacy_url_in_the_body_becomes_one_media_node_below_the_deck(self):
        url = self.file.file_url
        self.write_body(
            url, [{"type": "image", "src": url}, {"type": "video", "src": "/files/gone.mp4", "poster": url}]
        )

        frappe.set_user("Administrator")
        convert_deck(self.deck.name, node_of(self.deck.name))

        background, elements = self.body()
        picture = elements[0]["src"]
        self.assertEqual(frappe.db.get_value("Drive Node", picture, "parent_node"), node_of(self.deck.name))
        self.assertEqual(background, picture)
        self.assertEqual(elements[1]["poster"], picture)
        # a URL with no File behind it is left for the legacy read path
        self.assertEqual(elements[1]["src"], "/files/gone.mp4")

    def test_a_second_run_finds_nothing_left_to_convert(self):
        self.write_body("#ffffffff", [{"type": "image", "src": self.file.file_url}])

        frappe.set_user("Administrator")
        convert_deck(self.deck.name, node_of(self.deck.name))
        _, converted = self.body()

        self.assertEqual(convert_deck(self.deck.name, node_of(self.deck.name)), {})
        self.assertEqual(self.body()[1], converted)

    def test_a_url_of_another_decks_file_stays_on_the_legacy_read_path(self):
        other = make_presentation(f"Other deck {frappe.generate_hash(6)}")
        foreign = make_private_image(other.name)
        self.write_body("#ffffffff", [{"type": "image", "src": foreign.file_url}])

        frappe.set_user("Administrator")
        self.assertEqual(convert_deck(self.deck.name, node_of(self.deck.name)), {})
        self.assertEqual(self.body()[1][0]["src"], foreign.file_url)

    def test_a_failed_deck_stays_legacy_and_logged_while_the_others_convert_and_a_rerun_finishes_it(self):
        healthy = make_presentation(f"Healthy deck {frappe.generate_hash(6)}")
        healthy_file = make_private_image(healthy.name)
        healthy_slide = healthy.slides[0].name
        frappe.db.set_value(
            "Slide",
            healthy_slide,
            "elements",
            frappe.as_json([{"type": "image", "src": healthy_file.file_url}]),
        )
        self.write_body("#ffffffff", [{"type": "image", "src": self.file.file_url}])

        def fail_for_one_deck(docname, node):
            mapping = convert(docname, node)
            if docname == self.deck.name:
                raise OSError("storage is down")
            return mapping

        convert = move_file_media_to_drive.convert_deck
        frappe.set_user("Administrator")
        with deck_transactions():
            with patch.object(move_file_media_to_drive, "convert_deck", fail_for_one_deck):
                execute()

            healthy_src = frappe.parse_json(frappe.db.get_value("Slide", healthy_slide, "elements"))[0]["src"]
            self.assertEqual(
                frappe.db.get_value("Drive Node", healthy_src, "parent_node"), node_of(healthy.name)
            )
            self.assertEqual(self.body()[1][0]["src"], self.file.file_url)
            logs = failure_logs(self.deck.name)
            self.assertEqual(len(logs), 1)
            self.assertIn("storage is down", logs[0])
            self.assertIn(RETRY, logs[0])

            execute()
        self.assertEqual(
            frappe.db.get_value("Drive Node", self.body()[1][0]["src"], "parent_node"),
            node_of(self.deck.name),
        )

    def test_a_deck_over_quota_leaves_nothing_behind_and_converts_once_there_is_room(self):
        second_file = make_private_image(self.deck.name)
        urls = [self.file.file_url, second_file.file_url]
        self.write_body("#ffffffff", [{"type": "image", "src": url} for url in urls])
        node = node_of(self.deck.name)
        root = frappe.db.get_value("Drive Node", node, "root")

        ensure_user(OTHER_OWNER)
        frappe.set_user(OTHER_OWNER)
        suffix = frappe.generate_hash(6)
        healthy = make_presentation(f"Healthy deck {suffix}")
        healthy_file = make_private_image(healthy.name)
        healthy_slide = healthy.slides[0].name
        frappe.db.set_value(
            "Slide",
            healthy_slide,
            "elements",
            frappe.as_json([{"type": "image", "src": healthy_file.file_url}]),
        )

        frappe.set_user("Administrator")
        used, quota = frappe.db.get_value("Drive Root", root, ["used_bytes", "quota_bytes"])
        self.addCleanup(frappe.db.set_value, "Drive Root", root, "quota_bytes", quota)
        sizes = [len(file.get_content()) for file in (self.file, second_file)]
        # room for either picture but not both, so the deck fails partway through
        frappe.db.set_value("Drive Root", root, "quota_bytes", used + max(sizes))
        children = frappe.db.count("Drive Node", {"parent_node": node})
        reservations = frappe.db.count("Drive Storage Reservation", {"root": root})

        with deck_transactions():
            execute()

            self.assertEqual(frappe.db.get_value("Drive Root", root, "used_bytes"), used)
            self.assertEqual(frappe.db.count("Drive Node", {"parent_node": node}), children)
            self.assertEqual(frappe.db.count("Drive Storage Reservation", {"root": root}), reservations)
            _, elements = self.body()
            self.assertEqual([element["src"] for element in elements], urls)
            logs = failure_logs(self.deck.name)
            self.assertEqual(len(logs), 1)
            self.assertIn("DriveOverQuota", logs[0])
            self.assertIn(RETRY, logs[0])
            [healthy_element] = frappe.parse_json(frappe.db.get_value("Slide", healthy_slide, "elements"))
            self.assertEqual(
                frappe.db.get_value("Drive Node", healthy_element["src"], "parent_node"),
                node_of(healthy.name),
            )

            frappe.db.set_value("Drive Root", root, "quota_bytes", used + sum(sizes))
            execute()

        _, elements = self.body()
        for element in elements:
            self.assertEqual(frappe.db.get_value("Drive Node", element["src"], "parent_node"), node)

    def test_a_file_that_cannot_be_read_fails_its_deck_and_the_others_still_convert(self):
        suffix = frappe.generate_hash(6)
        healthy = make_presentation(f"Healthy deck {suffix}")
        healthy_file = make_private_image(healthy.name)
        healthy_slide = healthy.slides[0].name
        frappe.db.set_value(
            "Slide",
            healthy_slide,
            "elements",
            frappe.as_json([{"type": "image", "src": healthy_file.file_url}]),
        )
        self.write_body("#ffffffff", [{"type": "image", "src": self.file.file_url}])

        frappe.set_user("Administrator")
        with deck_transactions():
            with self.reading_the_file_raises(PermissionError("the disk refused")):
                execute()

            [healthy_element] = frappe.parse_json(frappe.db.get_value("Slide", healthy_slide, "elements"))
            self.assertEqual(
                frappe.db.get_value("Drive Node", healthy_element["src"], "parent_node"),
                node_of(healthy.name),
            )
            _, elements = self.body()
            self.assertEqual(elements[0]["src"], self.file.file_url)
            logs = failure_logs(self.deck.name)
            self.assertEqual(len(logs), 1)
            self.assertIn("the disk refused", logs[0])
            self.assertIn(RETRY, logs[0])

            execute()

        _, elements = self.body()
        self.assertEqual(
            frappe.db.get_value("Drive Node", elements[0]["src"], "parent_node"), node_of(self.deck.name)
        )

    def test_a_file_whose_bytes_are_lost_keeps_its_url_and_is_not_a_failure(self):
        readable = make_private_image(self.deck.name)
        self.write_body(
            "#ffffffff",
            [{"type": "image", "src": self.file.file_url}, {"type": "image", "src": readable.file_url}],
        )

        frappe.set_user("Administrator")
        with deck_transactions(), self.reading_the_file_raises(FileNotFoundError("no bytes")):
            execute()

        _, (lost, converted) = self.body()
        self.assertEqual(lost["src"], self.file.file_url)
        self.assertEqual(
            frappe.db.get_value("Drive Node", converted["src"], "parent_node"), node_of(self.deck.name)
        )
        self.assertEqual(failure_logs(self.deck.name), [])
