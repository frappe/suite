"""What WebDAV read promises once it answers from `Drive Node` (§12).

These run with no site and no database: the subject is the protocol boundary -
the method table, the one mount, the hiding rule, the Depth 1 query budget, the
ETag both ends must agree on, and the quota and principal answers. The engine
workflows behind it have their own tests, and `suite/drive/webdav/tests` sends
whole requests through the dispatcher against a live site.
"""

import hashlib
import io
import os
import subprocess
import tempfile
from datetime import datetime
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase
from lxml import etree
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request, Response

from suite.drive import framework
from suite.drive._core import nodes as node_core
from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
    DriveOverQuota,
)
from suite.drive._core.nodes import EMPTY_BLOB_CHECKSUM, MAX_PAGE_SIZE
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.drive.http.tests import ensure_local_context, local_attribute
from suite.drive.webdav import (
    ALLOWED_METHODS,
    context,
    deadprops,
    dispatch,
    errors,
    get,
    locks,
    log,
    options,
    pathmap,
    properties,
    propfind,
    settings,
)
from suite.drive.webdav.xmlutil import dav

USER = "dav-reader@example.com"
PRINCIPALS = Principals(USER, (USER, "$GROUP:team", "$GENERAL"), ("$PUBLIC",))
WRITE_METHODS = ("PUT", "DELETE", "MKCOL", "MOVE", "COPY", "LOCK", "UNLOCK", "PROPPATCH")

STAMP = datetime(2026, 9, 5, 12, 0, 0)


def setUpModule():
    ensure_local_context()


def node(name: str, **overrides) -> frappe._dict:
    """One `Drive Node` row in the shape every read path receives it."""
    row = frappe._dict(
        name=name,
        parent="root1",
        root="root1",
        path="",
        title=name,
        kind="file",
        state="Active",
        trashed_at=None,
        trash_root=None,
        blob=None,
        size=0,
        mime="text/plain",
        url=None,
        content_doctype=None,
        content_docname=None,
        content_modified=None,
        is_template=0,
        owner=USER,
        creation=STAMP,
        modified=STAMP,
        modified_by=USER,
    )
    row.update(overrides)
    return row


def root_node(name: str = "root1") -> frappe._dict:
    return node(name, parent=None, root=None, path="", title="My Drive", kind="root", mime=None)


def grant_row(node_id: str, role: int = READ, principal: str = USER) -> frappe._dict:
    return frappe._dict(node=node_id, principal=principal, role=role, password_hash=None)


def window_rows(parent: frappe._dict, children: list[frappe._dict]) -> list[frappe._dict]:
    """The union result `FOLDER_PAGE_SQL` returns: the parent, then the window."""
    head = frappe._dict(parent)
    head._drive_parent = 0
    head._drive_document_descendant = 0
    out = [head]
    for child in children:
        row = frappe._dict(child)
        row._drive_parent = 1
        out.append(row)
    return out


def resolved(node_row=None, *, segments=None, parent=None, is_mount=False) -> pathmap.ResolvedPath:
    return pathmap.ResolvedPath(
        segments=list(segments or []),
        node=node_row,
        parent=parent,
        is_mount=is_mount,
    )


class _GroupCache:
    """The one cache key the principal path reads, answered from memory.

    Everything else stays on the real cache. `frappe.cache` is one object and
    `frappe._` reads the merged translation dict off it, so replacing the whole
    object with a `MagicMock` makes every translated string a mock. A
    `frappe.throw` under that patch then raises `TypeError` out of
    `strip_html_tags` on a run that has a terminal.
    """

    def __init__(self, real):
        self.real = real

    def __call__(self):
        """`framework.principals_for` reaches the cache as `frappe.cache()`."""
        return self

    def __getattr__(self, name):
        return getattr(self.real, name)

    def hget(self, key, name, generator=None, **kwargs):
        if key == "drive_user_groups":
            return generator()
        return self.real.hget(key, name, generator=generator, **kwargs)


class _Stdin:
    """`msgprint` asks `sys.stdin.isatty()`, and nothing else about the caller.

    The exception text is stripped with `strip_html_tags` only when the run has
    a terminal (`frappe/utils/messages.py:77-85`), so a piped run passes a
    refusal that the site gate fails.
    """

    def __init__(self, terminal: bool):
        self.terminal = terminal

    def isatty(self) -> bool:
        return self.terminal


def multistatus(response) -> dict[str, dict[int, dict[str, etree._Element]]]:
    """{href: {status: {clark tag: element}}} from a 207 body."""
    root = etree.fromstring(response.get_data())
    out: dict[str, dict[int, dict[str, etree._Element]]] = {}
    for entry in root.findall(dav("response")):
        href = entry.find(dav("href")).text
        by_status: dict[int, dict[str, etree._Element]] = {}
        for propstat in entry.findall(dav("propstat")):
            code = int(propstat.find(dav("status")).text.split()[1])
            by_status[code] = {element.tag: element for element in propstat.find(dav("prop"))}
        out[href] = by_status
    return out


class DavCase(UnitTestCase):
    """Site-free bindings every read path reaches for."""

    def setUp(self):
        self.db = self.bind("db", MagicMock())
        self.bind("_webdav_path_memo", {})
        self.bind("response_headers", {})
        self.bind("session", frappe._dict(user=USER))
        # `now_datetime` and the property timestamps both resolve the site zone
        self.start(patch("frappe.get_system_settings", return_value="UTC"))

    def bind(self, name, value):
        return self.enter(local_attribute(name, value))

    def enter(self, manager):
        value = manager.__enter__()
        self.addCleanup(manager.__exit__, None, None, None)
        return value

    def start(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def make_ctx(self, method: str, path: str, *, headers=None, data: bytes = b"") -> context.DavContext:
        builder = EnvironBuilder(method=method, path=path, headers=dict(headers or {}), data=data)
        request = Request(builder.get_environ())
        frappe.local.request = request
        ctx = context.build(request, USER)
        # `principals` is a cached_property; seed it so no session lookup runs
        ctx.__dict__["principals"] = PRINCIPALS
        return ctx


# --- A. the method table and the allow-list (§12.1) ---


class TestMethodAllowList(DavCase):
    def allowed(self, raw):
        with patch("frappe.get_cached_doc", return_value=frappe._dict(webdav_allowed_methods=raw)):
            return settings.allowed_webdav_methods()

    def test_an_unconfigured_site_offers_every_implemented_verb(self):
        # ticket 25 relinked the write verbs, so an admin who narrows nothing
        # gets the whole implemented surface, not a read-only subset
        for raw in (None, "", "   "):
            with self.subTest(raw=raw):
                self.assertEqual(self.allowed(raw), ALLOWED_METHODS)
        for method in WRITE_METHODS:
            self.assertIn(method, self.allowed(None))

    def test_an_admin_list_naming_put_now_offers_it(self):
        offered = self.allowed("GET, PUT, PROPFIND, LOCK, MKCOL")
        self.assertEqual(offered, ("OPTIONS", "GET", "HEAD", "PUT", "PROPFIND", "MKCOL", "LOCK"))

    def test_an_admin_list_still_narrows_the_surface(self):
        self.assertEqual(self.allowed("GET"), ("OPTIONS", "GET", "HEAD"))
        self.assertEqual(self.allowed("PROPFIND"), ("OPTIONS", "PROPFIND"))

    def test_a_garbage_setting_does_not_lock_the_site_to_options(self):
        self.assertEqual(self.allowed("FLOOP, BLARG"), ALLOWED_METHODS)
        # a list with one real verb keeps that verb and drops the noise
        self.assertEqual(self.allowed("GET, FLOOP"), ("OPTIONS", "GET", "HEAD"))

    def test_a_list_of_write_verbs_alone_is_honoured_as_written(self):
        # the fallback only rescues an unparseable setting; a list of known
        # verbs is taken at its word, however unusual the mount it produces
        self.assertEqual(self.allowed("PUT, DELETE, MKCOL"), ("OPTIONS", "PUT", "DELETE", "MKCOL"))

    def test_the_allow_list_can_still_withdraw_a_relinked_write_verb(self):
        """§12.1 keeps the admin switch: implemented is not the same as offered."""
        offered = self.allowed("GET, PROPFIND")
        for method in WRITE_METHODS:
            with self.subTest(method=method):
                self.assertIn(method, ALLOWED_METHODS)
                self.assertNotIn(method, offered)


class TestDispatchTable(DavCase):
    def test_the_handler_table_covers_every_implemented_method(self):
        """`ALLOWED_METHODS` is what OPTIONS advertises, so a verb in one list
        and not the other is a 405 the site promised it would not send."""
        dispatched = set(dispatch._HANDLERS) | {"OPTIONS"}
        self.assertEqual(dispatched, set(ALLOWED_METHODS))
        self.assertEqual(dispatch._HANDLERS["PROPFIND"], ("propfind", "handle"))
        self.assertEqual(dispatch._HANDLERS["GET"], ("get", "handle"))
        self.assertEqual(dispatch._HANDLERS["HEAD"], ("get", "handle"))
        self.assertEqual(dispatch._HANDLERS["PUT"], ("put", "handle"))
        self.assertEqual(dispatch._HANDLERS["DELETE"], ("structure", "handle_delete"))
        self.assertEqual(dispatch._HANDLERS["MKCOL"], ("structure", "handle_mkcol"))
        self.assertEqual(dispatch._HANDLERS["MOVE"], ("structure", "handle_move"))
        self.assertEqual(dispatch._HANDLERS["COPY"], ("copy", "handle"))
        self.assertEqual(dispatch._HANDLERS["PROPPATCH"], ("proppatch", "handle"))
        self.assertEqual(dispatch._HANDLERS["LOCK"], ("lock", "handle_lock"))
        self.assertEqual(dispatch._HANDLERS["UNLOCK"], ("lock", "handle_unlock"))

    def test_the_read_verbs_resolve_to_the_relinked_handlers(self):
        self.assertIs(dispatch._handler_for("PROPFIND"), propfind.handle)
        self.assertIs(dispatch._handler_for("GET"), get.handle)
        self.assertIs(dispatch._handler_for("HEAD"), get.handle)

    def test_every_write_verb_resolves_to_a_handler(self):
        from suite.drive.webdav import copy, lock, proppatch, put, structure

        expected = {
            "PUT": put.handle,
            "DELETE": structure.handle_delete,
            "MKCOL": structure.handle_mkcol,
            "MOVE": structure.handle_move,
            "COPY": copy.handle,
            "PROPPATCH": proppatch.handle,
            "LOCK": lock.handle_lock,
            "UNLOCK": lock.handle_unlock,
        }
        self.assertEqual(set(expected), set(WRITE_METHODS))
        for method, handler in expected.items():
            with self.subTest(method=method):
                self.assertIs(dispatch._handler_for(method), handler)

    def test_an_unimplemented_method_is_405_naming_what_is_offered(self):
        """`_handler_for` answers for the implemented set only.

        The admin allow-list is enforced a step earlier, in `_dispatch`, so a
        withdrawn verb never reaches here. What does reach here is a method DAV
        does not implement at all, and its `Allow` has to name the offered list
        rather than the implemented one.
        """
        narrowed = ("OPTIONS", "GET", "HEAD", "PROPFIND")
        for method in ("PATCH", "REPORT", "BREW"):
            with (
                self.subTest(method=method),
                self.assertRaises(errors.MethodNotAllowed) as caught,
            ):
                dispatch._handler_for(method, narrowed)
            self.assertEqual(caught.exception.status, 405)
            self.assertEqual(caught.exception.headers["Allow"], ", ".join(narrowed))


class TestOptionsAdvertisement(DavCase):
    def setUp(self):
        super().setUp()
        self.start(patch("frappe.get_cached_doc", return_value=frappe._dict(webdav_allowed_methods="")))

    def test_options_advertises_the_same_allow_the_dispatcher_enforces(self):
        request = Request(EnvironBuilder(method="OPTIONS", path="/dav/").get_environ())
        response = options.handle(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Allow"], ", ".join(settings.allowed_webdav_methods()))
        self.assertEqual(response.headers["Allow"], ", ".join(ALLOWED_METHODS))
        for method in WRITE_METHODS:
            self.assertIn(method, response.headers["Allow"])

    def test_an_unnarrowed_site_now_claims_class_2(self):
        """Finder reads class 2 to decide whether a mount is read-write, and
        ticket 25 relinked LOCK and UNLOCK, so the claim is true again."""
        request = Request(EnvironBuilder(method="OPTIONS", path="/dav/").get_environ())
        self.assertEqual(options.handle(request).headers["DAV"], "1, 2, 3")
        self.assertEqual(settings.dav_compliance(ALLOWED_METHODS), "1, 2, 3")
        # an admin who withdraws LOCK drops the class with it
        self.assertEqual(settings.dav_compliance(("OPTIONS", "GET", "HEAD", "PROPFIND")), "1, 3")

    def test_an_allow_list_without_propfind_claims_no_class_at_all(self):
        """RFC 4918 §9.1: PROPFIND is what class 1 means. `DAV: 1` over an
        allow-list that answers 405 to it sends the client down a path it
        cannot recover from."""
        for methods in (("OPTIONS",), ("OPTIONS", "GET", "HEAD")):
            with self.subTest(methods=methods):
                self.assertEqual(settings.dav_compliance(methods), "")

        with patch.object(options, "allowed_webdav_methods", return_value=("OPTIONS", "GET", "HEAD")):
            request = Request(EnvironBuilder(method="OPTIONS", path="/dav/").get_environ())
            response = options.handle(request)
            self.assertNotIn("DAV", response.headers)
            self.assertEqual(response.headers["Allow"], "OPTIONS, GET, HEAD")

            options.advertise_on_root()
            self.assertNotIn("DAV", frappe.local.response_headers)
            self.assertEqual(frappe.local.response_headers["MS-Author-Via"], "DAV")


class TestUnreadableIsNeverForbidden(DavCase):
    def test_propfind_asks_read_on_the_target_and_surfaces_404(self):
        target = node("file1", title="report.txt")
        refusal = DriveNotFound("Drive node file1 was not found")
        with (
            patch.object(pathmap, "resolve", return_value=resolved(target, segments=["report.txt"])),
            patch.object(propfind, "require", side_effect=refusal) as require,
        ):
            ctx = self.make_ctx("PROPFIND", "/dav/report.txt", headers={"Depth": "0"})
            with self.assertRaises(DriveNotFound):
                propfind.handle(ctx)

        require.assert_called_once_with(target, READ, PRINCIPALS)
        self.assertEqual(errors.map_exception(refusal).status, 404)

    def test_get_asks_read_on_the_node_and_surfaces_404(self):
        target = node("file1", title="report.txt")
        refusal = DriveNotFound("Drive node file1 was not found")
        with (
            patch.object(pathmap, "resolve", return_value=resolved(target, segments=["report.txt"])),
            patch.object(get, "require", side_effect=refusal) as require,
        ):
            ctx = self.make_ctx("GET", "/dav/report.txt")
            with self.assertRaises(DriveNotFound):
                get.handle(ctx)

        require.assert_called_once_with(target, READ, PRINCIPALS)
        self.assertEqual(errors.map_exception(refusal).status, 404)


# --- B. one mount, the caller's Personal Root (§12) ---


class TestSingleMount(DavCase):
    def test_the_mount_is_the_callers_personal_root_node(self):
        self.db.sql.side_effect = [[root_node()]]
        with patch.object(pathmap, "personal_root_for", return_value="root1") as lookup:
            answer = pathmap.resolve([], USER)

        lookup.assert_called_once_with(USER)
        self.assertTrue(answer.is_mount)
        self.assertTrue(answer.exists)
        self.assertTrue(answer.is_collection)
        self.assertEqual(answer.node.name, "root1")
        self.assertEqual(answer.node.kind, "root")

    def test_a_user_with_no_active_personal_root_has_no_mount_at_all(self):
        with patch.object(pathmap, "personal_root_for", return_value=None):
            for segments in ([], ["Reports"], ["Reports", "q3.txt"]):
                with self.subTest(segments=segments):
                    answer = pathmap.resolve(segments, USER)
                    self.assertFalse(answer.exists)
                    self.assertEqual(answer.missing_intermediate, bool(segments))
        self.assertEqual(self.db.sql.call_count, 0)

    def test_an_archived_root_row_leaves_every_path_unmapped(self):
        self.db.sql.side_effect = [[], []]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            self.assertFalse(pathmap.resolve([], USER).exists)
            self.assertFalse(pathmap.resolve(["Reports"], USER).exists)

    def test_everyone_is_only_a_child_lookup_and_it_misses(self):
        self.db.sql.side_effect = [[root_node()], [], []]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            answer = pathmap.resolve(["Everyone"], USER)

        self.assertFalse(answer.exists)
        self.assertIsNotNone(answer.parent)
        self.assertEqual(answer.parent.name, "root1")
        child_query = self.db.sql.call_args_list[1]
        self.assertIn("parent = %(parent)s", child_query.args[0])
        self.assertEqual(child_query.kwargs["values"]["parent"], "root1")
        self.assertEqual(child_query.kwargs["values"]["segment"], "Everyone")

    def test_every_walk_stays_inside_the_callers_own_root(self):
        folder = node("folder1", title="Reports", kind="folder")
        leaf = node("file1", parent="folder1", title="q3.txt")
        self.db.sql.side_effect = [[root_node()], [folder], [leaf]]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            answer = pathmap.resolve(["Reports", "q3.txt"], USER)

        self.assertEqual(answer.node.name, "file1")
        parents = [call.kwargs["values"]["parent"] for call in self.db.sql.call_args_list[1:]]
        self.assertEqual(parents, ["root1", "folder1"])
        self.assertEqual(self.db.sql.call_args_list[0].kwargs["values"], {"name": "root1"})

    def test_a_non_folder_intermediate_segment_ends_the_walk(self):
        self.db.sql.side_effect = [[root_node()], [node("file1", title="report.txt")]]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            answer = pathmap.resolve(["report.txt", "inside.txt"], USER)

        self.assertFalse(answer.exists)
        self.assertTrue(answer.missing_intermediate)
        # the leaf was never asked for
        self.assertEqual(self.db.sql.call_count, 2)


# --- C. hidden content documents and their media (§12.2) ---


class TestHiddenContent(DavCase):
    def test_only_folders_and_files_are_reachable_over_dav(self):
        self.assertEqual(pathmap.VISIBLE_KINDS, ("folder", "file"))
        for kind, expected in (
            ("folder", True),
            ("file", True),
            ("document", False),
            ("link", False),
            ("root", False),
        ):
            with self.subTest(kind=kind):
                self.assertEqual(pathmap.visible(node("n", kind=kind)), expected)

    def test_a_template_is_hidden_whatever_its_kind(self):
        for kind in ("folder", "file"):
            with self.subTest(kind=kind):
                self.assertFalse(pathmap.visible(node("n", kind=kind, is_template=1)))

    def test_an_office_extension_never_makes_a_content_document_visible(self):
        for title in ("Report.docx", "Book.xlsx", "Deck.pptx"):
            with self.subTest(title=title):
                self.assertFalse(pathmap.visible(node("n", title=title, kind="document")))

    def test_an_uploaded_office_file_stays_visible_whatever_its_extension(self):
        for title in ("report.docx", "book.xlsx", "deck.pptx", "notes", "archive.tar.gz"):
            with self.subTest(title=title):
                self.assertTrue(pathmap.visible(node("n", title=title, kind="file")))

    def test_an_uploaded_office_file_resolves_by_direct_path(self):
        uploaded = node("file1", title="report.docx", mime="application/octet-stream")
        self.db.sql.side_effect = [[root_node()], [uploaded]]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            answer = pathmap.resolve(["report.docx"], USER)

        self.assertTrue(answer.exists)
        self.assertEqual(answer.node.name, "file1")

    def test_the_lookup_predicate_itself_excludes_documents_links_and_templates(self):
        self.assertEqual(
            pathmap._VISIBLE, "state = 'Active' AND kind IN ('folder', 'file') AND is_template = 0"
        )
        self.db.sql.side_effect = [[root_node()], [], []]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            pathmap.resolve(["Deck"], USER)

        for call in self.db.sql.call_args_list[1:]:
            self.assertIn("kind IN ('folder', 'file')", call.args[0])
            self.assertIn("state = 'Active'", call.args[0])
            self.assertIn("is_template = 0", call.args[0])

    def test_a_document_is_dropped_from_a_listing_page(self):
        parent = root_node()
        visible_file = node("file1", title="report.docx")
        rows = [
            visible_file,
            node("doc1", title="Deck", kind="document"),
            node("link1", title="Bookmark", kind="link"),
            node("tpl1", title="Template", is_template=1),
        ]
        self.db.sql.side_effect = [
            window_rows(parent, rows),
            [grant_row("root1")],
            [],
        ]
        parent_row, listed = propfind._read_page(PRINCIPALS, "root1")

        self.assertEqual(parent_row.name, "root1")
        self.assertEqual([row.name for row in listed], ["file1"])

    def test_an_unresolved_path_is_404_in_both_read_handlers(self):
        with patch.object(pathmap, "resolve", return_value=resolved(segments=["Deck"])):
            ctx = self.make_ctx("PROPFIND", "/dav/Deck", headers={"Depth": "0"})
            with self.assertRaises(errors.NotFoundError):
                propfind.handle(ctx)

            ctx = self.make_ctx("GET", "/dav/Deck")
            with self.assertRaises(errors.NotFoundError):
                get.handle(ctx)

    def test_media_under_a_document_is_unreachable_because_the_document_segment_404s(self):
        # the `Deck` lookup finds nothing, so `cover.png` is never asked for
        self.db.sql.side_effect = [[root_node()], [], []]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            answer = pathmap.resolve(["Deck", "cover.png"], USER)

        self.assertFalse(answer.exists)
        self.assertTrue(answer.missing_intermediate)
        self.assertEqual(self.db.sql.call_count, 3)
        segments = [call.kwargs["values"]["segment"] for call in self.db.sql.call_args_list[1:]]
        self.assertEqual(segments, ["Deck", "Deck"])


class TestOneNamespace(DavCase):
    """A name a listing will not publish must not resolve by hand either."""

    def resolve(self, title, rows):
        self.db.sql.side_effect = [[root_node()], rows, rows]
        with patch.object(pathmap, "personal_root_for", return_value="root1"):
            return pathmap.resolve([title], USER)

    def test_a_title_the_listing_drops_does_not_resolve(self):
        # `\` survives `_VISIBLE`, survives the URL grammar as %5C, and used to
        # answer 200 at a href no listing ever published
        row = node("file1", title="a\\b")
        self.assertFalse(pathmap.addressable(row))
        self.assertFalse(pathmap.visible(row))
        self.assertFalse(self.resolve("a\\b", [row]).exists)

    def test_an_ordinary_title_still_resolves(self):
        row = node("file1", title="a-b.txt")
        self.assertTrue(pathmap.visible(row))
        self.assertTrue(self.resolve("a-b.txt", [row]).exists)

    def test_two_siblings_with_one_title_publish_one_href(self):
        older = node("file1", title="dup.txt", blob="blob1", creation=STAMP)
        newer = node("file2", title="dup.txt", blob="blob2", creation=datetime(2026, 9, 6, 12, 0, 0))

        # the row a GET of that href would answer from is the one published,
        # whichever order the window returned them in
        for window in ([newer, older], [older, newer]):
            with self.subTest(window=[row.name for row in window]):
                published = propfind._one_row_per_name(window)
                self.assertEqual([row.name for row in published], ["file1"])

    def test_titles_differing_only_by_case_keep_their_own_hrefs(self):
        rows = [node("file1", title="A.txt"), node("file2", title="a.txt")]
        self.assertEqual([row.name for row in propfind._one_row_per_name(rows)], ["file1", "file2"])


# --- D. the Depth 1 query budget (§5.3, §12.5) ---


class TestDepthOneBudget(DavCase):
    def setUp(self):
        super().setUp()
        self.get_all = self.start(patch("frappe.get_all", side_effect=self.fake_get_all))
        self.doctype_calls: list[str] = []
        self.blob_checksum = hashlib.sha256(b"hello").hexdigest()
        # False = the batched read answers for none of the page's blobs
        self.blobs_readable = True
        self.dead_props = self.start(
            patch.object(deadprops, "get_dead_props", wraps=deadprops.get_dead_props)
        )
        self.fetch_locks = self.start(patch.object(locks, "_fetch_locks", wraps=locks._fetch_locks))

    def fake_get_all(self, doctype, **kwargs):
        self.doctype_calls.append(doctype)
        if doctype == "File Blob" and self.blobs_readable:
            return [
                frappe._dict(name=name, checksum=self.blob_checksum) for name in kwargs["filters"]["name"][1]
            ]
        return []

    def run_depth_one(self, children, *, windows=1):
        parent = root_node()
        side_effect = []
        for index in range(windows):
            page = children[index * MAX_PAGE_SIZE : (index + 1) * MAX_PAGE_SIZE]
            side_effect += [window_rows(parent, page), [grant_row("root1")], []]
        self.db.sql.side_effect = side_effect

        body = b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
        with patch.object(pathmap, "resolve", return_value=resolved(parent, is_mount=True)):
            ctx = self.make_ctx("PROPFIND", "/dav/", headers={"Depth": "1"}, data=body)
            return propfind.handle(ctx)

    def test_depth_one_costs_three_engine_queries_one_property_fetch_and_one_lock_fetch(self):
        children = [
            node("file1", title="a.txt", blob="blob1"),
            node("folder1", title="Reports", kind="folder"),
        ]
        response = self.run_depth_one(children)

        self.assertEqual(response.status_code, 207)
        self.assertEqual(self.db.sql.call_count, 3)
        self.assertEqual(self.dead_props.call_count, 1)
        self.assertEqual(self.fetch_locks.call_count, 1)
        self.assertEqual(self.doctype_calls.count("File Blob"), 1)
        self.assertEqual(self.doctype_calls.count("Drive DAV Property"), 1)
        self.assertEqual(self.doctype_calls.count("Drive DAV Lock"), 1)
        self.assertEqual(len(multistatus(response)), 3)

    def reset_budget(self):
        self.db.sql.reset_mock()
        self.dead_props.reset_mock()
        self.fetch_locks.reset_mock()
        self.doctype_calls.clear()

    def test_the_budget_does_not_move_with_the_number_of_children(self):
        for size in (2, 60):
            with self.subTest(children=size):
                self.reset_budget()
                children = [node(f"file{i}", title=f"f{i}.txt", blob=f"blob{i}") for i in range(size)]
                response = self.run_depth_one(children)

                self.assertEqual(self.db.sql.call_count, 3)
                self.assertEqual(self.dead_props.call_count, 1)
                self.assertEqual(self.fetch_locks.call_count, 1)
                self.assertEqual(self.doctype_calls.count("File Blob"), 1)
                # every child is still published; only the cost stayed flat
                self.assertEqual(len(multistatus(response)), size + 1)

    def test_no_blob_read_at_all_when_no_child_holds_a_blob(self):
        children = [
            node("folder1", title="Reports", kind="folder"),
            node("file1", title="empty.txt", blob=None),
        ]
        self.run_depth_one(children)

        self.assertEqual(self.db.sql.call_count, 3)
        self.assertNotIn("File Blob", self.doctype_calls)

    def test_a_page_of_unreadable_blobs_still_costs_one_blob_read(self):
        # the batch looked and answered for nothing; the render loop must not
        # go back per row, which cost 11 reads for these 10 children
        self.blobs_readable = False
        children = [node(f"file{i}", title=f"f{i}.txt", blob=f"blob{i}") for i in range(10)]
        response = self.run_depth_one(children)

        self.assertEqual(self.doctype_calls.count("File Blob"), 1)
        self.assertEqual(self.db.sql.call_count, 3)
        self.assertEqual(len(multistatus(response)), 11)

    def test_a_file_whose_blob_has_no_readable_checksum_is_listed_without_a_getetag(self):
        self.blobs_readable = False
        children = [
            node("file1", title="a.txt", blob="blob1"),
            node("file2", title="b.txt", blob=None),
        ]
        response = self.run_depth_one(children)
        listed = multistatus(response)

        self.assertEqual(response.status_code, 207)
        # the resource is still published, just without a validator
        self.assertIn("/dav/a.txt", listed)
        self.assertNotIn(dav("getetag"), listed["/dav/a.txt"][200])
        self.assertIn(dav("getcontentlength"), listed["/dav/a.txt"][200])
        # the empty head beside it keeps the zero-bytes validator
        self.assertEqual(listed["/dav/b.txt"][200][dav("getetag")].text, f'"{EMPTY_BLOB_CHECKSUM}"')

    def test_a_folder_wider_than_one_window_pages_instead_of_truncating(self):
        children = [node(f"file{i}", title=f"f{i:04d}.txt") for i in range(MAX_PAGE_SIZE + 5)]
        response = self.run_depth_one(children, windows=2)

        # three queries per window, and every child is published
        self.assertEqual(self.db.sql.call_count, 6)
        self.assertEqual(self.dead_props.call_count, 1)
        self.assertEqual(self.fetch_locks.call_count, 1)
        self.assertEqual(len(multistatus(response)), MAX_PAGE_SIZE + 6)


# --- E. ETag, conditional requests and ranges (§12.4, §13.5) ---


class LocalDriver:
    """A driver backed by a real file on disk; `get_path` is what marks it local."""

    def __init__(self, path: str):
        self.path = path

    def get_path(self, key, is_private):
        return self.path

    def download_url(self, *args, **kwargs):
        return None


class RemoteDriver:
    """A driver with no `get_path`: reads and ranged reads only."""

    def __init__(self, data: bytes):
        self.data = data

    def read(self, key, is_private=False):
        return io.BytesIO(self.data)

    def read_range(self, key, start, end, is_private=False):
        return io.BytesIO(self.data[start : end + 1])

    def download_url(self, *args, **kwargs):
        return None


class TestEtagScheme(DavCase):
    def test_the_etag_is_the_quoted_blob_checksum(self):
        checksum = hashlib.sha256(b"hello").hexdigest()
        row = node("file1", blob="blob1", size=5)
        self.assertEqual(properties.compute_etag(row, checksum), f'"{checksum}"')

    def test_an_uncached_file_reads_its_checksum_once(self):
        checksum = hashlib.sha256(b"hello").hexdigest()
        row = node("file1", blob="blob1", size=5)
        with patch.object(properties, "blob_checksums", return_value={"blob1": checksum}) as read:
            self.assertEqual(properties.compute_etag(row), f'"{checksum}"')
        read.assert_called_once_with(["blob1"])

    def test_a_file_with_no_blob_gets_the_checksum_of_zero_bytes(self):
        self.assertEqual(EMPTY_BLOB_CHECKSUM, hashlib.sha256(b"").hexdigest())
        self.assertEqual(properties.compute_etag(node("file1", blob=None)), f'"{EMPTY_BLOB_CHECKSUM}"')

    def test_getetag_is_present_on_a_file_and_absent_on_a_collection(self):
        checksum = hashlib.sha256(b"hello").hexdigest()
        file_props = properties.live_properties(
            node("file1", blob="blob1", size=5),
            is_collection=False,
            display_name="a.txt",
            checksum=checksum,
        )
        self.assertEqual(file_props[dav("getetag")].text, f'"{checksum}"')

        folder_props = properties.live_properties(
            node("folder1", kind="folder"), is_collection=True, display_name="Reports"
        )
        self.assertIsNone(folder_props[dav("getetag")])
        self.assertIsNone(folder_props[dav("getcontentlength")])

    def test_a_checksum_the_batch_did_not_find_is_no_validator_and_no_second_query(self):
        row = node("file1", blob="blob1", size=5)
        with patch.object(properties, "blob_checksums") as read:
            self.assertIsNone(properties.compute_etag(row, None))
        read.assert_not_called()

    def test_checksums_for_keys_every_blob_holding_row_none_included(self):
        rows = [
            node("file1", blob="blob1"),
            node("file2", blob="blob2"),
            node("file3", blob=None),
            node("folder1", kind="folder"),
        ]
        with patch.object(properties, "blob_checksums", return_value={"blob1": "aa" * 32}):
            answer = properties.checksums_for(rows)

        # the key is the caller's proof that the batch already looked
        self.assertEqual(answer, {"file1": "aa" * 32, "file2": None})
        self.assertIn("file2", answer)

    def test_one_batched_read_answers_a_whole_pages_validators(self):
        checksums = {"blob1": "aa" * 32, "blob2": "bb" * 32}
        rows = [
            node("file1", blob="blob1"),
            node("file2", blob="blob2"),
            node("folder1", kind="folder"),
        ]
        with patch.object(properties, "blob_checksums", return_value=checksums) as read:
            answer = properties.checksums_for(rows)
        read.assert_called_once_with(["blob1", "blob2"])
        self.assertEqual(answer, {"file1": "aa" * 32, "file2": "bb" * 32})


class BlobStreamCase(DavCase):
    """Range and conditional coverage through `frappe.storage.serve.stream_blob`."""

    DATA = b"0123456789A"

    def setUp(self):
        super().setUp()
        self.checksum = hashlib.sha256(self.DATA).hexdigest()
        self.blob = frappe._dict(
            name="blob1",
            key="ab/cd/blob1",
            driver="local",
            is_private=1,
            checksum=self.checksum,
            mime_type="text/plain",
            file_size=len(self.DATA),
        )

    def environ(self, headers=None):
        return EnvironBuilder(method="GET", path="/dav/a.txt", headers=dict(headers or {})).get_environ()

    def stream(self, driver, headers=None):
        from frappe.storage import serve

        with patch.object(serve, "get_driver", return_value=driver):
            response = serve.stream_blob(
                self.blob, "a.txt", as_attachment=True, environ=self.environ(headers)
            )
        self.addCleanup(response.close)
        return response

    def body(self, response) -> bytes:
        return b"".join(response.response)


class TestLocalDriverStreaming(BlobStreamCase):
    def setUp(self):
        super().setUp()
        handle, path = tempfile.mkstemp()
        with os.fdopen(handle, "wb") as sink:
            sink.write(self.DATA)
        self.addCleanup(os.unlink, path)
        self.driver = LocalDriver(path)

    def test_a_full_get_is_200_with_every_byte(self):
        response = self.stream(self.driver)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.body(response), self.DATA)

    def test_the_wire_etag_is_the_string_propfind_publishes(self):
        response = self.stream(self.driver)
        row = node("file1", blob="blob1", size=len(self.DATA))
        self.assertEqual(properties.compute_etag(row, self.checksum), response.headers["ETag"])

    def test_a_range_request_is_206_with_the_requested_bytes(self):
        response = self.stream(self.driver, {"Range": "bytes=0-4"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content_length, 5)
        self.assertEqual(self.body(response), b"01234")

    def test_if_none_match_with_the_published_etag_is_304(self):
        response = self.stream(self.driver, {"If-None-Match": f'"{self.checksum}"'})
        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.headers["ETag"], f'"{self.checksum}"')


class TestRemoteDriverStreaming(BlobStreamCase):
    def setUp(self):
        super().setUp()
        self.blob.driver = "s3"
        self.driver = RemoteDriver(self.DATA)

    def test_a_full_get_is_200_with_every_byte(self):
        response = self.stream(self.driver)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.body(response), self.DATA)
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")

    def test_a_range_request_is_206_with_a_content_range(self):
        response = self.stream(self.driver, {"Range": "bytes=0-4"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["Content-Range"], f"bytes 0-4/{len(self.DATA)}")
        self.assertEqual(response.content_length, 5)
        self.assertEqual(self.body(response), b"01234")

    def test_an_open_ended_range_answers_the_tail(self):
        response = self.stream(self.driver, {"Range": "bytes=5-"})
        last = len(self.DATA) - 1
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["Content-Range"], f"bytes 5-{last}/{len(self.DATA)}")
        self.assertEqual(self.body(response), self.DATA[5:])

    def test_an_unsatisfiable_range_is_416_naming_the_size(self):
        response = self.stream(self.driver, {"Range": f"bytes={len(self.DATA) + 10}-"})
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response.headers["Content-Range"], f"bytes */{len(self.DATA)}")

    def test_if_none_match_with_the_published_etag_is_304(self):
        response = self.stream(self.driver, {"If-None-Match": f'"{self.checksum}"'})
        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.headers["ETag"], f'"{self.checksum}"')

    def test_the_wire_etag_is_the_string_propfind_publishes(self):
        response = self.stream(self.driver)
        row = node("file1", blob="blob1", size=len(self.DATA))
        self.assertEqual(properties.compute_etag(row, self.checksum), response.headers["ETag"])


class TestStreamContentRefusals(DavCase):
    def environ(self, headers=None):
        return EnvironBuilder(method="GET", path="/dav/a.txt", headers=dict(headers or {})).get_environ()

    def test_a_node_that_is_not_a_file_has_no_bytes_to_send(self):
        for kind in ("folder", "root", "document", "link"):
            with self.subTest(kind=kind), self.assertRaises(DriveConflict):
                node_core.stream_content(node("n", kind=kind, blob="blob1"), environ=self.environ())

    def test_an_unusable_blob_is_a_conflict_not_an_empty_file(self):
        row = node("file1", blob="blob1", size=5)
        unusable = (
            frappe.DoesNotExistError("gone"),
            frappe._dict(name="blob1", file_size=5, is_private=1, status="Pending"),
            frappe._dict(name="blob1", file_size=5, is_private=0, status="Ready"),
        )
        for blob in unusable:
            with self.subTest(blob=blob):
                fetch = {"side_effect": blob} if isinstance(blob, Exception) else {"return_value": blob}
                with (
                    patch("frappe.get_doc", **fetch),
                    self.assertRaises(DriveConflict),
                ):
                    node_core.stream_content(row, environ=self.environ())

    def test_the_blob_is_read_once_and_handed_to_the_stream(self):
        """Two reads of one `File Blob` per download is one too many: the doc
        this branch already loaded is what `stream_blob` would have loaded."""
        row = node("file1", blob="blob1", size=5)
        blob = frappe._dict(name="blob1", file_size=5, is_private=1, status="Ready", checksum="abc")
        with (
            patch("frappe.get_doc", return_value=blob) as get_doc,
            patch("frappe.storage.serve.stream_blob", return_value=Response(b"")) as stream,
        ):
            node_core.stream_content(row, environ=self.environ())

        self.assertEqual(get_doc.call_count, 1)
        self.assertIs(stream.call_args.args[0], blob)

    def test_an_empty_head_answers_200_with_no_body_and_the_empty_etag(self):
        row = node("file1", blob=None, size=0, mime="text/plain")
        response = node_core.stream_content(row, environ=self.environ())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_data(), b"")
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        self.assertEqual(response.headers["ETag"], properties.compute_etag(row))
        self.assertEqual(response.headers["ETag"], f'"{hashlib.sha256(b"").hexdigest()}"')

    def test_an_empty_head_answers_304_to_its_own_validator(self):
        """A zero-byte file publishes a validator, so it has to honour one."""
        row = node("file1", blob=None, size=0, mime="text/plain")
        environ = self.environ({"If-None-Match": f'"{EMPTY_BLOB_CHECKSUM}"'})
        response = node_core.stream_content(row, environ=environ)

        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.headers["ETag"], f'"{EMPTY_BLOB_CHECKSUM}"')


class TestIfRange(DavCase):
    """RFC 7233 §3.2: a stale `If-Range` means the whole representation.

    The framework's remote-driver path never reads the header, so a Range
    spliced onto a replaced blob would be a silently corrupt download.
    """

    CHECKSUM = "a" * 64

    def environ(self, headers):
        return EnvironBuilder(method="GET", path="/dav/a.txt", headers=headers).get_environ()

    def kept(self, headers) -> bool:
        stripped = node_core._range_honouring_environ(self.environ(headers), self.CHECKSUM)
        return "HTTP_RANGE" in stripped

    def test_a_matching_strong_tag_keeps_the_range(self):
        self.assertTrue(self.kept({"Range": "bytes=0-4", "If-Range": f'"{self.CHECKSUM}"'}))

    def test_a_stale_tag_drops_the_range(self):
        self.assertFalse(self.kept({"Range": "bytes=0-4", "If-Range": '"deadbeef"'}))

    def test_a_weak_tag_never_satisfies_a_range(self):
        self.assertFalse(self.kept({"Range": "bytes=0-4", "If-Range": f'W/"{self.CHECKSUM}"'}))

    def test_a_date_form_is_left_to_the_driver_path(self):
        self.assertTrue(self.kept({"Range": "bytes=0-4", "If-Range": "Sat, 05 Sep 2026 12:00:00 GMT"}))

    def test_no_range_header_is_left_alone(self):
        environ = self.environ({"If-Range": '"deadbeef"'})
        self.assertIs(node_core._range_honouring_environ(environ, self.CHECKSUM), environ)

    def test_a_blob_with_no_checksum_cannot_satisfy_if_range(self):
        environ = self.environ({"Range": "bytes=0-4", "If-Range": '"deadbeef"'})
        self.assertNotIn("HTTP_RANGE", node_core._range_honouring_environ(environ, None))


class TestGetResponseHeaders(DavCase):
    def test_a_download_is_neutralized_and_advertises_ranges(self):
        row = node("file1", title="report.docx", blob=None, size=0)
        with (
            patch.object(pathmap, "resolve", return_value=resolved(row, segments=["report.docx"])),
            patch.object(get, "require", return_value=None),
        ):
            ctx = self.make_ctx("GET", "/dav/report.docx")
            response = get.handle(ctx)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Content-Security-Policy"], "sandbox")
        self.assertEqual(response.headers["Accept-Ranges"], "bytes")
        self.assertEqual(response.headers["Cache-Control"], "private, no-cache")
        disposition = response.headers["Content-Disposition"]
        self.assertTrue(disposition.startswith("attachment"))
        self.assertIn("report.docx", disposition)

    def get(self, row, headers=None):
        with (
            patch.object(pathmap, "resolve", return_value=resolved(row, segments=[row.title])),
            patch.object(get, "require", return_value=None),
        ):
            return get.handle(self.make_ctx("GET", f"/dav/{row.title}", headers=headers))

    def dispatcher_answer(self, row, refusal):
        """What the dispatcher makes of an exception the byte path raised.

        `dispatch._dispatch` calls `errors.map_exception` then
        `errors.to_response`; this is that pair, with the framework exception
        the streamer would have raised.
        """
        with (
            patch.object(pathmap, "resolve", return_value=resolved(row, segments=[row.title])),
            patch.object(get, "require", return_value=None),
            patch.object(node_core, "stream_content", side_effect=refusal),
            self.assertRaises(type(refusal)) as caught,
        ):
            get.handle(self.make_ctx("GET", f"/dav/{row.title}"))
        return errors.to_response(errors.map_exception(caught.exception))

    def test_last_modified_is_the_time_getlastmodified_publishes(self):
        """§12.4: `content_modified` is the content's time. werkzeug derives
        its own from the blob file's mtime, which is shared by every node that
        dedupes onto those bytes, so the byte path must be told."""
        stamp = datetime(2026, 8, 24, 10, 30, 0)
        row = node("file1", title="a.txt", blob=None, size=0, content_modified=stamp)
        response = self.get(row)

        published = properties.live_properties(row, is_collection=False, display_name="a.txt")
        self.assertEqual(response.headers["Last-Modified"], published[dav("getlastmodified")].text)
        self.assertEqual(response.headers["Last-Modified"], properties.rfc1123(stamp))

    def test_a_304_carries_no_representation_metadata(self):
        """RFC 7232 §4.1, and RFC 7234 §4.3.4: a cache copies onto the stored
        response whatever a 304 carries."""
        row = node("file1", title="a.txt", blob=None, size=0)
        response = self.get(row, {"If-None-Match": f'"{EMPTY_BLOB_CHECKSUM}"'})

        self.assertEqual(response.status_code, 304)
        for header in ("Content-Disposition", "Content-Security-Policy", "X-Content-Type-Options"):
            self.assertNotIn(header, response.headers)
        self.assertEqual(response.headers["ETag"], f'"{EMPTY_BLOB_CHECKSUM}"')

    def test_a_range_the_bytes_cannot_satisfy_is_416_not_500(self):
        """`send_file` refuses a Range by raising werkzeug's own exception. The
        local driver is the default on every non-S3 site, so this is the common
        path, and a 500 here also wrote an Error Log row per client retry."""
        from werkzeug.exceptions import RequestedRangeNotSatisfiable

        row = node("file1", title="a.txt", blob="blob1", size=11)
        answer = self.dispatcher_answer(row, RequestedRangeNotSatisfiable(length=11))

        self.assertEqual(answer.status_code, 416)
        self.assertEqual(answer.headers["Content-Range"], "bytes */11")

    def test_bytes_missing_from_the_driver_are_404_not_500(self):
        """The base handler caught `FileNotFoundError` and answered 404. The
        framework raises werkzeug's `NotFound` instead, and an unmapped 500
        also had the dispatcher log and commit an Error Log row."""
        from werkzeug.exceptions import NotFound as FrameworkNotFound

        row = node("file1", title="a.txt", blob="blob1", size=11)
        answer = self.dispatcher_answer(row, FrameworkNotFound())

        self.assertEqual(answer.status_code, 404)
        self.assertNotIn("Drive", answer.get_data(as_text=True))


# --- F. quota properties (§7.9, §12.4) ---


class QuotaCase(DavCase):
    def setUp(self):
        super().setUp()
        self.usage = self.start(patch.object(propfind.quota_core, "get_storage_usage"))
        self.usage.return_value = frappe._dict(
            used_bytes=4096, reserved_bytes=0, quota_bytes=10240, effective_quota=10240
        )
        self.start(patch.object(propfind, "require", return_value=None))
        self.start(patch.object(deadprops, "get_dead_props", return_value={}))
        self.start(patch.object(locks, "discovery_map", return_value={}))

    def propfind_body(self, row, body: bytes, *, is_mount=False, segments=None):
        with patch.object(
            pathmap, "resolve", return_value=resolved(row, segments=segments, is_mount=is_mount)
        ):
            path = "/dav/" + "/".join(segments or [])
            ctx = self.make_ctx("PROPFIND", path, headers={"Depth": "0"}, data=body)
            return multistatus(propfind.handle(ctx))


PROP_QUOTA = (
    b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>'
    b"<D:quota-used-bytes/><D:quota-available-bytes/></D:prop></D:propfind>"
)
ALLPROP = b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
ALLPROP_INCLUDE = (
    b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/><D:include>'
    b"<D:quota-used-bytes/><D:quota-available-bytes/></D:include></D:propfind>"
)


class TestQuotaProperties(QuotaCase):
    def test_used_and_available_come_from_the_personal_root(self):
        answer = self.propfind_body(root_node(), PROP_QUOTA, is_mount=True)["/dav/"]
        self.usage.assert_called_once_with("root1")
        self.assertEqual(answer[200][dav("quota-used-bytes")].text, "4096")
        self.assertEqual(answer[200][dav("quota-available-bytes")].text, str(10240 - 4096))

    def test_a_deeper_folder_still_reports_the_roots_numbers(self):
        folder = node("folder1", title="Reports", kind="folder", root="root1", path="")
        answer = self.propfind_body(folder, PROP_QUOTA, segments=["Reports"])["/dav/Reports/"]
        self.usage.assert_called_once_with("root1")
        self.assertEqual(answer[200][dav("quota-used-bytes")].text, "4096")
        self.assertEqual(answer[200][dav("quota-available-bytes")].text, str(10240 - 4096))

    def test_available_is_never_negative(self):
        self.usage.return_value = frappe._dict(used_bytes=20480, effective_quota=10240)
        answer = self.propfind_body(root_node(), PROP_QUOTA, is_mount=True)["/dav/"]
        self.assertEqual(answer[200][dav("quota-available-bytes")].text, "0")

    def test_available_is_omitted_not_zeroed_on_an_unlimited_root(self):
        self.usage.return_value = frappe._dict(used_bytes=4096, effective_quota=0)
        answer = self.propfind_body(root_node(), PROP_QUOTA, is_mount=True)["/dav/"]

        self.assertEqual(answer[200][dav("quota-used-bytes")].text, "4096")
        self.assertNotIn(dav("quota-available-bytes"), answer[200])
        self.assertIn(dav("quota-available-bytes"), answer[404])

    def test_a_bare_allprop_returns_neither_quota_property(self):
        answer = self.propfind_body(root_node(), ALLPROP, is_mount=True)["/dav/"]
        self.assertNotIn(dav("quota-used-bytes"), answer[200])
        self.assertNotIn(dav("quota-available-bytes"), answer[200])
        self.assertIn(dav("displayname"), answer[200])
        self.usage.assert_not_called()

    def test_allprop_with_include_returns_them(self):
        answer = self.propfind_body(root_node(), ALLPROP_INCLUDE, is_mount=True)["/dav/"]
        self.assertEqual(answer[200][dav("quota-used-bytes")].text, "4096")
        self.assertEqual(answer[200][dav("quota-available-bytes")].text, str(10240 - 4096))

    def test_quota_is_not_offered_on_a_file(self):
        row = node("file1", title="a.txt")
        answer = self.propfind_body(row, PROP_QUOTA, segments=["a.txt"])["/dav/a.txt"]
        self.assertIn(dav("quota-used-bytes"), answer[404])
        self.assertIn(dav("quota-available-bytes"), answer[404])

    def test_a_quota_probe_at_a_file_costs_no_root_read(self):
        """The answer is a 404 propstat either way, so the three queries
        `get_storage_usage` spends are three nobody asked for."""
        row = node("file1", title="a.txt")
        self.propfind_body(row, PROP_QUOTA, segments=["a.txt"])
        self.usage.assert_not_called()

    def test_an_empty_prop_body_still_yields_a_valid_response(self):
        """RFC 4918 §14.24: href plus propstat or status. `<D:prop/>` leaves no
        propstat, and a bare href is a body a strict client refuses."""
        body = b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop/></D:propfind>'
        with patch.object(pathmap, "resolve", return_value=resolved(root_node(), is_mount=True)):
            ctx = self.make_ctx("PROPFIND", "/dav/", headers={"Depth": "0"}, data=body)
            document = etree.fromstring(propfind.handle(ctx).get_data())

        entry = document.find(dav("response"))
        self.assertIsNone(entry.find(dav("propstat")))
        self.assertEqual(entry.find(dav("status")).text, "HTTP/1.1 200 OK")


# --- G. principals (§6.9, §12.4) ---


class TestDavPrincipals(DavCase):
    LINK_TOKEN = "abcdefghijklmnopqrstuv"

    def setUp(self):
        super().setUp()
        self.start(patch.object(frappe, "cache", _GroupCache(frappe.cache)))
        self.start(patch.object(framework, "_user_groups", return_value=("team",)))
        self.start(patch.object(framework, "is_drive_admin", return_value=False))

    def build_ctx(self, headers=None):
        builder = EnvironBuilder(method="PROPFIND", path="/dav/", headers=dict(headers or {}))
        request = Request(builder.get_environ())
        frappe.local.request = request
        return context.build(request, USER)

    def test_a_dav_session_carries_the_user_their_groups_general_and_public(self):
        principals = self.build_ctx().principals
        self.assertEqual(principals.user, USER)
        self.assertEqual(principals.own, (USER, "$GROUP:team", "$GENERAL"))
        self.assertEqual(principals.open, ("$PUBLIC",))
        self.assertEqual(principals.link_tickets, ())

    def test_an_x_drive_links_header_reaches_the_request_and_never_the_principals(self):
        ticket = f"{self.LINK_TOKEN}.4102444800.{'a' * 64}"
        ctx = self.build_ctx({"X-Drive-Links": ticket})

        # the header really is on the request the handler will read
        self.assertEqual(ctx.request.headers.get("X-Drive-Links"), ticket)
        # and the framework would have honoured it outside DAV
        unstripped = framework.principals_for(USER)
        self.assertIn(f"$LINK:{self.LINK_TOKEN}", unstripped.open)
        self.assertTrue(unstripped.link_tickets)

        principals = ctx.principals
        self.assertEqual(principals.open, ("$PUBLIC",))
        self.assertEqual(principals.link_tickets, ())
        self.assertFalse([p for p in principals.all() if p.startswith("$LINK:")])

    def test_a_bare_link_token_header_is_discarded_too(self):
        ctx = self.build_ctx({"X-Drive-Links": self.LINK_TOKEN})
        self.assertEqual(ctx.principals.open, ("$PUBLIC",))
        self.assertFalse([p for p in ctx.principals.all() if p.startswith("$LINK:")])

    def dispatched(self, headers):
        """One request through `_dispatch`, returning (response, ctx)."""
        from suite.drive.webdav import auth

        builder = EnvironBuilder(method="PROPFIND", path="/dav/", headers=dict(headers))
        request = Request(builder.get_environ())
        frappe.local.request = request
        seen = {}

        def handler(ctx):
            seen["ctx"] = ctx
            return Response(status=207)

        with (
            patch.object(settings, "global_webdav_enabled", return_value=True),
            patch.object(settings, "user_webdav_enabled", return_value=True),
            patch.object(settings, "allowed_webdav_methods", return_value=ALLOWED_METHODS),
            patch.object(auth, "authenticate", return_value=USER),
            patch.object(dispatch, "_handler_for", return_value=handler),
            patch.object(log, "configured_level", return_value=None),
            patch("frappe.set_user"),
            self.assertRaises(dispatch.DAVResponseException) as caught,
        ):
            dispatch._dispatch(request)
        return caught.exception.response, seen.get("ctx")

    def test_the_dispatcher_drops_the_link_header_before_anything_reads_it(self):
        """§6.9 has to hold for the whole request, not for one property.
        `framework.principals_for` reads the header from `frappe.local.request`
        wherever it is called, and the framework permission hook calls it."""
        ticket = f"{self.LINK_TOKEN}.4102444800.{'a' * 64}"
        response, ctx = self.dispatched({"X-Drive-Links": ticket})

        self.assertEqual(response.status_code, 207)
        self.assertIsNone(ctx.request.headers.get("X-Drive-Links"))
        self.assertNotIn("HTTP_X_DRIVE_LINKS", ctx.request.environ)
        # the framework, asked directly mid-request, now finds nothing either
        self.assertEqual(framework.principals_for(USER).open, ("$PUBLIC",))
        self.assertEqual(framework.principals_for(USER).link_tickets, ())

    def test_an_oversized_link_header_does_not_refuse_the_dav_request(self):
        """`parse_link_header` throws over the item limit, and that
        `ValidationError` maps to 409. A header DAV ignores by rule must not
        be able to fail the request it rides on."""
        from suite.drive._core.principals import LINK_HEADER_LIMIT, parse_link_header

        header = ",".join([self.LINK_TOKEN] * (LINK_HEADER_LIMIT + 5))
        with self.assertRaises(frappe.ValidationError):
            parse_link_header(header)

        response, ctx = self.dispatched({"X-Drive-Links": header})
        self.assertEqual(response.status_code, 207)
        self.assertEqual(ctx.principals.open, ("$PUBLIC",))

    def test_the_oversized_refusal_carries_its_message_on_a_terminal(self):
        """`frappe.throw` translates the message, and `frappe._` reads the
        merged translation dict off `frappe.cache`. A test that replaced the
        whole cache object made that message a mock, which `strip_html_tags`
        refuses - but only on a run with a terminal, so a piped run passed and
        the site gate failed. Both runs are asserted here."""
        from suite.drive._core.principals import LINK_HEADER_LIMIT, parse_link_header

        header = ",".join([self.LINK_TOKEN] * (LINK_HEADER_LIMIT + 5))
        expected = f"X-Drive-Links accepts at most {LINK_HEADER_LIMIT} items"
        log = self.bind("message_log", [])

        for terminal in (False, True):
            with self.subTest(terminal=terminal):
                log.clear()
                with patch("sys.stdin", _Stdin(terminal)):
                    with self.assertRaises(frappe.ValidationError) as caught:
                        parse_link_header(header)
                self.assertEqual(str(caught.exception), expected)
                self.assertEqual(log[-1]["message"], expected)


# --- H. refusal mapping ---


class TestRefusalMapping(DavCase):
    def test_every_drive_refusal_maps_to_its_dav_status(self):
        expected = (
            (DriveNotFound, 404),
            (DriveForbidden, 403),
            (DriveConflict, 409),
            (DriveOverQuota, 507),
            (DriveLocked, 403),
            (DriveLinkExpired, 403),
            (DriveError, 400),
        )
        for refusal, status in expected:
            with self.subTest(refusal=refusal.__name__):
                self.assertEqual(errors.map_exception(refusal("refused")).status, status)

    def test_not_found_is_not_swallowed_by_the_validation_error_branch(self):
        self.assertTrue(issubclass(DriveNotFound, frappe.ValidationError))
        mapped = errors.map_exception(DriveNotFound("gone"))
        self.assertIsInstance(mapped, errors.NotFoundError)
        self.assertNotIsInstance(mapped, errors.Conflict)
        # a plain frappe ValidationError is what the 409 branch is for
        self.assertEqual(errors.map_exception(frappe.ValidationError("nope")).status, 409)

    def test_a_dav_error_passes_through_unchanged(self):
        raised = errors.NotFoundError("Resource not found.")
        self.assertIs(errors.map_exception(raised), raised)

    def test_a_refusal_never_leaks_the_drive_message_on_404_or_403(self):
        for refusal in (DriveNotFound, DriveForbidden, DriveLocked, DriveLinkExpired):
            with self.subTest(refusal=refusal.__name__):
                mapped = errors.map_exception(refusal("secret node title"))
                self.assertNotIn("secret", mapped.message)


# --- N. the harness itself (§12) ---


class TestDavFixtureQueueHygiene(DavCase):
    """The DAV harness must not change the site it measures.

    `webdav/tests/utils.file_node` builds every fixture file through
    `_core.nodes.create_file`, and those suites arrange about 140 files and
    commit. An unsuppressed fixture therefore leaves that many
    `previews.render` jobs on the site's short queue after each run.
    """

    def test_the_file_fixture_builds_its_node_without_queuing_a_render(self):
        from suite.drive._core import previews
        from suite.drive.webdav.tests import utils as dav_utils

        before = previews.enqueue_render

        def create_file(*args, **kwargs):
            previews.enqueue_render("node-1")
            return "node-1"

        blob = frappe._dict(name="blob-1", file_size=3, mime_type="text/plain", checksum="abc")
        with (
            patch.object(dav_utils, "put_blob", return_value=blob),
            patch.object(dav_utils, "node_principals", return_value=PRINCIPALS),
            patch.object(dav_utils.node_core, "create_file", side_effect=create_file),
            patch("suite.drive._core.previews.frappe.enqueue") as enqueue,
        ):
            node = dav_utils.file_node(USER, "root-1", "a.txt", b"abc")

        self.assertEqual(node.name, "node-1")
        self.assertEqual(node.blob, "blob-1")
        enqueue.assert_not_called()
        # the suppression is scoped to the fixture, not left on the module
        self.assertIs(previews.enqueue_render, before)


class TestLitmusHarness(DavCase):
    """`litmus_setup.prepare` provisions its user outside the test runner.

    `User.on_update` computes `now = frappe.in_test or frappe.flags.in_install`
    and enqueues `create_contact` with it. Under `bench execute` both are false,
    so the enqueue measures the queue depth and a site at its cap refuses the
    insert, rolling the litmus user back before the DAV URL is printed.
    """

    def setUp(self):
        super().setUp()
        from suite.drive.webdav.tests import litmus_setup

        self.harness = litmus_setup
        held = frappe.flags.in_install
        self.addCleanup(lambda: frappe.flags.__setitem__("in_install", held))
        # the real one reaches the shared redis cache; no unit case may write it
        self.clear_meta = self.start(patch.object(litmus_setup, "clear_meta_cache"))

    def test_the_block_makes_the_user_controller_run_its_job_inline(self):
        # the expression core computes, with the test runner's flag taken away
        with patch("frappe.in_test", False):
            self.assertFalse(frappe.in_test or frappe.flags.in_install)
            with self.harness.inline_user_jobs():
                self.assertTrue(frappe.in_test or frappe.flags.in_install)

    def test_the_flag_is_put_back_to_what_it_held(self):
        for held in (None, False, True):
            with self.subTest(held=held):
                frappe.flags.in_install = held
                with self.harness.inline_user_jobs():
                    self.assertTrue(frappe.flags.in_install)
                self.assertEqual(frappe.flags.in_install, held)

    def test_the_flag_is_put_back_when_the_block_raises(self):
        frappe.flags.in_install = False
        with self.assertRaises(frappe.QueueOverloaded):
            with self.harness.inline_user_jobs():
                raise frappe.QueueOverloaded("Too many queued background jobs")
        self.assertFalse(frappe.flags.in_install)

    def prepare(self, insert, refusal=None):
        """Run `prepare` site-free, recording the flag at each step."""
        seen = {}

        def ensure(user):
            seen["ensure_mount"] = frappe.flags.in_install

        self.db.exists.return_value = False
        with (
            patch("frappe.get_doc", return_value=frappe._dict(insert=insert)),
            patch("frappe.clear_document_cache"),
            patch("frappe.utils.get_url", return_value="http://site.test/dav/"),
            patch.object(self.harness, "update_password"),
            patch.object(self.harness, "enable_user_webdav"),
            patch.object(self.harness, "ensure_mount", side_effect=ensure),
            patch.object(self.harness, "mount_refusal", return_value=refusal),
        ):
            seen["url"] = self.harness.prepare()
        return seen

    def test_prepare_inserts_the_user_inside_the_isolation(self):
        seen = {}

        def insert(**kwargs):
            seen["insert"] = frappe.flags.in_install

        frappe.flags.in_install = False
        seen.update(self.prepare(insert))

        self.assertTrue(seen["insert"])
        self.assertEqual(seen["url"], "http://site.test/dav/")
        # and no wider: the rest of prepare runs on the site's own flags
        self.assertFalse(seen["ensure_mount"])
        self.assertFalse(frappe.flags.in_install)

    def test_prepare_puts_the_flag_back_when_the_insert_raises(self):
        def insert(**kwargs):
            raise frappe.QueueOverloaded("Too many queued background jobs")

        frappe.flags.in_install = False
        with self.assertRaises(frappe.QueueOverloaded):
            self.prepare(insert)
        self.assertFalse(frappe.flags.in_install)

    def test_the_block_drops_the_metas_it_may_have_poisoned(self):
        """`Meta.set_custom_permissions` returns early under `in_install`, and
        `get_meta` publishes what it built to the redis cache the web workers
        read. A meta first built inside the block must not outlive it."""
        with self.harness.inline_user_jobs():
            self.clear_meta.assert_not_called()
        self.clear_meta.assert_called_once_with()

    def test_the_metas_are_dropped_when_the_block_raises(self):
        with self.assertRaises(frappe.QueueOverloaded):
            with self.harness.inline_user_jobs():
                raise frappe.QueueOverloaded("Too many queued background jobs")
        self.clear_meta.assert_called_once_with()

    # ----------------------------------------------------------------------
    # the mount postcondition
    # ----------------------------------------------------------------------

    def mount(self, *, root="root-1", pair=None, parent="root-1", upload=None):
        """Patch the four site reads `mount_refusal` makes; return the mocks.

        Each argument stands for one half of the gate `handle_mkcol` applies:
        the root row, the pair it names, what `/dav/` resolves to, and §12.1's
        UPLOAD on it. `None` means the read is sound.
        """
        from suite.drive.webdav import pathmap

        resolved = frappe._dict(parent=parent, node=None, missing_intermediate=parent is None)
        mocks = frappe._dict(
            personal_root_for=self.start(patch.object(self.harness, "personal_root_for", return_value=root)),
            validate_root_pair=self.start(patch.object(self.harness, "validate_root_pair", side_effect=pair)),
            resolve=self.start(patch.object(pathmap, "resolve", return_value=resolved)),
            require=self.start(patch.object(self.harness, "require", side_effect=upload)),
            principals_for=self.start(
                patch.object(self.harness.framework, "principals_for", return_value="principals")
            ),
        )
        self.start(patch.object(pathmap, "reset_memo"))
        return mocks

    def test_a_sound_mount_is_not_refused(self):
        self.mount()
        self.assertIsNone(self.harness.mount_refusal("litmus@example.com"))

    def test_no_personal_root_is_refused(self):
        mocks = self.mount(root=None)
        refusal = self.harness.mount_refusal("litmus@example.com")

        self.assertIn("no Active Personal Root", refusal)
        self.assertIn("litmus@example.com", refusal)
        # and the reads below it are never made: there is nothing to read
        mocks.validate_root_pair.assert_not_called()
        mocks.resolve.assert_not_called()

    def test_a_root_pair_that_does_not_validate_is_refused(self):
        mocks = self.mount(pair=frappe.ValidationError("Root node is not a root."))
        refusal = self.harness.mount_refusal("litmus@example.com")

        self.assertIn("root-1", refusal)
        self.assertIn("Root node is not a root.", refusal)
        mocks.resolve.assert_not_called()

    def test_a_namespace_with_no_mount_is_refused(self):
        """What `pathmap` answers when the caller has no root to mount: the
        parent of the one collection litmus makes is None, and `handle_mkcol`
        turns that into the 409 that stopped all five groups."""
        self.mount(parent=None)
        refusal = self.harness.mount_refusal("litmus@example.com")

        self.assertIn("does not resolve", refusal)

    def test_a_root_the_user_cannot_write_into_is_refused(self):
        from suite.drive._core.errors import DriveNotFound

        self.mount(upload=DriveNotFound("Resource not found."))
        refusal = self.harness.mount_refusal("litmus@example.com")

        self.assertIn("UPLOAD", refusal)

    def test_the_mount_is_read_as_the_litmus_user_not_as_the_caller(self):
        """`bench execute` runs as Administrator, and `require` answers MANAGE
        to an admin on any node. Asking with the caller's identity would pass
        on a mount litmus cannot use."""
        from suite.drive._core.roles import UPLOAD

        mocks = self.mount()
        self.harness.mount_refusal("litmus@example.com")

        mocks.principals_for.assert_called_once_with("litmus@example.com")
        mocks.resolve.assert_called_once_with(["litmus"], "litmus@example.com")
        mocks.require.assert_called_once_with("root-1", UPLOAD, "principals")

    def ensure(self, refusal, root="root-1"):
        """Run `ensure_mount` with a stubbed refusal; return the two writers."""
        with (
            patch.object(self.harness, "personal_root_for", return_value=root),
            patch.object(self.harness, "mount_refusal", return_value=refusal),
            patch.object(self.harness, "drop_personal_root") as drop,
            patch.object(self.harness, "provision_personal_root") as provision,
        ):
            self.harness.ensure_mount("litmus@example.com")
        return drop, provision

    def test_a_root_that_will_not_serve_is_replaced(self):
        drop, provision = self.ensure("the Personal Root pair root-1 is not valid: gone")

        drop.assert_called_once_with("litmus@example.com")
        provision.assert_called_once_with("litmus@example.com")

    def test_a_sound_root_is_left_alone(self):
        """`provision_personal_root` returns early on an existing row, so the
        call is the no-op; the drop is what must not happen."""
        drop, provision = self.ensure(None)

        drop.assert_not_called()
        provision.assert_called_once_with("litmus@example.com")

    def test_a_user_with_no_root_is_provisioned_without_a_drop(self):
        drop, provision = self.ensure("no Active Personal Root", root=None)

        drop.assert_not_called()
        provision.assert_called_once_with("litmus@example.com")

    def test_prepare_refuses_to_print_a_url_for_a_mount_that_is_not_there(self):
        """The gate this whole postcondition exists for. Without it `prepare`
        prints the URL, litmus MKCOLs its one collection, and every group stops
        in `begin` on a 409 that reads as a protocol defect."""
        with self.assertRaises(self.harness.LitmusFixtureError) as caught:
            self.prepare(lambda **kwargs: None, refusal="root-1 has no anchor grant")

        self.assertIn("root-1 has no anchor grant", str(caught.exception))

    def test_prepare_proves_the_mount_after_the_commit(self):
        """The committed rows are what the served site reads, so the proof has
        to come after the commit, not before it."""
        order = []
        self.db.commit.side_effect = lambda: order.append("commit")

        with (
            patch("frappe.get_doc", return_value=frappe._dict(insert=lambda **kwargs: None)),
            patch("frappe.clear_document_cache"),
            patch("frappe.utils.get_url", return_value="http://site.test/dav/"),
            patch.object(self.harness, "update_password"),
            patch.object(self.harness, "enable_user_webdav"),
            patch.object(self.harness, "ensure_mount"),
            patch.object(self.harness, "mount_refusal", side_effect=lambda user: order.append("proof")),
        ):
            self.db.exists.return_value = False
            self.harness.prepare()

        self.assertEqual(order, ["commit", "proof"])


class TestLitmusVerdict(UnitTestCase):
    """`litmus_verdict.sh` reads a litmus transcript and rules on it.

    Gate run 6 is why this suite exists. All five groups stopped in `begin` on
    a 409, no case ran at all, and the runner's only complaint was:

        STALE LEDGER LINE (now passes): basic:delete_fragment:WARNING

    Two faults made that the report. The stale check read the ledger's whole
    third field as the kind, reason prose included, so it matched no transcript
    line and called the entry stale on every run. And it ruled on the absence
    of a non-pass line, which makes "ran and passed" and "never ran" the same
    state. Nothing in the runner noticed the abort message itself.

    A recorded transcript is all this needs, so it runs here rather than on the
    site gate: no served site, no litmus binary.
    """

    LEDGER = (
        "# tolerated non-passes\n"
        "basic:delete_fragment:WARNING werkzeug strips URI fragments before the app sees"
        " them, so a fragment-bearing DELETE cannot be told apart from a normal one\n"
    )
    GROUPS = ("http", "basic", "copymove", "props", "locks")

    def setUp(self):
        from suite.drive.webdav.tests import litmus_setup

        self.script = os.path.join(os.path.dirname(litmus_setup.__file__), "litmus_verdict.sh")

    def rule(self, transcript, ledger=None):
        """Run the script on a transcript; return (exit status, its output)."""
        with tempfile.TemporaryDirectory() as tmp:
            ledger_path = os.path.join(tmp, "litmus_expected.txt")
            output_path = os.path.join(tmp, "output.txt")
            with open(ledger_path, "w") as f:
                f.write(self.LEDGER if ledger is None else ledger)
            with open(output_path, "w") as f:
                f.write(transcript)
            done = subprocess.run(
                ["bash", self.script, ledger_path, output_path],
                capture_output=True,
                text=True,
            )
        return done.returncode, done.stdout + done.stderr

    def transcript(self, *, fragment="WARNING (unreported)", groups=GROUPS):
        """A full run of every group, with `basic:delete_fragment` as given."""
        lines = []
        for group in groups:
            lines.append(f"-> running `{group}':")
            lines.append(" 0. init.................. pass")
            lines.append(" 1. begin................. pass")
            if group == "basic":
                lines.append(f" 9. delete_fragment....... {fragment}")
            lines.append(" 2. finish................ pass")
            lines.append(f"<- summary for `{group}': of 3 tests run: 3 passed, 0 failed. 100.0%")
        return "\n".join(lines) + "\n"

    def aborted(self):
        """Gate run 6, as litmus printed it.

        litmus MKCOLs its own `litmus/` collection in every group's `begin`,
        before a single case. A 409 there makes it print this line and abandon
        the group, so there is no verdict line to read.
        """
        lines = []
        for group in self.GROUPS:
            lines.append(f"-> running `{group}':")
            lines.append(" 0. init.................. pass")
            lines.append("Could not create new collection `/dav/litmus/' for tests: 409 CONFLICT")
        return "\n".join(lines) + "\n"

    # --- the gate run 6 report ---

    def test_a_run_that_aborts_in_begin_is_named_as_an_abort(self):
        status, out = self.rule(self.aborted())

        self.assertEqual(status, 1)
        self.assertIn("ABORTED: Could not create new collection", out)
        for group in self.GROUPS:
            self.assertIn(f"GROUP DID NOT START: {group}", out)

    def test_an_abort_does_not_call_the_ledger_stale(self):
        """The bug this file was written for. A group that never ran proves
        nothing about the tests inside it, so its ledger lines stand."""
        status, out = self.rule(self.aborted())

        self.assertEqual(status, 1)
        self.assertNotIn("STALE", out)
        self.assertIn("LEDGERED TEST DID NOT RUN: basic:delete_fragment:WARNING", out)

    def test_a_group_that_never_started_is_named(self):
        status, out = self.rule(self.transcript(groups=("http", "basic")))

        self.assertEqual(status, 1)
        self.assertIn("GROUP DID NOT RUN: locks", out)
        self.assertNotIn("GROUP DID NOT RUN: http", out)

    def test_an_empty_transcript_fails(self):
        """litmus crashed, or never connected. Silence is not a pass."""
        status, out = self.rule("")

        self.assertEqual(status, 1)
        self.assertNotIn("all groups clean", out)

    # --- the ledger ---

    def test_a_ledgered_warning_that_still_warns_is_clean(self):
        """The reason prose after the kind is prose. Reading it as part of the
        kind is what reported this entry stale on every run."""
        status, out = self.rule(self.transcript())

        self.assertEqual(status, 0)
        self.assertIn("litmus: all groups clean", out)
        self.assertNotIn("STALE", out)

    def test_a_ledgered_test_that_now_passes_is_stale(self):
        status, out = self.rule(self.transcript(fragment="pass"))

        self.assertEqual(status, 1)
        self.assertIn("STALE LEDGER LINE (now passes): basic:delete_fragment:WARNING", out)

    def test_a_ledgered_warning_that_became_a_failure_is_reported(self):
        status, out = self.rule(self.transcript(fragment="FAIL (deleted the wrong node)"))

        self.assertEqual(status, 1)
        self.assertIn("UNLEDGERED FAIL: basic:delete_fragment", out)

    def test_an_unledgered_failure_fails_the_run(self):
        status, out = self.rule(self.transcript(fragment="FAIL (deleted the wrong node)"), ledger="")

        self.assertEqual(status, 1)
        self.assertIn("UNLEDGERED FAIL: basic:delete_fragment", out)

    def test_an_unledgered_warning_alone_does_not_fail_the_run(self):
        """A WARNING is litmus reporting a tolerated deviation. Only a FAIL
        turns the gate red; the WARNING is printed so it can be ledgered."""
        transcript = self.transcript(groups=("http", "copymove", "props", "locks"))
        transcript += "-> running `basic':\n 1. begin................. pass\n"
        transcript += " 9. delete_fragment....... WARNING (unreported)\n"
        status, out = self.rule(transcript, ledger="")

        self.assertEqual(status, 0)
        self.assertIn("UNLEDGERED WARNING: basic:delete_fragment", out)

    def test_a_ledger_line_is_read_with_its_group(self):
        """`init`, `begin` and `finish` exist in all five groups. A tolerance
        ledgered for one of them must not excuse another."""
        transcript = self.transcript()
        transcript = transcript.replace(
            "-> running `locks':\n 0. init.................. pass",
            "-> running `locks':\n 0. init.................. FAIL (no lock support)",
        )
        status, out = self.rule(transcript, ledger="http:init:FAIL tolerated in http only\n")

        self.assertEqual(status, 1)
        self.assertIn("UNLEDGERED FAIL: locks:init", out)

    # --- lines that are not verdicts ---

    def test_prose_that_mentions_a_verdict_is_not_read_as_one(self):
        """`tr '\\r' '\\n'` in run_litmus.sh splits any CR inside an echoed
        response body into fresh lines, so arbitrary text reaches this parser."""
        transcript = self.transcript()
        transcript += 'File "/apps/suite/drive/webdav/dav.py", line 91. WARNING\n'
        transcript += "the server said: FAIL\n"
        status, out = self.rule(transcript)

        self.assertEqual(status, 0)
        self.assertIn("litmus: all groups clean", out)

    def test_a_server_message_naming_warning_does_not_hide_a_failure(self):
        """The verdict is the field after the dots, not any word on the line."""
        status, out = self.rule(self.transcript(fragment="FAIL (server said WARNING: no)"))

        self.assertEqual(status, 1)
        self.assertIn("UNLEDGERED FAIL: basic:delete_fragment", out)

    # --- the shipped ledger, against the run it was written from ---

    def shipped_ledger(self) -> str:
        from suite.drive.webdav.tests import litmus_setup

        path = os.path.join(os.path.dirname(litmus_setup.__file__), "litmus_expected.txt")
        with open(path) as ledger:
            return ledger.read()

    def gate_run_7(self, complex_verdict="FAIL (400 Bad Request)") -> str:
        """Gate run 7's shape: every group runs, and the two litmus 0.13
        conditionals fail in `locks`."""
        lines = []
        for group in self.GROUPS:
            lines.append(f"-> running `{group}':")
            lines.append(" 0. init.................. pass")
            lines.append(" 1. begin................. pass")
            if group == "basic":
                lines.append(" 9. delete_fragment....... WARNING (unreported)")
            if group == "locks":
                lines.append(f"27. complex_cond_put...... {complex_verdict}")
                lines.append(f"28. fail_complex_cond_put. {complex_verdict}")
            lines.append(" 2. finish................ pass")
        return "\n".join(lines) + "\n"

    def test_the_shipped_ledger_covers_gate_run_7(self):
        """The ledger has to name the tests litmus really prints. A typo in a
        test name reads as a tolerance for a test that never ran, and the run
        stays red for a reason nobody can find in the transcript.
        """
        status, out = self.rule(self.gate_run_7(), ledger=self.shipped_ledger())

        self.assertEqual(status, 0, out)
        self.assertIn("litmus: all groups clean", out)

    def test_the_two_conditional_lines_go_when_litmus_can_send_the_header(self):
        """The ledger tolerates a client defect, so it must come out by itself
        the moment litmus stops truncating the header."""
        status, out = self.rule(self.gate_run_7(complex_verdict="pass"), ledger=self.shipped_ledger())

        self.assertEqual(status, 1)
        self.assertIn("STALE LEDGER LINE (now passes): locks:complex_cond_put:FAIL", out)
        self.assertIn("STALE LEDGER LINE (now passes): locks:fail_complex_cond_put:FAIL", out)
