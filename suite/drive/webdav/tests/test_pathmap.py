"""Path resolution and the DAV naming policy, against `Drive Node`.

One mount: the caller's Personal Root is `/dav/` itself (§12). There is no
`Home` alias, no `Everyone` mount, and nothing above the root to list.
"""

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive._core.nodes import create_link, update
from suite.drive.webdav import pathmap
from suite.drive.webdav.errors import BadGateway, BadRequest, Forbidden
from suite.drive.webdav.tests.utils import (
    drop_dav_root,
    drop_nodes,
    ensure_user_with_password,
    file_node,
    folder_node,
    node_principals,
    personal_dav_root,
    raw_child_node,
    raw_document_node,
)
from suite.tests.utils import ensure_user

USER = "webdav-pathmap@example.com"
ROOTLESS = "webdav-pathmap-rootless@example.com"


def resolve(path: str, user: str = USER):
    pathmap.reset_memo()
    return pathmap.resolve([segment for segment in path.split("/") if segment], user)


class TestWebDAVPathmap(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(USER, "webdav-pathmap-pw")
        ensure_user(ROOTLESS)
        cls.root = personal_dav_root(USER)
        cls.docs = folder_node(USER, cls.root, "Docs")
        cls.report = file_node(USER, cls.docs, "Report.txt", b"report")

    def setUp(self):
        frappe.set_user(USER)
        pathmap.reset_memo()

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def test_the_mount_is_the_personal_root(self):
        mount = resolve("")
        self.assertTrue(mount.is_mount)
        self.assertTrue(mount.is_collection)
        self.assertEqual(mount.node.name, self.root)
        self.assertEqual(mount.node.kind, "root")
        # `.entity` is the pre-relink spelling the parked write verbs still read
        self.assertIs(mount.entity, mount.node)

    def test_legacy_mount_aliases_are_gone(self):
        for alias in ("Home", "home", "Everyone", "everyone", "Shared"):
            result = resolve(alias)
            self.assertFalse(result.exists, f"/dav/{alias} must not resolve")
            self.assertFalse(result.is_mount)
            # an alias is now an ordinary missing leaf below the root
            self.assertEqual(result.parent.name, self.root)

    def test_a_user_with_no_personal_root_has_no_mount(self):
        drop_dav_root(ROOTLESS)
        mount = resolve("", user=ROOTLESS)
        self.assertFalse(mount.exists)
        self.assertFalse(mount.is_mount)
        self.assertFalse(mount.missing_intermediate)

        below = resolve("Docs/Report.txt", user=ROOTLESS)
        self.assertFalse(below.exists)
        self.assertTrue(below.missing_intermediate)
        self.assertIsNone(below.parent)

    def test_nested_resolution(self):
        result = resolve("Docs/Report.txt")
        self.assertEqual(result.node.name, self.report.name)
        self.assertFalse(result.is_collection)

        folder = resolve("Docs")
        self.assertEqual(folder.node.name, self.docs)
        self.assertTrue(folder.is_collection)
        self.assertFalse(folder.is_mount)

    def test_missing_leaf_keeps_parent(self):
        result = resolve("Docs/new-file.bin")
        self.assertFalse(result.exists)
        self.assertEqual(result.parent.name, self.docs)
        self.assertFalse(result.missing_intermediate)

    def test_missing_intermediate(self):
        result = resolve("NoSuchFolder/file.txt")
        self.assertFalse(result.exists)
        self.assertIsNone(result.parent)
        self.assertTrue(result.missing_intermediate)

    def test_a_file_cannot_be_walked_through(self):
        result = resolve("Docs/Report.txt/deeper.txt")
        self.assertFalse(result.exists)
        self.assertTrue(result.missing_intermediate)

    def test_case_variant_lookup_falls_back_when_unambiguous(self):
        self.assertEqual(resolve("docs/REPORT.TXT").node.name, self.report.name)

    def test_exact_case_wins_and_ambiguity_resolves_nothing(self):
        # `_refuse_sibling_collision` compares in the site collation, so Drive
        # will not create this pair itself; the BINARY-first walk still has to
        # answer for one a legacy import or a restore left behind.
        lower = raw_child_node(self.docs, "report.txt")
        try:
            self.assertEqual(resolve("Docs/Report.txt").node.name, self.report.name)
            self.assertEqual(resolve("Docs/report.txt").node.name, lower)
            self.assertFalse(resolve("Docs/REPORT.TXT").exists)
        finally:
            drop_nodes([lower])

    def test_exact_duplicates_resolve_to_the_oldest(self):
        younger = raw_child_node(self.docs, "Report.txt")
        try:
            self.assertEqual(resolve("Docs/Report.txt").node.name, self.report.name)
        finally:
            drop_nodes([younger])

    def test_content_documents_and_their_media_are_unreachable(self):
        """§12.2: a document 404s by direct URL, and that hides its media too."""
        document = raw_document_node(self.docs, "Deck")
        media = file_node(USER, document, "slide-1.png", b"png-bytes")
        try:
            self.assertFalse(resolve("Docs/Deck").exists)
            self.assertFalse(pathmap.visible(pathmap.fetch(document)))

            # the media node is an ordinary file; the only path to it runs
            # through the hidden document segment, which stops the walk
            self.assertEqual(pathmap.fetch(media.name).kind, "file")
            through_document = resolve("Docs/Deck/slide-1.png")
            self.assertFalse(through_document.exists)
            self.assertTrue(through_document.missing_intermediate)
        finally:
            drop_nodes([media.name, document])

    def test_an_uploaded_office_file_stays_visible(self):
        """Visibility is the node kind, never the filename extension (§12.2)."""
        docx = file_node(USER, self.docs, "report.docx", b"PK\x03\x04 not really a docx")
        try:
            self.assertEqual(resolve("Docs/report.docx").node.name, docx.name)
            self.assertTrue(pathmap.visible(pathmap.fetch(docx.name)))
        finally:
            drop_nodes([docx.name])

    def test_link_nodes_are_invisible(self):
        link = create_link(node_principals(USER), self.docs, "Site", url="https://example.test")
        try:
            self.assertFalse(resolve("Docs/Site").exists)
            self.assertFalse(pathmap.visible(pathmap.fetch(link)))
        finally:
            drop_nodes([link])

    def test_visible_covers_state_kind_template_and_spelling(self):
        """The same four tests `_VISIBLE` makes in SQL, so a row dropped from a
        listing and a row a path lookup will not reach answer alike."""

        def row(**overrides):
            base = frappe._dict(state="Active", kind="file", is_template=0, title="ok.txt")
            base.update(overrides)
            return base

        self.assertTrue(pathmap.visible(row()))
        self.assertTrue(pathmap.visible(row(kind="folder")))
        for hidden in (row(kind="document"), row(kind="link"), row(kind="root")):
            self.assertFalse(pathmap.visible(hidden))
        self.assertFalse(pathmap.visible(row(state="Trashed")))
        self.assertFalse(pathmap.visible(row(state=None)))
        self.assertFalse(pathmap.visible(row(is_template=1)))
        self.assertFalse(pathmap.visible(row(title="a/b.txt")))

    def test_unaddressable_titles_are_not_published(self):
        """Drive accepts these titles; no DAV URL can name them, so a listing
        drops them rather than publishing a href it cannot parse back."""
        for title in ("a/b.txt", "a\\b.txt", ".", "..", "ctl\x01.txt", ""):
            self.assertFalse(pathmap.addressable(frappe._dict(title=title)), title)
        for title in ("100%.txt", "Café.md", ".DS_Store", "report.docx"):
            self.assertTrue(pathmap.addressable(frappe._dict(title=title)), title)

    def test_slashed_title_is_dropped_from_the_namespace(self):
        slashed = folder_node(USER, self.docs, "a/b.txt")
        try:
            self.assertFalse(pathmap.visible(pathmap.fetch(slashed)))
            # the client cannot spell it either: the slash splits into segments
            self.assertFalse(resolve("Docs/a/b.txt").exists)
        finally:
            drop_nodes([slashed])

    def test_trashed_names_are_free(self):
        gone = file_node(USER, self.docs, "gone.txt", b"bye")
        update(node_principals(USER), gone.name, state="Trashed")
        self.assertFalse(resolve("Docs/gone.txt").exists)
        self.assertFalse(pathmap.visible(pathmap.fetch(gone.name)))

    def test_validate_dav_name(self):
        parent = frappe._dict(name=self.docs)
        pathmap.validate_dav_name("fine.txt", parent)
        pathmap.validate_dav_name(".DS_Store", parent)  # Finder writes these constantly
        # the on-disk layout went with the `File` tree, so its names are free
        for freed in (".trash", ".uploads", ".Thumbnails", "Users"):
            pathmap.validate_dav_name(freed, parent)

        for bad in ("", "a" * 141, "a/b", "a\\b", ".", "..", "ctl\x01"):
            with self.assertRaises(BadRequest):
                pathmap.validate_dav_name(bad, parent)

        for reserved in (".embeds", ".EMBEDS"):
            with self.assertRaises(Forbidden):
                pathmap.validate_dav_name(reserved, parent)

    def test_parse_destination(self):
        def request(destination=None, host="s2.localhost:8001"):
            headers = {"Destination": destination} if destination else {}
            builder = EnvironBuilder(method="MOVE", path="/dav/a", headers=headers)
            builder.host = host
            return Request(builder.get_environ())

        segments, slash = pathmap.parse_destination(request("http://s2.localhost:8001/dav/Docs/Caf%C3%A9/"))
        self.assertEqual(segments, ["Docs", "Café"])
        self.assertTrue(slash)

        segments, slash = pathmap.parse_destination(request("/dav/Docs/b.txt"))
        self.assertEqual(segments, ["Docs", "b.txt"])
        self.assertFalse(slash)

        # a Host-rewriting proxy ($host) drops the port; only an explicit conflict rejects
        segments, _ = pathmap.parse_destination(
            request("http://s2.localhost:8001/dav/Docs/c", host="s2.localhost")
        )
        self.assertEqual(segments, ["Docs", "c"])
        with self.assertRaises(BadGateway):
            pathmap.parse_destination(request("http://s2.localhost:9999/dav/Docs/x"))

        with self.assertRaises(BadGateway):
            pathmap.parse_destination(request("http://evil.example.com/dav/Docs/x"))
        with self.assertRaises(BadGateway):
            pathmap.parse_destination(request("http://s2.localhost:8001/files/x"))
        with self.assertRaises(BadRequest):
            pathmap.parse_destination(request(None))

    def test_href_encoding(self):
        self.assertEqual(pathmap.href_for([], True), "/dav/")
        self.assertEqual(pathmap.href_for(["Docs", "a b.txt"], False), "/dav/Docs/a%20b.txt")
        self.assertEqual(pathmap.href_for(["Docs", "Café"], True), "/dav/Docs/Caf%C3%A9/")
