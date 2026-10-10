import hashlib
import json
import struct

from frappe.tests import UnitTestCase

from suite.suite_core.content.log import Refusal, parse_push


def push_body(push_header: dict, payload: bytes = b"\x01") -> bytes:
    encoded = json.dumps(push_header).encode()
    return struct.pack(">I", len(encoded)) + encoded + payload


def push_header(**changes) -> dict:
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
        pushed = push_body(push_header())
        parsed, payload = parse_push(pushed)

        expected_sha = hashlib.sha256(b"\x01").digest()
        self.assertEqual(parsed["shas"], [expected_sha])
        self.assertEqual(payload, b"\x01")

    def test_malformed_pushes_are_refused_before_anything_is_read(self):
        sha = "ab" * 32
        for case in (
            push_header(shas=[]),
            push_header(to=2, shas=[sha]),
            push_header(shas=["not hex"]),
            push_header(shas=["ab"]),
            push_header(shas=[1]),
            push_header(shas=sha),
            push_header(**{"from": 0}),
            push_header(cid=True),
            push_header(schema=0),
            push_header(schema=True),
            push_header(schema="1"),
            {key: value for key, value in push_header().items() if key != "schema"},
        ):
            with self.subTest(case=case), self.assertRaises(Refusal) as refused:
                parse_push(push_body(case))

            self.assertEqual(
                (refused.exception.status, refused.exception.body), (400, {"collab": "malformed"})
            )
