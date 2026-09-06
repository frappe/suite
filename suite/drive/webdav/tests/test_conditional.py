"""RFC 7232 preconditions against the DAV ETag scheme.

Site-free: the rows are `Drive Node` shapes as `frappe._dict`, the requests are
real werkzeug ones, and the two things the module would otherwise read from the
site — the blob checksum and the site timezone — are supplied here. Fixing the
zone is not only what makes the run site-free: without it an
`If-Unmodified-Since` assertion silently depends on whatever timezone the site
happens to carry.
"""

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
from frappe.tests import UnitTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.drive._core.nodes import EMPTY_BLOB_CHECKSUM
from suite.drive.webdav.conditional import evaluate_preconditions, is_not_modified
from suite.drive.webdav.errors import PreconditionFailed
from suite.drive.webdav.properties import compute_etag, rfc1123

CHECKSUM = "ab" * 32
MODIFIED = datetime(2026, 8, 20, 12, 0, 0)


def request_with(method: str = "PUT", **headers) -> Request:
    return Request(EnvironBuilder(method=method, path="/dav/x", headers=headers).get_environ())


def row(**overrides) -> frappe._dict:
    """An ordinary file node with no blob — §8.5's empty head.

    Its validator is the checksum of zero bytes, which keeps every case here
    off the `File Blob` table without weakening what is being asserted: the
    comparison rules do not care which checksum it is.
    """
    base = frappe._dict(
        name="cond123",
        kind="file",
        blob=None,
        size=0,
        mime=None,
        content_modified=MODIFIED,
        modified=datetime(2026, 1, 1, 0, 0, 0),
    )
    base.update(overrides)
    return base


class TestPreconditions(UnitTestCase):
    def setUp(self):
        super().setUp()
        zone = patch("suite.drive.webdav.properties._site_zone", return_value=ZoneInfo("UTC"))
        zone.start()
        self.addCleanup(zone.stop)

    def test_etag_is_the_node_validator(self):
        self.assertEqual(compute_etag(row()), f'"{EMPTY_BLOB_CHECKSUM}"')
        with patch(
            "suite.drive.webdav.properties.blob_checksums",
            return_value={"blob-1": CHECKSUM},
        ):
            self.assertEqual(compute_etag(row(blob="blob-1", size=4, mime="text/plain")), f'"{CHECKSUM}"')

    def test_no_headers_passes(self):
        evaluate_preconditions(request_with(), row())
        evaluate_preconditions(request_with(), None)

    def test_if_match(self):
        etag = compute_etag(row())
        evaluate_preconditions(request_with(**{"If-Match": etag}), row())
        evaluate_preconditions(request_with(**{"If-Match": f'"other", {etag}'}), row())
        evaluate_preconditions(request_with(**{"If-Match": "*"}), row())

        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-Match": '"nope"'}), row())
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-Match": "*"}), None)
        # weak validators never satisfy If-Match (RFC 7232 §2.3.2)
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-Match": f"W/{etag}"}), row())

    def test_if_none_match(self):
        etag = compute_etag(row())
        evaluate_preconditions(request_with(**{"If-None-Match": '"other"'}), row())
        evaluate_preconditions(request_with(**{"If-None-Match": "*"}), None)

        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-None-Match": "*"}), row())
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-None-Match": etag}), row())
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-None-Match": f"W/{etag}"}), row())

    def test_if_unmodified_since_reads_content_modified(self):
        current = rfc1123(MODIFIED)
        evaluate_preconditions(request_with(**{"If-Unmodified-Since": current}), row())

        stale = rfc1123(datetime(2020, 1, 1))
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(request_with(**{"If-Unmodified-Since": stale}), row())

        # garbage dates are ignored per RFC
        evaluate_preconditions(request_with(**{"If-Unmodified-Since": "not-a-date"}), row())

    def test_the_row_time_is_only_a_fallback(self):
        """§8.11: `content_modified` is the content's own time. The row time
        answers only while nothing has written the content yet."""
        untouched = row(content_modified=None, modified=MODIFIED)
        evaluate_preconditions(request_with(**{"If-Unmodified-Since": rfc1123(MODIFIED)}), untouched)
        with self.assertRaises(PreconditionFailed):
            evaluate_preconditions(
                request_with(**{"If-Unmodified-Since": rfc1123(datetime(2020, 1, 1))}), untouched
            )

    def test_is_not_modified(self):
        etag = compute_etag(row())
        self.assertTrue(is_not_modified(request_with("GET", **{"If-None-Match": etag}), row()))
        self.assertTrue(is_not_modified(request_with("GET", **{"If-None-Match": "*"}), row()))
        self.assertFalse(is_not_modified(request_with("GET", **{"If-None-Match": '"other"'}), row()))

        self.assertTrue(
            is_not_modified(request_with("GET", **{"If-Modified-Since": rfc1123(MODIFIED)}), row())
        )
        self.assertFalse(
            is_not_modified(
                request_with("GET", **{"If-Modified-Since": rfc1123(datetime(2020, 1, 1))}), row()
            )
        )
        self.assertFalse(is_not_modified(request_with("GET"), row()))
