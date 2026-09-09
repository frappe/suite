"""Template folder and document conversion."""

import tempfile
import unittest
from pathlib import Path

from suite.drive._core.roles import EDIT, MANAGE, READ
from suite.drive.patches.build.content import BuildContentError, link_content_documents
from suite.drive.patches.build.content_mapping import InvalidLegacyContent
from suite.drive.patches.build.mapping import GENERAL
from suite.drive.patches.build.ports import ACTIVE, TRASHED, ContentRow, TreeRow, WriterTemplateRow
from suite.drive.patches.build.slides import convert_slides_and_templates
from suite.drive.patches.build.templates import convert_templates
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    InterruptedRun,
    build_environment,
)

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def writer_template(name, title="Template", owner=OWNER, keymap="vim"):
    return WriterTemplateRow(
        name=name,
        title=title,
        content="<p>Exact HTML</p>",
        keymap=keymap,
        owner=owner,
        creation=STAMP,
        modified=STAMP,
        modified_by=owner,
    )


def presentation_template(name, title="Slides", owner=OWNER):
    return ContentRow(
        "Presentation",
        name,
        title=title,
        owner=owner,
        creation=STAMP,
        modified=STAMP,
        modified_by=owner,
        is_template=1,
    )


class TemplateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def environment(self, source):
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
        )
        return env, target

    def admin_root(self, target, name="root-1"):
        """The Administrator Personal Root ticket 27 leaves behind."""
        target.node_rows[name] = {
            "name": name,
            "title": "Administrator",
            "parent": None,
            "root": None,
            "path": "",
            "kind": "root",
            "state": ACTIVE,
        }
        target.root_rows[name] = {
            "name": name,
            "node": name,
            "user": "Administrator",
            "kind": "Personal",
            "state": ACTIVE,
        }
        return name

    def folder_row(self, target, root, name="folder-1", **values):
        row = {
            "name": name,
            "title": "Templates",
            "parent": root,
            "root": root,
            "path": "",
            "kind": "folder",
            "blob": None,
            "size": 0,
            "mime": None,
            "url": None,
            "content_doctype": None,
            "content_docname": None,
            "state": ACTIVE,
            "trashed_at": None,
            "trash_root": None,
            "content_modified": STAMP,
            "is_template": 0,
            "owner": "Administrator",
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": "Administrator",
        }
        row.update(values)
        target.node_rows[name] = row
        return name

    def node_grants(self, target, node):
        return len([row for row in target.grant_rows.values() if row["node"] == node])

    def tree_node(self, target, deck, name="file-1", **values):
        """The document node §14.4 builds from a legacy `File` row."""
        row = {
            "name": name,
            "title": "Deck",
            "parent": "old-folder",
            "root": "old-root",
            "path": "/old-folder/",
            "kind": "document",
            "blob": None,
            "size": 0,
            "mime": "frappe/slides",
            "url": None,
            "content_doctype": "Presentation",
            "content_docname": deck,
            "state": ACTIVE,
            "trashed_at": None,
            "trash_root": None,
            "content_modified": STAMP,
            "is_template": 0,
            "owner": OWNER,
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": OWNER,
        }
        row.update(values)
        target.node_rows[name] = row
        return name

    def test_writer_template_creates_noncollaborative_document_node_and_grants(self):
        source_row = writer_template("writer-template")
        source = FakeContent(writer_templates=[source_row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env)

        self.assertEqual(target.node_rows[folder]["title"], "Templates")
        document = target.writer_rows[source_row.name]
        self.assertEqual(document["content"], "AAA=")
        self.assertEqual(document["html"], source_row.content)
        self.assertEqual(document["settings"], '{"keymap":"vim"}')
        self.assertEqual(document["collab"], 0)
        node = target.node_rows[source_row.name]
        self.assertEqual(node["parent"], folder)
        self.assertEqual(node["mime"], "frappe/writer")
        self.assertEqual(node["is_template"], 1)
        self.assertEqual(target.grant_roles(source_row.name, (GENERAL,))[GENERAL], READ)
        self.assertEqual(target.grant_roles(source_row.name, (OWNER,))[OWNER], MANAGE)
        self.assertEqual(source.writer_template_rows, [source_row])

        convert_templates(env)
        self.assertEqual(len(target.writer_rows), 1)

    def test_administrator_owned_template_has_no_redundant_owner_grant(self):
        row = writer_template("writer-template", owner="Administrator")
        source = FakeContent(writer_templates=[row], users={"Administrator": True})
        env, target = self.environment(source)

        convert_templates(env)

        self.assertEqual(target.grant_roles(row.name, (GENERAL,))[GENERAL], READ)
        self.assertNotIn("Administrator", target.grant_roles(row.name, ("Administrator",)))

    def test_presentation_template_uses_its_source_id_and_gets_linked(self):
        row = presentation_template("deck-template")
        source = FakeContent(documents=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env)

        node = target.node_rows[row.name]
        self.assertEqual(node["parent"], folder)
        self.assertEqual(node["mime"], "frappe/slides")
        self.assertEqual(node["content_docname"], row.name)
        self.assertEqual(source.document_rows[(row.doctype, row.name)].node, row.name)

    def test_duplicate_template_titles_are_deduped_in_source_order(self):
        first = writer_template("writer-a", title="Common")
        second = writer_template("writer-b", title="Common")
        source = FakeContent(
            writer_templates=[second, first],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)

        convert_templates(env)

        self.assertEqual(target.node_rows["writer-a"]["title"], "Common")
        self.assertEqual(target.node_rows["writer-b"]["title"], "Common (2)")
        self.assertEqual(env.state.content().template_title_renames, 1)

    def test_template_nodes_carry_the_folder_child_path(self):
        writer = writer_template("writer-template")
        presentation = presentation_template("deck-template")
        source = FakeContent(
            writer_templates=[writer],
            documents=[presentation],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)

        folder = convert_templates(env)

        # `_core/nodes.child_path` is `f"{path or '/'}{name}/"`. Without the
        # leading slash `_check_tree_position` refuses the node on every
        # later save, move, restore, or copy.
        self.assertEqual(target.node_rows[folder]["path"], "")
        for name in ("writer-template", "deck-template"):
            self.assertEqual(target.node_rows[name]["path"], f"/{folder}/")
            self.assertEqual(target.node_rows[name]["root"], target.node_rows[folder]["root"])

    def test_case_only_templates_folder_collision_is_refused(self):
        source = FakeContent(users={"Administrator": True})
        env, target = self.environment(source)
        target.node_rows["id1"] = {
            "name": "id1",
            "kind": "root",
            "state": "Active",
        }
        target.root_rows["id1"] = {
            "name": "id1",
            "node": "id1",
            "kind": "Personal",
            "user": "Administrator",
            "state": "Active",
        }
        target.node_rows["collision"] = {
            "name": "collision",
            "title": "templates",
            "parent": "id1",
            "state": "Active",
        }

        with self.assertRaisesRegex(InvalidLegacyContent, "ambiguous Templates"):
            convert_templates(env)

    def test_template_logical_unit_rolls_back_after_interruption(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.fail_unit = row.name

        with self.assertRaises(InterruptedRun):
            convert_templates(env)
        self.assertNotIn(row.name, target.writer_rows)
        self.assertNotIn(row.name, target.node_rows)
        self.assertFalse(target.grant_roles(row.name, (GENERAL, OWNER)))

    def test_missing_non_administrator_owner_is_refused(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True})
        env, _ = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "has no User row"):
            convert_templates(env)

    # -- canonical position

    def test_template_nodes_carry_the_canonical_child_path(self):
        """`drive_node.py:80` recomputes a child path from its parent on save.

        A path with no leading slash makes `_validate_chain` throw, and makes
        the `path LIKE CONCAT('%/', node, '/%')` ancestor-grant and
        `revoke_below` queries skip every template node.
        """
        writer = writer_template("writer-template")
        deck = presentation_template("deck-template")
        source = FakeContent(
            writer_templates=[writer],
            documents=[deck],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)

        folder = convert_templates(env)

        root = target.node_rows[folder]["root"]
        self.assertEqual(target.node_rows[folder]["path"], "")
        self.assertEqual(target.node_rows["writer-template"]["path"], f"/{folder}/")
        self.assertEqual(target.node_rows["deck-template"]["path"], f"/{folder}/")
        self.assertEqual(target.node_rows["writer-template"]["root"], root)
        self.assertEqual(target.node_rows["deck-template"]["root"], root)

    # -- the Templates folder

    def test_an_exact_templates_folder_is_reused(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        root = self.admin_root(target)
        existing = self.folder_row(target, root)

        folder = convert_templates(env)

        self.assertEqual(folder, existing)
        self.assertEqual(target.node_rows["writer-template"]["parent"], existing)

    def test_a_trashed_templates_folder_does_not_block_a_new_active_one(self):
        """Plan §10: active sibling uniqueness ignores Trashed nodes."""
        source = FakeContent(
            writer_templates=[writer_template("writer-template")], users={"Administrator": True, OWNER: True}
        )
        env, target = self.environment(source)
        root = self.admin_root(target)
        self.folder_row(target, root, name="old", state=TRASHED)

        folder = convert_templates(env)

        self.assertNotEqual(folder, "old")
        self.assertEqual(target.node_rows["old"]["state"], TRASHED)
        self.assertEqual(target.node_rows[folder]["state"], ACTIVE)

    def test_duplicate_active_templates_folders_are_refused(self):
        source = FakeContent(users={"Administrator": True})
        env, target = self.environment(source)
        root = self.admin_root(target)
        self.folder_row(target, root, name="one")
        self.folder_row(target, root, name="two")

        with self.assertRaisesRegex(InvalidLegacyContent, "ambiguous Templates"):
            convert_templates(env)

    def test_a_non_folder_named_templates_is_refused(self):
        """Plan §10: refuse a file, link, document, or root with that title."""
        source = FakeContent(users={"Administrator": True})
        env, target = self.environment(source)
        root = self.admin_root(target)
        self.folder_row(target, root, kind="file")

        with self.assertRaisesRegex(InvalidLegacyContent, "Templates folder field kind"):
            convert_templates(env)

    def test_a_templates_folder_in_the_wrong_position_is_refused(self):
        source = FakeContent(users={"Administrator": True})
        env, target = self.environment(source)
        root = self.admin_root(target)
        self.folder_row(target, root)
        target.node_rows["folder-1"]["root"] = "elsewhere"

        with self.assertRaisesRegex(InvalidLegacyContent, "Templates folder field root"):
            convert_templates(env)

    def test_the_templates_folder_receives_no_general_grant(self):
        """Plan §10 and memo §7: the folder itself gets no `$GENERAL` grant."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env)

        self.assertEqual(target.grant_roles(folder, (GENERAL, OWNER, "Administrator")), {})

    # -- collisions

    def test_an_unrelated_node_holding_a_writer_template_id_is_refused(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.node_rows[row.name] = {"name": row.name, "title": "Unrelated", "kind": "folder"}

        with self.assertRaisesRegex(InvalidLegacyContent, "Writer template node writer-template field"):
            convert_templates(env)

    def test_an_unrelated_node_holding_a_presentation_template_id_is_refused(self):
        row = presentation_template("deck-template")
        source = FakeContent(documents=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.node_rows[row.name] = {"name": row.name, "title": "Unrelated", "kind": "folder"}

        with self.assertRaisesRegex(InvalidLegacyContent, "Presentation template node deck-template field"):
            convert_templates(env)

    def test_a_mismatched_writer_document_collision_is_refused(self):
        """Memo §9: refuse any mismatched Writer Document, never mint another id."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.writer_rows[row.name] = {
            "name": row.name,
            "node": row.name,
            "content": "AAA=",
            "html": "<p>Somebody else wrote this</p>",
            "settings": '{"keymap":"vim"}',
            "collab": 0,
            "owner": OWNER,
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": OWNER,
        }

        with self.assertRaisesRegex(
            InvalidLegacyContent, "Writer template document writer-template field html"
        ):
            convert_templates(env)

    def stored_writer_document(self, target, row, **values):
        document = {
            "name": row.name,
            "node": row.name,
            "content": "AAA=",
            "html": row.content or "",
            "settings": '{"keymap":"vim"}',
            "collab": 0,
            "owner": row.owner,
            "creation": row.creation,
            "modified": row.modified,
            "modified_by": row.modified_by,
        }
        document.update(values)
        target.writer_rows[row.name] = document
        return document

    def test_a_blank_writer_document_link_is_repaired_on_a_rerun(self):
        """Plan §10: repair a blank reciprocal link, the way the deck path does."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        self.stored_writer_document(target, row, node=None)

        convert_templates(env)

        self.assertEqual(target.writer_rows[row.name]["node"], row.name)

    def test_a_writer_document_linking_another_node_is_refused(self):
        """A wrong link is a collision, not a half-written row."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        self.stored_writer_document(target, row, node="somebody-else")

        with self.assertRaisesRegex(
            InvalidLegacyContent, "Writer template document writer-template field node"
        ):
            convert_templates(env)

    def test_a_blank_link_is_repaired_only_after_the_whole_row_matches(self):
        """The repair must not bless a document whose body is somebody else's."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        self.stored_writer_document(target, row, node=None, html="<p>Somebody else wrote this</p>")

        with self.assertRaisesRegex(
            InvalidLegacyContent, "Writer template document writer-template field html"
        ):
            convert_templates(env)

        self.assertIsNone(target.writer_rows[row.name]["node"])

    def test_a_mismatched_existing_template_grant_is_refused(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.grant_rows["stale"] = {
            "name": "stale",
            "node": row.name,
            "principal": GENERAL,
            "role": EDIT,
        }

        with self.assertRaisesRegex(InvalidLegacyContent, "conflicting"):
            convert_templates(env)

    # -- source shapes

    def test_a_presentation_template_without_a_title_uses_its_source_id(self):
        """`Presentation.title` is `reqd=0`, so NULL is a real source value."""
        row = ContentRow(
            "Presentation",
            "deck-template",
            title=None,
            owner=OWNER,
            creation=STAMP,
            modified=STAMP,
            modified_by=OWNER,
            is_template=1,
        )
        source = FakeContent(documents=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        convert_templates(env)

        self.assertEqual(target.node_rows["deck-template"]["title"], "deck-template")

    def test_an_empty_keymap_serializes_to_empty_settings(self):
        row = writer_template("writer-template", keymap="")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        convert_templates(env)

        self.assertEqual(target.writer_rows[row.name]["settings"], "{}")

    def test_light_and_dark_decks_keep_their_presentation_ids(self):
        light = presentation_template("deck-light", title="Light")
        dark = presentation_template("deck-dark", title="Dark")
        source = FakeContent(documents=[light, dark], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env)

        for row in (light, dark):
            node = target.node_rows[row.name]
            self.assertEqual(node["parent"], folder)
            self.assertEqual(node["title"], row.title)
            self.assertEqual(node["is_template"], 1)
            self.assertEqual(source.document_rows[(row.doctype, row.name)].node, row.name)
        self.assertEqual(env.state.content().template_nodes_created, 2)

    # -- reruns

    def test_convert_templates_fills_the_callers_live_conversion_record(self):
        """A caller holding the record already must pass it in.

        Loading a second copy here and saving it is overwritten the moment the
        caller saves its own older instance, and every template counter then
        reports zero.
        """
        writer = writer_template("writer-b", title="Common")
        deck = presentation_template("deck-a", title="Common")
        source = FakeContent(
            writer_templates=[writer],
            documents=[deck],
            users={"Administrator": True, OWNER: True},
        )
        env, _ = self.environment(source)
        live = env.state.content()
        live.slides_deferred = 3

        convert_templates(env, result=live)

        self.assertEqual(live.template_nodes_created, 2)
        self.assertEqual(live.writer_templates_converted, 1)
        self.assertEqual(live.template_title_renames, 1)
        # The caller's own phase counters survive.
        self.assertEqual(live.slides_deferred, 3)

    def test_the_slides_phase_saves_the_template_counters_it_produced(self):
        """slides.py owns the phase record, so the counters must reach it."""
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.writer_templates_converted, 1)
        self.assertEqual(result.template_nodes_created, 1)
        self.assertEqual(env.state.content().writer_templates_converted, 1)

    def test_step_10_leaves_the_template_documents_step_8_created(self):
        """§14.7 puts a template under `Templates`; §14.6's orphan rule must not move it.

        The `Writer Document` step 8 mints has no `File` row, so step 10 reads
        it back in the orphan loop. Re-deriving it there would place it in its
        owner's Personal Root and then refuse the node step 8 wrote, on the
        first run and on every run after it.
        """
        writer = writer_template("writer-template")
        deck = presentation_template("deck-template")
        source = FakeContent(
            writer_templates=[writer],
            documents=[deck],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)

        convert_slides_and_templates(env)
        folder = target.node_rows["writer-template"]["parent"]
        before = dict(target.node_rows["writer-template"])
        self.assertEqual(target.node_rows[folder]["title"], "Templates")

        result = link_content_documents(env)

        self.assertEqual(result.issues, [])
        self.assertTrue(result.links_completed)
        self.assertEqual(result.orphan_content_docs_adopted, 0)
        self.assertEqual(result.link_title_renames, 0)
        self.assertEqual(target.node_rows["writer-template"], before)
        self.assertEqual(len(target.content_nodes("Writer Document", "writer-template")), 1)
        # No Personal Root was minted for the template's owner either.
        self.assertNotIn(OWNER, target.locked_content_roots)

        again = link_content_documents(env)

        self.assertEqual(again.issues, [])
        self.assertEqual(again.orphan_content_docs_adopted, 0)
        self.assertEqual(target.node_rows["writer-template"], before)

    def test_a_template_node_claiming_an_ordinary_document_is_refused(self):
        """The flag on the node is not the evidence; the source row is."""
        writer = writer_template("writer-template")
        source = FakeContent(writer_templates=[writer], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        convert_slides_and_templates(env)
        # An ordinary orphan whose node an earlier target write flagged.
        source.add_content_document(
            ContentRow(
                "Writer Document",
                "writer-1",
                owner=OWNER,
                creation=STAMP,
                modified=STAMP,
                modified_by=OWNER,
            )
        )
        target.node_rows["node-1"] = {
            **target.node_rows["writer-template"],
            "name": "node-1",
            "content_docname": "writer-1",
        }
        source.link_document("Writer Document", "writer-1", "node-1")

        with self.assertRaisesRegex(BuildContentError, "which is not one"):
            link_content_documents(env)

    # -- a template deck that already has a §14.4 node

    def test_a_template_deck_with_an_existing_node_adopts_it_in_place(self):
        """§14.6 gives one content document one node; §14.7 must not mint a second."""
        deck = presentation_template("deck-template")
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        node = self.tree_node(target, deck.name)
        before = dict(target.node_rows[node])

        folder = convert_templates(env)

        result = env.state.content()
        self.assertEqual(result.template_nodes_adopted, 1)
        self.assertEqual(result.template_nodes_created, 0)
        # No second node, and nothing new under `Templates`.
        self.assertNotIn(deck.name, target.node_rows)
        self.assertEqual(target.child_nodes(folder), [])
        stored = target.node_rows[node]
        self.assertEqual(stored["is_template"], 1)
        # §8.10: the flag and the grant are the whole conversion. The node
        # keeps the place, the title, and the stamps §14.4 gave it.
        self.assertEqual(
            {key: value for key, value in stored.items() if key != "is_template"},
            {key: value for key, value in before.items() if key != "is_template"},
        )
        self.assertEqual(source.document_rows[(deck.doctype, deck.name)].node, node)
        self.assertEqual(target.grant_roles(node, (GENERAL,))[GENERAL], READ)
        self.assertEqual(target.grant_roles(node, (OWNER,))[OWNER], MANAGE)
        self.assertEqual(self.node_grants(target, node), 2)
        self.assertEqual(
            [(issue.source, issue.reason, issue.phase) for issue in result.issues],
            [
                (
                    f"Presentation:{deck.name}",
                    f"template Presentation {deck.name} already had node {node}; adopted in place",
                    "templates",
                )
            ],
        )

    def test_a_second_run_over_an_adopted_template_deck_writes_nothing(self):
        deck = presentation_template("deck-template")
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        node = self.tree_node(target, deck.name)

        convert_templates(env)
        rows = (dict(target.node_rows), dict(target.grant_rows))

        convert_templates(env)

        again = env.state.content()
        self.assertEqual((dict(target.node_rows), dict(target.grant_rows)), rows)
        self.assertEqual(self.node_grants(target, node), 2)
        self.assertEqual(again.template_nodes_adopted, 0)
        self.assertEqual(again.template_nodes_created, 0)
        self.assertEqual(source.document_rows[(deck.doctype, deck.name)].node, node)
        # `begin_phase` drops the templates phase's evidence first, so the
        # standing shape is reported once per run and never accumulates.
        self.assertEqual(len(again.issues), 1)
        self.assertEqual(again.issues_by_phase, {"templates": 1})

    def test_an_adopted_deck_claims_no_title_under_the_templates_folder(self):
        adopted = presentation_template("deck-a", title="Common")
        minted = presentation_template("deck-b", title="Common")
        source = FakeContent(
            documents=[adopted, minted],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.tree_node(target, adopted.name)

        convert_templates(env)

        self.assertEqual(target.node_rows["deck-b"]["title"], "Common")
        self.assertEqual(env.state.content().template_title_renames, 0)

    def test_an_adopted_deck_survives_the_slides_and_link_steps(self):
        """The defect: `history._document_node` refused the second node."""
        deck = presentation_template("deck-template")
        source = FakeContent(
            documents=[deck],
            files=[
                TreeRow(
                    "file-1",
                    content_doctype="Presentation",
                    content_docname="deck-template",
                )
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        node = self.tree_node(target, deck.name)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.template_nodes_adopted, 1)
        self.assertTrue(result.slides_completed)

        linked = link_content_documents(env)

        self.assertTrue(linked.links_completed)
        self.assertEqual(linked.orphan_content_docs_adopted, 0)
        self.assertEqual(source.document_rows[(deck.doctype, deck.name)].node, node)

    def test_two_nodes_for_one_template_deck_are_refused(self):
        deck = presentation_template("deck-template")
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        self.tree_node(target, deck.name, name="file-1")
        self.tree_node(target, deck.name, name="file-2")

        with self.assertRaisesRegex(InvalidLegacyContent, "deck-template has multiple target nodes"):
            convert_templates(env)

    def test_a_template_deck_with_no_node_is_still_created_under_templates(self):
        deck = presentation_template("deck-template")
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env)

        result = env.state.content()
        self.assertEqual(result.template_nodes_created, 1)
        self.assertEqual(result.template_nodes_adopted, 0)
        self.assertEqual(result.issues, [])
        self.assertEqual(target.node_rows[deck.name]["parent"], folder)
        self.assertEqual(target.node_rows[deck.name]["is_template"], 1)
        self.assertEqual(source.document_rows[(deck.doctype, deck.name)].node, deck.name)

    def test_a_second_run_changes_no_row_and_no_counter(self):
        writer = writer_template("writer-template")
        deck = presentation_template("deck-template")
        source = FakeContent(
            writer_templates=[writer],
            documents=[deck],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)

        convert_templates(env)
        rows = (dict(target.node_rows), dict(target.grant_rows), dict(target.writer_rows))
        first = env.state.content()
        convert_templates(env)
        second = env.state.content()

        self.assertEqual((dict(target.node_rows), dict(target.grant_rows), dict(target.writer_rows)), rows)
        self.assertEqual(
            (first.template_nodes_created, first.writer_templates_converted, first.template_title_renames),
            (second.template_nodes_created, second.writer_templates_converted, second.template_title_renames),
        )
        self.assertEqual(second.template_nodes_created, 2)


if __name__ == "__main__":
    unittest.main()
