"""Content links, true orphans, and governed shares."""

import tempfile
import unittest
from pathlib import Path

from suite.drive._core.roles import MANAGE, NONE, READ
from suite.drive.patches.build.content import BuildContentError, link_content_documents
from suite.drive.patches.build.mapping import GENERAL
from suite.drive.patches.build.ports import ACTIVE, REMOVED, TRASHED, ContentRow, ContentShareRow, TreeRow
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
        "kind": "document",
        "content_doctype": row.doctype,
        "content_docname": row.name,
        "state": values.pop("state", ACTIVE),
        **values,
    }


class ContentTest(unittest.TestCase):
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
        state = env.state.content()
        state.slides_completed = True
        env.state.put_content(state)
        return env, target

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

    def test_true_orphan_gets_a_personal_root_and_a_deduped_title(self):
        row = document("Sheet", "sheet-1", title="Budget", trashed=1, trashed_on="2024-02-01")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.node_rows["sibling"] = {"name": "sibling", "parent": "id1", "title": "Budget", "state": ACTIVE}

        result = link_content_documents(env)

        node = target.node_rows["sheet-1"]
        self.assertEqual(node["parent"], "id1")
        self.assertEqual(node["title"], "Budget (2)")
        self.assertEqual(node["state"], TRASHED)
        self.assertEqual(node["trash_root"], "sheet-1")
        self.assertEqual(node["trashed_at"], "2024-02-01")
        self.assertEqual(result.orphan_content_docs_adopted, 1)
        self.assertEqual(result.title_renames, 1)

    def test_file_sheet_trash_disagreement_is_counted_without_repair(self):
        row = document("Sheet", "sheet-1", trashed=1)
        source = FakeContent(documents=[row], files=[file_for(row, "file-1", ACTIVE)])
        env, target = self.environment(source)
        add_document_node(target, "file-1", row, state=ACTIVE)

        result = link_content_documents(env)

        self.assertEqual(result.trash_disagreements, 1)
        self.assertEqual(target.node_rows["file-1"]["state"], ACTIVE)
        self.assertEqual(source.document_rows[(row.doctype, row.name)].trashed, 1)

    def test_removed_file_is_not_reclassified_as_an_orphan(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], files=[file_for(row, "file-1", REMOVED)])
        env, _ = self.environment(source)

        with self.assertRaisesRegex(BuildContentError, "Removed File"):
            link_content_documents(env)

    def test_orphan_node_and_link_rollback_as_one_unit(self):
        row = document("Writer Document", "writer-1")
        source = FakeContent(documents=[row], users={OWNER: True})
        env, target = self.environment(source)
        target.fail_unit = "writer-1"

        with self.assertRaises(InterruptedRun):
            link_content_documents(env)
        self.assertNotIn("writer-1", target.node_rows)
        self.assertIsNone(source.document_rows[(row.doctype, row.name)].node)

    def test_content_shares_merge_and_a_direct_deny_wins(self):
        row = document("Writer Document", "writer-1", node="node-1")
        shares = [
            ContentShareRow("share-1", row.doctype, row.name, user="reader@example.com", read=1),
            ContentShareRow("share-2", row.doctype, row.name, everyone=1, share=1),
            ContentShareRow("share-3", row.doctype, row.name, user="missing@example.com", write=1),
            ContentShareRow("share-4", "Writer Version", "old-version", user="reader@example.com", read=1),
        ]
        source = FakeContent(
            documents=[row],
            shares=shares,
            users={"reader@example.com": True},
        )
        env, target = self.environment(source)
        add_document_node(target, "node-1", row)
        target.grant_rows["deny"] = {
            "name": "deny",
            "node": "node-1",
            "principal": "reader@example.com",
            "role": NONE,
        }

        result = link_content_documents(env, batch_size=2)

        self.assertEqual(target.grant_roles("node-1", ("reader@example.com",))["reader@example.com"], NONE)
        self.assertEqual(target.grant_roles("node-1", (GENERAL,))[GENERAL], MANAGE)
        self.assertEqual(result.docshare_rows_dropped, 2)
        self.assertEqual(len(source.share_rows), 4)

    def test_share_without_any_effective_right_is_dropped(self):
        row = document("Writer Document", "writer-1", node="node-1")
        share = ContentShareRow("share-1", row.doctype, row.name, user="reader@example.com")
        source = FakeContent(documents=[row], shares=[share], users={"reader@example.com": True})
        env, target = self.environment(source)
        add_document_node(target, "node-1", row)

        result = link_content_documents(env)

        self.assertEqual(result.docshare_rows_dropped, 1)
        self.assertNotIn("reader@example.com", target.grant_roles("node-1", ("reader@example.com",)))


if __name__ == "__main__":
    unittest.main()
