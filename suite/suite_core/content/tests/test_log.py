import hashlib
import json
import struct

from frappe.tests import UnitTestCase

from suite.suite_core.content.log import Refusal, parse_push


def body(header: dict, payload: bytes = b"\x01") -> bytes:
    encoded = json.dumps(header).encode()
    return struct.pack(">I", len(encoded)) + encoded + payload


def header(**changes) -> dict:
    sha = hashlib.sha256(b"\x01").hexdigest()
    return {
        "lineage": "L",
        "sid": "s" * 32,
        "from": 1,
        "to": 1,
        "cid": 7,
        "seen_rev": 0,
        "schema": 1,
        "shas": [sha],
        **changes,
    }


class TestParsePush(UnitTestCase):
    def test_a_push_names_one_sha_per_seq(self):
        parsed, payload = parse_push(body(header()))

        self.assertEqual(parsed["shas"], [hashlib.sha256(b"\x01").digest()])
        self.assertEqual(payload, b"\x01")

    def test_malformed_pushes_are_refused_before_anything_is_read(self):
        sha = "ab" * 32
        for case in (
            header(shas=[]),
            header(to=2, shas=[sha]),
            header(shas=["not hex"]),
            header(shas=["ab"]),
            header(shas=[1]),
            header(shas=sha),
            header(**{"from": 0}),
            header(cid=True),
            header(schema=0),
            header(schema=True),
            header(schema="1"),
            {key: value for key, value in header().items() if key != "schema"},
        ):
            with self.subTest(case=case), self.assertRaises(Refusal) as refused:
                parse_push(body(case))
            self.assertEqual(
                (refused.exception.status, refused.exception.body), (400, {"collab": "malformed"})
            )
