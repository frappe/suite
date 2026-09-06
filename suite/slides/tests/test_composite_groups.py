"""The grouped composite load (ticket 20, §6.2, §6.6).

The contract is the module docstring of `suite/slides/api/composite.py`. Every
field, order rule, bound, and refusal it states is pinned by a test here, and
the frontend fixture at
`frontend/src/apps/slides/contracts/composite-groups.fixture.json` is compared
against a real answer by `test_the_frontend_fixture_matches_a_real_answer`, so
the three cannot drift apart.

Two classes, split the way the sibling adoption modules split:

- `TestCompositeGroupRequest` is a `UnitTestCase`. The request rules touch no
  row, so they are proved with no site: the bound, the duplicate rule, every
  malformed shape, and the tie between the group bound and Drive's own
  `X-Drive-Links` limit.
- `TestCompositeGroups` is an `IntegrationTestCase` running under `activated()`,
  because a Drive-native composite does not exist on a site until ticket 29
  registers the declaration. It proves authorization, order, placeholders,
  revocation between groups, injection, and the link-code arithmetic on real
  rows.

`suite/tests/test_architecture.py` records this module's `suite.drive._core`
imports as owned debt: a test needs the grant, root, and principal workflows
that tickets 21 and 22 will expose over HTTP.
"""

import json
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.drive._core.access import grant, revoke
from suite.drive._core.content import clear_registry_cache
from suite.drive._core.principals import LINK_HEADER_LIMIT, Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.slides import drive as slides
from suite.slides.api import composite as api
from suite.tests.utils import ensure_user

OWNER = "composite-groups-owner@example.com"
VIEWER = "composite-groups-viewer@example.com"
STRANGER = "composite-groups-stranger@example.com"

DOCTYPE = "Presentation"
SATELLITE = "Slide"

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "frontend"
    / "src"
    / "apps"
    / "slides"
    / "contracts"
    / "composite-groups.fixture.json"
)

ACTIVATION = {
    "drive_content_types": ["suite.slides.drive.SPEC"],
    "has_permission": {
        DOCTYPE: ["suite.drive.framework.doc_has_permission"],
        SATELLITE: ["suite.drive.framework.satellite_has_permission"],
    },
    "permission_query_conditions": {
        DOCTYPE: ["suite.drive.framework.doc_query_conditions"],
        SATELLITE: ["suite.drive.framework.satellite_query_conditions"],
    },
}


@contextmanager
def activated():
    """Register Slides for the block, exactly the way ticket 29 will register it.

    The same helper the adoption modules use, kept local so this module proves
    nothing about the site being activated and activates nothing itself.
    """
    real_get_hooks = frappe.get_hooks

    def hooks(hook=None, *args, **kwargs):
        if hook == "drive_content_types":
            return list(ACTIVATION[hook])
        if hook in ("has_permission", "permission_query_conditions"):
            wired = dict(real_get_hooks(hook, *args, **kwargs) or {})
            wired.update({name: list(paths) for name, paths in ACTIVATION[hook].items()})
            return wired
        return real_get_hooks(hook, *args, **kwargs)

    clear_registry_cache()
    try:
        with patch("frappe.get_hooks", hooks):
            yield
    finally:
        clear_registry_cache()


@contextmanager
def link_header(*tokens: str):
    """Carry the given codes in `X-Drive-Links` for the block.

    A real `werkzeug` request, not a patched reader: the count the limit acts
    on is the count of comma-separated items the header actually carries, and a
    stub that hands over a list would skip the split the limit is written on.
    """
    builder = EnvironBuilder(
        path="/api/method/suite.slides.api.composite.composite_group",
        headers={"X-Drive-Links": ",".join(tokens)},
    )
    previous = getattr(frappe.local, "request", None)
    frappe.local.request = Request(builder.get_environ())
    try:
        yield
    finally:
        frappe.local.request = previous


class TestCompositeGroupRequest(UnitTestCase):
    """The request rules, proved without a site.

    Nothing below reads a row. That is the point: every refusal here describes
    the request alone, so a malformed call never reaches the database and never
    asks a question about the composite.
    """

    # the bound

    def test_the_group_bound_leaves_exactly_one_code_for_the_composite(self):
        """§6.6: count the composite's own code when a group needs it."""
        self.assertEqual(api.GROUP_LIMIT, LINK_HEADER_LIMIT - 1)
        self.assertEqual(api.GROUP_LIMIT, 19)

    def test_nineteen_ids_are_accepted_and_twenty_are_refused(self):
        nineteen = [f"ref{index}" for index in range(19)]
        self.assertEqual(api._requested_references(nineteen), nineteen)

        with self.assertRaises(frappe.ValidationError) as refused:
            api._requested_references([*nineteen, "ref19"])
        self.assertIn("at most 19", str(refused.exception))

    def test_a_repeat_counts_toward_the_bound_rather_than_buying_room(self):
        """§4.7 counts supplied items before dedup; a group counts the same way."""
        twenty = [f"ref{index}" for index in range(19)] + ["ref0"]
        with self.assertRaises(frappe.ValidationError) as refused:
            api._requested_references(twenty)
        self.assertIn("at most 19", str(refused.exception))

    def test_a_repeat_inside_the_bound_is_still_refused(self):
        with self.assertRaises(frappe.ValidationError) as refused:
            api._requested_references(["ref0", "ref1", "ref0"])
        self.assertIn("same reference twice", str(refused.exception))

    # the shape

    def test_every_malformed_group_is_refused_with_one_answer(self):
        answers = set()
        for supplied in (
            None,
            "",
            "   ",
            "not json",
            "{}",
            "[]",
            "null",
            "5",
            '"ref0"',
            [],
            {},
            {"references": ["ref0"]},
            5,
            True,
            ["ref0", None],
            ["ref0", ""],
            ["ref0", 7],
            ["ref0", ["ref1"]],
            [["ref0"]],
            [{"reference": "ref0"}],
        ):
            with self.subTest(supplied=supplied):
                with self.assertRaises(frappe.ValidationError) as refused:
                    api._requested_references(supplied)
                answers.add(str(refused.exception))
        self.assertEqual(answers, {"A composite group is a list of reference ids"})

    def test_a_group_arrives_as_a_list_or_as_its_json_text(self):
        self.assertEqual(api._requested_references(["a", "b"]), ["a", "b"])
        self.assertEqual(api._requested_references('["a", "b"]'), ["a", "b"])

    def test_a_shape_refusal_is_a_validation_error_not_a_permission_error(self):
        """A malformed request is the caller's mistake, never an access answer."""
        with self.assertRaises(frappe.ValidationError):
            api._requested_references(None)
        self.assertFalse(issubclass(frappe.ValidationError, frappe.PermissionError))
        with self.assertRaises(frappe.ValidationError):
            api._requested_references("[]")

    def test_the_order_the_caller_asked_for_survives_the_request_reader(self):
        self.assertEqual(api._requested_references(["c", "a", "b"]), ["c", "a", "b"])

    # membership

    def test_membership_gives_one_answer_for_an_unknown_and_a_foreign_id(self):
        members = {"mine": {"reference": "mine"}}
        answers = set()
        for requested in (["never-existed"], ["another-composites-row"], ["mine", "not-mine"]):
            with self.subTest(requested=requested):
                with self.assertRaises(frappe.ValidationError) as refused:
                    api._refuse_non_members(requested, members)
                answers.add(str(refused.exception))
        self.assertEqual(len(answers), 1)
        self.assertIsNone(api._refuse_non_members(["mine"], members))

    def test_the_refusal_message_names_no_reference_and_no_deck(self):
        with self.assertRaises(frappe.ValidationError) as refused:
            api._refuse_non_members(["secret-deck-name"], {})
        self.assertNotIn("secret-deck-name", str(refused.exception))

    # the name

    def test_a_name_that_is_not_a_docname_is_refused_before_any_lookup(self):
        """`frappe.db.get_value` reads a dict or a list as filters, not as a name."""
        for name in ({"is_composite": 1}, ["deck-1"], None, "", 5, True):
            with self.subTest(name=name):
                with self.assertRaises(frappe.PermissionError) as refused:
                    api._authorized_composite(name)
                self.assertEqual(str(refused.exception), api.REFUSED)

    # the guest-reachable answer

    def test_the_route_refuses_with_the_whole_deck_read_paths_own_words(self):
        from suite.slides.doctype.presentation import presentation

        source = Path(presentation.__file__).read_text()
        self.assertIn(f'frappe.throw("{api.REFUSED}", frappe.PermissionError)', source)


class TestCompositeGroups(IntegrationTestCase):
    """Grouped loading on real rows, under `activated()`."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(VIEWER)
        ensure_user(STRANGER)
        # A run killed between `setUp` and its cleanup leaves the fixture roots
        # behind, and `create_root` then refuses every later run.
        _purge_fixture_roots()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # Entered first, so its exit runs last: the fixture purge below is a
        # Drive workflow and needs the registry it injects.
        activation = activated()
        activation.__enter__()
        self.addCleanup(activation.__exit__, None, None, None)
        # Registered before the first row exists, so a `setUp` that dies half
        # way still hands its roots back.
        self.addCleanup(self._remove_fixture_rows)
        self.root = create_root(kind="Personal", title="Composite Root", user=OWNER)
        self.other_root = create_root(kind="Personal", title="Composite Other", user=VIEWER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)

    def _remove_fixture_rows(self):
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        frappe.db.commit()

    # helpers

    def _deck(self, title="Deck", parent=None) -> str:
        return drive.create_document(parent or self.root.node, title, content_doctype=DOCTYPE)

    def _docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def _composite(self, referenced: list[str], title="Composite") -> str:
        node = self._deck(title=title)
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        deck.is_composite = 1
        for reference in referenced:
            deck.append("reference_presentations", {"presentation": self._docname(reference)})
        deck.save(ignore_permissions=True)
        return node

    def _background(self, node: str, colour: str) -> None:
        docname = self._docname(node)
        row = slides._slide_rows(docname)[0]
        frappe.db.set_value(SATELLITE, row["name"], {"background": colour}, update_modified=False)
        # `set_value` on a child row leaves the parent's document cache alone,
        # and the read path uses `get_cached_doc`.
        frappe.clear_document_cache(DOCTYPE, docname)

    def _share(self, node: str, user: str, role: int | None = None) -> None:
        grant(node, user, drive.READ if role is None else role, self.admin)

    def _link(self, node: str) -> str:
        """Share `node` by link and answer the code the client would hold."""
        return grant(node, "$LINK", drive.READ, self.admin)["principal"].removeprefix("$LINK:")

    def _as(self, user: str):
        frappe.set_user(user)
        self.addCleanup(frappe.set_user, "Administrator")

    def _ids(self, composite: str) -> list[str]:
        return [row["reference"] for row in api.composite_manifest(self._docname(composite))["references"]]

    # the manifest

    def test_the_manifest_names_every_reference_in_order_and_opens_none(self):
        references = [self._deck(title=f"Ref {index}") for index in range(3)]
        composite = self._composite(references)

        answered = api.composite_manifest(self._docname(composite))

        self.assertEqual(answered["presentation"], self._docname(composite))
        self.assertEqual(answered["node"], composite)
        self.assertEqual(answered["group_limit"], 19)
        self.assertEqual(answered["reference_count"], 3)
        self.assertEqual(
            [row["presentation"] for row in answered["references"]],
            [self._docname(node) for node in references],
        )
        self.assertEqual([row["index"] for row in answered["references"]], [1, 2, 3])
        # The manifest names references; it never says whether one can be read
        # and never carries a reference's content or node id.
        for row in answered["references"]:
            self.assertEqual(set(row), {"reference", "index", "presentation"})

    def test_a_reference_id_is_the_row_and_never_the_deck_or_the_node(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])

        [row] = api.composite_manifest(self._docname(composite))["references"]

        self.assertNotEqual(row["reference"], row["presentation"])
        self.assertNotEqual(row["reference"], reference)
        self.assertNotEqual(row["reference"], composite)
        self.assertTrue(frappe.db.exists("Reference Presentation", row["reference"]))

    # groups, order, and content

    def test_a_group_answers_in_the_order_it_was_asked_not_the_stored_order(self):
        references = [self._deck(title=f"Ref {index}") for index in range(3)]
        composite = self._composite(references)
        ids = self._ids(composite)

        answered = api.composite_group(self._docname(composite), [ids[2], ids[0]])

        self.assertEqual([row["reference"] for row in answered["references"]], [ids[2], ids[0]])
        self.assertEqual(
            [row["presentation"] for row in answered["references"]],
            [self._docname(references[2]), self._docname(references[0])],
        )

    def test_a_group_answers_one_entry_per_requested_id_and_nothing_else(self):
        references = [self._deck(title=f"Ref {index}") for index in range(3)]
        composite = self._composite(references)
        ids = self._ids(composite)

        answered = api.composite_group(self._docname(composite), [ids[1]])

        self.assertEqual(len(answered["references"]), 1)
        self.assertEqual(answered["references"][0]["reference"], ids[1])

    def test_a_readable_reference_carries_its_node_and_its_slides(self):
        reference = self._deck(title="Ref")
        self._background(reference, "#111111ff")
        composite = self._composite([reference])
        [identifier] = self._ids(composite)

        [answered] = api.composite_group(self._docname(composite), [identifier])["references"]

        self.assertTrue(answered["readable"])
        self.assertEqual(answered["node"], reference)
        self.assertFalse(answered["composite"])
        self.assertEqual([slide["background"] for slide in answered["slides"]], ["#111111ff"])

    def test_an_unreadable_reference_comes_back_in_place_with_no_content(self):
        mine = self._deck(title="Mine")
        hidden = self._deck(title="Hidden", parent=self.other_root.node)
        composite = self._composite([mine, hidden])
        self._share(composite, VIEWER)
        self._share(mine, VIEWER)
        ids = self._ids(composite)

        self._as(VIEWER)
        answered = api.composite_group(self._docname(composite), ids)["references"]

        self.assertEqual([row["reference"] for row in answered], ids)
        self.assertEqual([row["readable"] for row in answered], [True, False])
        marked = answered[1]
        # Marked, never dropped (§6.6), and never given the handle every Drive
        # route takes (§5.4).
        self.assertIsNone(marked["node"])
        self.assertIsNone(marked["slides"])
        self.assertIsNone(marked["composite"])
        self.assertEqual(marked["presentation"], self._docname(hidden))

    def test_a_composite_naming_one_deck_twice_answers_two_separate_references(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference, reference])
        ids = self._ids(composite)

        self.assertEqual(len(set(ids)), 2)
        answered = api.composite_group(self._docname(composite), ids)["references"]
        self.assertEqual([row["reference"] for row in answered], ids)
        self.assertEqual({row["presentation"] for row in answered}, {self._docname(reference)})
        self.assertEqual([row["readable"] for row in answered], [True, True])

    def test_a_reference_that_is_itself_a_composite_is_marked_and_holds_no_slides(self):
        """Ticket 18 left the semantics: one call resolves one level, no recursion."""
        leaf = self._deck(title="Leaf")
        inner = self._composite([leaf], title="Inner")
        outer = self._composite([inner], title="Outer")
        [identifier] = self._ids(outer)

        [answered] = api.composite_group(self._docname(outer), [identifier])["references"]

        self.assertTrue(answered["readable"])
        self.assertTrue(answered["composite"])
        self.assertEqual(answered["slides"], [])

    def test_a_blank_reference_row_is_unreadable_rather_than_an_error(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        deck = frappe.get_doc(DOCTYPE, self._docname(composite))
        deck.append("reference_presentations", {"presentation": None})
        # The save-time check refuses a reference with no deck; the read path
        # still has to answer for a row that reached the table another way.
        deck.flags.ignore_validate = True
        deck.save(ignore_permissions=True)
        ids = self._ids(composite)

        answered = api.composite_group(self._docname(composite), ids)["references"]

        self.assertEqual([row["readable"] for row in answered], [True, False])
        self.assertEqual(answered[1]["presentation"], "")

    # the bound, on real rows

    def test_nineteen_references_load_in_one_group(self):
        decks = [self._deck(title=f"Ref {index}") for index in range(3)]
        composite = self._composite([decks[index % 3] for index in range(19)])
        ids = self._ids(composite)

        answered = api.composite_group(self._docname(composite), ids)["references"]

        self.assertEqual(len(answered), 19)
        self.assertEqual([row["reference"] for row in answered], ids)
        self.assertTrue(all(row["readable"] for row in answered))

    def test_a_twentieth_reference_needs_a_second_group(self):
        decks = [self._deck(title=f"Ref {index}") for index in range(2)]
        composite = self._composite([decks[index % 2] for index in range(20)])
        ids = self._ids(composite)

        with self.assertRaises(frappe.ValidationError):
            api.composite_group(self._docname(composite), ids)

        first = api.composite_group(self._docname(composite), ids[:19])["references"]
        second = api.composite_group(self._docname(composite), ids[19:])["references"]
        self.assertEqual([row["reference"] for row in first + second], ids)

    # authorization, on every group

    def test_the_composite_is_authorized_again_on_every_group(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        self._share(composite, VIEWER)
        self._share(reference, VIEWER)
        ids = self._ids(composite)

        self._as(VIEWER)
        self.assertTrue(api.composite_group(self._docname(composite), ids)["references"][0]["readable"])

        frappe.set_user("Administrator")
        revoke(composite, VIEWER, self.admin)

        self._as(VIEWER)
        with self.assertRaises(frappe.PermissionError):
            api.composite_group(self._docname(composite), ids)
        with self.assertRaises(frappe.PermissionError):
            api.composite_manifest(self._docname(composite))

    def test_a_reference_revoked_between_two_groups_is_unreadable_in_the_second(self):
        first_deck = self._deck(title="First")
        second_deck = self._deck(title="Second")
        composite = self._composite([first_deck, second_deck])
        self._share(composite, VIEWER)
        self._share(first_deck, VIEWER)
        self._share(second_deck, VIEWER)
        ids = self._ids(composite)

        self._as(VIEWER)
        first = api.composite_group(self._docname(composite), [ids[0]])["references"]
        self.assertTrue(first[0]["readable"])

        frappe.set_user("Administrator")
        revoke(second_deck, VIEWER, self.admin)

        self._as(VIEWER)
        second = api.composite_group(self._docname(composite), [ids[1]])["references"]
        self.assertFalse(second[0]["readable"])
        self.assertIsNone(second[0]["node"])
        self.assertIsNone(second[0]["slides"])

    def test_a_reference_granted_between_two_groups_is_readable_in_the_second(self):
        hidden = self._deck(title="Hidden", parent=self.other_root.node)
        composite = self._composite([hidden])
        self._share(composite, STRANGER)
        ids = self._ids(composite)

        self._as(STRANGER)
        self.assertFalse(api.composite_group(self._docname(composite), ids)["references"][0]["readable"])

        frappe.set_user("Administrator")
        self._share(hidden, STRANGER)

        self._as(STRANGER)
        answered = api.composite_group(self._docname(composite), ids)["references"][0]
        self.assertTrue(answered["readable"])
        self.assertEqual(answered["node"], hidden)

    def test_a_placeholder_keeps_its_id_and_its_place_across_repeated_loads(self):
        mine = self._deck(title="Mine")
        hidden = self._deck(title="Hidden", parent=self.other_root.node)
        composite = self._composite([mine, hidden, mine])
        self._share(composite, VIEWER)
        self._share(mine, VIEWER)
        ids = self._ids(composite)

        self._as(VIEWER)
        answers = [
            [
                (row["reference"], row["readable"])
                for row in api.composite_group(self._docname(composite), ids)["references"]
            ]
            for _ in range(3)
        ]

        self.assertEqual(len(set(map(tuple, answers))), 1)
        self.assertEqual([readable for _, readable in answers[0]], [True, False, True])

    def test_a_grant_change_never_moves_a_reference_id(self):
        mine = self._deck(title="Mine")
        hidden = self._deck(title="Hidden", parent=self.other_root.node)
        composite = self._composite([mine, hidden])
        self._share(composite, VIEWER)
        self._share(mine, VIEWER)
        before = self._ids(composite)

        # The readable half becomes the unreadable half, and the other way.
        self._share(hidden, VIEWER)
        revoke(mine, VIEWER, self.admin)

        self.assertEqual(self._ids(composite), before)
        self._as(VIEWER)
        answered = api.composite_group(self._docname(composite), before)["references"]
        self.assertEqual([row["reference"] for row in answered], before)
        self.assertEqual([row["readable"] for row in answered], [False, True])

    # injection

    def test_an_invented_id_a_deck_name_and_a_node_id_are_all_refused(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        [identifier] = self._ids(composite)

        answers = set()
        for injected in (
            "not-a-reference",
            self._docname(reference),
            reference,
            composite,
            self._docname(composite),
        ):
            with self.subTest(injected=injected):
                with self.assertRaises(frappe.ValidationError) as refused:
                    api.composite_group(self._docname(composite), [identifier, injected])
                answers.add(str(refused.exception))
        self.assertEqual(len(answers), 1)

    def test_a_reference_id_from_another_composite_is_refused(self):
        reference = self._deck(title="Ref")
        mine = self._composite([reference], title="Mine")
        theirs = self._composite([reference], title="Theirs")
        [foreign] = self._ids(theirs)

        with self.assertRaises(frappe.ValidationError):
            api.composite_group(self._docname(mine), [foreign])

    def test_a_remembered_association_confers_no_authority(self):
        """The call takes no node id and no deck name, so nothing remembered can be asserted."""
        hidden = self._deck(title="Hidden", parent=self.other_root.node)
        composite = self._composite([hidden])
        self._share(composite, STRANGER)
        ids = self._ids(composite)

        self._as(STRANGER)
        # The client "remembers" that this reference is that node. Naming it
        # changes nothing: the id is not a member, and the member's own answer
        # is still the point check.
        with self.assertRaises(frappe.ValidationError):
            api.composite_group(self._docname(composite), [hidden])
        self.assertFalse(api.composite_group(self._docname(composite), ids)["references"][0]["readable"])

    # non-disclosure

    def test_a_stranger_is_refused_before_membership_is_ever_checked(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        [identifier] = self._ids(composite)

        self._as(STRANGER)
        for requested in ([identifier], ["invented"]):
            with self.subTest(requested=requested):
                with self.assertRaises(frappe.PermissionError) as refused:
                    api.composite_group(self._docname(composite), requested)
                self.assertEqual(str(refused.exception), api.REFUSED)

    def test_both_calls_answer_a_stranger_the_same_way_three_times(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])

        self._as(STRANGER)
        for call, requested in ((api.composite_manifest, None), (api.composite_group, ["anything"])):
            answers = set()
            for name in (self._docname(composite), self._docname(reference), "no-such-deck"):
                with self.subTest(call=call.__name__, name=name):
                    with self.assertRaises(frappe.PermissionError) as refused:
                        call(name) if requested is None else call(name, requested)
                    answers.add(str(refused.exception))
            self.assertEqual(answers, {api.REFUSED})

    def test_a_guest_reads_a_published_composite_and_only_published_references(self):
        published = self._deck(title="Published")
        private = self._deck(title="Private")
        composite = self._composite([published, private])
        self._share(composite, "$PUBLIC")
        self._share(published, "$PUBLIC")
        ids = self._ids(composite)

        self._as("Guest")
        answered = api.composite_group(self._docname(composite), ids)["references"]

        self.assertEqual([row["readable"] for row in answered], [True, False])

    def test_a_malformed_group_is_refused_the_same_way_whatever_the_name_is(self):
        """A shape refusal describes the request, so it answers no question about a name."""
        reference = self._deck(title="Ref")
        composite = self._composite([reference])

        answers = set()
        for name in (self._docname(composite), self._docname(reference), "no-such-deck"):
            for caller in ("Administrator", STRANGER):
                with self.subTest(name=name, caller=caller):
                    frappe.set_user(caller)
                    with self.assertRaises(frappe.ValidationError) as refused:
                        api.composite_group(name, "not a list")
                    answers.add(str(refused.exception))
        frappe.set_user("Administrator")
        self.assertEqual(len(answers), 1)

    def test_a_deck_that_is_not_a_composite_is_refused_even_to_its_owner(self):
        """The route serves composites. Nothing else reaches it, however readable."""
        plain = self._deck(title="Plain")

        with self.assertRaises(frappe.PermissionError) as refused:
            api.composite_manifest(self._docname(plain))
        self.assertEqual(str(refused.exception), api.REFUSED)
        with self.assertRaises(frappe.PermissionError):
            api.composite_group(self._docname(plain), ["anything"])

    # link codes

    def test_a_link_code_authorizes_its_reference_for_the_group_that_carries_it(self):
        published = self._deck(title="Published")
        shared = self._deck(title="Shared by link")
        composite = self._composite([published, shared])
        self._share(composite, "$PUBLIC")
        self._share(published, "$PUBLIC")
        code = self._link(shared)
        ids = self._ids(composite)

        self._as("Guest")
        with link_header(code):
            carried = api.composite_group(self._docname(composite), ids)["references"]
        without = api.composite_group(self._docname(composite), ids)["references"]

        self.assertEqual([row["readable"] for row in carried], [True, True])
        self.assertEqual([row["readable"] for row in without], [True, False])
        self.assertEqual([row["reference"] for row in carried], [row["reference"] for row in without])

    def test_an_oversized_link_header_is_refused_rather_than_marking_everything_unreadable(self):
        """§6.2: the explicit error, never a silently trimmed set."""
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        self._share(composite, "$PUBLIC")
        self._share(reference, "$PUBLIC")
        ids = self._ids(composite)
        codes = tuple(frappe.generate_hash(length=22) for _ in range(LINK_HEADER_LIMIT + 1))

        self._as("Guest")
        for call in (
            lambda: api.composite_group(self._docname(composite), ids),
            lambda: api.composite_manifest(self._docname(composite)),
        ):
            with self.subTest(call=call), link_header(*codes):
                with self.assertRaises(frappe.ValidationError) as refused:
                    call()
                self.assertIn("at most", str(refused.exception))
                self.assertNotIsInstance(refused.exception, drive.DriveError)

    def test_twenty_codes_are_still_accepted(self):
        reference = self._deck(title="Ref")
        composite = self._composite([reference])
        self._share(composite, "$PUBLIC")
        self._share(reference, "$PUBLIC")
        ids = self._ids(composite)
        codes = tuple(frappe.generate_hash(length=22) for _ in range(LINK_HEADER_LIMIT))

        self._as("Guest")
        with link_header(*codes):
            self.assertTrue(api.composite_group(self._docname(composite), ids)["references"][0]["readable"])

    # more than twenty separately shared references

    def test_more_than_twenty_separately_shared_references_load_in_two_groups(self):
        """The case §6.6 exists for: one code each, and one for the composite."""
        composite_node, references, codes, composite_code = self._widely_shared_composite()
        ids = self._ids(composite_node)
        self.assertEqual(len(ids), 21)

        self._as("Guest")
        first_codes = (composite_code, *codes[:19])
        second_codes = (composite_code, *codes[19:])
        self.assertEqual(len(first_codes), LINK_HEADER_LIMIT)

        with link_header(*first_codes):
            first = api.composite_group(self._docname(composite_node), ids[:19])["references"]
        with link_header(*second_codes):
            second = api.composite_group(self._docname(composite_node), ids[19:])["references"]

        answered = first + second
        self.assertEqual([row["reference"] for row in answered], ids)
        self.assertTrue(all(row["readable"] for row in answered))
        self.assertEqual(
            [row["node"] for row in answered],
            references,
        )

    def test_a_group_carrying_the_wrong_codes_marks_only_those_references(self):
        composite_node, _references, codes, composite_code = self._widely_shared_composite()
        ids = self._ids(composite_node)

        self._as("Guest")
        # The codes for the first group's references, sent with the second.
        with link_header(composite_code, *codes[:19]):
            answered = api.composite_group(self._docname(composite_node), ids[19:])["references"]

        self.assertEqual([row["reference"] for row in answered], ids[19:])
        self.assertEqual([row["readable"] for row in answered], [False, False])
        self.assertTrue(all(row["node"] is None and row["slides"] is None for row in answered))

    def _widely_shared_composite(self):
        """One composite, 21 references, one share link each, plus its own link."""
        references = [self._deck(title=f"Shared {index}") for index in range(21)]
        composite_node = self._composite(references, title="Widely shared")
        codes = [self._link(reference) for reference in references]
        composite_code = self._link(composite_node)
        return composite_node, references, codes, composite_code

    # the frontend contract fixture

    def test_the_frontend_fixture_matches_a_real_answer(self):
        """The checked-in fixture is the contract the SPA will code against.

        Ids and timestamps are the site's, so the comparison is structural: the
        same keys, the same types, the same ordering, and the same group
        arithmetic. A field added to either side without the other fails here.
        """
        fixture = json.loads(FIXTURE.read_text())
        composite_node, _references, codes, composite_code = self._widely_shared_composite()
        docname = self._docname(composite_node)
        ids = self._ids(composite_node)

        self._as("Guest")
        with link_header(composite_code):
            manifest = api.composite_manifest(docname)
        with link_header(composite_code, *codes[:19]):
            first = api.composite_group(docname, ids[:19])
        with link_header(composite_code):
            second = api.composite_group(docname, ids[19:])

        self.assertEqual(set(manifest), set(fixture["manifest"]))
        self.assertEqual(manifest["group_limit"], fixture["manifest"]["group_limit"])
        self.assertEqual(manifest["reference_count"], fixture["manifest"]["reference_count"])
        self.assertEqual(len(manifest["references"]), len(fixture["manifest"]["references"]))
        self.assertEqual(set(manifest["references"][0]), set(fixture["manifest"]["references"][0]))

        for answered, recorded in ((first, fixture["groups"][0]), (second, fixture["groups"][1])):
            # `request` records the call that produced the group; it is the
            # fixture's own field and never part of an answer.
            self.assertEqual(set(answered), set(recorded) - {"request"})
            self.assertEqual(set(recorded["request"]), {"name", "references", "x_drive_links"})
            self.assertEqual(len(answered["references"]), len(recorded["references"]))
            for row, expected in zip(answered["references"], recorded["references"], strict=True):
                self.assertEqual(set(row), set(expected))
                self.assertEqual(row["readable"], expected["readable"])
                self.assertEqual(row["slides"] is None, expected["slides"] is None)
                self.assertEqual(row["node"] is None, expected["node"] is None)

        self.assertEqual(fixture["group_limit"], api.GROUP_LIMIT)
        self.assertEqual(fixture["link_header_limit"], LINK_HEADER_LIMIT)
        recorded_errors = {name: entry["error"] for name, entry in fixture["refusals"].items()}
        self.assertEqual(recorded_errors["unreadable_composite"], api.REFUSED)


def _purge_fixture_roots() -> None:
    """Hand back every Drive root this module's users own, through Drive's purge.

    The three users belong to this module alone, so the filter can never reach a
    live account or another test module's fixtures.
    """
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    roots = frappe.get_all("Drive Root", filters={"user": ["in", (OWNER, VIEWER, STRANGER)]}, pluck="name")
    # Purging a document node calls the app's `on_purge`, which Drive reads from
    # the registry, so the purge runs registered even when the caller is not.
    with activated():
        for root in roots:
            if frappe.db.get_value("Drive Root", root, "state") == "Active":
                update_root(root, admin, state="Archived")
            purge_root(root, admin)
