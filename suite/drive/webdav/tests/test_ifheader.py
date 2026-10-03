import uuid

import frappe
from frappe.tests import UnitTestCase

from suite.drive.webdav.ifheader import EMPTY_IF, BadIfHeader, parse_if_header
from suite.drive.webdav.properties import compute_etag

TOKEN = "urn:uuid:11111111-2222-3333-4444-555555555555"

# The exact conditional litmus 0.13 formats for `complex_cond_put` and
# `fail_complex_cond_put`, read out of the shipped `litmus/libexec/locks`
# binary rather than guessed: one `ne_snprintf` format string with three
# arguments, `(token, etag, etag)`, into a 200-byte stack buffer.
LITMUS_COMPLEX = "(<%s> [%s]) (Not <DAV:no-lock> [%s])"
LITMUS_BUFFER = 200


def evaluate(header, entity="target", tokens=frozenset(), etag=None, href_map=None):
    parsed = parse_if_header(header)
    href_map = href_map or {}

    def resolve_href(href):
        if href is None:
            return entity
        return href_map.get(href)

    return parsed.evaluate(
        resolve_href,
        lambda name: etag if name == entity else None,
        lambda name: tokens if name == entity else frozenset(),
    )


class TestIfHeaderParsing(UnitTestCase):
    def test_empty_and_missing(self):
        self.assertIs(parse_if_header(None), EMPTY_IF)
        self.assertIs(parse_if_header("   "), EMPTY_IF)

    def test_no_tag_list_with_token(self):
        parsed = parse_if_header(f"(<{TOKEN}>)")
        self.assertEqual(parsed.all_tokens(), {TOKEN})
        group = parsed.tagged[0]
        self.assertIsNone(group.resource_href)
        self.assertFalse(group.lists[0].conditions[0].negated)

    def test_tagged_lists(self):
        header = f'<http://host/dav/a.txt> (<{TOKEN}>) </dav/b.txt> (["etag-b"])'
        parsed = parse_if_header(header)
        self.assertEqual(len(parsed.tagged), 2)
        self.assertEqual(parsed.tagged[0].resource_href, "http://host/dav/a.txt")
        self.assertEqual(parsed.tagged[1].resource_href, "/dav/b.txt")
        self.assertEqual(parsed.tagged[1].lists[0].conditions[0].etag, '"etag-b"')

    def test_not_and_multiple_conditions(self):
        parsed = parse_if_header(f'(Not <DAV:no-lock> ["tag"]) (<{TOKEN}>)')
        first = parsed.tagged[0].lists[0]
        self.assertTrue(first.conditions[0].negated)
        self.assertEqual(first.conditions[0].token, "DAV:no-lock")
        self.assertFalse(first.conditions[1].negated)
        # negated tokens still count as submitted
        self.assertEqual(parse_if_header("(Not <DAV:no-lock>)").all_tokens(), {"DAV:no-lock"})

    def test_corrupt_headers_raise(self):
        for bad in ("(", "()", "(<tok>", "Not <tok>", "((<tok>))", "garbage", "<href-only>"):
            with self.assertRaises(BadIfHeader, msg=bad):
                parse_if_header(bad)

    def test_a_resource_tag_with_no_state_list_is_refused(self):
        """`Tagged-list = Resource-Tag 1*List` (§10.4.2). A tag standing alone
        used to be dropped, and the lists around it were evaluated as if the
        client had never named a resource."""
        for bad in (
            f'(<{TOKEN}> ["v1"]) </dav/other.txt>',
            "</dav/a.txt> </dav/b.txt> (<tok>)",
            f"</dav/a.txt> (<{TOKEN}>) </dav/b.txt>",
        ):
            with self.assertRaises(BadIfHeader, msg=bad):
                parse_if_header(bad)

    def test_a_repeated_not_is_refused_rather_than_absorbed(self):
        """One `Not` per condition. A second used to be swallowed by the
        first, so `Not Not <tok>` evaluated as `Not <tok>`."""
        for bad in ("(Not Not <tok>)", '(Not Not ["v1"])', "(Not Not Not <tok>)"):
            with self.assertRaises(BadIfHeader, msg=bad):
                parse_if_header(bad)

    def test_a_dangling_not_closes_nothing(self):
        for bad in ('(<tok> ["v1"] Not)', "(Not)"):
            with self.assertRaises(BadIfHeader, msg=bad):
                parse_if_header(bad)

    def test_not_is_matched_case_insensitively(self):
        """The ABNF spells it `"Not"`, and RFC 5234 §2.3 makes a quoted string
        case-insensitive. A client sending `not` means the same thing."""
        parsed = parse_if_header("(not <DAV:no-lock>)")
        self.assertTrue(parsed.tagged[0].lists[0].conditions[0].negated)


class TestIfHeaderEvaluation(UnitTestCase):
    def test_token_match(self):
        self.assertTrue(evaluate(f"(<{TOKEN}>)", tokens=frozenset({TOKEN})))
        self.assertFalse(evaluate(f"(<{TOKEN}>)", tokens=frozenset()))

    def test_no_lock_tautology(self):
        self.assertTrue(evaluate("(Not <DAV:no-lock>)"))

    def test_etag_condition(self):
        self.assertTrue(evaluate('(["v1"])', etag='"v1"'))
        self.assertFalse(evaluate('(["v1"])', etag='"v2"'))

    def test_and_within_list(self):
        header = f'(<{TOKEN}> ["v1"])'
        self.assertTrue(evaluate(header, tokens=frozenset({TOKEN}), etag='"v1"'))
        self.assertFalse(evaluate(header, tokens=frozenset({TOKEN}), etag='"v2"'))
        self.assertFalse(evaluate(header, tokens=frozenset(), etag='"v1"'))

    def test_or_across_lists(self):
        header = f'(<{TOKEN}> ["wrong"]) (Not <DAV:no-lock>)'
        self.assertTrue(evaluate(header, tokens=frozenset({TOKEN}), etag='"right"'))

    def test_tagged_binding(self):
        header = f"</dav/other.txt> (<{TOKEN}>)"
        # token active on the request target but the condition binds to /dav/other.txt
        self.assertFalse(evaluate(header, tokens=frozenset({TOKEN}), href_map={"/dav/other.txt": "other"}))
        # unresolvable tagged href evaluates false rather than erroring
        self.assertFalse(evaluate(header, href_map={}))


class TestLitmusComplexConditional(UnitTestCase):
    """RFC 4918 §10.4's complex production, in the two shapes litmus sends.

    `complex_cond_put` submits the lock token and the resource's real ETag and
    expects the write to happen. `fail_complex_cond_put` submits the same token
    with the ETag corrupted in place and expects 412. The two differ only in
    the ETag, so an evaluator that reads `Not <DAV:no-lock>` as a whole-list
    tautology would perform both.
    """

    ETAG = '"a6fe3464be12cf20ce87aaff2f71211c37171ecc319929e935ce7c5a117abcde"'
    # `fail_complex_cond_put` corrupts the tag in place with
    # `pnt = etag + strlen(etag) - 3; PRECOND(pnt > etag); (*pnt)++`, so it
    # increments index 63 — the second hex digit from the end, inside the
    # quotes. Derived rather than written out, so it stays the byte litmus
    # really moves.
    STALE = ETAG[:-3] + chr(ord(ETAG[-3]) + 1) + ETAG[-2:]

    def header(self, token: str, etag: str) -> str:
        return LITMUS_COMPLEX % (token, etag, etag)

    def test_the_complex_grammar_parses_into_two_alternatives(self):
        parsed = parse_if_header(self.header(TOKEN, self.ETAG))
        self.assertEqual(len(parsed.tagged), 1)
        first, second = parsed.tagged[0].lists
        self.assertEqual(
            [(c.negated, c.token, c.etag) for c in first.conditions],
            [(False, TOKEN, None), (False, None, self.ETAG)],
        )
        self.assertEqual(
            [(c.negated, c.token, c.etag) for c in second.conditions],
            [(True, "DAV:no-lock", None), (False, None, self.ETAG)],
        )

    def test_complex_cond_put_holds_on_the_lock_and_the_etag(self):
        self.assertTrue(evaluate(self.header(TOKEN, self.ETAG), tokens=frozenset({TOKEN}), etag=self.ETAG))

    def test_fail_complex_cond_put_does_not_hold_on_a_corrupted_etag(self):
        """Both lists are false: the first on the ETag, the second because the
        entity-tag is ANDed with `Not <DAV:no-lock>` rather than replaced by
        it. This is the 412 half of the pair."""
        # one byte apart, at the index litmus increments, and still a quoted tag
        self.assertEqual(
            [i for i, (a, b) in enumerate(zip(self.ETAG, self.STALE, strict=False)) if a != b], [63]
        )
        self.assertEqual(len(self.STALE), len(self.ETAG))
        self.assertFalse(evaluate(self.header(TOKEN, self.STALE), tokens=frozenset({TOKEN}), etag=self.ETAG))

    def test_the_lock_token_is_submitted_by_either_shape(self):
        """§10.4's lenient submission rule: the token counts as submitted even
        in the shape that evaluates false, so the 412 is not also a 423.

        `DAV:no-lock` rides along by the same rule and satisfies nothing: it is
        never an active lock on any resource.
        """
        for etag in (self.ETAG, self.STALE):
            self.assertEqual(parse_if_header(self.header(TOKEN, etag)).all_tokens(), {TOKEN, "DAV:no-lock"})

    def test_litmus_truncates_the_header_a_sha256_etag_produces(self):
        """Why both litmus cases fail here and pass against a short-ETag server.

        litmus formats the conditional into `char buf[200]` with `ne_snprintf`,
        which keeps 199 characters. §12.4 publishes the blob's SHA-256 as the
        entity-tag, so the tag is 66 characters quoted and the header is 207:
        the second tag loses its closing bracket and the header is no longer
        RFC 4918 §10.4 grammar. Nothing on this side is wrong, and nothing on
        this side can make it right - the value litmus truncates is the one the
        byte path publishes. Ledgered in litmus_expected.txt.
        """
        header = self.header(TOKEN, self.ETAG)
        # the tag length is production's, not this file's: `compute_etag` on a
        # blobless row is the empty-bytes SHA-256, quoted, and every tag §12.4
        # publishes is that shape. Shorten it and the ledger line must go.
        self.assertEqual(len(compute_etag(frappe._dict())), 66)
        self.assertEqual(len(self.ETAG), 66)
        self.assertEqual(len(TOKEN), len(f"urn:uuid:{uuid.uuid4()}"))
        self.assertEqual(len(TOKEN), 45)
        self.assertEqual(len(header), 207)

        sent = header[: LITMUS_BUFFER - 1]
        self.assertEqual(len(sent), 199)
        self.assertTrue(sent.endswith(self.ETAG[:60]))
        with self.assertRaises(BadIfHeader):
            parse_if_header(sent)

    def test_no_prefix_of_the_header_can_permit_what_the_whole_one_refuses(self):
        """ "Refused, not guessed" at every cut, not only at litmus's.

        A cut inside a production is refused, which is litmus's case. A cut
        that lands exactly on a list boundary cannot be refused and must not
        be: it is indistinguishable from a client that sent fewer lists. It is
        safe for the same reason - the lists are ORed, so a prefix offers the
        gate fewer ways to hold, never more. The property worth pinning is
        that one: no prefix opens a write the whole header would refuse.

        This is what makes the truncated-header ledger line a client defect
        rather than a hole. Recovering the header, by contrast, would have to
        invent a list the client never finished sending.
        """
        header = self.header(TOKEN, self.ETAG)
        whole = parse_if_header(header)
        parsed_prefixes = 0

        for cut in range(1, len(header)):
            try:
                prefix = parse_if_header(header[:cut])
            except BadIfHeader:
                continue
            parsed_prefixes += 1
            # same untagged group, and a subset of its alternatives
            self.assertEqual([group.resource_href for group in prefix.tagged], [None])
            self.assertEqual(
                list(prefix.tagged[0].lists),
                list(whole.tagged[0].lists[: len(prefix.tagged[0].lists)]),
            )
            for tokens, etag in (
                (frozenset({TOKEN}), self.ETAG),
                (frozenset(), self.STALE),
                (frozenset(), None),
            ):
                if evaluate(header[:cut], tokens=tokens, etag=etag):
                    self.assertTrue(evaluate(header, tokens=tokens, etag=etag), header[:cut])

        # the boundary cuts really exist, or the loop above proves nothing:
        # the `)` that closes the first list, and the space after it
        self.assertEqual(parsed_prefixes, 2)

    def test_an_untruncated_header_is_accepted_at_any_length(self):
        """The refusal above is the client's truncation, not a length limit of
        our own: the same 207-byte header parses whole, and so does one an
        order of magnitude longer."""
        header = self.header(TOKEN, self.ETAG)
        self.assertEqual(len(parse_if_header(header).tagged[0].lists), 2)

        long_header = " ".join(f"</dav/{index}.txt> {header}" for index in range(30))
        self.assertGreater(len(long_header), 6000)
        self.assertEqual(len(parse_if_header(long_header).tagged), 30)
