"""Content links, true orphans, and governed shares."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from suite.drive._core.roles import EDIT, MANAGE, NONE, READ
from suite.drive.patches.build import content as content_module
from suite.drive.patches.build.content import BuildContentError, link_content_documents
from suite.drive.patches.build.mapping import GENERAL
from suite.drive.patches.build.ports import (
    ACTIVE,
    PERSONAL,
    REMOVED,
    TRASHED,
    ContentRow,
    ContentShareRow,
    TreeRow,
    WriterTemplateRow,
)
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    InterruptedRun,
    build_environment,
)

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def document(doctype, name, **values):
    values.setdefault("owner", OWNER)
    values.setdefault("creation", STAMP)
    values.setdefault("modified", STAMP)
    values.setdefault("modified_by", OWNER)
    return ContentRow(doctype=doctype, name=name, **values)


def file_for(row, name, status=ACTIVE):
    return TreeRow(
        name=name,
        status=status,
        content_doctype=row.doctype,
        content_docname=row.name,
        owner=row.owner,
        creation=STAMP,
        modified=STAMP,
    )


def add_document_node(target, name, row, **values):
    target.node_rows[name] = {
        "name": name,
        "title": values.pop("title", row.title or row.name),
        "parent": values.pop("parent", "root"),
        "root": values.pop("root", "root"),
        "path": values.pop("path", ""),
        "kind": values.pop("kind", "document"),
        "content_doctype": values.pop("content_doctype", row.doctype),
        "content_docname": values.pop("content_docname", row.name),
        "state": values.pop("state", ACTIVE),
        **values,
    }


def add_node(target, name, **values):
    """A target row that is not a content node: a collision or a share target."""
    target.node_rows[name] = {"name": name, "parent": "root", "root": "root", "state": ACTIVE, **values}


class CountingTarget(FakeContentTarget):
    """Count the target rows each Build transaction really carries.

    The rows are counted off the fake's own tables. Counting what the code
    said it reserved would only check Build's accounting against a copy of
    that accounting, and every miscount would agree with itself.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.batches = []
        self.written = self._row_count()

    def _row_count(self):
        links = sum(1 for row in (self.content.document_rows.values() if self.content else ()) if row.node)
        return (
            len(self.node_rows) + len(self.root_rows) + len(self.grant_rows) + len(self.writer_rows) + links
        )

    def start(self):
        """Freeze the fixture rows so only Build's own writes are counted."""
        self.written = self._row_count()
        return self

    def commit(self):
        super().commit()
        carried = self._row_count() - self.written
        if carried:
            self.batches.append(carried)
            self.written += carried


class CountingGrantReads(FakeContentTarget):
    """Count the grant round trips the share mapper issues."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.grant_reads = 0
        self.pair_reads = 0

    def grant_roles(self, node, principals):
        self.grant_reads += 1
        return super().grant_roles(node, principals)

    def grant_pairs(self, pairs):
        self.pair_reads += 1
        return super().grant_pairs(pairs)


class ContentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def environment(self, source, target=None, slides_completed=True):
        target = target if target is not None else FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
        )
        state = env.state.content()
        state.slides_completed = slides_completed
        env.state.put_content(state)
        return env, target

    def personal_root(self, target, name, user=OWNER, state=ACTIVE):
        target.node_rows[name] = {
            "name": name,
            "title": user,
            "parent": None,
            "root": None,
            "path": "",
            "kind": "root",
            "state": ACTIVE,
        }
        target.root_rows[name] = {
            "name": name,
            "node": name,
            "user": user,
            "kind": "Personal",
            "state": state,
        }
        return name

    # -- file-backed links

    def test_file_backed_document_gets_only_its_blank_reciprocal_link(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1")])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)

        result = link_content_documents(env)

        self.assertEqual(source.document_rows[(row.doctype, row.name)].node, "file-1")
        self.assertEqual(len(target.content_nodes(row.doctype, row.name)), 1)
        self.assertTrue(result.completed)
        self.assertEqual(result.orphan_content_docs_adopted, 0)

        link_content_documents(env)
        self.assertEqual(len(target.content_nodes(row.doctype, row.name)), 1)

    def test_a_file_node_that_is_not_a_document_is_refused(self):
        """Plan §6 step 4 requires `kind='document'` on the File's node."""
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1")])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row, kind="folder")

        with self.assertRaisesRegex(BuildContentError, "field kind"):
            link_content_documents(env)

    def test_a_file_node_carrying_another_content_pair_is_refused(self):
        """Plan §6 step 4 requires the exact content pair, not just the id."""
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1")])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row, content_docname="writer-9")
        # A second node carries the real pair, so only the File node is wrong.
        add_document_node(target, "other", row)

        with self.assertRaisesRegex(BuildContentError, "field content_docname"):
            link_content_documents(env)

    def test_a_document_pointing_at_another_node_is_refused(self):
        row = document("Writer Document", "writer-1", node="somewhere-else")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1")])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)

        with self.assertRaisesRegex(BuildContentError, "points at another Drive Node"):
            link_content_documents(env)

    def test_two_files_claiming_one_document_are_refused(self):
        row = document("Sheet", "sheet-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1"), file_for(row, "file-2")])
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildContentError, "more than one File"):
            link_content_documents(env)

    def test_removed_file_is_not_reclassified_as_an_orphan(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1", REMOVED)])
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildContentError, "Removed File"):
            link_content_documents(env)

    # -- batching

    def test_link_commits_split_at_1000_target_rows_not_999(self):
        rows = [document("Writer Document", f"writer-{index:04}") for index in range(1001)]
        source = FakeContent(documents=rows, files=[file_for(row, f"file-{row.name}") for row in rows])
        env, target = self.environment(source, CountingTarget(content=source))
        for row in rows:
            add_document_node(target, f"file-{row.name}", row)
        target.start()

        link_content_documents(env, batch_size=1000)

        self.assertEqual(target.batches, [1000, 1])

    def test_a_new_root_pair_counts_against_the_batch_and_is_never_split(self):
        linked = [document("Writer Document", f"writer-{index}") for index in range(8)]
        orphan = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(
            documents=[*linked, orphan],
            files=[file_for(row, f"file-{row.name}") for row in linked],
            users={OWNER: True},
        )
        env, target = self.environment(source, CountingTarget(content=source))
        for row in linked:
            add_document_node(target, f"file-{row.name}", row)
        target.start()

        link_content_documents(env, batch_size=10)

        # 8 links, then the root node, its metadata, its grant, and the orphan pair together.
        self.assertEqual(target.batches, [8, 5])

    # -- true orphans

    def test_true_orphan_gets_a_personal_root_and_a_deduped_title(self):
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.node_rows["sibling"] = {"name": "sibling", "parent": "id1", "title": "Budget", "state": ACTIVE}

        result = link_content_documents(env)

        # Plan §6's whole orphan mapping row, not just the fields Build writes last.
        self.assertEqual(
            target.node_rows["sheet-1"],
            {
                "name": "sheet-1",
                "title": "Budget (2)",
                "parent": "id1",
                "root": "id1",
                "path": "",
                "kind": "document",
                "blob": None,
                "size": 0,
                "mime": "frappe/sheet",
                "url": None,
                "content_doctype": "Sheet",
                "content_docname": "sheet-1",
                "state": ACTIVE,
                "trashed_at": None,
                "trash_root": None,
                "content_modified": STAMP,
                "is_template": 0,
                "owner": OWNER,
                "creation": STAMP,
                "modified": STAMP,
                "modified_by": OWNER,
                "docstatus": 0,
                "idx": 0,
            },
        )
        self.assertEqual(source.document_rows[(row.doctype, row.name)].node, "sheet-1")
        self.assertEqual(result.orphan_content_docs_adopted, 1)
        self.assertEqual(result.title_renames, 1)

    def test_a_trashed_orphan_sheet_keeps_its_title_and_maps_its_lifecycle(self):
        """A Trashed sibling holds no title reservation (titles.py, §14.4).

        Deduping it against an Active sibling renames a node that needed no
        rename and inflates the reported `title_renames`.
        """
        row = document("Sheet", "sheet-1", title="Budget", trashed=1, trashed_on="2024-02-01")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.node_rows["sibling"] = {"name": "sibling", "parent": "id1", "title": "Budget", "state": ACTIVE}

        result = link_content_documents(env)

        node = target.node_rows["sheet-1"]
        self.assertEqual(node["parent"], "id1")
        self.assertEqual(node["title"], "Budget")
        self.assertEqual(node["state"], TRASHED)
        self.assertEqual(node["trash_root"], "sheet-1")
        self.assertEqual(node["trashed_at"], "2024-02-01")
        self.assertEqual(result.title_renames, 0)

    def test_a_trashed_orphan_without_trashed_on_falls_back_to_modified(self):
        row = document("Sheet", "sheet-1", title="Budget", trashed=1, modified="2024-03-04 05:06:07.000000")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)

        link_content_documents(env)

        self.assertEqual(target.node_rows["sheet-1"]["trashed_at"], "2024-03-04 05:06:07.000000")

    def test_an_orphan_writer_document_without_a_title_is_named_untitled(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)

        link_content_documents(env)

        self.assertEqual(target.node_rows["writer-1"]["title"], "Untitled Document")

    def test_a_links_rerun_drops_the_evidence_the_last_links_run_recorded(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1")])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)
        state = env.state.content()
        state.record_issue("Sheet:gone", "a refusal from the run before", phase="links")
        env.state.put_content(state)

        result = link_content_documents(env)

        # Issues are evidence for one run of one phase. Inheriting the last
        # list double-counts §14.9 for a site the rerun found clean.
        self.assertEqual(result.issues, [])
        self.assertEqual(result.issues_total, 0)

    def test_a_rerun_reports_the_same_title_rename_count(self):
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.node_rows["personal"] = {"name": "personal", "kind": "root", "state": ACTIVE, "title": OWNER}
        target.root_rows["personal"] = {
            "name": "personal",
            "node": "personal",
            "kind": PERSONAL,
            "user": OWNER,
            "state": ACTIVE,
        }
        target.node_rows["sibling"] = {
            "name": "sibling",
            "parent": "personal",
            "title": "Budget",
            "state": ACTIVE,
        }

        first = link_content_documents(env)
        second = link_content_documents(env)

        # The ticket compares every reported count across two identical runs.
        # The second run adopts nothing new, so it has to re-derive the rename
        # from the source row with the stored node left out of its own group.
        self.assertEqual(first.title_renames, 1)
        self.assertEqual(second.title_renames, 1)
        self.assertEqual(second.orphan_content_docs_adopted, first.orphan_content_docs_adopted)
        self.assertEqual(target.node_rows["sheet-1"]["title"], "Budget (2)")

    def test_the_personal_root_identity_is_locked_before_it_is_read(self):
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)

        link_content_documents(env)

        # `_core/roots.py` and ticket 27 both lock the identity first. Read
        # first and a root committed in between leaves the user with two
        # Active Personal Roots, which §3.2 bars and no rerun can repair.
        self.assertIn(OWNER, target.locked_content_roots)

    def test_an_orphan_naming_a_missing_node_is_refused(self):
        row = document("Sheet", "sheet-1", node="gone")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildContentError, "names a missing Drive Node"):
            link_content_documents(env)

    def test_an_orphan_pointing_at_another_node_is_refused(self):
        row = document("Sheet", "sheet-1", node="elsewhere")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        add_document_node(target, "sheet-1", row)

        with self.assertRaisesRegex(BuildContentError, "points at another Drive Node"):
            link_content_documents(env)

    def test_blank_ownership_refuses_instead_of_inventing_a_root(self):
        row = document("Sheet", "sheet-1", owner=None)
        source = FakeContent(documents=[row])
        env, target = self.environment(source)

        with self.assertRaisesRegex(BuildContentError, "no owner for a Personal Root"):
            link_content_documents(env)
        self.assertEqual(target.root_rows, {})

    def test_an_unrelated_node_id_collision_is_refused_with_evidence(self):
        """Plan §6: refuse an unrelated target collision.

        Left to the insert this is an `IntegrityError` inside the savepoint,
        raised past `except InvalidLegacyContent`, so the run dies and the
        state file records nothing.
        """
        row = document("Sheet", "abc", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        add_node(target, "abc", kind="folder", title="Unrelated")

        with self.assertRaisesRegex(BuildContentError, "unrelated Drive Node already holds"):
            link_content_documents(env)
        self.assertEqual(env.state.content().issues_total, 1)

    def test_orphan_node_and_link_rollback_as_one_unit(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.fail_unit = "writer-1"

        with self.assertRaises(InterruptedRun):
            link_content_documents(env)
        self.assertNotIn("writer-1", target.node_rows)
        self.assertIsNone(source.document_rows[(row.doctype, row.name)].node)

    # -- orphan reruns

    def test_a_second_run_validates_the_orphan_and_reports_the_same_renames(self):
        """§13: every stable report count remains unchanged on a rerun.

        The rename belongs to the source rows, so it has to be re-derived
        rather than counted only on the run that created the node.
        """
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.node_rows["sibling"] = {"name": "sibling", "parent": "id1", "title": "Budget", "state": ACTIVE}

        first = link_content_documents(env)
        rows = dict(target.node_rows)
        second = link_content_documents(env)

        self.assertEqual((first.title_renames, second.title_renames), (1, 1))
        self.assertEqual((first.orphan_content_docs_adopted, second.orphan_content_docs_adopted), (1, 1))
        self.assertEqual(target.node_rows, rows)

    def test_a_rerun_refuses_an_orphan_node_moved_out_of_its_planned_shape(self):
        """§13: never bless a target because only its primary key exists."""
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        link_content_documents(env)
        # Not `is_template`: that flag routes the row to the template branch,
        # which owns its own refusal (`test_a_template_node_claims_...`).
        target.node_rows["sheet-1"].update({"root": "elsewhere", "mime": "frappe/writer"})

        with self.assertRaisesRegex(BuildContentError, "orphan node sheet-1 field root"):
            link_content_documents(env)

    def test_a_template_node_claims_a_document_that_no_template_row_explains(self):
        """§14.7 owns `is_template`, so an orphan node carrying it is a collision."""
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        link_content_documents(env)
        target.node_rows["sheet-1"]["is_template"] = 1

        with self.assertRaisesRegex(BuildContentError, "a template node claims Sheet sheet-1"):
            link_content_documents(env)

    # -- Personal Root

    def test_an_archived_personal_root_is_accepted_for_an_enabled_owner(self):
        """Ticket 27 archives a root whose `Users/<email>` folder was Trashed.

        `root_pairs.py:220-227` applies that rule whatever the User row says,
        so recomputing the expected state here aborts a healthy run.
        """
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        self.personal_root(target, "root-1", state="Archived")

        link_content_documents(env)

        self.assertEqual(target.node_rows["sheet-1"]["parent"], "root-1")
        self.assertEqual(target.root_rows["root-1"]["state"], "Archived")

    def test_a_personal_root_whose_metadata_names_another_node_is_refused(self):
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        self.personal_root(target, "root-1", state="Archived")
        target.root_rows["stale"] = target.root_rows.pop("root-1")
        target.root_rows["stale"]["name"] = "stale"

        with self.assertRaisesRegex(BuildContentError, "Personal Root root-1 field name"):
            link_content_documents(env)

    def test_a_disabled_owner_receives_archived_root_metadata(self):
        """Plan §6: disabled or missing User rows receive Archived metadata."""
        disabled = document("Sheet", "sheet-1", title="Budget", owner="off@example.com")
        unknown = document("Sheet", "sheet-2", title="Ledger", owner="ghost@example.com")
        source = FakeContent(documents=[disabled, unknown], users={"off@example.com": False})
        env, target = self.environment(source)

        link_content_documents(env)

        states = {row["user"]: row["state"] for row in target.root_rows.values()}
        self.assertEqual(states, {"off@example.com": "Archived", "ghost@example.com": "Archived"})
        # A missing User row can hold no grant; a disabled one still owns its root.
        self.assertEqual(
            target.grant_roles(target.personal_roots("off@example.com")[0], ("off@example.com",)),
            {"off@example.com": MANAGE},
        )
        self.assertEqual(
            target.grant_roles(target.personal_roots("ghost@example.com")[0], ("ghost@example.com",)), {}
        )

    # -- File and Sheet trash census

    def test_file_sheet_trash_disagreement_is_counted_without_repair(self):
        row = document("Sheet", "sheet-1", trashed=1)
        source = FakeContent(documents=[row], files=[file_for(row, "file-1", ACTIVE)])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row, state=ACTIVE)

        result = link_content_documents(env)

        self.assertEqual(result.trash_disagreements, 1)
        self.assertEqual(target.node_rows["file-1"]["state"], ACTIVE)
        self.assertEqual(source.document_rows[(row.doctype, row.name)].trashed, 1)

    def test_a_trashed_file_under_an_untrashed_sheet_also_disagrees(self):
        row = document("Sheet", "sheet-1", trashed=0)
        source = FakeContent(documents=[row], files=[file_for(row, "file-1", TRASHED)])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row, state=TRASHED)

        result = link_content_documents(env)

        self.assertEqual(result.trash_disagreements, 1)

    def test_a_null_file_status_reads_as_active(self):
        """`File.status` defaults to Active, so NULL is not a disagreement."""
        agree = document("Sheet", "sheet-1", trashed=0)
        differ = document("Sheet", "sheet-2", trashed=1)
        source = FakeContent(
            documents=[agree, differ],
            files=[file_for(agree, "file-1", None), file_for(differ, "file-2", None)],
        )
        env, target = self.environment(source)
        add_document_node(target, "file-1", agree)
        add_document_node(target, "file-2", differ)

        result = link_content_documents(env)

        self.assertEqual(result.trash_disagreements, 1)

    # -- Presentation templates

    def test_a_template_deck_before_step_8_is_refused_with_bounded_evidence(self):
        """§4 gives step 10 no template job, so step 8 has to run first.

        A fresh site has no template node yet. The refusal has to reach
        `drive-build-state.json` rather than kill the run with a bare traceback.
        """
        deck = document("Presentation", "deck-template", title="Light", is_template=1)
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source, slides_completed=False)

        with self.assertRaisesRegex(BuildContentError, "has no template node"):
            link_content_documents(env)

        issues = env.state.content().issues
        self.assertEqual(
            [(issue.source, issue.phase) for issue in issues], [("Presentation:deck-template", "links")]
        )
        self.assertFalse(env.state.content().links_completed)
        # Nothing was adopted under the template id.
        self.assertNotIn("deck-template", target.node_rows)

    def test_step_10_never_runs_the_slides_phase(self):
        """§4 gives step 10 two jobs: adopt orphans and drain history.

        Running step 8 from here converts templates and Slide media a second
        time, and its guard read the `slides_completed` flag §4 forbids.
        """
        row = document("Sheet", "sheet-1", title="Budget")
        source = FakeContent(documents=[row], users={OWNER: True, "Administrator": True})
        env, target = self.environment(source, slides_completed=False)

        result = link_content_documents(env)

        self.assertTrue(result.links_completed)
        self.assertFalse(result.slides_completed)
        self.assertFalse(result.completed)
        self.assertEqual(target.personal_roots("Administrator"), ())
        self.assertNotIn("Templates", [node.get("title") for node in target.node_rows.values()])

    def test_a_template_link_is_revalidated_when_the_slides_phase_is_complete(self):
        """Plan §4: no `completed` flag may bypass validation."""
        deck = document("Presentation", "deck-template", title="Light", is_template=1)
        source = FakeContent(documents=[deck], users={"Administrator": True, OWNER: True})
        env, _ = self.environment(source, slides_completed=True)

        with self.assertRaisesRegex(BuildContentError, "has no template node"):
            link_content_documents(env)

    def test_a_writer_template_with_a_blank_link_is_refused_like_a_deck(self):
        """§14.6 gives every content document a link, templates included.

        Step 8 writes the link with the document and repairs a blank one on a
        rerun, so a blank link at step 10 means step 8 did not finish this
        template. Accepting it leaves `Writer Document.node` unset for good.
        """
        row = document("Writer Document", "writer-template", title="Letter")
        template = WriterTemplateRow(
            name="writer-template",
            title="Letter",
            content="<p>Letter</p>",
            keymap=None,
            owner=OWNER,
            creation=STAMP,
            modified=STAMP,
            modified_by=OWNER,
        )
        source = FakeContent(
            documents=[row], writer_templates=[template], users={"Administrator": True, OWNER: True}
        )
        env, target = self.environment(source)
        add_document_node(target, "writer-template", row, is_template=1, mime="frappe/writer")

        with self.assertRaisesRegex(BuildContentError, "writer-template has no reciprocal link"):
            link_content_documents(env)

        self.assertFalse(env.state.content().links_completed)

    def test_a_kill_inside_the_share_mapper_leaves_step_10_incomplete(self):
        """§14.2 lets a rerun skip a complete record, so completeness must wait.

        Set before the share mapper, the flag claims step 10 finished on a
        record that carries no content share at all.
        """
        row = document("Writer Document", "writer-1", title="Letter")
        share = ContentShareRow("share-1", "Writer Document", "writer-1", user="reader@example.com", read=1)
        source = FakeContent(documents=[row], shares=[share], users={OWNER: True, "reader@example.com": True})

        class Exploding(FakeContentTarget):
            def grant_pairs(self, *args, **kwargs):
                raise RuntimeError("killed inside the share mapper")

        env, target = self.environment(source, target=Exploding(content=source))

        with self.assertRaises(RuntimeError):
            link_content_documents(env)

        self.assertFalse(env.state.content().links_completed)
        self.assertFalse(env.state.content().completed)

    def test_a_converted_template_validates_and_receives_its_governed_shares(self):
        """§7 maps a Presentation share onto the template node step 8 wrote."""
        deck = document("Presentation", "deck-template", title="Light", is_template=1, node="deck-template")
        share = ContentShareRow("share-1", "Presentation", "deck-template", user="reader@example.com", read=1)
        source = FakeContent(
            documents=[deck],
            shares=[share],
            users={"Administrator": True, OWNER: True, "reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "deck-template", deck, is_template=1, mime="frappe/slides")

        result = link_content_documents(env)

        self.assertEqual(
            target.grant_roles("deck-template", ("reader@example.com",))["reader@example.com"], READ
        )
        self.assertEqual(result.orphan_content_docs_adopted, 0)
        self.assertTrue(result.links_completed)

    # -- governed shares

    def test_content_shares_merge_and_a_direct_deny_wins(self):
        row = document("Writer Document", "writer-1")
        version_row = document("Writer Version", "old-version")
        shares = [
            ContentShareRow("share-1", row.doctype, row.name, user="reader@example.com", read=1),
            ContentShareRow("share-2", row.doctype, row.name, everyone=1, share=1, write=1),
            ContentShareRow("share-3", row.doctype, row.name, user="missing@example.com", write=1),
            ContentShareRow("share-4", "Writer Version", "old-version", user="reader@example.com", read=1),
        ]
        source = FakeContent(
            documents=[row],
            files=[file_for(row, "file-1")],
            shares=shares,
            users={"reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)
        # A real target row for the history share, so the widening refusal in
        # §7 is what drops it rather than the absence of any node.
        add_document_node(target, "version-node", version_row)
        target.grant_rows["deny"] = {
            "name": "deny",
            "node": "file-1",
            "principal": "reader@example.com",
            "role": NONE,
        }

        result = link_content_documents(env, batch_size=2)

        self.assertEqual(target.grant_roles("file-1", ("reader@example.com",))["reader@example.com"], NONE)
        self.assertEqual(target.grant_roles("file-1", (GENERAL,))[GENERAL], MANAGE)
        self.assertEqual(target.grant_roles("version-node", ("reader@example.com",)), {})
        self.assertEqual(result.docshare_rows_dropped, 2)
        self.assertEqual(len(source.share_rows), 4)

    def test_a_whole_share_batch_costs_one_grant_read(self):
        """A site with 200k content shares must not issue 200k round trips."""
        rows = [document("Writer Document", f"writer-{index}") for index in range(3)]
        readers = [f"reader{index}@example.com" for index in range(4)]
        shares = [
            ContentShareRow(f"share-{row.name}-{index}", row.doctype, row.name, user=user, read=1)
            for row in rows
            for index, user in enumerate(readers)
        ]
        source = FakeContent(
            documents=rows,
            files=[file_for(row, f"file-{row.name}") for row in rows],
            shares=shares,
            users=dict.fromkeys(readers, True),
        )
        env, target = self.environment(source, CountingGrantReads(content=source))
        for row in rows:
            add_document_node(target, f"file-{row.name}", row)

        link_content_documents(env)

        # One read for twelve pairs over three nodes, and not one per node.
        self.assertEqual(target.pair_reads, 1)
        self.assertEqual(target.grant_reads, 0)
        for row in rows:
            self.assertEqual(len(target.grant_roles(f"file-{row.name}", tuple(readers))), 4)

    def test_a_refusal_does_not_leave_the_loop_reading_unbound_names(self):
        """`_fail` raises today; the loop must not depend on that for binding."""
        # The refusal has to be the first row of the run: a later one reads the
        # previous iteration's values instead of raising.
        bad = document("Presentation", "deck-1", node="gone")
        good = document("Presentation", "deck-2", title="Deck")
        source = FakeContent(documents=[bad, good], users={OWNER: True})
        env, target = self.environment(source)
        recorded = []

        def record(environment, result, source_id, reason):
            recorded.append(source_id)
            result.record_issue(source_id, reason, phase="links")

        with mock.patch.object(content_module, "_fail", record):
            result = link_content_documents(env)

        self.assertEqual(recorded, ["Presentation:deck-1"])
        self.assertEqual(source.document_rows[("Presentation", "deck-2")].node, "deck-2")
        self.assertEqual(result.documents_seen, 2)
        self.assertEqual(result.orphan_content_docs_adopted, 1)

    def test_share_without_any_effective_right_is_dropped(self):
        row = document("Writer Document", "writer-1")
        share = ContentShareRow("share-1", row.doctype, row.name, user="reader@example.com")
        source = FakeContent(
            documents=[row],
            files=[file_for(row, "file-1")],
            shares=[share],
            users={"reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)

        result = link_content_documents(env)

        self.assertEqual(result.docshare_rows_dropped, 1)
        self.assertNotIn("reader@example.com", target.grant_roles("file-1", ("reader@example.com",)))

    def test_a_write_share_reaches_edit_and_a_submit_flag_adds_nothing(self):
        first = document("Writer Document", "writer-1")
        second = document("Writer Document", "writer-2")
        shares = [
            ContentShareRow("share-1", first.doctype, first.name, user="reader@example.com", write=1),
            ContentShareRow(
                "share-2", second.doctype, second.name, user="reader@example.com", submit=1, read=1
            ),
        ]
        source = FakeContent(
            documents=[first, second],
            files=[file_for(first, "file-1"), file_for(second, "file-2")],
            shares=shares,
            users={"reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "file-1", first)
        add_document_node(target, "file-2", second)

        link_content_documents(env)

        # §14.5 lists no `submit` on the ladder, and neither content doctype is
        # submittable. Grants round down, so the row falls to its `read` flag.
        self.assertEqual(target.grant_roles("file-1", ("reader@example.com",))["reader@example.com"], EDIT)
        self.assertEqual(target.grant_roles("file-2", ("reader@example.com",))["reader@example.com"], READ)

    def test_a_second_run_merges_shares_instead_of_appending_them(self):
        """`Drive Grant` is unique on `(node, principal)`, and the fake enforces it."""
        row = document("Writer Document", "writer-1")
        share = ContentShareRow("share-1", row.doctype, row.name, user="reader@example.com", read=1)
        source = FakeContent(
            documents=[row],
            files=[file_for(row, "file-1")],
            shares=[share],
            users={"reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "file-1", row)

        link_content_documents(env)
        grants = dict(target.grant_rows)
        link_content_documents(env)

        self.assertEqual(target.grant_rows, grants)
        self.assertEqual(target.grant_roles("file-1", ("reader@example.com",))["reader@example.com"], READ)

    def test_a_share_on_an_orphan_reaches_the_node_adopted_in_the_same_run(self):
        """Plan §7 runs the share mapper after templates and orphan links exist.

        A share that arrives before its target exists is dropped as an
        unmigrated entity; one whose target the same run adopts is kept.
        """
        adopted = document("Writer Document", "writer-1", title="Notes")
        shares = [
            ContentShareRow("share-1", "Writer Document", "writer-1", user="reader@example.com", read=1),
            ContentShareRow("share-2", "Writer Document", "gone", user="reader@example.com", read=1),
        ]
        source = FakeContent(
            documents=[adopted],
            shares=shares,
            users={OWNER: True, "reader@example.com": True},
        )
        env, target = self.environment(source)

        result = link_content_documents(env)

        self.assertEqual(target.grant_roles("writer-1", ("reader@example.com",))["reader@example.com"], READ)
        self.assertEqual(result.docshare_rows_dropped, 1)


if __name__ == "__main__":
    unittest.main()
