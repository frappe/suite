"""`suite.writer.api.embed`, against the documents ticket 29 made Drive-native.

`Writer Document` is registered in `drive_content_types`, so every document
written since is a `Drive Node` with no `File` row. Both endpoints read the
`File` first and refused one with `DoesNotExistError` before reaching the
workflow, so the editor could neither add a picture to a new document nor show
one back.

`add` decides nothing itself: it names the document as the upload destination
and `upload_file` runs the UPLOAD check on it. `get` serves a media node
through Drive's own signed byte path, whose READ check is the forwarder's.
These cases pin both halves and the refusals around them.
"""

from contextlib import contextmanager
from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_folder, purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.tests.fixtures import storage_v2
from suite.tests.utils import ensure_user
from suite.writer.api import embed
from suite.writer.api.docs import create_document

OWNER = "writer-embed-owner@example.com"
OTHER = "writer-embed-other@example.com"

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
    b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _admin() -> Principals:
    return Principals("Administrator", ("Administrator",), (), is_admin=True)


@contextmanager
def upload_request(content: bytes, filename: str):
    builder = EnvironBuilder(
        path="/api/method/suite.writer.api.embed.add",
        method="POST",
        data={"file": (BytesIO(content), filename)},
    )
    frappe.local.request = Request(builder.get_environ())
    values = {
        "uuid": frappe.generate_hash(12),
        "chunk_index": "",
        "total_chunk_count": "",
        "chunk_byte_offset": "",
    }
    frappe.form_dict.update(values)
    try:
        yield
    finally:
        for key in values:
            frappe.form_dict.pop(key, None)
        del frappe.local.request


class TestWriterEmbed(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user(OWNER)
        self.addCleanup(frappe.set_user, "Administrator")
        self.document = frappe._dict(create_document(title=f"Embeds {frappe.generate_hash(6)}"))
        self.addCleanup(self._purge, self.document.name)

    @staticmethod
    def _purge(node: str):
        frappe.set_user("Administrator")
        if not frappe.db.exists("Drive Node", node):
            return
        update(_admin(), node, state="Trashed")
        purge(_admin(), node)
        frappe.db.commit()

    def add(self, document: str, content: bytes = PNG, filename: str = "shot.png"):
        with (
            storage_v2(),
            upload_request(content, filename),
            patch("suite.drive.api.files.frappe.publish_realtime"),
        ):
            return embed.add(document)

    # add

    def test_a_picture_added_to_a_linked_document_becomes_a_node_below_it(self):
        """§9.4: an embed is a media node under the document it is in. The
        answer is still the legacy `embed.get?id=` URL the editor writes into
        the body, so the frontend contract is unchanged."""
        answer = self.add(self.document.name)

        node = answer["file_url"].rsplit("=", 1)[1]
        row = frappe.db.get_value("Drive Node", node, ("parent", "kind", "title"), as_dict=True)
        self.assertEqual(row.parent, self.document.name)
        self.assertEqual(row.kind, "file")
        self.assertTrue(row.title.startswith(f"{self.document.name} embed -"))
        self.assertFalse(frappe.db.exists("File", node), "no legacy row is written beside it")
        self.assertEqual(answer["file_url"], f"/api/method/suite.writer.api.embed.get?id={node}")

    def test_a_stranger_cannot_add_a_picture_and_is_not_told_the_document_exists(self):
        """The gate is `upload_file`'s UPLOAD check on the document node. §5.4
        hides a node below Read, so a stranger gets `DriveNotFound`."""
        frappe.set_user(OTHER)
        with self.assertRaises(DriveNotFound):
            self.add(self.document.name)

        self.assertEqual(self._children(self.document.name), [])

    def test_a_reader_cannot_add_a_picture(self):
        """A Read grant is not UPLOAD, and a reader is told so rather than
        hidden from."""
        grant(self.document.name, OTHER, drive.READ, _admin())
        frappe.db.commit()

        frappe.set_user(OTHER)
        with self.assertRaises(DriveForbidden):
            self.add(self.document.name)

        frappe.set_user("Administrator")
        self.assertEqual(self._children(self.document.name), [])

    def test_an_id_neither_store_holds_is_refused_before_the_upload(self):
        """`add` names its own destination, so an id that is not a document
        must not reach `upload_file` — it would place the picture wherever the
        caller pointed."""
        with self.assertRaises(frappe.DoesNotExistError):
            self.add("no-such-document")

    def test_a_folder_of_somebody_elses_cannot_be_named_as_the_document(self):
        """A `Drive Node` that is not a Writer document is not a document id.
        The refusal is by name, before any byte is written."""
        frappe.set_user("Administrator")
        root = personal_root_for(OTHER) or provision_personal_root(OTHER)
        theirs = create_folder(_admin(), root, f"Theirs {frappe.generate_hash(6)}")
        self.addCleanup(self._purge, theirs)
        frappe.db.commit()

        frappe.set_user(OWNER)
        with self.assertRaises(frappe.DoesNotExistError):
            self.add(theirs)

        self.assertEqual(self._children(theirs), [])

    # get

    def test_the_owner_reads_the_picture_back_through_drives_signed_path(self):
        """§6.8: every node byte path answers a redirect to a signature. That
        is what an `<img src>` needs, and it is the forwarder's READ check that
        decides, not this module."""
        node = self.add(self.document.name)["file_url"].rsplit("=", 1)[1]

        embed.get(node)

        self.assertEqual(frappe.local.response["type"], "redirect")
        self.assertTrue(frappe.local.response["location"])

    def test_a_stranger_is_refused_the_picture(self):
        node = self.add(self.document.name)["file_url"].rsplit("=", 1)[1]
        frappe.db.commit()

        frappe.set_user(OTHER)
        with self.assertRaises(DriveNotFound):
            embed.get(node)

    def test_a_reader_of_the_document_reads_its_pictures(self):
        """An embed inherits the document's grants, because it hangs under it."""
        node = self.add(self.document.name)["file_url"].rsplit("=", 1)[1]
        grant(self.document.name, OTHER, drive.READ, _admin())
        frappe.db.commit()

        frappe.set_user(OTHER)
        embed.get(node)

        self.assertEqual(frappe.local.response["type"], "redirect")

    def test_a_node_that_is_not_below_a_writer_document_is_not_an_embed(self):
        """The endpoint is guest-reachable, so it must not become a general
        byte reader for any node id a caller can name."""
        frappe.set_user("Administrator")
        root = personal_root_for(OWNER) or provision_personal_root(OWNER)
        folder = create_folder(_admin(), root, f"Loose {frappe.generate_hash(6)}")
        self.addCleanup(self._purge, folder)
        deck = drive.create_document(
            folder, f"Deck {frappe.generate_hash(6)}", content_doctype="Presentation"
        )
        frappe.db.commit()

        frappe.set_user(OWNER)
        with self.assertRaises(ValueError):
            embed.get(deck)

    def _children(self, node: str) -> list[str]:
        return frappe.get_all("Drive Node", filters={"parent": node, "state": "Active"}, pluck="name")

    def tearDown(self):
        frappe.local.response.pop("type", None)
        frappe.local.response.pop("location", None)
        super().tearDown()
