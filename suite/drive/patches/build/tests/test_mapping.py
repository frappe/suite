"""§14.5 as data, checked against the table it came from.

The mapping module is pure, so the whole of §14.5 fits in a table walk. The
expected roles below come from a second reading of the spec table, written
out in this file. Nothing here imports `role_for_flags` to build its own
expectations, so a changed branch in the module shows up as a failure.

The constants are pinned against the files that own the same spellings: the
`Drive Grant` DocType JSON for the principal length, `suite/drive/utils` and
`suite/drive/_core` for the sentinel strings.
"""

import itertools
import json
import os
import unittest

import suite.drive
from suite.drive._core.access import _principal_kind
from suite.drive._core.principals import parse_link_header
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD
from suite.drive.patches.build.mapping import (
    ANONYMOUS,
    CONTENT_FLAGS,
    GENERAL,
    GROUP_PREFIX,
    LINK_CEILING,
    LINK_PREFIX,
    PRINCIPAL_LENGTH,
    PUBLIC,
    PUBLIC_CEILING,
    clamp_link,
    clamp_public,
    collapse,
    docshare_role,
    merged_role,
    principal_kind,
    role_for_flags,
)
from suite.drive.utils import GENERAL_USER
from suite.drive.utils import GROUP_PREFIX as UTILS_GROUP_PREFIX

FLAG_NAMES = ("read", "comment", "share", "upload", "write", "deny")

# §14.5, read as "the highest content flag wins", highest first. `share` is
# not a content flag, so it is not in this ladder.
CONTENT_LADDER = (("write", EDIT), ("upload", UPLOAD), ("comment", COMMENT), ("read", READ))


def spec_role(flags: dict) -> int | None:
    """§14.5 row by row, written out again so the walk has a second opinion.

    The order of the checks differs from the module on purpose. The module
    tests `share and write` before the ladder. This one runs the ladder
    first and lets the `share` row override it, which is how the table
    reads. Both orders must give the same answer for all 64 rows.
    """
    if flags["deny"]:
        return NONE
    highest = None
    for flag, role in CONTENT_LADDER:
        if flags[flag]:
            highest = role
            break
    if flags["share"] and flags["write"]:
        return MANAGE
    return highest


def every_flag_combination():
    """All 2**6 rows of the flag table, as dicts."""
    for values in itertools.product((0, 1), repeat=len(FLAG_NAMES)):
        yield dict(zip(FLAG_NAMES, values, strict=True))


class TestRoleForFlags(unittest.TestCase):
    def test_every_flag_combination_matches_the_spec_table(self):
        """All 64 flag rows map to the role §14.5 gives them."""
        for flags in every_flag_combination():
            with self.subTest(**flags):
                self.assertEqual(role_for_flags(flags), spec_role(flags))

    def test_the_walk_covers_all_sixty_four_rows(self):
        """The table walk is exhaustive, so a new flag cannot slip past it."""
        self.assertEqual(len(list(every_flag_combination())), 64)

    def test_a_deny_row_is_none_whatever_else_it_sets(self):
        """Denies round up: `deny = 1` beats every content flag."""
        for flags in every_flag_combination():
            if not flags["deny"]:
                continue
            with self.subTest(**flags):
                self.assertEqual(role_for_flags(flags), NONE)

    def test_the_named_rows_of_the_spec_table(self):
        """The seven rows §14.5 spells out map to the roles it names."""
        rows = (
            ({"deny": 1, "read": 1, "write": 1, "share": 1}, NONE),
            ({"share": 1, "write": 1}, MANAGE),
            ({"write": 1}, EDIT),
            ({"upload": 1}, UPLOAD),
            ({"comment": 1}, COMMENT),
            ({"read": 1}, READ),
            ({}, None),
        )
        for flags, expected in rows:
            with self.subTest(flags=flags):
                self.assertEqual(role_for_flags(flags), expected)

    def test_share_without_write_falls_back_to_the_content_flags(self):
        """`share` alone grants nothing: the highest content flag decides."""
        self.assertEqual(role_for_flags({"share": 1, "upload": 1}), UPLOAD)
        self.assertEqual(role_for_flags({"share": 1, "comment": 1}), COMMENT)

    def test_share_with_read_is_read_and_not_manage(self):
        """A legacy sharer who cannot write must not become a manager."""
        # This is the row a naive `share -> MANAGE` reading gets wrong, and
        # it would hand out grant and purge rights on the migrated site.
        self.assertEqual(role_for_flags({"share": 1, "read": 1}), READ)

    def test_share_alone_grants_nothing(self):
        """A row with only `share` has no content flag, so §14.5 drops it."""
        self.assertIsNone(role_for_flags({"share": 1}))

    def test_a_row_with_no_flags_is_dropped(self):
        """None means "drop the row", which is not the same as NONE."""
        self.assertIsNone(role_for_flags({}))
        self.assertIsNotNone(role_for_flags({"deny": 1}))


class TestCollapse(unittest.TestCase):
    def test_a_single_row_collapses_to_itself(self):
        """One row per `(entity, user)` is the normal case and must not move."""
        row = {"name": "a", "creation": "2020-01-01", "read": 1, "user": "x@y.com"}
        self.assertEqual(collapse([row]), row)

    def test_the_deny_row_is_the_keeper(self):
        """`deny desc` first: a deny anywhere in the group wins the keeper slot."""
        grant = {"name": "a", "creation": "2020-01-01", "read": 1, "write": 1}
        deny = {"name": "b", "creation": "2021-01-01", "deny": 1, "read": 1}
        self.assertEqual(collapse([grant, deny])["name"], "b")
        self.assertEqual(collapse([deny, grant])["name"], "b")

    def test_a_grant_row_adds_no_flags_to_a_deny_keeper(self):
        """Same polarity only: a grant must not widen what a deny row denies."""
        # A deny row that picked up `write` from a grant would still deny,
        # but the report would name the wrong flags and a later rerun of the
        # patch would read a row the site never had.
        grant = {"name": "a", "creation": "2020-01-01", "write": 1, "share": 1}
        deny = {"name": "b", "creation": "2021-01-01", "deny": 1, "read": 1}
        keeper = collapse([grant, deny])
        self.assertEqual(keeper["name"], "b")
        self.assertNotIn("write", keeper)
        self.assertNotIn("share", keeper)

    def test_the_polarity_guard_holds_for_either_input_order(self):
        """The guard must not depend on the order the database returned rows in."""
        deny = {"name": "a", "creation": "2020-01-01", "deny": 1, "write": 1}
        grant = {"name": "b", "creation": "2021-01-01", "read": 1}
        for order in ([deny, grant], [grant, deny]):
            with self.subTest(order=[row["name"] for row in order]):
                keeper = collapse(list(order))
                self.assertEqual(keeper["name"], "a")
                self.assertNotIn("read", keeper)

    def test_same_polarity_rows_union_every_flag(self):
        """All five flags OR together, so no flag is quietly dropped."""
        keeper = collapse(
            [
                {"name": "a", "creation": "2020-01-01", "read": 1},
                {"name": "b", "creation": "2020-01-02", "comment": 1},
                {"name": "c", "creation": "2020-01-03", "share": 1},
                {"name": "d", "creation": "2020-01-04", "upload": 1},
                {"name": "e", "creation": "2020-01-05", "write": 1},
            ]
        )
        for flag in ("read", "comment", "share", "upload", "write"):
            with self.subTest(flag=flag):
                self.assertEqual(keeper[flag], 1)

    def test_read_share_unioned_with_write_maps_to_manage(self):
        """Collapse runs before mapping, and the composition is why."""
        # Mapped first, the rows give READ and EDIT and the higher is EDIT.
        # Collapsed first, the union holds `share` and `write`, which §14.5
        # maps to MANAGE. The patch collapses first, so MANAGE is right.
        keeper = collapse(
            [
                {"name": "a", "creation": "2020-01-01", "read": 1, "share": 1},
                {"name": "b", "creation": "2020-01-02", "write": 1},
            ]
        )
        self.assertEqual(role_for_flags(keeper), MANAGE)

    def test_the_oldest_row_wins_among_grants(self):
        """`creation` ranks same-polarity rows, so the oldest row is the keeper."""
        older = {"name": "z", "creation": "2020-01-01", "read": 1}
        newer = {"name": "a", "creation": "2021-01-01", "read": 1}
        self.assertEqual(collapse([newer, older])["name"], "z")

    def test_the_keeper_keeps_its_own_non_flag_fields(self):
        """Only flags merge. The keeper's identity comes from the first row."""
        keeper = collapse(
            [
                {"name": "a", "creation": "2020-01-01", "entity": "E1", "user": "a@b.com", "read": 1},
                {"name": "b", "creation": "2020-01-02", "entity": "E2", "user": "c@d.com", "write": 1},
            ]
        )
        self.assertEqual(keeper["name"], "a")
        self.assertEqual(keeper["entity"], "E1")
        self.assertEqual(keeper["user"], "a@b.com")

    def test_the_input_rows_are_not_modified(self):
        """Build reports on the source rows after collapsing, so they must survive."""
        rows = [
            {"name": "a", "creation": "2020-01-01", "read": 1},
            {"name": "b", "creation": "2020-01-02", "write": 1},
        ]
        collapse(rows)
        self.assertEqual(rows[0], {"name": "a", "creation": "2020-01-01", "read": 1})

    def test_a_missing_creation_still_orders_by_name(self):
        """A hand-inserted row with no `creation` must not make the run random."""
        rows = [
            {"name": "b", "creation": None, "read": 1},
            {"name": "a", "creation": None, "comment": 1},
        ]
        self.assertEqual(collapse(rows)["name"], "a")
        self.assertEqual(collapse(list(reversed(rows)))["name"], "a")

    def test_a_missing_creation_sorts_before_a_present_one(self):
        """The empty-string fallback sorts low, so the undated row is the keeper."""
        undated = {"name": "z", "read": 1}
        dated = {"name": "a", "creation": "2020-01-01", "read": 1}
        self.assertEqual(collapse([dated, undated])["name"], "z")

    def test_the_order_is_stable_for_every_input_permutation(self):
        """The same rows in any order give the same keeper, run after run."""
        rows = [
            {"name": "a", "creation": "2020-01-02", "read": 1},
            {"name": "b", "creation": "2020-01-01", "comment": 1},
            {"name": "c", "creation": "2020-01-01", "upload": 1},
        ]
        for order in itertools.permutations(rows):
            with self.subTest(order=[row["name"] for row in order]):
                keeper = collapse(list(order))
                self.assertEqual(keeper["name"], "b")
                self.assertEqual(role_for_flags(keeper), UPLOAD)


class TestPrincipalKind(unittest.TestCase):
    def test_the_empty_user_is_anonymous(self):
        """`user = ""` is the link row §14.5 splits into `$PUBLIC` and `$LINK`."""
        self.assertEqual(principal_kind(""), "anonymous")

    def test_the_general_sentinel(self):
        """`$GENERAL` means any logged-in user and maps to one principal."""
        self.assertEqual(principal_kind("$GENERAL"), "general")

    def test_a_group_sentinel(self):
        """`$GROUP:<name>` carries the User Group name after the prefix."""
        self.assertEqual(principal_kind("$GROUP:Engineering"), "group")

    def test_a_group_sentinel_with_an_empty_name(self):
        """The prefix alone still classifies as a group here."""
        # The engine's `_principal_kind` refuses this one. Build classifies
        # it as a group, so the row reaches the writer and is refused there
        # rather than being counted as unknown.
        self.assertEqual(principal_kind("$GROUP:"), "group")

    def test_an_unknown_sentinel(self):
        """Any other `$` value is unknown, so Build drops it and counts it."""
        self.assertEqual(principal_kind("$OTHER"), "unknown")

    def test_a_link_sentinel_is_unknown_on_a_legacy_row(self):
        """Drive never wrote `$LINK:` to a legacy row, so reading one is unknown."""
        self.assertEqual(principal_kind("$LINK:abc"), "unknown")

    def test_an_email_is_a_user(self):
        """A valid address is the one thing the engine takes as a user principal."""
        self.assertEqual(principal_kind("a@b.com"), "user")

    def test_a_user_link_that_is_not_an_email_is_unknown(self):
        """`Drive Permission.user` is a plain Link, so it can hold these two.

        `access._principal_kind` answers None for both, so a grant written
        with either would be a row nothing ever reads. Neither loses
        access: `is_drive_admin` gives Administrator everything without a
        grant, and a guest reads through `$PUBLIC`.
        """
        self.assertEqual(principal_kind("Administrator"), "unknown")
        self.assertEqual(principal_kind("Guest"), "unknown")
        self.assertEqual(principal_kind("not an address"), "unknown")

    def test_the_user_rule_matches_the_engine(self):
        """Build and `access._principal_kind` agree on every spelling."""
        from suite.drive._core.access import _principal_kind

        for value in ("a@b.com", "Administrator", "Guest", "x", "a@b"):
            with self.subTest(value=value):
                engine = _principal_kind(value) == "user"
                self.assertEqual(principal_kind(value) == "user", engine)


class TestClamps(unittest.TestCase):
    def test_a_link_never_holds_manage(self):
        """§5.9 refusal 9: a MANAGE row mints an EDIT link, not a MANAGE one."""
        self.assertEqual(clamp_link(MANAGE), EDIT)

    def test_a_link_keeps_every_level_at_or_below_edit(self):
        """Clamping must not take away access the site really had."""
        for role in (EDIT, UPLOAD, COMMENT, READ, NONE):
            with self.subTest(role=role):
                self.assertEqual(clamp_link(role), role)

    def test_public_caps_at_read(self):
        """§6.5: everything above READ becomes READ for `$PUBLIC`."""
        for role in (MANAGE, EDIT, UPLOAD, COMMENT):
            with self.subTest(role=role):
                self.assertEqual(clamp_public(role), READ)

    def test_public_keeps_read_and_none(self):
        """READ and a deny pass through unchanged."""
        self.assertEqual(clamp_public(READ), READ)
        self.assertEqual(clamp_public(NONE), NONE)


class TestMergedRole(unittest.TestCase):
    def test_the_first_source_wins_when_nothing_is_stored(self):
        """No stored row yet, so the incoming role is the answer."""
        for role in (NONE, READ, COMMENT, UPLOAD, EDIT, MANAGE):
            with self.subTest(role=role):
                self.assertEqual(merged_role(None, role), role)

    def test_a_stored_deny_beats_any_incoming_role(self):
        """A stored deny is role 0, and a plain `max` would promote it."""
        for role in (READ, COMMENT, UPLOAD, EDIT, MANAGE):
            with self.subTest(role=role):
                self.assertEqual(merged_role(NONE, role), NONE)

    def test_an_incoming_deny_beats_any_stored_role(self):
        """Denies win from either side, so source order cannot change the result."""
        for role in (READ, COMMENT, UPLOAD, EDIT, MANAGE):
            with self.subTest(role=role):
                self.assertEqual(merged_role(role, NONE), NONE)

    def test_two_grants_keep_the_higher_role(self):
        """One row per `(node, principal)`, so the most permissive grant stays."""
        self.assertEqual(merged_role(READ, EDIT), EDIT)
        self.assertEqual(merged_role(EDIT, READ), EDIT)
        self.assertEqual(merged_role(MANAGE, READ), MANAGE)
        self.assertEqual(merged_role(READ, MANAGE), MANAGE)

    def test_the_same_role_twice_is_that_role(self):
        """Two sources naming one pair at one level leave the level alone."""
        self.assertEqual(merged_role(UPLOAD, UPLOAD), UPLOAD)


class TestDocshareRole(unittest.TestCase):
    def test_write_is_edit(self):
        """§14.5: a `DocShare` write becomes EDIT on the sheet's node."""
        self.assertEqual(docshare_role({"write": 1}), EDIT)

    def test_read_is_read(self):
        """§14.5: a `DocShare` read becomes READ."""
        self.assertEqual(docshare_role({"read": 1}), READ)

    def test_write_and_read_together_are_edit(self):
        """`write` implies `read` on the strict ladder, so EDIT is the answer."""
        self.assertEqual(docshare_role({"read": 1, "write": 1}), EDIT)

    def test_no_flags_is_dropped(self):
        """A `DocShare` row with neither flag grants nothing."""
        self.assertIsNone(docshare_role({}))

    def test_a_stray_share_grants_nothing(self):
        """`share` is not in the §14.5 DocShare table, so it maps to nothing."""
        # Sheets passes `share=0`, but a hand-edited row could set it. It
        # must not become MANAGE the way a Drive Permission row would.
        self.assertIsNone(docshare_role({"share": 1}))


class TestConstants(unittest.TestCase):
    def test_the_public_ceiling_is_read(self):
        """§6.5 caps `$PUBLIC` at READ."""
        self.assertEqual(PUBLIC_CEILING, READ)

    def test_the_link_ceiling_is_edit(self):
        """§5.9 refusal 9 caps a link at EDIT."""
        self.assertEqual(LINK_CEILING, EDIT)

    def test_the_principal_length_matches_the_doctype(self):
        """A longer principal than the column holds would truncate on write."""
        path = os.path.join(
            os.path.dirname(suite.drive.__file__), "doctype", "drive_grant", "drive_grant.json"
        )
        with open(path) as handle:
            doctype = json.load(handle)
        field = next(f for f in doctype["fields"] if f["fieldname"] == "principal")
        self.assertEqual(PRINCIPAL_LENGTH, 200)
        self.assertEqual(PRINCIPAL_LENGTH, field["length"])

    def test_the_general_sentinel_matches_the_app(self):
        """Build has to write the same spelling the engine reads."""
        self.assertEqual(GENERAL, GENERAL_USER)
        self.assertEqual(_principal_kind(GENERAL), "general")

    def test_the_group_prefix_matches_the_app(self):
        """A different prefix would make every group grant unreadable."""
        self.assertEqual(GROUP_PREFIX, UTILS_GROUP_PREFIX)
        self.assertEqual(_principal_kind(GROUP_PREFIX + "Engineering"), "group")

    def test_the_public_sentinel_is_the_one_the_engine_calls_open(self):
        """`suite/drive/utils` has no `$PUBLIC`, so the engine is the source."""
        self.assertEqual(_principal_kind(PUBLIC), "open")

    def test_the_link_prefix_matches_the_minted_principal(self):
        """`parse_link_header` mints the principal Build must write."""
        token = "A" * 22
        (credential,) = parse_link_header(token)
        self.assertEqual(credential.principal, LINK_PREFIX + token)

    def test_the_anonymous_user_is_the_empty_string(self):
        """`Drive Permission.user` is not nullable, so the link row holds ""."""
        self.assertEqual(ANONYMOUS, "")

    def test_the_content_flags_are_the_ladder_lowest_first(self):
        """`share` is not a content flag, and the order is the ladder's order."""
        self.assertEqual(CONTENT_FLAGS, ("read", "comment", "upload", "write"))
        roles = [READ, COMMENT, UPLOAD, EDIT]
        self.assertEqual(roles, sorted(roles))


if __name__ == "__main__":
    unittest.main()
