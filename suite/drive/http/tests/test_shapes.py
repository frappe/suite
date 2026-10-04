"""The published node shape, and the coercion that stands in for annotations."""

import unittest
from datetime import UTC, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.people import person
from suite.drive.http import shapes
from suite.drive.http.tests import ensure_local_context

# The fixtures below are stored site-naive. Published, they are UTC `Z`
# strings, so the site's zone decides the answer: pin one that is not UTC so a
# format-only `strftime` cannot pass.
SITE_ZONE = patch("suite.drive._core.times.site_zone", return_value=ZoneInfo("Asia/Kolkata"))


def fake_people(ids):
    """The `User` table, without the table: every id is a person named by it."""
    return {user: person(user, None, None) for user in ids if user}


# A shape names the people a row refers to. The lookup is the one query these
# tests do not make.
PEOPLE = patch("suite.drive.http.shapes.people", side_effect=fake_people)

ADA = person("a@example.com", "Ada Lovelace", "/files/ada.png")


def setUpModule():
    ensure_local_context()
    SITE_ZONE.start()
    PEOPLE.start()


def tearDownModule():
    PEOPLE.stop()
    SITE_ZONE.stop()


STORED = frappe._dict(
    {
        "name": "n1",
        "title": "Report",
        "kind": "file",
        "parent_node": "f1",
        "path": "r1/f1/n1",
        "root": "r1",
        "state": "Active",
        "size": 1234,
        "mime": "application/pdf",
        "url": None,
        "content_doctype": None,
        "content_docname": None,
        "is_template": 0,
        "owner": "a@example.com",
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "modified": datetime(2026, 1, 2, 3, 4, 6),
        "content_modified": datetime(2026, 1, 2, 3, 4, 7),
        "trash_root": None,
        "trashed_at": None,
        "blob": "blob-secret",
        "modified_by": "b@example.com",
    }
)


VERSION = frappe._dict(
    {
        "name": "v1",
        "node": "n1",
        "seq": 3,
        "kind": "named",
        "label": "Before the rewrite",
        "pinned": 1,
        "actor": "a@example.com",
        "size": 4096,
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "blob": "blob-secret",
    }
)

ACTIVITY = frappe._dict(
    {
        "name": "act1",
        "node": "n1",
        "action": "share_add",
        "actor": "a@example.com",
        "at": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "via_link": "$LINK:tok",
        "client": "davfs2/1.6",
        "detail": {"principal": "b@example.com", "new_role": 20},
    }
)

GRANT = frappe._dict(
    {
        "name": "g1",
        "node": "n1",
        "principal": "b@example.com",
        "role": 20,
        "expires_on": datetime(2026, 3, 1, 9, 8, 7, 654321),
        "has_password": 1,
        "password_hash": "$2b$12$hash",
        "url": None,
    }
)

COMMENT = frappe._dict(
    {
        "name": "c1",
        "thread": "t1",
        "node": "n1",
        "content": "Fix the total",
        "author": "Guest",
        "author_name": "Priya",
        "mentions": ["a@example.com"],
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "modified": datetime(2026, 1, 2, 3, 4, 6),
    }
)

THREAD = frappe._dict(
    {
        "name": "t1",
        "node": "n1",
        "anchor": "block-7",
        "resolved": 1,
        "resolved_by": "a@example.com",
        "resolved_at": datetime(2026, 1, 3, 4, 5, 6),
        "creation": datetime(2026, 1, 2, 3, 4, 5, 678901),
        "comments": [COMMENT],
    }
)


class TestNodeShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_fields(self):
        self.assertEqual(
            sorted(shapes.node_shape(STORED)),
            sorted(
                [
                    "name",
                    "title",
                    "kind",
                    "parent_node",
                    "root",
                    "state",
                    "trash_root",
                    "size",
                    "mime",
                    "url",
                    "content_doctype",
                    "content_docname",
                    "is_template",
                    "owner",
                    "creation",
                    "modified",
                    "content_modified",
                ]
            ),
        )

    def test_the_shape_withholds_tree_bookkeeping_and_storage_ids(self):
        answer = shapes.node_shape(STORED)
        for withheld in ("path", "trashed_at", "blob", "modified_by"):
            self.assertNotIn(withheld, answer)

    def test_a_root_node_reports_its_own_id_as_its_root(self):
        root_row = frappe._dict(
            {**STORED, "name": "r1", "kind": "root", "parent_node": None, "root": None, "path": ""}
        )
        self.assertEqual(shapes.node_shape(root_row)["root"], "r1")
        self.assertEqual(shapes.node_shape(STORED)["root"], "r1")

    def test_times_are_published_in_utc_to_the_second(self):
        # §11.3: stored site-naive (here IST, +05:30), published RFC 3339 `Z`.
        answer = shapes.node_shape(STORED)
        self.assertEqual(answer["creation"], "2026-01-01T21:34:05Z")
        self.assertEqual(answer["modified"], "2026-01-01T21:34:06Z")
        self.assertEqual(answer["content_modified"], "2026-01-01T21:34:07Z")

    def test_an_absent_time_is_null_not_an_empty_string(self):
        self.assertIsNone(shapes.stamp(None))
        self.assertIsNone(shapes.stamp(""))

    def test_a_missing_size_reads_as_zero(self):
        answer = shapes.node_shape(frappe._dict({**STORED, "size": None}))
        self.assertEqual(answer["size"], 0)

    def test_a_list_row_and_a_detail_row_are_the_same_shape(self):
        # One serialiser answers both, so this is the guarantee, not a sample.
        detail = shapes.node_shape(STORED)
        listed = shapes.node_shapes([STORED])[0]
        self.assertEqual(detail, listed)

    def test_the_owner_is_published_as_a_person_not_an_id(self):
        answer = shapes.node_shape(STORED, {"a@example.com": ADA})
        self.assertEqual(
            answer["owner"],
            {"id": "a@example.com", "full_name": "Ada Lovelace", "user_image": "/files/ada.png"},
        )

    def test_a_single_row_looks_its_own_owner_up(self):
        with patch.object(shapes, "people", side_effect=fake_people) as lookup:
            answer = shapes.node_shape(STORED)
        self.assertEqual(answer["owner"], person("a@example.com", None, None))
        self.assertEqual(lookup.call_count, 1)

    def test_a_page_looks_every_owner_up_once(self):
        rows = [
            frappe._dict({**STORED, "name": name, "owner": owner})
            for name, owner in (("n1", "a@example.com"), ("n2", "b@example.com"), ("n3", "a@example.com"))
        ]
        with patch.object(shapes, "people", side_effect=fake_people) as lookup:
            answers = shapes.node_shapes(rows)
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(set(lookup.call_args.args[0]), {"a@example.com", "b@example.com"})
        self.assertEqual(
            [answer["owner"]["id"] for answer in answers], ["a@example.com", "b@example.com", "a@example.com"]
        )


class TestVersionShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_fields(self):
        self.assertEqual(
            sorted(shapes.version_shape(VERSION)),
            sorted(["name", "node", "seq", "kind", "label", "pinned", "actor", "size", "creation"]),
        )

    def test_the_shape_withholds_the_storage_id(self):
        # The bytes are reached through the version content route, never by name.
        self.assertNotIn("blob", shapes.version_shape(VERSION))

    def test_a_missing_sequence_or_size_reads_as_zero(self):
        answer = shapes.version_shape(frappe._dict({**VERSION, "seq": None, "size": None}))
        self.assertEqual(answer["seq"], 0)
        self.assertEqual(answer["size"], 0)

    def test_times_are_published_to_the_second(self):
        self.assertEqual(shapes.version_shape(VERSION)["creation"], "2026-01-01T21:34:05Z")


class TestActivityShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_columns(self):
        self.assertEqual(
            sorted(shapes.activity_shape(ACTIVITY)),
            sorted(["name", "node", "action", "actor", "at", "via_link", "client", "detail"]),
        )

    def test_a_missing_detail_is_an_empty_mapping_not_null(self):
        answer = shapes.activity_shape(frappe._dict({**ACTIVITY, "detail": None}))
        self.assertEqual(answer["detail"], {})

    def test_times_are_published_to_the_second(self):
        self.assertEqual(shapes.activity_shape(ACTIVITY)["at"], "2026-01-01T21:34:05Z")

    def test_the_link_that_decided_a_row_is_named_without_its_token(self):
        # §11.2 answers this history to READ and hears a Guest, while the token
        # is a bearer secret that reaches EDIT (§6.1).
        self.assertEqual(shapes.activity_shape(ACTIVITY)["via_link"], "$LINK")

    def test_no_share_row_detail_carries_a_token(self):
        for key in ("principal", "old_principal", "new_principal"):
            with self.subTest(key=key):
                row = frappe._dict({**ACTIVITY, "detail": {key: "$LINK:" + "a" * 22, "new_role": 30}})
                answer = shapes.activity_shape(row)
                self.assertEqual(answer["detail"][key], "$LINK")
                self.assertEqual(answer["detail"]["new_role"], 30)

    def test_masking_leaves_every_other_principal_spelling_alone(self):
        for principal in ("b@example.com", "$PUBLIC", "$GENERAL", "$GROUP:sales", None):
            with self.subTest(principal=principal):
                self.assertEqual(shapes.mask_link(principal), principal)

    def test_the_stored_row_is_never_mutated_by_masking(self):
        detail = {"principal": "$LINK:" + "a" * 22}
        row = frappe._dict({**ACTIVITY, "detail": detail})
        shapes.activity_shape(row)
        self.assertEqual(detail["principal"], "$LINK:" + "a" * 22)


class TestNotificationShape(UnitTestCase):
    def test_the_shape_withholds_the_recipient(self):
        # The route is scoped to the caller, so `to_user` can only be the caller.
        row = frappe._dict({"name": "no1", "to_user": "a@example.com", "activity": ACTIVITY})
        self.assertNotIn("to_user", shapes.notification_shape(row))

    def test_the_activity_is_nested_through_the_activity_shape(self):
        row = frappe._dict(
            {"name": "no1", "read": 0, "creation": datetime(2026, 1, 2, 3, 4, 5), "activity": ACTIVITY}
        )
        answer = shapes.notification_shape(row)
        self.assertEqual(answer["activity"], shapes.activity_shape(ACTIVITY))
        self.assertEqual(answer["creation"], "2026-01-01T21:34:05Z")

    def test_a_missing_activity_still_yields_a_mapping(self):
        answer = shapes.notification_shape(frappe._dict({"name": "no1", "activity": None}))
        self.assertIsInstance(answer["activity"], dict)
        self.assertIsNone(answer["activity"]["node"])


class TestGrantShape(UnitTestCase):
    def test_the_shape_never_publishes_the_password_hash(self):
        self.assertNotIn("password_hash", shapes.grant_shape(GRANT))

    def test_has_password_is_published_as_a_bool(self):
        self.assertIs(shapes.grant_shape(GRANT)["has_password"], True)
        cleared = shapes.grant_shape(frappe._dict({**GRANT, "has_password": 0}))
        self.assertIs(cleared["has_password"], False)

    def test_a_url_appears_only_when_the_row_carries_one(self):
        self.assertNotIn("url", shapes.grant_shape(GRANT))
        linked = shapes.grant_shape(frappe._dict({**GRANT, "url": "/l/tok"}))
        self.assertEqual(linked["url"], "/l/tok")

    def test_a_user_principal_carries_its_person_and_a_special_one_does_not(self):
        answer = shapes.grant_shape(GRANT)
        self.assertEqual(answer["person"], person("b@example.com", None, None))
        for special in ("$PUBLIC", "$GENERAL", "$GROUP:readers", "$LINK:tok"):
            with self.subTest(principal=special):
                self.assertNotIn("person", shapes.grant_shape(frappe._dict({**GRANT, "principal": special})))

    def test_a_listing_names_its_people_in_one_lookup(self):
        # The owner, each local user grant, and each inherited user grant the
        # caller may see. A redacted ancestor link names nobody.
        answer = {
            "grants": [GRANT, frappe._dict({**GRANT, "name": "g2", "principal": "$GROUP:readers"})],
            "owner": "o@example.com",
            "inherited": [
                {
                    "grant": frappe._dict({**GRANT, "name": "g3", "principal": "c@example.com"}),
                    "redacted": False,
                    "source_node": "f1",
                    "source_title": "Folder",
                },
                {
                    "grant": frappe._dict({**GRANT, "name": "g4", "principal": "$LINK:tok"}),
                    "redacted": True,
                    "source_node": "r1",
                    "source_title": "Root",
                },
            ],
        }
        with patch.object(shapes, "people", side_effect=fake_people) as lookup:
            shaped = shapes.grants_shape(answer)
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(set(lookup.call_args.args[0]), {"o@example.com", "b@example.com", "c@example.com"})
        self.assertEqual(shaped["owner"], person("o@example.com", None, None))
        self.assertEqual(shaped["grants"][0]["person"]["id"], "b@example.com")
        self.assertNotIn("person", shaped["grants"][1])
        self.assertEqual(shaped["inherited"][0]["grant"]["person"]["id"], "c@example.com")
        self.assertNotIn("person", shaped["inherited"][1]["grant"])
        self.assertNotIn("explain", shaped)

    def test_a_shared_root_node_has_no_owner(self):
        self.assertIsNone(shapes.grants_shape({"grants": [], "owner": None})["owner"])

    def test_the_expiry_is_published_to_the_second(self):
        self.assertEqual(shapes.grant_shape(GRANT)["expires_on"], "2026-03-01T03:38:07Z")
        never = shapes.grant_shape(frappe._dict({**GRANT, "expires_on": None}))
        self.assertIsNone(never["expires_on"])


EXPLANATION = frappe._dict(
    {
        "role": 20,
        "source": "grant",
        "rows": [
            frappe._dict(
                {
                    "node": "f1",
                    "depth": 1,
                    "principal": "b@example.com",
                    "role": 20,
                    "expires_on": datetime(2026, 3, 1, 9, 8, 7),
                    "pass": 1,
                    "held": 1,
                    "winner": 1,
                }
            ),
            frappe._dict(
                {
                    "node": "r1",
                    "depth": 0,
                    "principal": "team@example.com",
                    "role": 10,
                    "expires_on": None,
                    "pass": 2,
                    "held": 0,
                    "winner": 0,
                }
            ),
        ],
    }
)


class TestExplainShape(UnitTestCase):
    def test_the_shape_publishes_exactly_the_declared_keys(self):
        self.assertEqual(sorted(shapes.explain_shape(EXPLANATION)), ["role", "rows", "source"])

    def test_every_row_carries_its_node_principal_and_verdict(self):
        for row in shapes.explain_shape(EXPLANATION)["rows"]:
            self.assertEqual(
                sorted(row),
                sorted(["node", "depth", "principal", "role", "expires_on", "pass", "held", "winner"]),
            )
        first = shapes.explain_shape(EXPLANATION)["rows"][0]
        self.assertEqual(first["node"], "f1")
        self.assertEqual(first["principal"], "b@example.com")
        self.assertEqual(first["expires_on"], "2026-03-01T03:38:07Z")

    def test_an_empty_explanation_survives(self):
        admin = frappe._dict({"role": 40, "source": "site admin", "rows": []})
        self.assertEqual(shapes.explain_shape(admin)["rows"], [])
        self.assertEqual(shapes.explain_shape(frappe._dict({}))["rows"], [])

    def test_held_and_winner_are_published_as_bools(self):
        rows = shapes.explain_shape(EXPLANATION)["rows"]
        self.assertIs(rows[0]["held"], True)
        self.assertIs(rows[0]["winner"], True)
        self.assertIs(rows[1]["held"], False)
        self.assertIs(rows[1]["winner"], False)


class TestThreadShape(UnitTestCase):
    def test_resolved_is_published_as_a_bool(self):
        self.assertIs(shapes.thread_shape(THREAD)["resolved"], True)
        open_thread = shapes.thread_shape(frappe._dict({**THREAD, "resolved": 0}))
        self.assertIs(open_thread["resolved"], False)

    def test_a_thread_with_no_comments_publishes_an_empty_list(self):
        answer = shapes.thread_shape(frappe._dict({**THREAD, "comments": None}))
        self.assertEqual(answer["comments"], [])

    def test_the_comments_are_nested_through_the_comment_shape(self):
        self.assertEqual(shapes.thread_shape(THREAD)["comments"], [shapes.comment_shape(COMMENT)])

    def test_a_signed_in_author_is_published_as_a_person_and_a_guest_is_not(self):
        signed = frappe._dict({**COMMENT, "name": "c2", "author": "a@example.com", "author_name": None})
        with patch.object(shapes, "people", return_value={"a@example.com": ADA}) as lookup:
            listed = shapes.thread_shapes(
                [THREAD, frappe._dict({**THREAD, "name": "t2", "comments": [signed, COMMENT]})]
            )
        # One lookup for the whole listing, naming only the signed-in authors.
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(set(lookup.call_args.args[0]), {"a@example.com"})
        guest, (person, guest_again) = listed[0]["comments"][0], listed[1]["comments"]
        self.assertEqual(person["person"], ADA)
        self.assertNotIn("person", guest)
        self.assertNotIn("person", guest_again)
        self.assertEqual(guest["author_name"], "Priya")

    def test_mentions_are_always_a_list(self):
        self.assertEqual(shapes.comment_shape(COMMENT)["mentions"], ["a@example.com"])
        none = shapes.comment_shape(frappe._dict({**COMMENT, "mentions": None}))
        self.assertEqual(none["mentions"], [])
        tupled = shapes.comment_shape(frappe._dict({**COMMENT, "mentions": ("a@example.com",)}))
        self.assertEqual(tupled["mentions"], ["a@example.com"])


class TestCoercion(UnitTestCase):
    def refused(self, call, *args, **kwargs):
        with self.assertRaises(frappe.ValidationError):
            call(*args, **kwargs)

    def test_text_accepts_absent_and_string_only(self):
        self.assertIsNone(shapes.text(None, "x"))
        self.assertEqual(shapes.text("a", "x"), "a")
        for bad in (1, True, [], {}, 1.5):
            self.refused(shapes.text, bad, "x")

    def test_required_text_refuses_blank(self):
        self.assertEqual(shapes.required_text(" a ", "x"), " a ")
        for bad in (None, "", "   "):
            self.refused(shapes.required_text, bad, "x")

    def test_whole_reads_a_query_string_digit(self):
        self.assertEqual(shapes.whole(None, "x", 60), 60)
        self.assertEqual(shapes.whole("", "x", 60), 60)
        self.assertEqual(shapes.whole("25", "x", 60), 25)
        self.assertEqual(shapes.whole(25, "x", 60), 25)
        for bad in (True, False, "-1", "1.5", "1e3", "abc", [1]):
            self.refused(shapes.whole, bad, "x", 60)

    def test_flag_reads_the_spellings_a_query_string_can_carry(self):
        for value in ("1", "true", "TRUE", "yes", "on", True):
            self.assertIs(shapes.flag(value, "x", False), True)
        for value in ("0", "false", "no", "off", False):
            self.assertIs(shapes.flag(value, "x", True), False)
        self.assertIs(shapes.flag(None, "x", True), True)
        for bad in ("maybe", 1, []):
            self.refused(shapes.flag, bad, "x", False)

    def test_expansions_accepts_only_the_three_named(self):
        self.assertEqual(shapes.expansions(None), frozenset())
        self.assertEqual(shapes.expansions("access, preview"), frozenset({"access", "preview"}))
        self.assertEqual(shapes.expansions(",,"), frozenset())
        for bad in ("grants", "access,grants", 1):
            self.refused(shapes.expansions, bad)

    def test_usage_expansions_accept_only_the_breakdown(self):
        allowed = shapes.USAGE_EXPANSIONS
        self.assertEqual(shapes.expansions("breakdown", allowed=allowed), frozenset({"breakdown"}))
        self.assertEqual(shapes.expansions(None, allowed=allowed), frozenset())
        for bad in ("access", "breakdown,preview"):
            self.refused(shapes.expansions, bad, allowed=allowed)

    def test_identifiers_are_bounded_distinct_and_ordered(self):
        self.assertEqual(shapes.identifiers(["b", "a", "b"], "nodes"), ("b", "a"))
        for bad in (None, [], "n1", ["", "a"], [1], [None]):
            self.refused(shapes.identifiers, bad, "nodes")
        self.refused(shapes.identifiers, [f"n{i}" for i in range(shapes.MAX_BATCH_NODES + 1)], "nodes")

    def test_a_batch_is_capped_at_one_page(self):
        biggest = [f"n{i}" for i in range(shapes.MAX_BATCH_NODES)]
        self.assertEqual(len(shapes.identifiers(biggest, "nodes")), shapes.MAX_BATCH_NODES)

    def test_a_patch_takes_only_the_fields_node_patch_takes(self):
        self.assertEqual(shapes.patch({"title": "a"}, "patch"), {"title": "a"})
        for bad in (None, {}, [], "state=Trashed", {"blob": "x"}, {"title": "a", "size": 1}):
            self.refused(shapes.patch, bad, "patch")


class TestRecordCoercion(UnitTestCase):
    def refused(self, call, *args, **kwargs):
        with self.assertRaises(frappe.ValidationError):
            call(*args, **kwargs)

    def test_a_sequence_is_a_whole_number_above_zero(self):
        self.assertEqual(shapes.sequence(3, "seq"), 3)
        self.assertEqual(shapes.sequence("3", "seq"), 3)
        for bad in (None, "", 0, "0", -1, True, False, "abc", "1.5"):
            self.refused(shapes.sequence, bad, "seq")

    def test_a_name_list_accepts_an_empty_list(self):
        # Clearing an already-empty badge is an answer of zero, not a 400.
        self.assertEqual(shapes.name_list([], "notifications"), ())

    def test_a_name_list_is_distinct_and_keeps_its_order(self):
        self.assertEqual(shapes.name_list(["b", "a", "b"], "notifications"), ("b", "a"))

    def test_a_name_list_refuses_a_bad_type_or_a_blank_item(self):
        for bad in (None, "no1", {"a": 1}, ["", "a"], ["  "], [1], [None]):
            self.refused(shapes.name_list, bad, "notifications")

    def test_a_name_list_is_capped_at_one_page(self):
        biggest = [f"no{i}" for i in range(shapes.MAX_BATCH_NODES)]
        self.assertEqual(len(shapes.name_list(biggest, "notifications")), shapes.MAX_BATCH_NODES)
        self.refused(shapes.name_list, [*biggest, "one-more"], "notifications")


class TestMoment(UnitTestCase):
    """§11.3: a time arrives as RFC 3339 with its offset and is stored site-naive."""

    def test_an_instant_lands_in_the_site_zone(self):
        for wire in ("2026-10-03T06:30:00Z", "2026-10-03T12:00:00+05:30", "2026-10-03T02:30:00-04:00"):
            with self.subTest(wire=wire):
                stored = shapes.moment(wire, "content_modified")
                self.assertEqual(stored, datetime(2026, 10, 3, 12, 0, 0))
                self.assertIsNone(stored.tzinfo)

    def test_an_aware_datetime_is_accepted_the_same_way(self):
        stored = shapes.moment(datetime(2026, 10, 3, 6, 30, tzinfo=UTC), "expires_on")
        self.assertEqual(stored, datetime(2026, 10, 3, 12, 0, 0))

    def test_an_absent_time_is_none(self):
        self.assertIsNone(shapes.moment(None, "expires_on"))
        self.assertIsNone(shapes.moment("", "expires_on"))

    def test_a_time_without_an_offset_is_refused_not_guessed(self):
        for bad in ("2026-10-03T06:30:00", "2026-10-03 06:30:00", "2026-10-03", datetime(2026, 10, 3, 6, 30)):
            with self.subTest(bad=bad):
                with self.assertRaises(frappe.ValidationError):
                    shapes.moment(bad, "expires_on")

    def test_anything_else_is_refused(self):
        for bad in (1_700_000_000_000, 0, True, "soon", {"at": "2026-10-03T06:30:00Z"}):
            with self.subTest(bad=bad):
                with self.assertRaises(frappe.ValidationError):
                    shapes.moment(bad, "content_modified")

    def test_a_round_trip_publishes_the_instant_that_arrived(self):
        self.assertEqual(shapes.stamp(shapes.moment("2026-10-03T06:30:00Z", "at")), "2026-10-03T06:30:00Z")
        self.assertEqual(
            shapes.stamp(shapes.moment("2026-10-03T12:00:00+05:30", "at")), "2026-10-03T06:30:00Z"
        )


if __name__ == "__main__":
    unittest.main()
