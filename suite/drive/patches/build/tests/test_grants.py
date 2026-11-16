"""§14.2 step 6 and §14.5: `Drive Permission` and Sheet `DocShare` mapping.

The mapping tables themselves are pinned in `test_mapping`. These tests are
about what happens around them: which rows are dropped, which become two
grants, what the guardrails refuse, and what a second run does.

`FakeDrive` carries the real unique index on `(node, principal)`, so a
duplicate insert raises here the way it would on a site.
"""

import json
import random
import tempfile
import unittest
from pathlib import Path
from typing import ClassVar

import frappe

from suite.drive._core import access
from suite.drive._core.access import chain_ids
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD
from suite.drive.framework import principals_for
from suite.drive.patches.build import grants as grants_module
from suite.drive.patches.build import kept_rights
from suite.drive.patches.build.ports import ACTIVE, DocShareRow, PermissionRow
from suite.drive.patches.build.root_pairs import ARCHIVED, PERSONAL, SHARED, RootPlan
from suite.drive.patches.build.state import BuildState, GrantConversion, KeptRightsPlanError
from suite.drive.patches.build.tests.fakes import (
    BUILD_STAMP,
    Counter,
    FakeDocShareJournal,
    FakeDrive,
    FakeTree,
    InterruptedRun,
    build_environment,
)
from suite.drive.patches.database_marker import ForeignRecordError, refuse_foreign_record, stamp_record

PERSONAL_ROOT = "personal01"
SHARED_ROOT = "sharedroot"
OWNER = "owner@example.com"
FRIEND = "friend@example.com"
ADMIN = "admin@example.com"


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
        The legacy dedupe rule Build reproduces unions the flags, and the
        union has `share` and `write` in it.
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

    def test_a_composite_read_row_is_dropped_when_the_deck_was_not_public(self):
        # `presentation.py` writes it for every composite deck, so it is not a choice
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

    def test_a_composite_read_row_is_mapped_when_the_deck_was_public(self):
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.public_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", read=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("deck000001"), {"$PUBLIC": READ})
        self.assertEqual(report.composite_rows_dropped, 0)
        self.assertEqual(report.links_minted, 0)

    def test_a_public_deny_on_a_public_composite_deck_is_kept(self):
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.public_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("deck000001"), {"$PUBLIC": NONE})
        self.assertEqual(report.composite_rows_dropped, 0)

    def test_a_public_write_row_on_a_public_composite_deck_is_mapped(self):
        self.add_node("deck000001", PERSONAL_ROOT)
        self.legacy.composite_decks.add("deck000001")
        self.legacy.public_decks.add("deck000001")
        self.legacy.permissions_rows = [permission("p1", "deck000001", "", read=1, write=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("deck000001")["$PUBLIC"], READ)
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


class CreatorGrantTest(GrantCase):
    """§4.2's creator rule, applied to legacy owners after every row is mapped.

    Legacy owners held everything without a row. The engine gives a creator
    EDIT when the parent gives less; Build does the same for what they had
    already made, asking the engine for the role rather than re-deriving it.
    """

    def owned(self, name, root, owner, path="", **columns):
        self.drive.node_rows[name] = {
            "name": name,
            "kind": "file",
            "root": root,
            "path": path,
            "state": ACTIVE,
            "owner": owner,
            **columns,
        }
        return name

    def test_an_owner_below_edit_on_their_own_node_gets_edit(self):
        """`$GENERAL` READ on the Shared root leaves the uploader a reader of their own file."""
        self.owned("shared00001", SHARED_ROOT, FRIEND)
        self.legacy.permissions_rows = [permission("p1", SHARED_ROOT, "$GENERAL", read=1)]
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles("shared00001"), {FRIEND: EDIT})
        self.assertEqual((report.owned_nodes_seen, report.creator_grants_minted), (1, 1))

    def test_an_owner_already_at_edit_through_an_ancestor_gets_nothing(self):
        """A `write` row on the folder already answers EDIT below it."""
        self.owned("shared0fold", SHARED_ROOT, FRIEND, kind="folder")
        self.owned("shared00001", SHARED_ROOT, FRIEND, path="/shared0fold")
        self.legacy.permissions_rows = [permission("p1", "shared0fold", FRIEND, read=1, write=1)]
        report = self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles("shared00001"), {})
        self.assertEqual(self.roles("shared0fold"), {FRIEND: EDIT})
        self.assertEqual(report.creator_grants_minted, 0)

    def test_the_personal_root_owner_needs_no_grant_below_their_anchor(self):
        """The anchor is MANAGE, so nothing in the owner's own root is below EDIT."""
        self.drive.grant_rows["anchor"] = {
            "name": "anchor",
            "node": PERSONAL_ROOT,
            "principal": OWNER,
            "role": MANAGE,
        }
        self.owned("person00001", PERSONAL_ROOT, OWNER)
        report = self.run_grants()
        self.assertEqual(self.roles("person00001"), {})
        self.assertEqual(report.creator_grants_minted, 0)

    def test_media_uploaded_into_someone_elses_presentation_follows_the_presentation(self):
        # The uploader holds what the presentation gives them, nothing more
        self.owned("deck0000001", SHARED_ROOT, OWNER, kind="document", content_doctype="Presentation")
        self.owned("writer00001", SHARED_ROOT, OWNER, kind="document", content_doctype="Writer Document")
        self.owned("media000001", SHARED_ROOT, FRIEND, path="/deck0000001", parent_node="deck0000001")
        self.owned("image000001", SHARED_ROOT, FRIEND, path="/writer00001", parent_node="writer00001")
        self.legacy.permissions_rows = [permission("p1", SHARED_ROOT, "$GENERAL", read=1)]
        self.run_grants(plans=[RootPlan(SHARED_ROOT, SHARED, None, "Shared", ACTIVE)])
        self.assertEqual(self.roles("media000001"), {})
        self.assertEqual(self.drive.effective_role(self.drive.node_rows["media000001"], FRIEND), READ)
        self.assertEqual(self.roles("image000001"), {FRIEND: EDIT})

    def test_an_owners_own_read_row_is_raised_to_edit(self):
        """Legacy let owners past their own row; the row moves up rather than doubling."""
        self.owned("shared00001", SHARED_ROOT, FRIEND)
        self.legacy.permissions_rows = [permission("p1", "shared00001", FRIEND, read=1)]
        self.run_grants()
        self.assertEqual(self.roles("shared00001"), {FRIEND: EDIT})
        self.assertEqual(len(self.drive.grant_rows), 1)

    def test_a_deny_on_the_owner_is_overridden_and_counted(self):
        """An owner never ends below EDIT on their own node, so their deny moves up and is reported."""
        self.owned("shared00001", SHARED_ROOT, FRIEND)
        self.legacy.permissions_rows = [permission("p1", "shared00001", FRIEND, deny=1)]
        report = self.run_grants()
        self.assertEqual(self.roles("shared00001"), {FRIEND: EDIT})
        self.assertEqual(len(self.drive.grant_rows), 1)
        self.assertEqual((report.creator_grants_minted, report.creator_denies_overridden), (0, 1))

        self.report.begin_run()
        second = self.run_grants()
        self.assertEqual(second.creator_denies_overridden, 1)
        self.assertEqual(self.roles("shared00001"), {FRIEND: EDIT})

    def test_a_deny_on_someone_other_than_the_owner_stays_a_deny(self):
        """§14.5's "deny wins" still holds for everyone but the owner."""
        self.owned("shared00001", SHARED_ROOT, FRIEND)
        self.legacy.permissions_rows = [permission("p1", "shared00001", OWNER, deny=1)]
        self.run_grants()
        self.assertEqual(self.roles("shared00001"), {OWNER: NONE, FRIEND: EDIT})

    def test_administrator_guest_and_root_nodes_are_left_alone(self):
        self.owned("shared00001", SHARED_ROOT, "Administrator")
        self.owned("shared00002", SHARED_ROOT, "Guest")
        self.drive.node_rows[SHARED_ROOT]["owner"] = FRIEND
        report = self.run_grants()
        self.assertEqual(self.drive.grant_rows, {})
        self.assertEqual((report.owned_nodes_seen, report.creator_grants_minted), (0, 0))

    def test_a_dead_owner_is_counted_not_granted(self):
        self.owned("shared00001", SHARED_ROOT, "gone@example.com")
        report = self.run_grants()
        self.assertEqual(self.drive.grant_rows, {})
        self.assertEqual((report.creator_owners_dead, report.creator_grants_minted), (1, 0))

    def test_a_rerun_keeps_the_count_and_writes_nothing_twice(self):
        self.owned("shared00001", SHARED_ROOT, FRIEND)
        first = self.run_grants()
        self.assertEqual(first.creator_grants_minted, 1)

        self.report.begin_run()
        second = self.run_grants()
        self.assertEqual(second.creator_grants_minted, 1)
        self.assertEqual(second.grants_written, 0)
        self.assertEqual(len(self.drive.grant_rows), 1)

    def test_owners_are_paged_in_batches(self):
        for index in range(5):
            self.owned(f"shared0000{index}", SHARED_ROOT, FRIEND)
        report = self.run_grants(batch_size=2)
        self.assertEqual(report.creator_grants_minted, 5)
        self.assertEqual(len(self.drive.grant_rows), 5)


class KeptRightsTest(GrantCase):
    """§14.5 Kept rights: nobody ends with less than legacy merged for them, nor more from this pass.

    Each expectation is the role legacy gave, worked out by hand from its
    rule: every flag comes from the nearest row that sets it, and inside one
    folder a person's own row comes before their group's, then `$GENERAL`,
    then the public row, a deny before a grant within one tier. Nothing
    shows without read, and `write` is EDIT. The answer is read from the
    engine itself.

    The tree: Shared root > `folderupper` > `folderlower` > `filelower1`.
    """

    NODES = ("folderupper", "folderlower", "filelower1")
    OTHER = "other@example.com"

    def setUp(self):
        super().setUp()
        self.add_tree_node("folderupper", "", kind="folder")
        self.add_tree_node("folderlower", "/folderupper", kind="folder")
        self.add_tree_node("filelower1", "/folderupper/folderlower")
        self.legacy.users[self.OTHER] = True
        self.legacy.groups.update({"Design", "Ops"})
        self.legacy.members["Design"] = {FRIEND}
        # One journal across runs, as on a site: a rerun reads back the
        # `DocShare` rows the first run deleted.
        self.journal = FakeDocShareJournal()
        # One id source across runs, as on a site: a rerun's new grant rows
        # must not reuse the names of rows an earlier run committed.
        self.ids = Counter("kept")

    def run_grants(self, batch_size=1000, plans=()):
        self.env = build_environment(
            self.path,
            tree=self.legacy,
            drive=self.drive,
            docshare_journal=self.journal,
            make_id=self.ids,
        )
        # As `run_build` does before step 1, so a resume compares the plan's
        # marker with the record's, two real markers, as on a site.
        refuse_foreign_record(self.env.state, self.drive)
        stamp_record(self.env.state, self.drive)
        grants_module.convert_grants(self.env, self.report, list(plans), batch_size=batch_size)
        return self.report

    def add_tree_node(self, name, path, kind="file"):
        parent = path.rsplit("/", 1)[-1] or SHARED_ROOT
        self.drive.node_rows[name] = {
            "name": name,
            "kind": kind,
            "root": SHARED_ROOT,
            "parent_node": parent,
            "path": path,
            "state": ACTIVE,
        }

    def role_of(self, user, node, groups=None):
        """The engine's answer for a signed-in `user` from the stored grants.

        `groups` stands for somebody who is not on the site yet, or who
        joined a group after Build ran.
        """
        if groups is None:
            groups = [group for group, members in self.legacy.members.items() if user in members]
        row = self.drive.node_rows[node]
        chain = chain_ids(row)
        own = (user, *(f"$GROUP:{group}" for group in groups), "$GENERAL")
        principals = Principals(user=user, own=own, open=("$PUBLIC",))
        grants = [frappe._dict(grant) for grant in self.drive.grant_rows.values() if grant["node"] in chain]
        return access._resolve_rows(grants, {name: depth for depth, name in enumerate(chain)}, principals)

    def everyone_on_every_node(self):
        return {
            (user, node): self.role_of(user, node)
            for user in (OWNER, FRIEND, self.OTHER)
            for node in self.NODES
        }

    # -- what legacy merged comes back

    def test_upload_from_a_far_folder_survives_a_nearer_comment_row(self):
        """Upload on the upper folder and comment on the lower one gave upload on both."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "folderlower"), UPLOAD)
        self.assertEqual(self.role_of(FRIEND, "filelower1"), UPLOAD)
        self.assertEqual(report.legacy_rights["kept"], 1)
        self.assertEqual(report.legacy_rights["person_grants"], 1)

    def test_everyones_edit_survives_a_persons_nearer_comment_row(self):
        """`$GENERAL` write above and a person's comment row below gave that person edit."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, write=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), EDIT)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), EDIT)

    def test_a_groups_full_row_survives_the_persons_own_comment_row_beside_it(self):
        """On one folder legacy read the person's comment flags, then took the rest from the group."""
        self.legacy.permissions_rows = [
            permission("p1", "folderlower", "$GROUP:Design", read=1, write=1, share=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), MANAGE)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), NONE)

    def test_everyones_edit_share_on_a_sheet_survives_a_persons_read_share(self):
        """Legacy took the higher of the person's own share and the sheet's `everyone` share."""
        self.legacy.sheets["sheet-1"] = "filelower1"
        self.legacy.docshare_rows = [
            docshare("d1", "sheet-1", user=FRIEND, read=1),
            docshare("d2", "sheet-1", everyone=1, read=1, write=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), EDIT)

    def test_everyones_upload_is_kept_by_one_grant_for_everyone(self):
        """`$GENERAL` upload above and `$GENERAL` comment below gave everyone upload below."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, upload=1),
            permission("p2", "folderlower", "$GENERAL", read=1, comment=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), UPLOAD)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), UPLOAD)
        self.assertEqual(self.role_of("newcomer@example.com", "filelower1", groups=()), UPLOAD)
        self.assertEqual(self.roles("folderlower"), {"$GENERAL": UPLOAD})
        self.assertEqual(report.legacy_rights["group_raises"], 1)

    def test_a_grant_row_beside_a_deny_row_for_the_same_group_still_gives_its_flags(self):
        """Legacy read the two rows one by one: the deny took upload, the grant gave write."""
        self.legacy.permissions_rows = [
            permission("p1", "folderlower", "$GROUP:Design", upload=1, deny=1),
            permission("p2", "folderlower", "$GROUP:Design", read=1, write=1),
            permission("p3", "folderlower", FRIEND, read=1, comment=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), EDIT)

    # -- nobody ends with more than legacy gave

    def test_a_kept_right_does_not_pass_a_public_deny_below_it(self):
        """The file's public row denied upload, so legacy gave comment there, not upload."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
            permission("p3", "filelower1", "", upload=1, deny=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "folderlower"), UPLOAD)
        self.assertEqual(self.role_of(FRIEND, "filelower1"), COMMENT)
        self.assertEqual(report.legacy_rights["pins"], 1)

    def test_a_public_deny_binds_only_people_with_no_grant_of_their_own(self):
        """Legacy took upload from everyone below the public deny; the engine does not (§6.5).

        The friend's own comment row decides them, so they stay at comment.
        Everybody else holds the `$GENERAL` upload grant, which the public
        deny does not bind, so they end at upload where legacy gave read.
        Build does not hold them back. The report counts them for the owner.
        """
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
            permission("p3", "folderlower", "", upload=1, deny=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), COMMENT)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), UPLOAD)
        self.assertEqual(self.role_of(OWNER, "folderlower"), UPLOAD)
        # Owner and other on `folderlower`, the one compared node below the deny.
        self.assertEqual(report.legacy_rights["exceeded"], 2)
        self.assertEqual(report.legacy_rights["exceeded_by_public_deny"], 2)

    def test_a_public_row_is_not_kept_for_signed_in_people(self):
        """§14.5 narrows a public row to `$PUBLIC` READ and a link, on purpose."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "", read=1, write=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), COMMENT)

    def test_a_deny_is_not_reopened(self):
        """§14.5 rounds a deny up to a total deny; the person stays out and is counted."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, write=1),
            permission("p2", "folderlower", FRIEND, upload=1, deny=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), NONE)
        self.assertEqual((report.legacy_rights["kept"], report.legacy_rights["behind_deny"]), (0, 1))

    def test_a_raise_for_everyone_says_no_more_than_legacy_gave_a_newcomer(self):
        """Everyone is in Design today, but `$GENERAL` alone gave read below.

        Raising the `$GENERAL` read grant to edit would serve everyone on
        the site today, and give edit to whoever signs up next. Each person
        gets their own grant instead, and the `$GENERAL` row stays read.
        """
        self.legacy.members["Design"] = {OWNER, FRIEND, self.OTHER}
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GROUP:Design", read=1, write=1),
            permission("p2", "folderlower", "$GENERAL", read=1),
        ]
        report = self.run_grants()
        for user in (OWNER, FRIEND, self.OTHER):
            self.assertEqual(self.role_of(user, "filelower1"), EDIT)
        self.assertEqual(self.role_of("newcomer@example.com", "filelower1", groups=()), READ)
        self.assertEqual(self.roles("folderlower")["$GENERAL"], READ)
        self.assertEqual(report.legacy_rights["person_grants"], 3)
        self.assertEqual(report.legacy_rights["from_groups"], 3)

    def test_a_class_of_members_is_kept_and_the_people_outside_it_are_not(self):
        """Design's edit above reached its two members below, never the owner outside it."""
        self.legacy.members["Design"] = {FRIEND, self.OTHER}
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GROUP:Design", read=1, write=1),
            permission("p2", "folderlower", "$GENERAL", read=1),
        ]
        self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), EDIT)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), EDIT)
        self.assertEqual(self.role_of(OWNER, "filelower1"), READ)

    def tie(self):
        """Design's full row far up; Design and Ops tied on the file; the friend denied write between.

        Legacy: the owner (Design) had edit on the file. The friend (Design
        and Ops) had read and comment there, upload from the far row, and
        no write, which their own deny took: upload.
        """
        self.legacy.members = {"Design": {OWNER, FRIEND}, "Ops": {FRIEND}}
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GROUP:Design", read=1, upload=1, write=1),
            permission("p2", "folderlower", FRIEND, write=1, deny=1),
            permission("p3", "filelower1", "$GROUP:Design", read=1, comment=1),
            permission("p4", "filelower1", "$GROUP:Ops", read=1),
        ]
        return {
            (OWNER, "folderupper"): EDIT,
            (OWNER, "folderlower"): EDIT,
            (OWNER, "filelower1"): EDIT,
            (FRIEND, "folderupper"): EDIT,
            # Legacy gave upload; the friend's own deny row stays a total deny.
            (FRIEND, "folderlower"): NONE,
            (FRIEND, "filelower1"): UPLOAD,
            (self.OTHER, "folderupper"): NONE,
            (self.OTHER, "folderlower"): NONE,
            (self.OTHER, "filelower1"): NONE,
        }

    def test_a_member_of_two_tied_groups_ends_at_their_own_role(self):
        """The friend's own deny sits above the file, so Design is not raised there at all.

        Each member today gets their own grant instead. A newcomer holds
        Design's comment grant on the file, tied with Ops's read: comment.
        Legacy gave a newcomer edit there (read and comment from the file,
        upload and write from the far row). That loss is the counted price
        of not raising a grant past a deny row (`raises_skipped`); a raise
        to edit would also have reached the friend through the tie.
        """
        expected = self.tie()
        report = self.run_grants()
        self.assertEqual(self.everyone_on_every_node(), expected)
        self.assertEqual(self.role_of("newcomer@example.com", "filelower1", groups=("Design",)), COMMENT)
        self.assertEqual(
            self.role_of("newcomer@example.com", "filelower1", groups=("Design", "Ops")), COMMENT
        )
        self.assertEqual(self.roles("filelower1")["$GROUP:Design"], COMMENT)
        self.assertEqual(report.legacy_rights["raises_skipped"], 1)

    def test_a_raise_does_not_pass_a_deny_for_another_group_a_member_may_join(self):
        """Review 2's Scenario A: a Contractors deny above Design's read row.

        The upper folder gives `$GENERAL` read and write, and denies
        Contractors upload and write. The lower folder gives Design read.
        Legacy, on the lower folder: a Design member takes read there and
        write from `$GENERAL` above, so edit. A Contractors member who joins
        Design takes read there, and the Contractors deny above takes write
        and upload before `$GENERAL` can give them: read. A newcomer in both
        groups is the same: read. Raising Design to edit would give both of
        them edit, so the friend gets their own edit grant instead.
        """
        self.legacy.groups.add("Contractors")
        self.legacy.members = {"Design": {FRIEND}, "Contractors": {self.OTHER}}
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, write=1),
            permission("p2", "folderupper", "$GROUP:Contractors", upload=1, write=1, deny=1),
            permission("p3", "folderlower", "$GROUP:Design", read=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "folderlower"), EDIT)
        self.assertEqual(self.role_of(self.OTHER, "folderlower", groups=("Design", "Contractors")), READ)
        self.assertEqual(
            self.role_of("newcomer@example.com", "folderlower", groups=("Design", "Contractors")), READ
        )
        self.assertEqual(self.roles("folderlower")["$GROUP:Design"], READ)
        self.assertEqual(
            {key: report.legacy_rights[key] for key in ("group_raises", "person_grants", "raises_skipped")},
            {"group_raises": 0, "person_grants": 1, "raises_skipped": 1},
        )

    def test_a_share_only_row_on_a_folder_still_gives_its_share_below(self):
        """Review 2's Scenario C: `$GENERAL` share on the upper folder, read, comment and write below.

        Legacy took share from the upper folder and the rest from the lower
        one, so everyone had manage on the lower folder and the file. The
        upper folder showed nothing: no row there gave read. Build drops
        the share-only row (no content flag), so the pass has to see it to
        keep manage.
        """
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", share=1),
            permission("p2", "folderlower", "$GENERAL", read=1, comment=1, write=1),
        ]
        report = self.run_grants()
        for user in (OWNER, FRIEND, self.OTHER):
            self.assertEqual(self.role_of(user, "folderupper"), NONE)
            self.assertEqual(self.role_of(user, "folderlower"), MANAGE)
            self.assertEqual(self.role_of(user, "filelower1"), MANAGE)
        self.assertEqual(self.role_of("newcomer@example.com", "filelower1", groups=()), MANAGE)
        self.assertEqual(report.grant_rows_dropped["no_flags"], 1)
        self.assertEqual(self.roles("folderupper"), {})

    def test_a_raise_for_everyone_from_a_sheets_everyone_share(self):
        """The sheet's `everyone` read share, under a folder where `$GENERAL` could write.

        Legacy took the higher of Drive's flags and the sheet's share:
        Drive gave read and write from the folder, so edit, for everyone,
        including whoever signs up later. The `everyone` share became a
        `$GENERAL` read grant on the sheet, which is nearer, so the pass
        raises that one grant to edit.
        """
        self.legacy.sheets["sheet-1"] = "filelower1"
        self.legacy.permissions_rows = [permission("p1", "folderupper", "$GENERAL", read=1, write=1)]
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", everyone=1, read=1)]
        report = self.run_grants()
        for user in (OWNER, FRIEND, self.OTHER):
            self.assertEqual(self.role_of(user, "filelower1"), EDIT)
        self.assertEqual(self.role_of("newcomer@example.com", "filelower1", groups=()), EDIT)
        self.assertEqual(self.roles("filelower1"), {"$GENERAL": EDIT})
        self.assertEqual(
            (report.legacy_rights["group_raises"], report.legacy_rights["person_grants"]), (1, 0)
        )

    def public_deny_below_a_kept_right(self):
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
            permission("p3", "filelower1", "", upload=1, deny=1),
        ]
        expected = dict.fromkeys(((user, node) for user in (OWNER, self.OTHER) for node in self.NODES), NONE)
        expected.update(
            {
                (FRIEND, "folderupper"): UPLOAD,
                (FRIEND, "folderlower"): UPLOAD,
                (FRIEND, "filelower1"): COMMENT,
            }
        )
        return expected

    def test_a_run_killed_at_any_commit_resumes_to_the_same_roles(self):
        """A kill before or after any commit, then a rerun, ends where one clean run ends.

        The rerun reads back grants the killed run already wrote. Deciding
        again from them would miss a pin the first decision needed and
        leave the friend at edit on the file, so it must not decide again.
        """
        for scenario in (self.tie, self.public_deny_below_a_kept_right):
            self.setUp()
            expected = scenario()
            self.drive.commit()
            self.run_grants(batch_size=1)
            self.assertEqual(self.everyone_on_every_node(), expected)
            commits = self.drive.commits - 1
            for kill in range(1, commits + 1):
                for after_commit in (False, True):
                    with self.subTest(scenario=scenario.__name__, kill=kill, after_commit=after_commit):
                        self.setUp()
                        scenario()
                        self.drive.commit()
                        self.kill_at(kill, after_commit)
                        with self.assertRaises(InterruptedRun):
                            self.run_grants(batch_size=1)
                        self.report = BuildState(self.path / "drive-build-state.json").grants()
                        self.report.begin_run()
                        self.run_grants(batch_size=1)
                        self.assertEqual(self.everyone_on_every_node(), expected)

    def kill_at(self, kill, after_commit):
        """Stop the run at its `kill`-th commit, with or without that commit landing."""
        drive = self.drive
        commit = drive.commit
        seen = 0

        def killing_commit():
            nonlocal seen
            seen += 1
            if seen != kill:
                return commit()
            drive.commit = commit
            if after_commit:
                commit()
            else:
                drive.rollback()
            raise InterruptedRun(f"killed at commit {kill}")

        drive.commit = killing_commit

    def test_a_rerun_writes_nothing_more(self):
        """The second run replays what the first decided: no new rows, the same counts."""
        self.legacy.sheets["sheet-1"] = "filelower1"
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        self.legacy.docshare_rows = [
            docshare("d1", "sheet-1", user=self.OTHER, read=1),
            docshare("d2", "sheet-1", everyone=1, read=1, write=1),
        ]
        first = self.run_grants()
        rows = {key: dict(row) for key, row in self.drive.grant_rows.items()}
        kept = dict(first.legacy_rights)
        self.report = GrantConversion.from_dict(first.as_dict())
        self.report.begin_run()
        second = self.run_grants()
        self.assertEqual(kept["kept"], 2)
        self.assertEqual(second.legacy_rights, kept)
        self.assertEqual(self.drive.grant_rows, rows)
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), EDIT)

    # -- what the report tells the owner

    def test_edit_kept_from_a_write_row_without_upload_is_counted(self):
        """Legacy let the friend edit below but not add files; EDIT adds upload, and the report says so."""
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GROUP:Design", read=1, write=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "filelower1"), EDIT)
        self.assertEqual(report.legacy_rights["upload_added"], 1)

    def test_share_without_write_is_counted_as_lost(self):
        """§14.5's table drops `share` without `write`; legacy let the person share."""
        self.legacy.permissions_rows = [permission("p1", "folderupper", FRIEND, read=1, share=1)]
        report = self.run_grants()
        self.assertEqual(self.role_of(FRIEND, "folderupper"), READ)
        self.assertEqual(report.legacy_rights["share_lost"], 1)

    def test_share_lost_counts_each_node_with_a_row_and_leaves_out_owners_and_admins(self):
        """`$GENERAL` read and share on the upper folder, then a row on each node below.

        Four people: the owner (who owns the upper folder), the friend, the
        other person and a Suite Admin. Legacy gave each of them read and
        share without write wherever they meet a row:

        - upper folder, every person: the friend and the other person count;
          the folder's owner and the admin do not (2);
        - lower folder, only the friend's own row names anyone there (1);
        - file, the public deny names everyone: the owner owns only the
          folder above, so they count here with the friend and the other
          person; the admin does not (3).
        """
        self.legacy.users[ADMIN] = True
        self.legacy.admins = {ADMIN}
        self.drive.node_rows["folderupper"]["owner"] = OWNER
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, share=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
            permission("p3", "filelower1", "", upload=1, deny=1),
        ]
        report = self.run_grants()
        self.assertEqual(report.legacy_rights["share_lost"], 2 + 1 + 3)

    def test_exceeded_counts_each_node_with_a_row_and_leaves_out_owners_and_admins(self):
        """`$GENERAL` read and upload above, and a public upload deny on each node below.

        Legacy took upload from everyone on both lower nodes: read. The
        engine lets the public deny bind only people with no grant of their
        own, and `$GENERAL` is one, so everyone ends at upload there, above
        legacy, because of a public deny. Counted per node: the lower folder
        has the owner, the friend and the other person (3); the file has
        the owner and the other person, since the friend owns it (2). The
        Suite Admin counts on neither.
        """
        self.legacy.users[ADMIN] = True
        self.legacy.admins = {ADMIN}
        self.drive.node_rows["filelower1"]["owner"] = FRIEND
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", "$GENERAL", read=1, upload=1),
            permission("p2", "folderlower", "", upload=1, deny=1),
            permission("p3", "filelower1", "", upload=1, deny=1),
        ]
        report = self.run_grants()
        self.assertEqual(self.role_of(self.OTHER, "filelower1"), UPLOAD)
        self.assertEqual(self.role_of(ADMIN, "folderlower"), UPLOAD)
        self.assertEqual(report.legacy_rights["exceeded"], 3 + 2)
        self.assertEqual(report.legacy_rights["exceeded_by_public_deny"], 3 + 2)

    # -- the saved plan

    def plan_path(self):
        return self.path / "drive-build-kept-rights.json"

    def kept_plan(self):
        self.legacy.permissions_rows = [
            permission("p1", "folderupper", FRIEND, read=1, upload=1),
            permission("p2", "folderlower", FRIEND, read=1, comment=1),
        ]
        first = self.run_grants()
        self.report = GrantConversion.from_dict(first.as_dict())
        self.report.begin_run()

    def test_the_plan_is_readable_by_the_site_account_only(self):
        """It maps who can reach what, so no other local account may read it."""
        self.kept_plan()
        self.assertEqual(self.plan_path().stat().st_mode & 0o777, 0o600)

    def test_a_plan_left_from_another_build_record_is_refused(self):
        """The record was moved aside and stamped anew, but the old plan stayed beside it.

        The old plan names a grant this data would not produce, so replaying
        it would write a row.
        """
        self.kept_plan()
        intruder = "intruder@example.com"
        self.legacy.users[intruder] = True
        plan = {
            "rights": [["folderlower", intruder, EDIT]],
            "counts": {"kept": 1},
            "marker": "another-record",
        }
        self.plan_path().write_text(json.dumps({"plan": plan}))
        rows = {key: dict(row) for key, row in self.drive.grant_rows.items()}
        with self.assertRaises(ForeignRecordError):
            self.run_grants()
        self.assertEqual(self.drive.grant_rows, rows)
        self.assertEqual(self.role_of(intruder, "folderlower"), NONE)

    def test_an_unreadable_plan_stops_the_run_instead_of_deciding_again(self):
        """Deciding again would read grants the first plan may already have raised."""
        broken = {
            "not json": "{",
            "no plan": json.dumps({"version": 1}),
            "a short row": json.dumps({"plan": {"rights": [["folderlower", FRIEND]], "counts": {}}}),
            "a role that is not a number": json.dumps(
                {"plan": {"rights": [["folderlower", FRIEND, "30"]], "counts": {}}}
            ),
        }
        for label, content in broken.items():
            with self.subTest(label):
                self.setUp()
                self.kept_plan()
                self.plan_path().write_text(content)
                with self.assertRaises(KeptRightsPlanError):
                    self.run_grants()
                self.assertEqual(self.plan_path().read_text(), content)


class KeptRightsRuleTest(unittest.TestCase):
    """`kept_rights.rights_to_keep` on inputs Build itself never produces."""

    def test_a_pin_never_denies(self):
        """With no stored grant behind the rows, holding the friend at "nothing" would be a total deny."""
        legacy = kept_rights.LegacyRights()
        legacy.add_row("upper", FRIEND, {"read": 1, "upload": 1})
        legacy.add_row("file", "", {"read": 1, "deny": 1})
        nodes = {
            "upper": {"name": "upper", "kind": "folder", "root": SHARED_ROOT, "path": ""},
            "file": {"name": "file", "kind": "file", "root": SHARED_ROOT, "path": "/upper"},
        }
        result = kept_rights.rights_to_keep(legacy, nodes, {"file": [("$PUBLIC", NONE)]}, {FRIEND: ()})
        self.assertEqual([(right.node, right.role) for right in result.rights], [("upper", UPLOAD)])
        self.assertEqual(result.pins_refused, 1)


class KeptRightsResolutionTest(unittest.TestCase):
    """The pass reads roles the way the engine reads them, on the same stored grants.

    Random grants for two people, two groups, `$GENERAL` and `$PUBLIC` on a
    four-node chain, written to `Drive Grant`, then read back by
    `access.effective_role` with the principals the site builds for each
    person.
    """

    PEOPLE: ClassVar = {
        "kept-a@example.com": ("kept-g1",),
        "kept-b@example.com": ("kept-g1", "kept-g2"),
        "kept-c@example.com": (),
    }

    def setUp(self):
        self.addCleanup(frappe.db.rollback)
        for group in ("kept-g1", "kept-g2"):
            doc = frappe.get_doc(
                {
                    "doctype": "User Group",
                    "name": group,
                    "user_group_members": [
                        {"user": user} for user, groups in self.PEOPLE.items() if group in groups
                    ],
                }
            )
            doc.flags.ignore_links = True
            doc.insert(ignore_permissions=True)

    def test_the_pass_and_the_engine_agree(self):
        rng = random.Random(1242)
        principals = (*self.PEOPLE, "$GROUP:kept-g1", "$GROUP:kept-g2", "$GENERAL", "$PUBLIC")
        roles = (NONE, READ, COMMENT, UPLOAD, EDIT, MANAGE)
        for case in range(150):
            chain = [frappe.generate_hash(length=10) for _ in range(4)]
            stored: dict[str, dict[str, int]] = {}
            for name in chain:
                for principal in rng.sample(principals, rng.randint(0, 3)):
                    stored.setdefault(name, {})[principal] = rng.choice(roles)
            frappe.db.bulk_insert(
                "Drive Grant",
                ["name", "node", "principal", "role"],
                [
                    (frappe.generate_hash(length=12), name, principal, role)
                    for name, held in stored.items()
                    for principal, role in held.items()
                ],
            )
            leaf = {"name": chain[-1], "kind": "file", "root": chain[0], "path": "/" + "/".join(chain[1:-1])}
            for user, groups in self.PEOPLE.items():
                with self.subTest(case=case, user=user):
                    self.assertEqual(
                        kept_rights.resolve(chain, stored, user, groups),
                        access.effective_role(leaf, principals_for(user)),
                    )


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

    def test_deleted_docshare_count_survives_the_start_of_a_rerun(self):
        stored = GrantConversion(docshare_rows_deleted=7)

        stored.begin_run()

        self.assertEqual(stored.docshare_rows_deleted, 7)

    def test_dropped_docshare_breakdown_survives_the_start_of_a_rerun(self):
        stored = GrantConversion(
            docshare_rows_dropped=2,
            docshare_dropped_by_reason={"dead_principal": 2},
        )

        stored.begin_run()

        self.assertEqual(stored.docshare_rows_dropped, 2)
        self.assertEqual(stored.docshare_dropped_by_reason, {"dead_principal": 2})


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

    def test_a_rerun_keeps_the_count_of_docshares_it_deleted(self):
        self.legacy.docshare_rows = [docshare("d1", "sheet-1", user=FRIEND, read=1)]
        first = self.run_grants()
        self.assertEqual(first.docshare_rows_deleted, 1)

        self.report.begin_run()
        second = self.run_grants()

        self.assertEqual(second.docshare_rows_seen, 0)
        self.assertEqual(second.docshare_rows_deleted, 1)
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
