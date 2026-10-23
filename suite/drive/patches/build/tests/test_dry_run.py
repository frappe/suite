"""The dry run: Build's numbers from the fakes, with one JSON file as its only write."""

import json
import tempfile
import unittest
from pathlib import Path

from suite.drive.patches.build.dry_run import (
    BYTES_LOCAL,
    BYTES_S3,
    CONTENT_ADOPTED_TEMPLATE,
    CONTENT_CREATED_TEMPLATE,
    CONTENT_LINKED,
    CONTENT_ORPHAN,
    DOCSHARE_DROPPED,
    DOCSHARE_FATES,
    RESULT_PREFIX,
    dry_run,
)
from suite.drive.patches.build.legacy import (
    BARE_ROOT_KEY,
    LEADING_SLASH,
    ROOT_FOLDER,
    UNDER_ROOT_FOLDER,
    get_s3_url,
)
from suite.drive.patches.build.ports import (
    ACTIVE,
    DRIVE_ROOT_ROW,
    REMOVED,
    TRASHED,
    USERS_ROW,
    ContentRow,
    ContentShareRow,
    DocShareRow,
    PermissionRow,
    TreeRow,
)
from suite.drive.patches.build.preflight import GO, DiskSettings
from suite.drive.patches.build.tests.fakes import (
    FakeBucket,
    FakeContent,
    FakeDrive,
    FakeTree,
    build_environment,
)
from suite.drive.patches.build.tree import DEPTH_CAP

ALICE = "alice@example.com"
GHOST = "ghost@example.com"
STAMP = "2020-01-01 00:00:00.000000"
ROOT_FOLDER_NAME = "drive"
S3_KEYS = {
    LEADING_SLASH: "/photos/holiday.jpg",
    BARE_ROOT_KEY: "report.pdf",
    UNDER_ROOT_FOLDER: f"{ROOT_FOLDER_NAME}/team/notes.txt",
    ROOT_FOLDER: "team/budget.xlsx",
}


def row(name, folder, **columns):
    columns.setdefault("file_name", name)
    columns.setdefault("creation", STAMP)
    columns.setdefault("modified", STAMP)
    columns.setdefault("owner", ALICE)
    columns.setdefault("status", ACTIVE)
    return TreeRow(name=name, folder=folder, **columns)


def folder(name, parent, **columns):
    return row(name, parent, is_folder=1, **columns)


def legacy_site():
    """One of everything the census counts, each shape exactly once."""
    rows = [
        folder(DRIVE_ROOT_ROW, None, file_name="Drive", owner="Administrator"),
        folder(USERS_ROW, None, file_name="Users", owner="Administrator"),
        folder("u-alice", USERS_ROW, file_name=ALICE),
        folder("u-ghost", USERS_ROW, file_name=GHOST),
        folder("team", DRIVE_ROOT_ROW),
        # One S3 file per key shape, one local file.
        *(row(f"s3-{index}", "team", file_url=get_s3_url(key)) for index, key in enumerate(S3_KEYS.values())),
        row("local", "team", file_url="/private/files/local.pdf"),
        # A document, a template deck with a File row, a link.
        row("doc-file", "team", content_doctype="Writer Document", content_docname="doc-1"),
        row("deck-file", "team", content_doctype="Presentation", content_docname="deck-old"),
        row("link", "team", file_type="Link", file_url="https://example.com"),
        # Two siblings share a title; a trashed sibling takes none.
        row("dup-a", "team", file_name="Same.txt", file_url="/private/files/a.txt"),
        row(
            "dup-b",
            "team",
            file_name="Same.txt",
            file_url="/private/files/b.txt",
            creation="2021-01-01 00:00:00",
        ),
        row("binned", "team", status=TRASHED, file_modified=STAMP, file_url="/private/files/binned.txt"),
        # A row whose parent is a file, a Removed subtree, a broken chain.
        row("under-a-file", "local", file_url="/private/files/under.txt"),
        folder("removed", "team", status=REMOVED),
        row("under-removed", "removed", file_url="/private/files/under-removed.txt"),
        row("dangling", "no-such-folder", file_url="/private/files/dangling.txt"),
        # frappe's own attachments, which are not Drive's.
        folder("Home", None, file_name="Home", owner="Administrator"),
        row("attachment", "Home", file_url="/private/files/attachment.txt"),
    ]
    # A chain one level past the cap, with a file below the refused folder.
    parent = "u-alice"
    for depth in range(1, DEPTH_CAP + 2):
        rows.append(folder(f"d{depth}", parent))
        parent = f"d{depth}"
    rows.append(row("too-deep", parent, file_url="/private/files/deep.txt"))

    tree = FakeTree(
        rows,
        permissions=[PermissionRow("perm-1", "team", ALICE, read=1)],
        docshares=[DocShareRow("share-sheet", "sheet-1", user=ALICE, read=1)],
        users={ALICE: True},
    )
    content = FakeContent(
        documents=[
            ContentRow("Writer Document", "doc-1"),
            ContentRow("Presentation", "deck-old", is_template=1),
            ContentRow("Presentation", "deck-new", is_template=1),
            ContentRow("Sheet", "sheet-1"),
        ],
        files=[tree.rows["doc-file"], tree.rows["deck-file"]],
        shares=[
            ContentShareRow("share-doc", "Writer Document", "doc-1", user=ALICE, read=1),
            ContentShareRow("share-version", "Writer Version", "v-1", user=ALICE, read=1),
        ],
    )
    bucket = FakeBucket()
    for key in S3_KEYS.values():
        bucket.put(key, b"bytes")
    return tree, content, bucket


class DryRunCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.tree, self.content, self.bucket = legacy_site()
        self.drive = FakeDrive()
        self.env = build_environment(
            self.path, tree=self.tree, drive=self.drive, content=self.content, bucket=self.bucket
        )
        self.out = self.path / "private"
        self.result = dry_run(self.env, directory=self.out, disk=DiskSettings(root_folder=ROOT_FOLDER_NAME))
        self.report = self.result.report


class Counts(DryRunCase):
    def test_the_roots_are_decided_as_step_4_decides_them(self):
        self.assertEqual(
            self.report["roots"],
            {"Shared, Active": 1, "Personal, Active": 1, "Personal, Archived: no User row for the email": 1},
        )
        self.assertEqual(self.report["roots_naming_no_user"], [f"u-ghost ({GHOST})"])

    def test_nodes_are_counted_by_kind_and_byte_source(self):
        self.assertEqual(
            self.report["nodes_by_kind"],
            {"folder": 1 + DEPTH_CAP, "file": 8, "document": 2, "link": 1},
        )
        self.assertEqual(
            self.report["document_nodes_by_content_doctype"], {"Writer Document": 1, "Presentation": 1}
        )
        self.assertEqual(self.report["file_nodes_by_byte_source"], {BYTES_S3: 4, BYTES_LOCAL: 4})
        self.assertEqual(self.report["file_nodes_s3_by_shape"], {shape: 1 for shape in S3_KEYS})
        self.assertEqual(self.report["nodes_trashed"], 1)
        self.assertEqual(self.report["title_renames"], 1)
        self.assertEqual(
            self.report["file_rows_by_status"], {ACTIVE: 21 + DEPTH_CAP + 1, TRASHED: 1, REMOVED: 1}
        )

    def test_every_skip_build_would_make_is_counted_with_its_reason(self):
        skips = self.report["skips"]
        self.assertEqual(
            skips["refusing"],
            {
                "over_capacity_skipped": 1,
                "invalid_parent_skipped": 1,
                "unsaveable_skipped": 0,
                "roots_skipped": 0,
                # Build counts a refused row itself here as well as under its
                # own counter, and every row below it: d41, under-a-file, too-deep.
                "unmigrated_reachable": 3,
            },
        )
        self.assertEqual(skips["reported"], {"removed_rows_skipped": 2, "broken_chains_skipped": 1})
        reasons = "\n".join(f"{entry['file']}: {entry['reason']}" for entry in self.report["skipped_rows"])
        self.assertIn(f"d{DEPTH_CAP + 1}: depth {DEPTH_CAP + 1} is past the cap of {DEPTH_CAP}", reasons)
        self.assertIn("under-a-file: parent local is a file", reasons)
        self.assertIn("dangling: the folder chain does not terminate", reasons)
        self.assertIn("too-deep: reachable from a Drive root and gets no node", reasons)
        self.assertEqual(self.report["rows_outside_drive"], 2)
        self.assertEqual(self.report["capacity"]["max_depth"], DEPTH_CAP + 1)

    def test_grants_and_content_are_sorted_by_what_build_does_with_them(self):
        self.assertEqual(self.report["drive_permission_rows"], 1)
        self.assertEqual(
            self.report["docshare_rows"],
            [
                {"share_doctype": "Sheet", "rows": 1, "fate": DOCSHARE_FATES["Sheet"]},
                {"share_doctype": "Writer Document", "rows": 1, "fate": DOCSHARE_FATES["Writer Document"]},
                {"share_doctype": "Writer Version", "rows": 1, "fate": DOCSHARE_DROPPED},
            ],
        )
        self.assertEqual(
            self.report["content_documents"],
            {
                "Writer Document": {"rows": 1, CONTENT_LINKED: 1},
                "Sheet": {"rows": 1, CONTENT_ORPHAN: 1},
                "Presentation": {"rows": 2, CONTENT_ADOPTED_TEMPLATE: 1, CONTENT_CREATED_TEMPLATE: 1},
            },
        )


class Output(DryRunCase):
    def test_the_preflight_verdict_leads_and_the_census_is_printed_as_tables(self):
        self.assertEqual(self.report["verdict"], GO)
        rendered = self.result.render()
        self.assertTrue(rendered.startswith("Drive Build dry run: GO"))
        for heading in ("Roots (step 4)", "Rows Build skips", "Grants (steps 6 and 10)", "Content documents"):
            self.assertIn(heading, rendered)
        self.assertIn("over_capacity_skipped", rendered)
        self.assertIn("drive_build_accept_skips", rendered)

    def test_the_report_is_saved_once_as_json_under_the_given_directory(self):
        self.assertEqual(self.result.path.parent, self.out)
        self.assertTrue(self.result.path.name.startswith(RESULT_PREFIX))
        self.assertEqual(json.loads(self.result.path.read_text()), json.loads(json.dumps(self.report)))
        self.assertEqual(sorted(self.out.iterdir()), [self.result.path])

    def test_nothing_else_is_written(self):
        self.assertEqual(self.drive.node_rows, {})
        self.assertEqual(self.drive.root_rows, {})
        self.assertEqual(self.drive.grant_rows, {})
        self.assertEqual(self.drive.commits, 0)
        self.assertEqual(self.env.files.commits, 0)
        self.assertEqual(self.bucket.copies, [])
        self.assertEqual(self.bucket.opened, [])
        self.assertFalse(self.env.state.path.exists())
        self.assertEqual(sorted(self.path.iterdir()), [self.out])
