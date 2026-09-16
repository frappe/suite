"""PROPPATCH against the single Personal Root mount.

Dead properties (RFC 4918 §4.4) are rows keyed by `Drive Node` id, so a MOVE
carries them without touching them and a COPY clones them onto the new ids.
The verb takes EDIT on the node (§12.1) and stamps Windows Explorer's
`Win32LastModifiedTime` into `content_modified` through the workflow that owns
it (§8.11), which is the same field PROPFIND publishes as `getlastmodified`
(§12.4).
"""

from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
from frappe.tests import IntegrationTestCase
from lxml import etree
from werkzeug.http import parse_date

from suite.drive._core import nodes as node_core
from suite.drive._core.access import grant
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.roles import NONE, READ
from suite.drive.webdav import copy as copy_module
from suite.drive.webdav import deadprops, pathmap, propfind, proppatch, structure
from suite.drive.webdav.errors import BadRequest, NotFoundError, map_exception
from suite.drive.webdav.properties import rfc1123
from suite.drive.webdav.tests.utils import (
    drop_nodes,
    ensure_user_with_password,
    file_node,
    folder_node,
    make_ctx,
    node_principals,
    personal_dav_root,
    raw_document_node,
    reset_dav_request,
)
from suite.drive.webdav.xmlutil import dav

OWNER = "webdav-proppatch-owner@example.com"
STRANGER = "webdav-proppatch-stranger@example.com"
PASSWORD = "webdav-proppatch-pw"

COLOR = "{urn:z}color"

SET_CUSTOM = (
    b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
    b"<D:set><D:prop><z:color>indigo</z:color></D:prop></D:set></D:propertyupdate>"
)
REMOVE_CUSTOM = (
    b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
    b"<D:remove><D:prop><z:color/></D:prop></D:remove></D:propertyupdate>"
)
ASK_COLOR = (
    b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>'
    b'<z:color xmlns:z="urn:z"/></D:prop></D:propfind>'
)

WIN32_DATE = "Thu, 20 Aug 2026 10:00:00 GMT"
SET_WIN32_MTIME = (
    b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" '
    b'xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop>'
    b"<Z:Win32LastModifiedTime>" + WIN32_DATE.encode() + b"</Z:Win32LastModifiedTime>"
    b"</D:prop></D:set></D:propertyupdate>"
)

# A zone that is neither UTC nor a whole hour from it, so a stamp written in
# the site's zone cannot be mistaken for one written in the process's.
SITE_ZONE = ZoneInfo("Asia/Kolkata")


def multistatus(response) -> etree._Element:
    return etree.fromstring(response.get_data())


def href(parsed) -> str:
    return parsed.find(f"{dav('response')}/{dav('href')}").text


def prop_statuses(parsed) -> dict[str, str]:
    """{property tag: its own status line} across every propstat (§9.2)."""
    result = {}
    for propstat in parsed.findall(f"{dav('response')}/{dav('propstat')}"):
        status = propstat.find(dav("status")).text
        for element in propstat.find(dav("prop")):
            result[element.tag] = status
    return result


class TestWebDAVProppatch(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(STRANGER, PASSWORD)
        cls.root = personal_dav_root(OWNER)
        personal_dav_root(STRANGER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # One fresh folder per test. Nothing rolls back between tests in this
        # class, and every case here counts the rows on one node.
        self.folder_title = f"PP-{frappe.generate_hash(length=6)}"
        self.folder = folder_node(OWNER, self.root, self.folder_title)
        self.file = file_node(OWNER, self.folder, "target.txt", b"props")
        self.target = f"/dav/{self.folder_title}/target.txt"
        self.created = [self.file.name, self.folder]

    def tearDown(self):
        frappe.set_user("Administrator")
        reset_dav_request()
        # `drop_nodes` does not know about the DAV property table, so the rows
        # this suite writes are removed by id first.
        frappe.db.delete("Drive DAV Property", {"entity": ["in", self.created]})
        drop_nodes(self.created)
        super().tearDown()

    def _track(self, *node_ids: str) -> None:
        self.created.extend(node_ids)

    def _proppatch(self, body: bytes, path: str | None = None, user: str = OWNER):
        return proppatch.handle(make_ctx("PROPPATCH", path or self.target, user, data=body))

    def _propfind(self, body: bytes = b"", path: str | None = None):
        ctx = make_ctx("PROPFIND", path or self.target, OWNER, headers={"Depth": "0"}, data=body)
        return multistatus(propfind.handle(ctx))

    def _resolve(self, *segments: str):
        pathmap.reset_memo()
        return pathmap.resolve(list(segments), OWNER).node

    # ----------------------------------------------------------------------
    # Storing, reading back, and removing
    # ----------------------------------------------------------------------

    def test_set_read_back_and_remove_a_dead_property(self):
        """§4.4: what a client PROPPATCHes is what the next PROPFIND reports.

        The href is the URL the client named. There is one mount, so no
        segment stands between `/dav/` and the caller's own children.
        """
        response = self._proppatch(SET_CUSTOM)
        self.assertEqual(response.status_code, 207)
        parsed = multistatus(response)
        self.assertEqual(href(parsed), f"/dav/{self.folder_title}/target.txt")
        self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 200 OK")

        found = self._propfind(ASK_COLOR)
        color = found.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}/{COLOR}")
        self.assertEqual(color.text, "indigo")

        self._proppatch(REMOVE_CUSTOM)
        self.assertEqual(deadprops.count(self.file.name), 0)
        # a property that is gone is reported as 404 for that property alone
        propstat = self._propfind(ASK_COLOR).find(f"{dav('response')}/{dav('propstat')}")
        self.assertIn("404", propstat.find(dav("status")).text)

    def test_allprop_includes_dead_properties(self):
        self._proppatch(SET_CUSTOM)
        found = self._propfind()
        color = found.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}/{COLOR}")
        self.assertIsNotNone(color)

    def test_remove_is_idempotent(self):
        """§9.2: removing a property that is not there is a success."""
        self._proppatch(SET_CUSTOM)
        for _ in range(2):
            parsed = multistatus(self._proppatch(REMOVE_CUSTOM))
            self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 200 OK")
        self.assertEqual(deadprops.count(self.file.name), 0)

    def test_update_overwrites_in_place(self):
        self._proppatch(SET_CUSTOM)
        self._proppatch(SET_CUSTOM.replace(b"indigo", b"crimson"))
        self.assertEqual(deadprops.count(self.file.name), 1)
        props = deadprops.get_dead_props([self.file.name])[self.file.name]
        self.assertEqual(props[COLOR].text, "crimson")

    def test_a_dead_property_row_names_a_drive_node(self):
        """The row's `entity` is a node id, and the read is on node identity.

        Ticket 24 left the table pointed at `Drive Node` while the verbs still
        wrote `File` ids. `_core.nodes` guards its copy and purge cascades on
        this same field option, so both stop working if it moves.
        """
        self._proppatch(SET_CUSTOM)
        self.assertEqual(frappe.get_meta("Drive DAV Property").get_field("entity").options, "Drive Node")

        entity = frappe.db.get_value("Drive DAV Property", {"entity": self.file.name}, "entity")
        self.assertEqual(entity, self.file.name)
        self.assertTrue(frappe.db.exists("Drive Node", entity))
        self.assertEqual(deadprops.get_dead_props([entity])[entity][COLOR].text, "indigo")

    # ----------------------------------------------------------------------
    # §12.1 authorization
    # ----------------------------------------------------------------------

    def test_a_reader_cannot_proppatch(self):
        """§12.1: PROPPATCH takes EDIT, so READ alone is refused with 403.

        The mount is the caller's own Personal Root, and §11.2 refuses a grant
        that names that root's own user inside it. The grant therefore names
        `$GENERAL`, which the caller carries as well: nearest depth beats
        identity tier (§5.1), so the node answers READ while the folder above
        it stays MANAGE.
        """
        grant(self.file.name, "$GENERAL", READ, node_principals(OWNER))
        with self.assertRaises(DriveForbidden) as caught:
            self._proppatch(SET_CUSTOM)
        self.assertEqual(map_exception(caught.exception).status, 403)
        self.assertEqual(deadprops.count(self.file.name), 0)

    def test_an_unreadable_node_is_404_not_403(self):
        """§12.1: below READ the verb answers 404, so it leaks no existence.

        `require` refuses below READ with the engine's own not-found. The same
        answer covers a path that is not in the caller's mount at all, which is
        every path in another user's root.
        """
        grant(self.file.name, "$GENERAL", NONE, node_principals(OWNER))
        with self.assertRaises(DriveNotFound) as caught:
            self._proppatch(SET_CUSTOM)
        self.assertEqual(map_exception(caught.exception).status, 404)

        with self.assertRaises(NotFoundError):
            self._proppatch(SET_CUSTOM, user=STRANGER)

    def test_a_content_document_is_not_reachable(self):
        """§12.2: a document node is hidden, so no verb reaches it by URL."""
        document = raw_document_node(self.folder, "Deck")
        self._track(document)
        with self.assertRaises(NotFoundError):
            self._proppatch(SET_CUSTOM, path=f"/dav/{self.folder_title}/Deck")

    def test_a_malformed_body_is_400(self):
        with self.assertRaises(BadRequest):
            self._proppatch(b"<wrong-root/>")

    def test_a_missing_resource_is_404(self):
        with self.assertRaises(NotFoundError):
            self._proppatch(SET_CUSTOM, path=f"/dav/{self.folder_title}/ghost.txt")

    # ----------------------------------------------------------------------
    # The per-entity property cap
    # ----------------------------------------------------------------------

    def _fill_to_cap(self) -> None:
        """Store exactly MAX_PROPS_PER_ENTITY dead properties on the file."""
        for index in range(deadprops.MAX_PROPS_PER_ENTITY):
            deadprops.upsert(self.file.name, etree.Element(f"{{urn:z}}p{index}"))
        self.assertEqual(deadprops.count(self.file.name), deadprops.MAX_PROPS_PER_ENTITY)

    def test_the_cap_refuses_one_more_property_than_the_entity_may_hold(self):
        """A genuine addition at the cap is 507, and nothing is applied."""
        self._fill_to_cap()

        parsed = multistatus(self._proppatch(SET_CUSTOM))
        self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 507 Insufficient Storage")
        self.assertNotIn(COLOR, deadprops.get_dead_props([self.file.name]).get(self.file.name, {}))
        self.assertEqual(deadprops.count(self.file.name), deadprops.MAX_PROPS_PER_ENTITY)

    def test_overwriting_a_property_the_entity_holds_is_not_an_addition(self):
        """A `set` over a stored property replaces one row and asks for no
        storage, so the cap has nothing to refuse. Counting it as an addition
        made a client sitting at the cap unable to rewrite its own property."""
        deadprops.upsert(self.file.name, etree.fromstring(b'<z:color xmlns:z="urn:z">green</z:color>'))
        for index in range(deadprops.MAX_PROPS_PER_ENTITY - 1):
            deadprops.upsert(self.file.name, etree.Element(f"{{urn:z}}p{index}"))
        self.assertEqual(deadprops.count(self.file.name), deadprops.MAX_PROPS_PER_ENTITY)

        parsed = multistatus(self._proppatch(SET_CUSTOM))
        self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 200 OK")
        stored = deadprops.get_dead_props([self.file.name])[self.file.name]
        self.assertEqual(stored[COLOR].text, "indigo")
        self.assertEqual(deadprops.count(self.file.name), deadprops.MAX_PROPS_PER_ENTITY)

    def test_the_cap_counts_a_repeated_tag_once(self):
        """Two sets of one tag in one body write one row, so they cost one."""
        for index in range(deadprops.MAX_PROPS_PER_ENTITY - 1):
            deadprops.upsert(self.file.name, etree.Element(f"{{urn:z}}p{index}"))

        body = (
            b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
            b"<D:set><D:prop><z:color>one</z:color></D:prop></D:set>"
            b"<D:set><D:prop><z:color>two</z:color></D:prop></D:set></D:propertyupdate>"
        )
        parsed = multistatus(self._proppatch(body))
        self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 200 OK")
        self.assertEqual(deadprops.count(self.file.name), deadprops.MAX_PROPS_PER_ENTITY)

    def test_a_same_named_property_in_another_namespace_is_a_real_addition(self):
        """The cap keys on (namespace, name), so `urn:y`色 is not `urn:z`色."""
        deadprops.upsert(self.file.name, etree.fromstring(b'<y:color xmlns:y="urn:y">green</y:color>'))
        for index in range(deadprops.MAX_PROPS_PER_ENTITY - 1):
            deadprops.upsert(self.file.name, etree.Element(f"{{urn:z}}p{index}"))

        parsed = multistatus(self._proppatch(SET_CUSTOM))
        self.assertEqual(prop_statuses(parsed)[COLOR], "HTTP/1.1 507 Insufficient Storage")

    # ----------------------------------------------------------------------
    # §9.2 atomicity
    # ----------------------------------------------------------------------

    def test_a_protected_property_is_refused_and_the_request_applies_nothing(self):
        """RFC 4918 §9.2: the failing property reports its own status, every
        other instruction reports 424, and none of them is applied.

        The live DAV: set is computed by the server, so a client that could
        write `getetag` would forge the validator its own conditional requests
        are checked against.
        """
        self._proppatch(SET_CUSTOM)
        body = (
            b'<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:z="urn:z">'
            b"<D:set><D:prop><z:ok>fine</z:ok><D:getetag>forged</D:getetag></D:prop></D:set>"
            b"<D:remove><D:prop><z:color/></D:prop></D:remove>"
            b"</D:propertyupdate>"
        )
        response = self._proppatch(body)
        self.assertEqual(response.status_code, 207)

        statuses = prop_statuses(multistatus(response))
        self.assertEqual(statuses[dav("getetag")], "HTTP/1.1 403 Forbidden")
        self.assertEqual(statuses["{urn:z}ok"], "HTTP/1.1 424 Failed Dependency")
        self.assertEqual(statuses[COLOR], "HTTP/1.1 424 Failed Dependency")

        # the set did not land and the remove did not run
        props = deadprops.get_dead_props([self.file.name])[self.file.name]
        self.assertEqual(deadprops.count(self.file.name), 1)
        self.assertEqual(props[COLOR].text, "indigo")
        self.assertNotIn("{urn:z}ok", props)

    # ----------------------------------------------------------------------
    # §8.11 the Windows mtime
    # ----------------------------------------------------------------------

    def test_win32_mtime_is_stamped_in_the_site_zone(self):
        """§8.11: the client's mtime lands in `Drive Node.content_modified`.

        The column is naive, so the instant is converted with the site's zone
        and not the one the process happens to run in. PROPFIND converts it
        back the same way, which is what returns the client its own string
        (§12.4). Explorer PROPPATCHes this after every copy and reads it back,
        so the property itself is stored as well.
        """
        with patch("suite.drive.webdav.properties._site_zone", return_value=SITE_ZONE):
            parsed = multistatus(self._proppatch(SET_WIN32_MTIME))
            self.assertEqual(
                prop_statuses(parsed)["{urn:schemas-microsoft-com:}Win32LastModifiedTime"],
                "HTTP/1.1 200 OK",
            )

            stored = frappe.utils.get_datetime(
                frappe.db.get_value("Drive Node", self.file.name, "content_modified")
            )
            sent = parse_date(WIN32_DATE)
            self.assertEqual(stored, sent.astimezone(SITE_ZONE).replace(tzinfo=None))
            # the site zone is offset from UTC, so the naive UTC clock time is
            # a different value and this pins which of the two was written
            self.assertNotEqual(stored, sent.replace(tzinfo=None))
            self.assertEqual(rfc1123(stored), WIN32_DATE)

            prop = self._propfind().find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
            self.assertEqual(prop.find(dav("getlastmodified")).text, WIN32_DATE)

        self.assertEqual(deadprops.count(self.file.name), 1)

    # ----------------------------------------------------------------------
    # What MOVE, COPY, and purge do to the rows
    # ----------------------------------------------------------------------

    def test_dead_properties_follow_a_move(self):
        """The rows are keyed by node id, and MOVE keeps the id."""
        self._proppatch(SET_CUSTOM)
        structure.handle_move(
            make_ctx(
                "MOVE",
                self.target,
                OWNER,
                headers={"Destination": f"/dav/{self.folder_title}/moved.txt"},
            )
        )

        moved = self._resolve(self.folder_title, "moved.txt")
        self.assertEqual(moved.name, self.file.name)
        self.assertEqual(deadprops.count(self.file.name), 1)

        found = self._propfind(ASK_COLOR, path=f"/dav/{self.folder_title}/moved.txt")
        color = found.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}/{COLOR}")
        self.assertEqual(color.text, "indigo")

    def test_copy_clones_dead_properties_onto_the_new_ids(self):
        """RFC 4918 §9.8.2: a COPY carries dead properties.

        The copy is a different node, so the rows are cloned rather than
        shared, and the workflow walks the whole subtree: a descendant's
        properties are cloned onto the descendant's copy.
        """
        sub = folder_node(OWNER, self.folder, "sub")
        inner = file_node(OWNER, sub, "inner.txt", b"nested")
        self._track(inner.name, sub)
        self._proppatch(SET_CUSTOM, path=f"/dav/{self.folder_title}/sub")
        self._proppatch(
            SET_CUSTOM.replace(b"indigo", b"crimson"),
            path=f"/dav/{self.folder_title}/sub/inner.txt",
        )

        copy_module.handle(
            make_ctx(
                "COPY",
                f"/dav/{self.folder_title}/sub",
                OWNER,
                headers={"Destination": f"/dav/{self.folder_title}/sub-copy"},
            )
        )
        copied_folder = self._resolve(self.folder_title, "sub-copy")
        copied_inner = self._resolve(self.folder_title, "sub-copy", "inner.txt")
        self._track(copied_inner.name, copied_folder.name)

        self.assertNotEqual(copied_folder.name, sub)
        self.assertNotEqual(copied_inner.name, inner.name)
        cloned = deadprops.get_dead_props([copied_folder.name, copied_inner.name])
        self.assertEqual(cloned[copied_folder.name][COLOR].text, "indigo")
        self.assertEqual(cloned[copied_inner.name][COLOR].text, "crimson")
        # the source keeps its own rows
        self.assertEqual(deadprops.count(sub), 1)

    def test_purge_cascades_dead_properties(self):
        """§3.15: purging a node takes its DAV property rows with it.

        DELETE is Drive's trash and the node stays, so the cascade this suite
        has to prove is the one on the workflow that really destroys the row.
        """
        self._proppatch(SET_CUSTOM)
        self.assertEqual(deadprops.count(self.file.name), 1)

        node_core.purge(node_principals(OWNER), self.file.name)
        self.assertEqual(frappe.db.count("Drive DAV Property", {"entity": self.file.name}), 0)
