"""Template folder and document conversion."""

import tempfile
import unittest
from pathlib import Path

from suite.drive._core.roles import MANAGE, READ
from suite.drive.patches.build.content_mapping import InvalidLegacyContent
from suite.drive.patches.build.mapping import GENERAL
from suite.drive.patches.build.ports import ContentRow, WriterTemplateRow
from suite.drive.patches.build.templates import convert_templates
from suite.drive.patches.build.tests.fakes import (
    FakeContent,
    FakeContentTarget,
    InterruptedRun,
    build_environment,
)

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def writer_template(name, title="Template", owner=OWNER):
    return WriterTemplateRow(
        name=name,
        title=title,
        content="<p>Exact HTML</p>",
        keymap="vim",
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

    def test_writer_template_creates_noncollaborative_document_node_and_grants(self):
        source_row = writer_template("writer-template")
        source = FakeContent(writer_templates=[source_row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env, env.state.content())

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

        convert_templates(env, env.state.content())
        self.assertEqual(len(target.writer_rows), 1)

    def test_administrator_owned_template_has_no_redundant_owner_grant(self):
        row = writer_template("writer-template", owner="Administrator")
        source = FakeContent(writer_templates=[row], users={"Administrator": True})
        env, target = self.environment(source)

        convert_templates(env, env.state.content())

        self.assertEqual(target.grant_roles(row.name, (GENERAL,))[GENERAL], READ)
        self.assertNotIn("Administrator", target.grant_roles(row.name, ("Administrator",)))

    def test_presentation_template_uses_its_source_id_and_gets_linked(self):
        row = presentation_template("deck-template")
        source = FakeContent(documents=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)

        folder = convert_templates(env, env.state.content())

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

        convert_templates(env, env.state.content())

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

        folder = convert_templates(env, env.state.content())

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
            convert_templates(env, env.state.content())

    def test_template_logical_unit_rolls_back_after_interruption(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True, OWNER: True})
        env, target = self.environment(source)
        target.fail_unit = row.name

        with self.assertRaises(InterruptedRun):
            convert_templates(env, env.state.content())
        self.assertNotIn(row.name, target.writer_rows)
        self.assertNotIn(row.name, target.node_rows)
        self.assertFalse(target.grant_roles(row.name, (GENERAL, OWNER)))

    def test_missing_non_administrator_owner_is_refused(self):
        row = writer_template("writer-template")
        source = FakeContent(writer_templates=[row], users={"Administrator": True})
        env, _ = self.environment(source)

        with self.assertRaisesRegex(InvalidLegacyContent, "has no User row"):
            convert_templates(env, env.state.content())


if __name__ == "__main__":
    unittest.main()
