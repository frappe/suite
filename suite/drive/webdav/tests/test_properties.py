"""Live properties and the ETag scheme, against `Drive Node` rows.

The strong validator is the `File Blob` checksum, quoted — the same value
`stream_blob` puts on a GET (§12.4). `getlastmodified` reports
`content_modified`, the content's own time, and falls back to the row time
only while nothing has written the content yet.
"""

from datetime import datetime
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.nodes import EMPTY_BLOB_CHECKSUM
from suite.drive.webdav.properties import (
    checksums_for,
    compute_etag,
    content_time,
    iso8601,
    live_properties,
    rfc1123,
)
from suite.drive.webdav.xmlutil import dav

CHECKSUM = "ab" * 32
OTHER_CHECKSUM = "cd" * 32


def row(**overrides):
    base = frappe._dict(
        name="node-abc123",
        title="report.pdf",
        kind="file",
        blob="blob-abc123",
        size=2048,
        mime="application/pdf",
        content_modified=datetime(2026, 8, 24, 10, 30, 0),
        modified=datetime(2026, 8, 20, 9, 0, 0, 123456),
        creation=datetime(2026, 8, 1, 9, 0, 0),
    )
    base.update(overrides)
    return base


class TestWebDAVProperties(IntegrationTestCase):
    def test_etag_is_the_quoted_blob_checksum(self):
        self.assertEqual(compute_etag(row(), CHECKSUM), f'"{CHECKSUM}"')

    def test_etag_reads_the_blob_when_the_caller_has_not(self):
        with patch(
            "suite.drive.webdav.properties.blob_checksums",
            return_value={"blob-abc123": CHECKSUM},
        ) as read:
            self.assertEqual(compute_etag(row()), f'"{CHECKSUM}"')
        read.assert_called_once_with(["blob-abc123"])

    def test_empty_head_etag_is_the_checksum_of_no_bytes(self):
        # §8.5: a file node with no blob is still a file, and validates like one
        with patch("suite.drive.webdav.properties.blob_checksums") as read:
            self.assertEqual(compute_etag(row(blob=None, size=0, mime=None)), f'"{EMPTY_BLOB_CHECKSUM}"')
        read.assert_not_called()

    def test_a_blob_with_no_readable_checksum_has_no_validator(self):
        """No validator is the honest answer. The empty-bytes one would tell a
        client that a file holding bytes is empty."""
        with patch("suite.drive.webdav.properties.blob_checksums", return_value={}):
            self.assertIsNone(compute_etag(row()))
        # and the same when the batch already looked and found nothing
        self.assertIsNone(compute_etag(row(), None))

    def test_a_passed_checksum_is_never_re_read(self):
        """`None` from a batched caller means "looked, and there was none" —
        the sentinel is what says nobody looked."""
        with patch("suite.drive.webdav.properties.blob_checksums") as read:
            self.assertEqual(compute_etag(row(), CHECKSUM), f'"{CHECKSUM}"')
            self.assertIsNone(compute_etag(row(), None))
        read.assert_not_called()

    def test_checksums_for_batches_one_read_per_listing(self):
        rows = [
            row(name="one", blob="blob-1"),
            row(name="two", blob="blob-2"),
            row(name="three", blob=None),
            row(name="four", blob="blob-1"),
            row(name="five", blob="blob-unreadable"),
        ]
        with patch(
            "suite.drive.webdav.properties.blob_checksums",
            return_value={"blob-1": CHECKSUM, "blob-2": OTHER_CHECKSUM},
        ) as read:
            found = checksums_for(rows)
        read.assert_called_once_with(["blob-1", "blob-2", "blob-1", "blob-unreadable"])
        # every row holding a blob is keyed, None included: the key is the
        # render loop's proof that the batch already looked
        self.assertEqual(
            found,
            {"one": CHECKSUM, "two": OTHER_CHECKSUM, "four": CHECKSUM, "five": None},
        )
        self.assertNotIn("three", found)

    def test_content_time_prefers_content_modified(self):
        self.assertEqual(content_time(row()), datetime(2026, 8, 24, 10, 30, 0))
        # null until something writes the content; the row time is all there is
        self.assertEqual(content_time(row(content_modified=None)), datetime(2026, 8, 20, 9, 0, 0, 123456))

    def test_date_formats(self):
        stamp = rfc1123(datetime(2026, 8, 24, 10, 30, 0))
        self.assertTrue(stamp.endswith(" GMT"))
        self.assertIn("2026", stamp)
        self.assertRegex(iso8601(datetime(2026, 8, 24, 10, 30, 0)), r"^2026-08-2\dT\d\d:\d\d:\d\dZ$")

    def test_file_properties(self):
        props = live_properties(row(), is_collection=False, display_name="report.pdf", checksum=CHECKSUM)
        self.assertEqual(props[dav("displayname")].text, "report.pdf")
        self.assertEqual(props[dav("getcontentlength")].text, "2048")
        self.assertEqual(props[dav("getcontenttype")].text, "application/pdf")
        self.assertEqual(props[dav("getetag")].text, f'"{CHECKSUM}"')
        self.assertEqual(props[dav("getlastmodified")].text, rfc1123(datetime(2026, 8, 24, 10, 30, 0)))
        self.assertEqual(len(props[dav("resourcetype")]), 0)
        self.assertIsNone(props[dav("quota-used-bytes")])

    def test_a_file_with_no_readable_checksum_publishes_no_getetag(self):
        props = live_properties(row(), is_collection=False, display_name="report.pdf", checksum=None)
        self.assertIsNone(props[dav("getetag")])
        # the rest of the resource is unaffected: it is still a listed file
        self.assertEqual(props[dav("getcontentlength")].text, "2048")
        self.assertEqual(props[dav("displayname")].text, "report.pdf")

    def test_an_empty_head_still_publishes_a_getetag(self):
        props = live_properties(
            row(blob=None, size=0, mime=None), is_collection=False, display_name="empty.txt", checksum=None
        )
        self.assertEqual(props[dav("getetag")].text, f'"{EMPTY_BLOB_CHECKSUM}"')

    def test_a_typeless_file_still_gets_a_content_type(self):
        props = live_properties(
            row(mime=None, size=0), is_collection=False, display_name="x", checksum=CHECKSUM
        )
        self.assertEqual(props[dav("getcontenttype")].text, "application/octet-stream")
        self.assertEqual(props[dav("getcontentlength")].text, "0")

    def test_collection_properties(self):
        props = live_properties(
            row(kind="folder", blob=None, size=0, mime=None),
            is_collection=True,
            display_name="Docs",
            quota=(500, 1000),
        )
        # a folder carries a rolled-up size Drive-side; neither is defined here
        self.assertIsNone(props[dav("getcontentlength")])
        self.assertIsNone(props[dav("getetag")])
        self.assertIsNone(props[dav("getcontenttype")])
        self.assertEqual(len(props[dav("resourcetype")]), 1)
        self.assertEqual(props[dav("resourcetype")][0].tag, dav("collection"))
        self.assertEqual(props[dav("quota-used-bytes")].text, "500")
        self.assertEqual(props[dav("quota-available-bytes")].text, "500")

    def test_unlimited_quota_omits_available(self):
        """RFC 4331 §4: an unlimited root leaves the property out, never guesses."""
        props = live_properties(row(kind="folder"), is_collection=True, display_name="Docs", quota=(500, 0))
        self.assertEqual(props[dav("quota-used-bytes")].text, "500")
        self.assertIsNone(props[dav("quota-available-bytes")])

    def test_an_overfull_root_reports_zero_available(self):
        props = live_properties(row(kind="folder"), is_collection=True, display_name="Docs", quota=(900, 500))
        self.assertEqual(props[dav("quota-available-bytes")].text, "0")

    def test_a_collection_without_quota_omits_both(self):
        props = live_properties(row(kind="folder"), is_collection=True, display_name="Docs")
        self.assertIsNone(props[dav("quota-used-bytes")])
        self.assertIsNone(props[dav("quota-available-bytes")])
