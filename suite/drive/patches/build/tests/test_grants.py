"""§14.2 step 6 and §14.5: `Drive Permission` and Sheet `DocShare` mapping.

The mapping tables themselves are pinned in `test_mapping`. These tests are
about what happens around them: which rows are dropped, which become two
grants, what the guardrails refuse, and what a second run does.

`FakeDrive` carries the real unique index on `(node, principal)`, so a
duplicate insert raises here the way it would on a site.
"""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD
from suite.drive.patches.build import grants as grants_module
from suite.drive.patches.build.ports import ACTIVE, DocShareRow, PermissionRow
from suite.drive.patches.build.root_pairs import ARCHIVED, PERSONAL, SHARED, RootPlan
from suite.drive.patches.build.state import BuildState, GrantConversion
from suite.drive.patches.build.tests.fakes import (
    BUILD_STAMP,
    FakeDrive,
    FakeTree,
    InterruptedRun,
    build_environment,
)

PERSONAL_ROOT = "personal01"
SHARED_ROOT = "sharedroot"
OWNER = "owner@example.com"
FRIEND = "friend@example.com"


def permission(name, entity, user, **flags):
    return PermissionRow(name=name, entity=entity, user=user, creation="2020-01-01 00:00:00.000000", **flags)


def docshare(name, share_name, **columns):
    columns.setdefault("creation", "2020-01-01 00:00:00.000000")
    return DocShareRow(name=name, share_name=share_name, **columns)


class GrantCase(unittest.TestCase):
    """A Personal root, a Shared root, and one ordinary node under each."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.drive = FakeDrive()
        self.add_root(PERSONAL_ROOT, PERSONAL, OWNER)
        self.add_root(SHARED_ROOT, SHARED, None)
        self.add_node("doc0000001", PERSONAL_ROOT)
        self.legacy = FakeTree(drive=self.drive, users={OWNER: True, FRIEND: True})
        self.report = GrantConversion()

    def add_root(self, node, kind, user):
        self.drive.node_rows[node] = {"name": node, "kind": "root", "root": node, "state": ACTIVE}
        self.drive.root_rows[node] = {"name": node, "node": node, "kind": kind, "user": user}

    def add_node(self, name, root, kind="document", state=ACTIVE):
        self.drive.node_rows[name] = {"name": name, "kind": kind, "root": root, "state": state}
        return name

    def run_grants(self, batch_size=1000, plans=()):
        self.env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        grants_module.convert_grants(self.env, self.report, list(plans), batch_size=batch_size)
        return self.report

    def roles(self, node):
        return self.drive.principals(node)


class RoleTest(GrantCase):
    """§14.5's first table, read through the whole step."""

    def check(self, flags, expected):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, **flags)]
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: expected})

    def test_read_becomes_read(self):
        """`read` only maps to READ."""
        self.check({"read": 1}, READ)

    def test_comment_becomes_comment(self):
        """`comment` maps to COMMENT."""
        self.check({"read": 1, "comment": 1}, COMMENT)

    def test_upload_becomes_upload(self):
        """`upload` maps to UPLOAD, which carries read through the strict ladder."""
        self.check({"read": 1, "upload": 1}, UPLOAD)

    def test_write_becomes_edit(self):
        """`write` maps to EDIT."""
        self.check({"read": 1, "write": 1}, EDIT)

    def test_share_with_write_becomes_manage(self):
        """`share` and `write` together map to MANAGE."""
        self.check({"read": 1, "write": 1, "share": 1}, MANAGE)

    def test_share_without_write_is_ignored(self):
        """§14.5: the highest content flag wins, and `share` is not one."""
        self.check({"read": 1, "share": 1}, READ)

    def test_a_deny_becomes_a_total_deny(self):
        """`deny = 1` maps to NONE whatever else the row says."""
        self.check({"read": 1, "write": 1, "deny": 1}, NONE)

    def test_a_row_with_no_flags_is_dropped(self):
        """It grants nothing, so it becomes nothing."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["no_flags"], 1)

    def test_a_grant_on_a_trashed_node_is_kept(self):
        """§14.5: "Grants on Trashed nodes are kept"."""
        self.add_node("trashed001", PERSONAL_ROOT, state="Trashed")
        self.legacy.permissions_rows = [permission("p1", "trashed001", FRIEND, read=1)]
        self.run_grants()
        self.assertEqual(self.roles("trashed001"), {FRIEND: READ})


class CollapseTest(GrantCase):
    """Duplicate `(entity, user)` rows collapse before anything is mapped."""

    def test_duplicates_union_their_flags_then_map(self):
        """A `read + share` row and a `write` row make MANAGE, not EDIT.

        Mapping first would give EDIT, because neither row maps above it.
        `dedupe_drive_permissions.py` unions the flags, and the union has
        `share` and `write` in it.
        """
        self.legacy.permissions_rows = [
            permission("p1", "doc0000001", FRIEND, read=1, share=1),
            permission("p2", "doc0000001", FRIEND, write=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: MANAGE})
        self.assertEqual(report.permission_rows_seen, 2)
        self.assertEqual(report.permission_pairs, 1)

    def test_a_deny_beats_a_grant_and_takes_no_flags_from_it(self):
        """The patch keeps the deny row and unions same-polarity rows only."""
        self.legacy.permissions_rows = [
            permission("p1", "doc0000001", FRIEND, write=1),
            permission("p2", "doc0000001", FRIEND, deny=1),
        ]
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: NONE})

    def test_a_pair_split_across_pages_still_collapses_once(self):
        """The open pair is carried over the page boundary, not re-read."""
        self.legacy.permissions_rows = [
            permission("p1", "doc0000001", FRIEND, read=1, share=1),
            permission("p2", "doc0000001", FRIEND, write=1),
            permission("p3", "doc0000001", FRIEND, read=1),
        ]
        report = self.run_grants(batch_size=2)
        self.assertEqual(self.roles("doc0000001"), {FRIEND: MANAGE})
        self.assertEqual(report.permission_pairs, 1)


class PrincipalTest(GrantCase):
    """§4.4 spellings, and the rows that name a principal which is gone."""

    def test_a_general_row_becomes_a_general_grant(self):
        """`$GENERAL` is every signed-in user."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "$GENERAL", read=1)]
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {"$GENERAL": READ})

    def test_a_group_row_becomes_a_group_grant(self):
        self.legacy.groups.add("Design")
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "$GROUP:Design", write=1)]
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {"$GROUP:Design": EDIT})

    def test_a_missing_group_is_dropped_and_counted(self):
        """§14.5 drops rows naming a User Group that no longer exists."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "$GROUP:Gone", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_missing_user_is_dropped_and_counted(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "gone@example.com", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_disabled_user_keeps_the_grant(self):
        """A disabled account still exists. Re-enabling it must not lose access."""
        self.legacy.users["asleep@example.com"] = False
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "asleep@example.com", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {"asleep@example.com": READ})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 0)

    def test_a_padded_address_grants_the_stripped_user(self):
        """Live rows hold a trailing space in `user`, and the account is enabled.

        §14.5 drops rows "naming a User or User Group that no longer
        exists". This one names somebody who does, so the padding comes off
        and the grant is written for the address the `User` row holds.
        """
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND + " ", read=1, write=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: EDIT})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 0)

    def test_a_leading_space_is_stripped_too(self):
        """The column never trimmed either end, so neither does Build."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", " " + FRIEND, read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: READ})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 0)

    def test_a_padded_address_for_a_missing_user_is_still_dropped(self):
        """Stripping decides the spelling, not whether the account exists."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", " gone@example.com ", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_whitespace_only_user_is_not_an_anonymous_row(self):
        """`user = ""` is the anonymous row (§14.5). A blank of spaces is not.

        Trimming this one to the empty string would publish the node with a
        `$PUBLIC` grant nobody asked for. It stays unknown, as before.
        """
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "  ", read=1, write=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_padded_sentinel_is_left_as_it_was(self):
        """Padding a sentinel is not an address, so nothing about it changes.

        All four spellings were dropped before the strip and are dropped
        after it: three are unknown, and `$GROUP:Design ` is a group whose
        name, space included, no `User Group` carries.
        """
        self.legacy.groups.add("Design")
        for value in ("$GENERAL ", " $GENERAL", "$GROUP:Design ", " $GROUP:Design"):
            with self.subTest(value=value):
                self.report = GrantConversion()
                self.legacy.permissions_rows = [permission("p1", "doc0000001", value, read=1)]
                report = self.run_grants()
                self.assertEqual(self.roles("doc0000001"), {})
                self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_an_unknown_sentinel_is_dropped(self):
        """A `$`-prefixed value Drive never wrote decides nothing for anybody."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "$NOBODY", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_an_administrator_row_is_dropped(self):
        """The engine takes no non-email user principal, and Administrator needs none.

        `is_drive_admin` gives Administrator every permission without a
        grant, so the row is a dead one either way. `dead_principal` is the
        §14.9 bucket closest to "this principal cannot be represented".
        """
        self.legacy.users["Administrator"] = True
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "Administrator", write=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_guest_row_is_dropped(self):
        """Drive expresses guest access as `user = ""`, never as a named Guest."""
        self.legacy.users["Guest"] = True
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "Guest", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_principal_past_the_column_is_dropped(self):
        """`Drive Grant.principal` is `varchar(200)`. A cut principal is a different one."""
        long_group = "$GROUP:" + "g" * 200
        self.legacy.groups.add("g" * 200)
        self.legacy.permissions_rows = [permission("p1", "doc0000001", long_group, read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 1)

    def test_a_row_on_an_unmigrated_entity_is_dropped(self):
        """Step 5 refused the entity, so there is nothing to hang a grant on."""
        self.legacy.permissions_rows = [permission("p1", "notanode01", FRIEND, read=1)]
        report = self.run_grants()
        self.assertEqual(report.grant_rows_dropped["unmigrated_entity"], 1)


class GuardrailTest(GrantCase):
    """§5.9 refusals 7, 8, and 11 bind Build as well as a Suite Admin."""

    def test_a_public_row_on_a_root_node_is_dropped(self):
        """Refusal 7. A public Personal root would publish a whole namespace."""
        self.legacy.permissions_rows = [permission("p1", PERSONAL_ROOT, "", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles(PERSONAL_ROOT), {})
        self.assertEqual(report.grant_rows_dropped["root_guardrail"], 1)
        self.assertEqual(report.links_minted, 0)

    def test_a_link_row_on_a_root_node_is_dropped(self):
        """Refusal 8. Nothing is minted for a root, whatever the flags say."""
        self.legacy.permissions_rows = [permission("p1", SHARED_ROOT, "", write=1)]
        report = self.run_grants()
        self.assertEqual(self.roles(SHARED_ROOT), {})
        self.assertEqual(report.grant_rows_dropped["root_guardrail"], 1)
        self.assertEqual(report.links_minted, 0)

    def test_a_deny_against_the_personal_root_owner_is_dropped(self):
        """Refusal 11, on a node inside the root as well as on the root itself."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", OWNER, deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(report.grant_rows_dropped["root_guardrail"], 1)

    def test_a_deny_on_the_personal_root_itself_is_dropped(self):
        """§5.9: "the root itself included"."""
        self.legacy.permissions_rows = [permission("p1", PERSONAL_ROOT, OWNER, deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles(PERSONAL_ROOT), {})
        self.assertEqual(report.grant_rows_dropped["root_guardrail"], 1)

    def test_a_deny_against_another_user_is_kept(self):
        """The guardrail is about the root's own user, not about denies."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: NONE})
        self.assertEqual(report.grant_rows_dropped["root_guardrail"], 0)

    def test_a_general_deny_in_the_shared_root_is_legal(self):
        """Refusal 11 names the Personal root's user. `$GENERAL` is not one."""
        self.add_node("shared0001", SHARED_ROOT)
        self.legacy.permissions_rows = [permission("p1", "shared0001", "$GENERAL", deny=1)]
        self.run_grants()
        self.assertEqual(self.roles("shared0001"), {"$GENERAL": NONE})


class AnonymousTest(GrantCase):
    """§14.5's second table: `user = ""` rows become `$PUBLIC` and a link."""

    def test_a_read_row_becomes_one_public_grant(self):
        """Nothing is minted: a read-only public row needs no token."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {"$PUBLIC": READ})
        self.assertEqual(report.links_minted, 0)
        self.assertEqual(report.public_grants_written, 1)

    def test_a_row_above_read_becomes_public_read_plus_a_link(self):
        """§6.5 caps `$PUBLIC` at READ, so the rest rides a link."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1, write=1)]
        report = self.run_grants()
        roles = self.roles("doc0000001")
        self.assertEqual(roles["$PUBLIC"], READ)
        link = [p for p in roles if p.startswith("$LINK:")]
        self.assertEqual(len(link), 1)
        self.assertEqual(roles[link[0]], EDIT)
        self.assertEqual(report.links_minted, 1)
        self.assertEqual(report.link_nodes, ["doc0000001"])

    def test_a_manage_row_clamps_its_link_to_edit(self):
        """§5.9 refusal 9. A MANAGE link would let a token holder purge the node."""
        self.legacy.permissions_rows = [
            permission("p1", "doc0000001", "", read=1, write=1, share=1),
        ]
        report = self.run_grants()
        roles = self.roles("doc0000001")
        link = next(p for p in roles if p.startswith("$LINK:"))
        self.assertEqual(roles[link], EDIT)
        self.assertEqual(report.links_clamped, 1)

    def test_a_comment_row_mints_a_comment_link(self):
        """The link sits at the mapped level, not at a fixed one."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1, comment=1)]
        self.run_grants()
        roles = self.roles("doc0000001")
        link = next(p for p in roles if p.startswith("$LINK:"))
        self.assertEqual(roles[link], COMMENT)

    def test_an_anonymous_deny_becomes_one_public_deny(self):
        """A link at role 0 would hand out a URL that opens nothing."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {"$PUBLIC": NONE})
        self.assertEqual(report.links_minted, 0)

    def test_a_forced_public_composite_row_is_dropped(self):
        """`presentation.py` writes it for every composite deck, so it is not a choice."""
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("deck000001"), {})
        self.assertEqual(report.composite_rows_dropped, 1)
        self.assertEqual(report.links_minted, 0)

    def test_a_public_deny_on_a_composite_deck_is_kept(self):
        """The forced row is `deny = 0, read = 1`, so a deny is provably not it.

        §6.5 makes a `$PUBLIC` grant on a folder publish everything below
        it, and a nearer deny is what stops that. Dropping the deny would
        publish the deck the site chose to hold back.
        """
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("deck000001"), {"$PUBLIC": NONE})
        self.assertEqual(report.composite_rows_dropped, 0)

    def test_a_public_write_row_on_a_composite_deck_is_mapped(self):
        """`presentation.py` only ever sets `read`, so a wider row is somebody's choice."""
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", read=1, write=1)]
        report = self.run_grants()
        roles = self.roles("deck000001")
        self.assertEqual(roles["$PUBLIC"], READ)
        self.assertEqual(report.composite_rows_dropped, 0)
        self.assertEqual(report.links_minted, 1)

    def test_a_real_token_is_22_base62_characters(self):
        """§3.3: about 128 bits of entropy."""
        import string

        env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        env.make_token = None
        token = env.new_token()
        self.assertEqual(len(token), 22)
        self.assertTrue(set(token) <= set(string.ascii_letters + string.digits))
        self.assertNotEqual(token, env.new_token())

    def test_the_state_file_never_holds_a_token(self):
        """A migration record on disk is not the place for a live secret."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1, write=1)]
        self.run_grants()
        stored = (self.path / "drive-build-state.json").read_text()
        self.assertNotIn("$LINK:", stored)
        self.assertIn("doc0000001", json.loads(stored)["grants"]["link_nodes"])


class DocShareTest(GrantCase):
    """§14.5: Sheet `DocShare` rows become grants on the sheet's node."""

    def setUp(self):
        super().setUp()
        self.add_node("sheetnode1", PERSONAL_ROOT)
        self.legacy.sheets["sheet-1"] = "sheetnode1"

    def test_read_becomes_read(self):
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: READ})

    def test_write_becomes_edit(self):
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1, write=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: EDIT})

    def test_the_everyone_row_becomes_general(self):
        """`everyone` meant every signed-in user, which is `$GENERAL`."""
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", everyone=1, read=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {"$GENERAL": READ})

    def test_a_row_for_a_missing_user_is_dropped(self):
        """[011 §11]: dropped and counted."""
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user="gone@example.com", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {})
        self.assertEqual(report.docshare_rows_dropped, 1)
        self.assertEqual(report.docshare_dropped_by_reason["dead_principal"], 1)

    def test_a_row_for_an_unmigrated_sheet_is_dropped(self):
        self.legacy.docshare_rows = [docshare("d1", "sheet-gone", user=FRIEND, read=1)]
        report = self.run_grants()
        self.assertEqual(report.docshare_dropped_by_reason["unmigrated_entity"], 1)

    def test_a_row_with_no_flags_is_dropped(self):
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND)]
        report = self.run_grants()
        self.assertEqual(report.docshare_dropped_by_reason["no_flags"], 1)

    def test_a_dropped_docshare_row_is_counted_once(self):
        """§14.9 prints the two drop totals separately, so neither may borrow the other."""
        long_user = "u" * 200 + "@example.com"
        self.legacy.users[long_user] = True
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=long_user, read=1)]
        report = self.run_grants()
        self.assertEqual(report.docshare_dropped_by_reason["dead_principal"], 1)
        self.assertEqual(report.docshare_rows_dropped, 1)
        self.assertEqual(report.grant_rows_dropped["dead_principal"], 0)

    def test_share_is_carried_for_the_journal_and_ignored_by_the_mapping(self):
        """§14.5's DocShare table has no `share` row, and Sheets never wrote one.

        `suite/sheets/api.py` passes `share=0`. The mapping reads `read` and
        `write` and nothing else, so a stray `share` on a site cannot raise
        anybody. The column is still carried, because the row is deleted and
        §14.11 restores it from the journal, not from the mapping.
        """
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1, share=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: READ})
        self.assertEqual(self.env.docshare_journal.preimage("d1")["share"], 1)

    def test_two_sources_on_one_pair_make_one_row(self):
        """`(node, principal)` is unique, so the higher of the two wins."""
        self.legacy.permissions_rows = [permission("p1", "sheetnode1", FRIEND, read=1)]
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1, write=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: EDIT})

    def test_a_deny_beats_a_docshare_grant(self):
        """A stored deny is role 0, so a plain max would silently promote it."""
        self.legacy.permissions_rows = [permission("p1", "sheetnode1", FRIEND, deny=1)]
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1, write=1)]
        self.run_grants()
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: NONE})


class CacheTest(GrantCase):
    """The same addresses repeat across a permission table. Read them once."""

    def test_a_user_is_looked_up_once_however_many_rows_name_them(self):
        """Without this, a colleague on ten thousand nodes is ten thousand reads."""
        calls = []
        real = self.legacy.user_enabled
        self.legacy.user_enabled = lambda email: (calls.append(email), real(email))[1]
        for index in range(5):
            self.add_node(f"node{index:06d}", PERSONAL_ROOT)
        self.legacy.permissions_rows = [
            permission(f"p{index}", f"node{index:06d}", FRIEND, read=1) for index in range(5)
        ]
        self.run_grants()
        self.assertEqual(calls, [FRIEND])
        self.assertEqual(len(self.drive.grant_rows), 5)


class SharedFloorTest(GrantCase):
    """§3.2: an Active Shared root pair carries a `$GENERAL` anchor."""

    def test_a_shared_root_with_no_general_row_gets_a_read_floor(self):
        """A root with no anchor at all would leave the space unreachable."""
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles(SHARED_ROOT), {"$GENERAL": READ})
        self.assertEqual(report.shared_anchors_written, 1)

    def test_a_migrated_general_row_is_kept_as_it_mapped(self):
        """§14.5: the fresh-site UPLOAD anchor is not forced on a migrated site."""
        self.legacy.permissions_rows = [permission("p1", SHARED_ROOT, "$GENERAL", read=1, upload=1)]
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles(SHARED_ROOT), {"$GENERAL": UPLOAD})
        self.assertEqual(report.shared_anchors_written, 0)

    def test_a_general_deny_on_the_shared_root_is_not_overwritten(self):
        """A site that shut its Shared space stays shut."""
        self.legacy.permissions_rows = [permission("p1", SHARED_ROOT, "$GENERAL", deny=1)]
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles(SHARED_ROOT), {"$GENERAL": NONE})
        self.assertEqual(report.shared_anchors_written, 0)

    def test_an_archived_shared_root_gets_no_floor(self):
        """Nothing is meant to reach it."""
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ARCHIVED)])
        self.assertEqual(self.roles(SHARED_ROOT), {})
        self.assertEqual(report.shared_anchors_written, 0)

    def test_a_personal_root_gets_no_general_floor(self):
        """Its anchor is the owner's MANAGE grant, written with the pair."""
        report = self.run_grants(plans=[RootPlan(PERSONAL_ROOT, PERSONAL, OWNER, "Personal", ACTIVE)])
        self.assertEqual(self.roles(PERSONAL_ROOT), {})
        self.assertEqual(report.shared_anchors_written, 0)


class RowShapeTest(GrantCase):
    """§3.3's columns, and the two §14.5 says are always NULL."""

    def test_a_grant_carries_no_expiry_and_no_password(self):
        """A legacy row set neither, so inventing either would change access."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        self.run_grants()
        stored = next(iter(self.drive.grant_rows.values()))
        self.assertIsNone(stored["expires_on"])
        self.assertIsNone(stored["password_hash"])

    def test_a_grant_is_stamped_with_the_build_clock(self):
        """Build authored this row. It did not copy it from anywhere."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        self.run_grants()
        stored = next(iter(self.drive.grant_rows.values()))
        self.assertEqual(stored["creation"], BUILD_STAMP)
        self.assertEqual(stored["modified"], BUILD_STAMP)
        self.assertEqual(stored["owner"], "Administrator")
        self.assertEqual(stored["docstatus"], 0)


class RerunTest(GrantCase):
    """§14.2: resumable in batches, and safe to run twice."""

    def test_a_rerun_writes_nothing_twice(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        first = self.run_grants()
        self.assertEqual(first.grants_written, 1)

        self.report = GrantConversion()
        second = self.run_grants()
        self.assertEqual(second.grants_written, 0)
        self.assertEqual(second.grants_already_present, 1)
        self.assertEqual(len(self.drive.grant_rows), 1)

    def test_a_rerun_of_a_padded_address_writes_nothing_twice(self):
        """The stripped principal is what the second run looks up, so it matches."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND + " ", read=1)]
        first = self.run_grants()
        self.assertEqual(first.grants_written, 1)

        self.report = GrantConversion()
        second = self.run_grants()
        self.assertEqual(second.grants_written, 0)
        self.assertEqual(second.grants_already_present, 1)
        self.assertEqual(len(self.drive.grant_rows), 1)

    def test_a_rerun_does_not_mint_a_second_link(self):
        """Two live tokens for one row would be two URLs nobody can revoke together."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1, write=1)]
        self.run_grants()
        first = sorted(self.roles("doc0000001"))

        self.report = GrantConversion()
        second = self.run_grants()
        self.assertEqual(sorted(self.roles("doc0000001")), first)
        self.assertEqual(second.links_minted, 0)

    def test_a_rerun_raises_a_grant_a_kill_left_low(self):
        """A run that died after writing READ finishes the job on the next pass."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1, write=1)]
        self.drive.grant_rows["g1"] = {
            "name": "g1",
            "node": "doc0000001",
            "principal": FRIEND,
            "role": READ,
        }
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: EDIT})

    def test_a_rerun_never_lowers_a_stored_grant(self):
        """Somebody may have raised it by hand after Build ran."""
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        self.drive.grant_rows["g1"] = {
            "name": "g1",
            "node": "doc0000001",
            "principal": FRIEND,
            "role": MANAGE,
        }
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: MANAGE})

    def test_a_stored_deny_survives_a_rerun(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, write=1)]
        self.drive.grant_rows["g1"] = {
            "name": "g1",
            "node": "doc0000001",
            "principal": FRIEND,
            "role": NONE,
        }
        self.run_grants()
        self.assertEqual(self.roles("doc0000001"), {FRIEND: NONE})

    def test_rows_are_committed_per_batch(self):
        self.legacy.permissions_rows = [
            permission(f"p{index}", "doc0000001", f"user{index}@example.com", read=1) for index in range(5)
        ]
        for index in range(5):
            self.legacy.users[f"user{index}@example.com"] = True
        self.run_grants(batch_size=2)
        self.assertGreaterEqual(self.drive.commits, 2)
        self.assertEqual(len(self.roles("doc0000001")), 5)

    def test_the_counters_reach_the_state_file(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        self.run_grants()
        state = BuildState(self.path / "drive-build-state.json")
        self.assertEqual(state.grants().grants_written, 1)

    def test_links_minted_is_cumulative_across_runs(self):
        """Owners were told a URL changed. A rerun must not un-tell them."""
        stored = GrantConversion(links_minted=7, grants_written=99)
        stored.begin_run()
        self.assertEqual(stored.links_minted, 7)
        self.assertEqual(stored.grants_written, 0)

    def test_pending_link_intents_survive_the_start_of_a_rerun(self):
        stored = GrantConversion(links_minted=7, pending_link_nodes=["doc0000001"])
        stored.begin_run()
        self.assertEqual(stored.links_minted, 7)
        self.assertEqual(stored.pending_link_nodes, ["doc0000001"])


class LinkInterruptionTest(GrantCase):
    """The exact auto-flush boundary cannot lose the cumulative link count."""

    def source(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", "", read=1, write=1)]

    def resume_from_disk(self):
        self.report = BuildState(self.path / "drive-build-state.json").grants()
        self.report.begin_run()
        return self.run_grants(batch_size=2)

    def assert_one_accounted_link(self, report):
        roles = self.roles("doc0000001")
        self.assertEqual(roles["$PUBLIC"], READ)
        self.assertEqual(len([principal for principal in roles if principal.startswith("$LINK:")]), 1)
        self.assertEqual(report.links_minted, 1)
        self.assertEqual(report.pending_link_nodes, [])

    def test_a_kill_after_the_write_ahead_record_but_before_insert_retries_once(self):
        class FailingGrantDrive(FakeDrive):
            fail_link_once = True

            def insert_grants(self, rows):
                if self.fail_link_once and any(row["principal"].startswith("$LINK:") for row in rows):
                    self.fail_link_once = False
                    raise InterruptedRun("killed after the link intent")
                return super().insert_grants(rows)

        self.drive = FailingGrantDrive()
        self.add_root(PERSONAL_ROOT, PERSONAL, OWNER)
        self.add_root(SHARED_ROOT, SHARED, None)
        self.add_node("doc0000001", PERSONAL_ROOT)
        self.legacy.drive = self.drive
        self.source()

        with self.assertRaises(InterruptedRun):
            self.run_grants(batch_size=2)
        stored = BuildState(self.path / "drive-build-state.json").grants()
        self.assertEqual(stored.pending_link_nodes, ["doc0000001"])
        self.assertEqual(stored.links_minted, 0)
        self.assertEqual(self.roles("doc0000001"), {})

        self.assert_one_accounted_link(self.resume_from_disk())

    def test_a_failed_write_ahead_save_publishes_nothing_and_retries_once(self):
        class FailingState(BuildState):
            def put_grants(self, grants):
                raise InterruptedRun("the link intent was not durable")

        self.source()
        env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        env.state = FailingState(self.path / "drive-build-state.json")

        with self.assertRaisesRegex(InterruptedRun, "not durable"):
            grants_module.convert_grants(env, self.report, [], batch_size=2)

        self.assertEqual(self.roles("doc0000001"), {})
        self.assertEqual(BuildState(self.path / "drive-build-state.json").grants().links_minted, 0)
        self.assert_one_accounted_link(self.resume_from_disk())

    def test_a_kill_after_insert_but_before_counter_finish_recovers_from_target(self):
        class FailingState(BuildState):
            def __init__(self, path):
                super().__init__(path)
                self.puts = 0

            def put_grants(self, grants):
                self.puts += 1
                if self.puts == 2:
                    raise InterruptedRun("killed after the grant commit")
                return super().put_grants(grants)

        self.source()
        env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        env.state = FailingState(self.path / "drive-build-state.json")
        with self.assertRaises(InterruptedRun):
            grants_module.convert_grants(env, self.report, [], batch_size=2)

        stored = BuildState(self.path / "drive-build-state.json").grants()
        self.assertEqual(stored.pending_link_nodes, ["doc0000001"])
        self.assertEqual(stored.links_minted, 0)
        self.assertEqual(len([p for p in self.roles("doc0000001") if p.startswith("$LINK:")]), 1)

        self.assert_one_accounted_link(self.resume_from_disk())

    def test_a_failed_recovery_save_leaves_the_intent_for_the_next_rerun(self):
        class FailingState(BuildState):
            def put_grants(self, grants):
                raise InterruptedRun("the recovered count was not durable")

        self.source()
        state = BuildState(self.path / "drive-build-state.json")
        state.put_grants(GrantConversion(pending_link_nodes=["doc0000001"]))
        self.drive.grant_rows["link-row"] = {
            "name": "link-row",
            "node": "doc0000001",
            "principal": "$LINK:already-committed",
            "role": EDIT,
        }
        self.report = state.grants()
        env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        env.state = FailingState(state.path)

        with self.assertRaisesRegex(InterruptedRun, "recovered count"):
            grants_module.convert_grants(env, self.report, [], batch_size=2)

        stored = state.grants()
        self.assertEqual(stored.links_minted, 0)
        self.assertEqual(stored.pending_link_nodes, ["doc0000001"])
        self.assert_one_accounted_link(self.resume_from_disk())


class StallTest(GrantCase):
    """A cursor that does not move is a loop, not a slow run."""

    def test_the_permission_cursor_refuses_to_loop(self):
        class Stuck(FakeTree):
            def permissions(self, after, limit):
                return [permission("p1", "doc0000001", FRIEND, read=1)]

        self.legacy = Stuck(drive=self.drive, users={OWNER: True, FRIEND: True})
        with self.assertRaises(RuntimeError) as caught:
            self.run_grants(batch_size=1)
        self.assertIn("stalled", str(caught.exception))

    def test_the_docshare_cursor_refuses_to_loop(self):
        class Stuck(FakeTree):
            def docshares(self, after, limit):
                return [docshare("d1", "sheet-1", user=FRIEND, read=1)]

        self.legacy = Stuck(drive=self.drive, users={OWNER: True, FRIEND: True})
        with self.assertRaises(RuntimeError) as caught:
            self.run_grants(batch_size=1)
        self.assertIn("stalled", str(caught.exception))


class SourceTest(GrantCase):
    """§14.2: Build preserves every migration source table but one row kind."""

    def setUp(self):
        super().setUp()
        self.add_node("sheetnode1", PERSONAL_ROOT)
        self.legacy.sheets["sheet-1"] = "sheetnode1"

    def test_the_permission_rows_are_untouched(self):
        self.legacy.permissions_rows = [permission("p1", "doc0000001", FRIEND, read=1)]
        before = list(self.legacy.permissions_rows)
        self.run_grants()
        self.assertEqual(self.legacy.permissions_rows, before)

    def test_a_rewritten_docshare_is_journaled_and_then_deleted(self):
        """§5.13: a share on a governed doctype fails every non-admin read.

        The grant is written and the row that produced it goes, with its
        full column set published first so §14.11 can put it back.
        """
        row = docshare("d1", "sheet-1", user=FRIEND, read=1, write=1, owner=OWNER)
        self.legacy.docshare_rows = [row]

        report = self.run_grants()

        self.assertEqual(self.roles("sheetnode1"), {FRIEND: EDIT})
        self.assertEqual(self.legacy.docshare_rows, [])
        self.assertEqual(self.drive.docshares_deleted, ["d1"])
        self.assertEqual(report.docshare_rows_deleted, 1)
        self.assertEqual(self.env.docshare_journal.preimage("d1"), row.preimage())

    def test_a_dropped_docshare_is_journaled_and_deleted_too(self):
        """A row that decided nothing still refuses the list it sits on."""
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user="gone@example.com", read=1)]

        report = self.run_grants()

        self.assertEqual(report.docshare_rows_dropped, 1)
        self.assertEqual(report.docshare_rows_deleted, 1)
        self.assertEqual(self.legacy.docshare_rows, [])
        self.assertIsNotNone(self.env.docshare_journal.preimage("d1"))

    def test_a_rerun_finds_no_rows_left_and_counts_none(self):
        """Data-derived, so the second pass is one empty page read."""
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1)]
        first = self.run_grants()
        self.assertEqual(first.docshare_rows_deleted, 1)

        self.report = GrantConversion()
        second = self.run_grants()

        self.assertEqual(second.docshare_rows_seen, 0)
        self.assertEqual(second.docshare_rows_deleted, 0)
        self.assertEqual(self.roles("sheetnode1"), {FRIEND: READ})

    def test_a_completed_record_still_deletes_a_row_that_is_still_there(self):
        """§14.2 lets a rerun skip a complete record; this work is not skipped.

        `run_build` calls step 6 on every pass and the loop is driven by the
        rows themselves, so a site whose Build finished before the delete
        existed still loses its leftover rows on the next migrate.
        """
        self.report.completed = True
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1)]

        report = self.run_grants()

        self.assertEqual(report.docshare_rows_deleted, 1)
        self.assertEqual(self.legacy.docshare_rows, [])

    def test_a_kill_before_the_commit_keeps_the_row_and_its_preimage(self):
        """The journal is the write-ahead side; the delete is not published."""
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1)]
        self.drive.fail_pair = None
        self.env = build_environment(self.path, tree=self.legacy, drive=self.drive)
        self.drive.commit()
        self.env.drive.delete_docshare("d1")
        self.assertEqual(self.legacy.docshare_rows, [])

        self.drive.rollback()

        self.assertEqual([row.name for row in self.legacy.docshare_rows], ["d1"])


if __name__ == "__main__":
    unittest.main()
