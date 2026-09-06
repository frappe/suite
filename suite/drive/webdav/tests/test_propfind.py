"""PROPFIND against the single Personal Root mount.

`/dav/` is the caller's own root (§12). Depth 1 spends the engine's folder
page and nothing per child, so the query count does not move with the number
of children (§12.5).
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from lxml import etree

from suite.drive._core.access import grant
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.roles import NONE
from suite.drive.webdav import propfind
from suite.drive.webdav.errors import BadRequest, Forbidden, NotFoundError, map_exception
from suite.drive.webdav.tests.utils import (
    drop_dav_root,
    drop_nodes,
    ensure_user_with_password,
    file_node,
    folder_node,
    make_ctx,
    node_principals,
    personal_dav_root,
    raw_document_node,
)
from suite.drive.webdav.xmlutil import dav

OWNER = "webdav-propfind-owner@example.com"
STRANGER = "webdav-propfind-stranger@example.com"
PASSWORD = "webdav-propfind-pw"
QUOTA = 10 * 1024 * 1024

REPORT = b"hello propfind"
NOTES = b"# notes"

PROPNAME_BODY = b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>'


def multistatus(response) -> etree._Element:
    return etree.fromstring(response.get_data())


def hrefs(parsed) -> list[str]:
    return [element.text for element in parsed.findall(f"{dav('response')}/{dav('href')}")]


def propfind_response(user: str, path: str, depth: str = "1", body: bytes = b""):
    ctx = make_ctx("PROPFIND", path, user, headers={"Depth": depth}, data=body)
    return propfind.handle(ctx)


def prop_body(*names: str) -> bytes:
    props = "".join(f"<D:{name}/>" for name in names)
    return f'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>{props}</D:prop></D:propfind>'.encode()


class TestWebDAVPropfind(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user_with_password(OWNER, PASSWORD)
        ensure_user_with_password(STRANGER, PASSWORD)
        # a root of its own, so the quota properties have a stated limit rather
        # than whichever site default `Drive Disk Settings` happens to carry
        drop_dav_root(OWNER)
        cls.root = personal_dav_root(OWNER, quota_bytes=QUOTA)
        personal_dav_root(STRANGER)
        cls.docs = folder_node(OWNER, cls.root, "PropDocs")
        cls.report = file_node(OWNER, cls.docs, "report.txt", REPORT, mime="text/plain")
        cls.notes = file_node(OWNER, cls.docs, "notes.md", NOTES, mime="text/markdown")

    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def test_depth_infinity_is_refused_with_precondition(self):
        for depth_headers in ({"Depth": "infinity"}, {}):
            ctx = make_ctx("PROPFIND", "/dav/", OWNER, headers=depth_headers)
            with self.assertRaises(Forbidden) as caught:
                propfind.handle(ctx)
            self.assertEqual(caught.exception.condition, "propfind-finite-depth")

    def test_depth_zero_file_properties(self):
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.txt", depth="0"))
        responses = parsed.findall(dav("response"))
        self.assertEqual(len(responses), 1)

        prop = responses[0].find(f"{dav('propstat')}/{dav('prop')}")
        self.assertEqual(prop.find(dav("displayname")).text, "report.txt")
        self.assertEqual(prop.find(dav("getcontentlength")).text, str(len(REPORT)))
        self.assertEqual(prop.find(dav("getcontenttype")).text, self.report.mime)
        self.assertTrue(prop.find(dav("getlastmodified")).text.endswith(" GMT"))
        # §12.4: the strong validator is the blob checksum, quoted
        self.assertEqual(prop.find(dav("getetag")).text, f'"{self.report.checksum}"')
        self.assertEqual(len(prop.find(dav("resourcetype"))), 0)

    def test_the_mount_lists_the_personal_root(self):
        parsed = multistatus(propfind_response(OWNER, "/dav/"))
        listed = hrefs(parsed)
        self.assertEqual(listed[0], "/dav/")
        self.assertIn("/dav/PropDocs/", listed)

        prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
        self.assertEqual(len(prop.find(dav("resourcetype"))), 1)
        self.assertEqual(prop.find(dav("resourcetype"))[0].tag, dav("collection"))

    def test_depth_one_lists_children_with_collection_hrefs(self):
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs"))
        listed = hrefs(parsed)
        self.assertEqual(listed[0], "/dav/PropDocs/")
        self.assertIn("/dav/PropDocs/report.txt", listed)
        self.assertIn("/dav/PropDocs/notes.md", listed)

    def test_depth_one_on_a_file_is_just_the_file(self):
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.txt"))
        self.assertEqual(len(parsed.findall(dav("response"))), 1)

    def test_content_documents_and_their_media_are_hidden(self):
        """§12.2: absent from the listing, and 404 by direct URL."""
        document = raw_document_node(self.docs, "Deck")
        media = file_node(OWNER, document, "slide-1.png", b"png-bytes")
        try:
            listed = hrefs(multistatus(propfind_response(OWNER, "/dav/PropDocs")))
            self.assertNotIn("/dav/PropDocs/Deck", listed)
            self.assertNotIn("/dav/PropDocs/Deck/", listed)
            self.assertNotIn("/dav/PropDocs/Deck/slide-1.png", listed)

            with self.assertRaises(NotFoundError):
                propfind_response(OWNER, "/dav/PropDocs/Deck", depth="0")
            with self.assertRaises(NotFoundError):
                propfind_response(OWNER, "/dav/PropDocs/Deck/slide-1.png", depth="0")
        finally:
            drop_nodes([media.name, document])

    def test_an_uploaded_office_file_is_listed(self):
        """Kind decides visibility, not the extension (§12.2)."""
        docx = file_node(OWNER, self.docs, "report.docx", b"PK\x03\x04 not really a docx")
        try:
            listed = hrefs(multistatus(propfind_response(OWNER, "/dav/PropDocs")))
            self.assertIn("/dav/PropDocs/report.docx", listed)

            parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.docx", depth="0"))
            prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
            self.assertEqual(len(prop.find(dav("resourcetype"))), 0)
        finally:
            drop_nodes([docx.name])

    def test_unreadable_children_are_omitted(self):
        """§12.1: a child shows only when its role is READ or higher."""
        hidden = file_node(OWNER, self.docs, "hidden.txt", b"no")
        try:
            grant(hidden.name, OWNER, NONE, node_principals(OWNER))
            listed = hrefs(multistatus(propfind_response(OWNER, "/dav/PropDocs")))
            self.assertIn("/dav/PropDocs/report.txt", listed)
            self.assertNotIn("/dav/PropDocs/hidden.txt", listed)

            # the point check refuses with the engine's own refusal; the
            # dispatcher maps it, and `test_drive_refusals_map_to_dav_statuses`
            # is where that mapping is pinned
            with self.assertRaises(DriveNotFound):
                propfind_response(OWNER, "/dav/PropDocs/hidden.txt", depth="0")
        finally:
            drop_nodes([hidden.name])

    def test_drive_refusals_map_to_dav_statuses(self):
        """§12.1: unreadable is always 404, never 403."""
        self.assertEqual(map_exception(DriveNotFound("gone")).status, 404)
        self.assertEqual(map_exception(DriveForbidden("no")).status, 403)

    def test_another_root_is_not_reachable(self):
        """There is no mount but the caller's own, so a stranger sees nothing
        of this tree — not a 403, just a path that is not there."""
        with self.assertRaises(NotFoundError):
            propfind_response(STRANGER, "/dav/PropDocs")
        with self.assertRaises(NotFoundError):
            propfind_response(OWNER, "/dav/PropDocs/no-such-file.bin")

    def test_propname_mode(self):
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.txt", "0", PROPNAME_BODY))
        prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
        etag = prop.find(dav("getetag"))
        self.assertIsNotNone(etag)
        self.assertIsNone(etag.text)

    def test_prop_mode_reports_missing_as_404(self):
        body = (
            b'<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>'
            b'<D:getetag/><z:custom xmlns:z="urn:z"/></D:prop></D:propfind>'
        )
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.txt", "0", body))
        propstats = parsed.findall(f"{dav('response')}/{dav('propstat')}")
        self.assertEqual(len(propstats), 2)
        self.assertIsNotNone(propstats[0].find(f"{dav('prop')}/{dav('getetag')}"))
        self.assertIn("404", propstats[1].find(dav("status")).text)
        self.assertIsNotNone(propstats[1].find(f"{dav('prop')}/{{urn:z}}custom"))

    def test_mount_quota_reports_personal_root_usage(self):
        """§7.9: both quota properties read the Personal Root, the only mount."""
        used = int(frappe.db.get_value("Drive Root", self.root, "used_bytes") or 0)
        self.assertGreater(used, 0)

        body = prop_body("quota-used-bytes", "quota-available-bytes")
        parsed = multistatus(propfind_response(OWNER, "/dav/", "0", body))
        prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
        self.assertEqual(prop.find(dav("quota-used-bytes")).text, str(used))
        self.assertEqual(prop.find(dav("quota-available-bytes")).text, str(QUOTA - used))

    def test_quota_is_reported_on_a_folder_from_its_root(self):
        used = int(frappe.db.get_value("Drive Root", self.root, "used_bytes") or 0)
        body = prop_body("quota-used-bytes", "quota-available-bytes")
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs", "0", body))
        prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
        self.assertEqual(prop.find(dav("quota-used-bytes")).text, str(used))

    def test_allprop_leaves_quota_out(self):
        # RFC 4331 §2: quota properties SHOULD NOT come back on allprop
        parsed = multistatus(propfind_response(OWNER, "/dav/", "0"))
        prop = parsed.find(f"{dav('response')}/{dav('propstat')}/{dav('prop')}")
        self.assertIsNone(prop.find(dav("quota-used-bytes")))
        self.assertIsNone(prop.find(dav("quota-available-bytes")))

    def test_a_file_has_no_quota_properties(self):
        body = prop_body("quota-used-bytes")
        parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs/report.txt", "0", body))
        propstats = parsed.findall(f"{dav('response')}/{dav('propstat')}")
        self.assertIn("404", propstats[-1].find(dav("status")).text)
        self.assertIsNotNone(propstats[-1].find(f"{dav('prop')}/{dav('quota-used-bytes')}"))

    def test_malformed_bodies_are_400(self):
        with self.assertRaises(BadRequest):
            propfind_response(OWNER, "/dav/", "0", b"<not-closed")
        with self.assertRaises(BadRequest):
            propfind_response(OWNER, "/dav/", "0", b"<wrong-root/>")

    def test_depth_one_query_budget_is_flat_in_child_count(self):
        """§12.5: three folder-page queries, one dead-property fetch, one lock
        fetch, one blob read. None of it scales with the number of children.

        The body is empty, so this is `allprop`: the widest request there is,
        and the one that pays for the page's validators.
        """
        small, large, created = self._budget_folders()
        try:
            small_queries = self._depth_one_queries("/dav/BudgetSmall")
            large_queries = self._depth_one_queries("/dav/BudgetLarge")
            self.assertEqual(
                small_queries,
                large_queries,
                "PROPFIND Depth:1 must stay O(1) in child count",
            )
            # path resolution (root lookup + one segment) plus the six above
            self.assertLessEqual(small_queries, 10)
        finally:
            drop_nodes(list(reversed(created)))

    def test_a_prop_body_without_getetag_costs_no_blob_read(self):
        """§12.5: the page's validators cost one `File Blob` read, and a client
        that never asked for `getetag` should not pay it."""
        _small, _large, created = self._budget_folders()
        try:
            # the batch is what reads `File Blob`; count it directly rather
            # than inferring it from the raw query total
            self.assertEqual(self._batch_calls(b""), 1, "allprop pays for the validators")
            self.assertEqual(self._batch_calls(prop_body("displayname", "getetag")), 1)
            self.assertEqual(self._batch_calls(PROPNAME_BODY), 1)
            self.assertEqual(
                self._batch_calls(prop_body("displayname", "getcontentlength")),
                0,
                "a prop body that does not name getetag must not read File Blob",
            )

            # and the saved read is a real query off the total
            allprop = self._depth_one_queries("/dav/BudgetSmall")
            without_etag = self._depth_one_queries(
                "/dav/BudgetSmall", body=prop_body("displayname", "getcontentlength")
            )
            self.assertLess(without_etag, allprop)
        finally:
            drop_nodes(list(reversed(created)))

    def test_a_blob_with_no_readable_checksum_is_listed_without_a_getetag(self):
        """A node naming a blob nobody can read has no validator, and no
        validator is the honest answer. It is still an ordinary listed file."""
        broken = file_node(OWNER, self.docs, "unreadable.bin", b"bytes with no checksum")
        frappe.db.set_value("File Blob", broken.blob, "checksum", None, update_modified=False)
        try:
            body = prop_body("displayname", "getetag")
            parsed = multistatus(propfind_response(OWNER, "/dav/PropDocs", "1", body))
            self.assertIn("/dav/PropDocs/unreadable.bin", hrefs(parsed))

            missing = self._propstat_for(parsed, "/dav/PropDocs/unreadable.bin", 404)
            self.assertIsNotNone(missing.find(f"{dav('prop')}/{dav('getetag')}"))
            found = self._propstat_for(parsed, "/dav/PropDocs/unreadable.bin", 200)
            self.assertIsNone(found.find(f"{dav('prop')}/{dav('getetag')}"))
            self.assertEqual(found.find(f"{dav('prop')}/{dav('displayname')}").text, "unreadable.bin")

            # a readable sibling on the same page still carries its validator,
            # so the batch keyed both rows rather than giving up on the page
            sibling = self._propstat_for(parsed, "/dav/PropDocs/report.txt", 200)
            self.assertEqual(
                sibling.find(f"{dav('prop')}/{dav('getetag')}").text, f'"{self.report.checksum}"'
            )
        finally:
            frappe.db.set_value("File Blob", broken.blob, "checksum", broken.checksum, update_modified=False)
            drop_nodes([broken.name])

    def _budget_folders(self) -> tuple[str, str, list[str]]:
        small = folder_node(OWNER, self.root, "BudgetSmall")
        large = folder_node(OWNER, self.root, "BudgetLarge")
        created = [small, large]
        for index in range(3):
            created.append(file_node(OWNER, small, f"small-{index}.txt", f"small {index}".encode()).name)
        for index in range(40):
            created.append(file_node(OWNER, large, f"large-{index}.txt", f"large {index}".encode()).name)
        return small, large, created

    def _batch_calls(self, body: bytes) -> int:
        ctx = make_ctx("PROPFIND", "/dav/BudgetSmall", OWNER, headers={"Depth": "1"}, data=body)
        with patch(
            "suite.drive.webdav.propfind.checksums_for",
            wraps=propfind.checksums_for,
        ) as batch:
            response = propfind.handle(ctx)
        self.assertEqual(response.status_code, 207)
        return batch.call_count

    def _depth_one_queries(self, path: str, body: bytes = b"") -> int:
        ctx = make_ctx("PROPFIND", path, OWNER, headers={"Depth": "1"}, data=body)
        with patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql:
            response = propfind.handle(ctx)
        self.assertEqual(response.status_code, 207)
        return sql.call_count

    @staticmethod
    def _propstat_for(parsed, href: str, status: int):
        for response in parsed.findall(dav("response")):
            if response.find(dav("href")).text != href:
                continue
            for propstat in response.findall(dav("propstat")):
                if f" {status} " in propstat.find(dav("status")).text:
                    return propstat
        raise AssertionError(f"no {status} propstat for {href}")
