"""Site-free contracts for Writer's version envelope and body readers."""

from __future__ import annotations

import io
import json
import unittest
from unittest import mock

import frappe

from suite.writer import drive as writer


class WriterVersionPayloads(unittest.TestCase):
    def _errors(self):
        translate = mock.patch.object(writer, "_", side_effect=lambda message: message)
        throw = mock.patch.object(
            writer.frappe,
            "throw",
            side_effect=lambda message, exc=Exception: (_ for _ in ()).throw(exc(message)),
        )
        translate.start()
        throw.start()
        self.addCleanup(translate.stop)
        self.addCleanup(throw.stop)

    def test_native_and_old_envelopes_preserve_or_default_collaboration(self):
        native = {"schema": writer.VERSION_SCHEMA, "content": "body", "html": "<p>x</p>", "collab": 0}
        old = {"schema": writer.VERSION_SCHEMA, "content": "body", "html": "<p>x</p>"}
        self.assertEqual(writer._version_payload(json.dumps(native).encode())["collab"], 0)
        self.assertEqual(writer._version_payload(json.dumps(old).encode())["collab"], 1)

    def test_exact_utf8_legacy_html_becomes_non_collaborative(self):
        html = "<p>legacy π</p>"
        self.assertEqual(
            writer._version_payload(html.encode()),
            {"content": writer.EMPTY_BODY, "html": html, "collab": 0},
        )

    def test_unknown_schema_and_invalid_utf8_are_refused(self):
        self._errors()
        for raw in (b'{"schema":"writer-document/2"}', b"\xff"):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    def test_invalid_utf8_refuses_without_leaning_on_throw_raising(self):
        # `text` is unbound on the decode arm, so the rest of the function must
        # be unreachable from it on its own. With `frappe.throw` stubbed out,
        # the old arm fell through and raised `UnboundLocalError` on the next
        # line.
        with (
            mock.patch.object(writer, "_", side_effect=lambda message: message),
            mock.patch.object(writer.frappe, "throw"),
            self.assertRaises(frappe.ValidationError),
        ):
            writer._version_payload(b"\xff")

    def test_a_json_object_is_an_envelope_and_owes_a_schema(self):
        # The fork is the shape, not a key spelling. A truncated envelope, or
        # one whose key is misspelled, must not restore its own source text as
        # the document body.
        self._errors()
        for raw in (
            b"{}",
            b'{"shema": "writer-document/1", "content": "a", "html": ""}',
            b'{"content": "a", "html": "<p>x</p>"}',
        ):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                writer._version_payload(raw)

    def test_json_that_is_not_an_object_is_still_read_as_legacy_html(self):
        # HTML never parses as a JSON object, but a snapshot may be any text.
        for raw in (b"[]", b"null", b"123", b"", b"<p>x</p>"):
            with self.subTest(raw=raw):
                self.assertEqual(
                    writer._version_payload(raw),
                    {"content": writer.EMPTY_BODY, "html": raw.decode(), "collab": 0},
                )

    def test_a_version_larger_than_the_bound_is_refused_before_it_is_held(self):
        self._errors()
        oversized = io.BytesIO(b"x" * (writer.MAX_VERSION_BYTES + 1))
        with mock.patch.object(writer.frappe.db, "set_value") as write:
            with self.assertRaises(frappe.ValidationError):
                writer.restore_version("WR-1", oversized)
        write.assert_not_called()

    def test_version_capture_includes_collaboration_mode(self):
        # The columns are half the contract. Drop `collab` from the read and
        # `row.collab` is None in production, so every native envelope records
        # `collab: 0` and every restore turns collaboration off.
        row = frappe._dict(content="body", html="<p>x</p>", collab=0)
        with mock.patch.object(writer.frappe.db, "get_value", return_value=row) as read:
            stream, mime = writer.version_bytes("WR-1")
        self.assertEqual(read.call_args.args, (writer.DOCTYPE, "WR-1", ("node", "content", "html", "collab")))
        self.assertEqual(mime, writer.VERSION_MIME)
        self.assertEqual(json.loads(stream.read())["collab"], 0)

    def test_restore_is_one_write_and_invalid_bytes_write_nothing(self):
        self._errors()
        with mock.patch.object(writer.frappe.db, "set_value") as write:
            writer.restore_version("WR-1", io.BytesIO(b"<p>legacy</p>"))
            write.assert_called_once_with(
                writer.DOCTYPE,
                "WR-1",
                {"content": writer.EMPTY_BODY, "html": "<p>legacy</p>", "collab": 0},
            )
            write.reset_mock()
            with self.assertRaises(frappe.ValidationError):
                writer.restore_version("WR-1", io.BytesIO(b"\xff"))
            write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
