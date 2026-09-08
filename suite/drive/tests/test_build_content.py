"""Ticket 28 conversion wiring against real Frappe tables.

The site-free suite proves the mapping matrix. These narrow fixtures prove
that bulk target rows, source queries, and exact blob bytes fit the shipped
schemas. Run them only at the ticket 28 site gate.

Every row a test makes carries a per-run prefix, and every id Build mints
here comes from `make_id`, which mints prefixed ids too. So `tearDown`
deletes the whole fixture by prefix, children before parents, and a blob is
dropped only when no surviving row still points at it.
"""

import base64
import hashlib
import io
import json
import shutil
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils import get_datetime
from PIL import Image

from suite.drive._core.content import clear_registry_cache, spec_for
from suite.drive._core.nodes import views
from suite.drive._core.roles import MANAGE, READ
from suite.drive.framework import principals_for_principal
from suite.drive.patches.build.content import MIMES, link_content_documents
from suite.drive.patches.build.content_mapping import (
    decode_sheets_data,
    derived_name,
    epoch_millis,
    sheet_anchor,
    sheet_version_bytes,
)
from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.history import convert_history_and_comments
from suite.drive.patches.build.mapping import GENERAL, PUBLIC
from suite.drive.patches.build.ports import (
    ACTIVE,
    PERSONAL,
    SiteContentSource,
    SiteContentTarget,
)
from suite.drive.patches.build.slide_journal import SlideBody, SlidePreimageJournal
from suite.drive.patches.build.slides import convert_slides_and_templates
from suite.drive.patches.build.state import BuildState, GrantConversion, TreeConversion

# One fixed stamp for every source row and for `env.now()`. A fixture with a
# clock has no exact expected value for the rows Build authors itself.
STAMP = "2024-01-02 03:04:05.000000"
OLDER = "2024-01-01 00:00:00.000000"

# The target tables ticket 28 writes. `tearDown` empties them by prefix, and
# the rerun comparison reads them back whole.
TARGET_DOCTYPES = (
    "Drive Root",
    "Drive Node",
    "Drive Grant",
    "Drive Node Version",
    "Drive Comment Thread",
    "Drive Comment",
    "Drive Node Preview",
)

# The source tables §16 says Build preserves. Only `node` links and journaled
# Slide bodies may differ after a run.
SOURCE_DOCTYPES = (
    "File",
    "DocShare",
    "Writer Document",
    "Writer Version",
    "Writer Template",
    "Sheet",
    "Sheet Snapshot",
    "Presentation",
    "Slide",
)


# The two specs ticket 29 registers. `suite/hooks.py` keeps
# `drive_content_types` empty until that release, so a test that reads a spec
# registers them for its own block and drops them again.
CONTENT_TYPES = ("suite.writer.drive.SPEC", "suite.sheets.drive.SPEC")


@contextmanager
def registered_content_types():
    """Build the content registry from both specs, and leave nothing behind.

    The registry is built from `drive_content_types` and cached per request,
    so injecting the hook is the whole registration. The cache is dropped on
    the way in and on the way out, and nothing is written.
    """
    real_get_hooks = frappe.get_hooks

    # `hook`, not `key`: frappe's own signature is `get_hooks(hook=None, ...)`
    # and three framework call sites pass it by keyword.
    def hooks(hook=None, *args, **kwargs):
        if hook == "drive_content_types":
            return list(CONTENT_TYPES)
        return real_get_hooks(hook, *args, **kwargs)

    clear_registry_cache()
    try:
        with patch("frappe.get_hooks", hooks):
            yield
    finally:
        clear_registry_cache()


class InterruptedRun(RuntimeError):
    """A stopped batch. Not a `ValueError`, so no phase turns it into evidence."""


def writer_comments(values: dict) -> str:
    """One real Yjs update holding a `comments` map, as Writer stores it."""
    document = pycrdt.Doc()
    comments = document.get("comments", type=pycrdt.Map)
    for key, value in values.items():
        comments[key] = value
    return base64.b64encode(document.get_update()).decode()


def png_bytes(size: tuple[int, int], seed: str) -> bytes:
    """A PNG whose colour comes from `seed`, so its checksum is this run's."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    output = io.BytesIO()
    Image.new("RGB", size, (digest[0], digest[1], digest[2])).save(output, "PNG")
    return output.getvalue()


class BuildContentCase(IntegrationTestCase):
    """Synthetic linked documents, isolated by a unique name prefix."""

    def setUp(self):
        super().setUp()
        self.prefix = "bldct" + frappe.generate_hash(length=8)
        self.state = BuildState(Path(frappe.get_site_path("private", f"{self.prefix}-state.json")))
        self.journal = SlidePreimageJournal(
            Path(frappe.get_site_path("private", f"{self.prefix}-slide-preimages"))
        )
        # Registered before the first write, and run even when the test or
        # `tearDown` raises. The database has the class rollback behind it;
        # these two paths under `private/` have nothing.
        self.addCleanup(shutil.rmtree, self.journal.root, ignore_errors=True)
        self.addCleanup(self.state.path.unlink, missing_ok=True)
        self.state.put_tree(TreeConversion(completed=True))
        self.state.put_grants(GrantConversion(completed=True))
        self.blobs = set()
        self.minted = 0
        self.owner = self.fixture_user()
        self.root = self.write_root(self.owner)

    def tearDown(self):
        # Child rows first, then their parents, then the nodes everything
        # points at. A row left behind here is a row the next test on this
        # site reads as real legacy data.
        like = self.prefix + "%"
        self.collect_blobs()
        for doctype in ("Sheet Op Log", "Sheet Collab State"):
            frappe.db.delete(doctype, {"sheet": ("like", like)})
        # A Sheet thread and its comments are named by SHA-256, so the prefix
        # sweep below cannot see them. Their node can.
        for doctype in ("Drive Comment", "Drive Comment Thread"):
            frappe.db.delete(doctype, {"node": ("like", like)})
        for doctype in (
            "Drive Comment",
            "Drive Comment Thread",
            "Drive Node Preview",
            "Drive Node Version",
            "Drive Grant",
            "Sheet Seq",
            "Sheet Snapshot",
            "Sheet",
            "Writer Version",
            "Writer Document",
            "Writer Template",
            "Slide",
            "Presentation",
            "DocShare",
            "File",
            "Drive Node",
            "Drive Root",
            "User",
        ):
            frappe.db.delete(doctype, {"name": ("like", like)})
        self.drop_blobs()
        super().tearDown()

    # -- blobs

    def collect_blobs(self) -> None:
        """Name every blob this run's target rows point at, before they go."""
        like = self.prefix + "%"
        for doctype in ("Drive Node Version", "Drive Node Preview", "Drive Node"):
            found = frappe.get_all(doctype, filters={"name": ("like", like)}, pluck="blob")
            self.blobs.update(name for name in found if name)

    def drop_blobs(self) -> None:
        """Delete only the blobs no surviving row still references.

        `put_blob` is content addressed, so a fixture payload can land on a
        row the site already had. Deleting by checksum alone would take the
        site's bytes with it.
        """
        for name in sorted(self.blobs):
            if self.blob_referenced(name):
                continue
            frappe.db.delete("File Blob", {"name": name})

    def blob_referenced(self, name: str) -> bool:
        return bool(
            frappe.db.exists("File", {"blob": name})
            or frappe.db.exists("Drive Node", {"blob": name})
            or frappe.db.exists("Drive Node Version", {"blob": name})
            or frappe.db.exists("Drive Node Preview", {"blob": name})
            or frappe.db.exists("Drive Node Preview", {"source_blob": name})
        )

    def blob(self, data: bytes, filename: str):
        row = SiteContentTarget().put_private_blob(data, filename)
        self.blobs.add(row.name)
        return row

    # -- fixtures

    def gid(self) -> str:
        """The prefixed id Build mints, so `tearDown` reaches its rows too."""
        self.minted += 1
        return f"{self.prefix}g{self.minted:03d}"

    def fixture_user(self) -> str:
        """One isolated enabled User, inserted without hooks or queue work."""
        email = f"{self.prefix}@example.invalid"
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": "Drive Build Content", "enabled": 1})
        user.db_insert()
        return user.name

    def insert(self, doctype, name, **values):
        doc = frappe.new_doc(doctype)
        doc.update(values)
        doc.name = name
        doc.owner = values.get("owner") or self.owner
        doc.modified_by = values.get("modified_by") or doc.owner
        doc.creation = values.get("creation") or STAMP
        doc.modified = values.get("modified") or doc.creation
        doc.flags.ignore_validate = True
        doc.db_insert()
        return doc

    def write_root(self, user: str) -> str:
        """One Personal root pair, written the way ticket 27 writes it."""
        name = self.gid()
        node = {
            "name": name,
            "title": user,
            "parent": None,
            "root": None,
            "path": "",
            "kind": "root",
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
            "owner": user,
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": user,
            "docstatus": 0,
            "idx": 0,
        }
        metadata = {
            "name": name,
            "node": name,
            "user": user,
            "kind": PERSONAL,
            "state": ACTIVE,
            "quota_bytes": 0,
            "used_bytes": 0,
            "acl_generation": 0,
            "owner": user,
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": user,
            "docstatus": 0,
            "idx": 0,
        }
        SiteContentTarget().write_root_pair(node, metadata, [])
        return name

    def legacy_file(self, name, **columns):
        """One legacy Drive `File` row, written straight to the table."""
        values = {"is_folder": 0, "folder": None, "status": ACTIVE, "file_name": name, **columns}
        return self.insert("File", name, **values)

    def content_pair(self, docname: str, doctype: str, *, title=None) -> str:
        """The legacy `File` and the node ticket 27 made from it.

        The node id is the `File` id, never the content id, so a test that
        reads back a reciprocal link cannot pass on the two being equal.
        """
        node = docname + "n"
        title = title or docname
        self.legacy_file(
            node,
            file_name=title,
            content_doctype=doctype,
            content_docname=docname,
        )
        SiteContentTarget().insert_nodes(
            [
                {
                    "name": node,
                    "title": title,
                    "parent": self.root,
                    "root": self.root,
                    "path": "",
                    "kind": "document",
                    "blob": None,
                    "size": 0,
                    "mime": MIMES[doctype],
                    "url": None,
                    "content_doctype": doctype,
                    "content_docname": docname,
                    "state": ACTIVE,
                    "trashed_at": None,
                    "trash_root": None,
                    "content_modified": STAMP,
                    "is_template": 0,
                    "owner": self.owner,
                    "creation": STAMP,
                    "modified": STAMP,
                    "modified_by": self.owner,
                    "docstatus": 0,
                    "idx": 0,
                }
            ]
        )
        return node

    def slide(self, name, deck, idx, elements, background=None):
        return self.insert(
            "Slide",
            name,
            parent=deck,
            parenttype="Presentation",
            parentfield="slides",
            idx=idx,
            elements=elements,
            background=background,
        )

    def environment(self, target=None):
        return BuildEnvironment(
            storage=None,
            files=None,
            state=self.state,
            legacy_s3=LegacyS3Config(),
            content=SiteContentSource(self.prefix),
            content_target=target or SiteContentTarget(),
            slide_journal=self.journal,
            clock=lambda: STAMP,
            make_id=self.gid,
        )

    # -- one deck, one writer document, one sheet

    def writer_fixture(self, *, comments=None, versions=()) -> str:
        """A file-backed Writer document, its versions, and its comments."""
        docname = self.prefix + "wdoc"
        node = self.content_pair(docname, "Writer Document", title="Notes")
        self.insert(
            "Writer Document",
            docname,
            content="AAA=",
            html=f"<p>{self.prefix}</p>",
            collab=1,
            ycomments=comments,
        )
        for suffix, snapshot, title, manual, creation in versions:
            self.insert(
                "Writer Version",
                self.prefix + suffix,
                doc=docname,
                snapshot=snapshot,
                title=title,
                manual=manual,
                creation=creation,
            )
        return node

    def sheet_fixture(self, *, workbook=None, snapshot=None) -> str:
        """A file-backed Sheet, one snapshot, and its head link."""
        docname = self.prefix + "sheet"
        node = self.content_pair(docname, "Sheet", title="Budget")
        version = self.prefix + "snap"
        self.insert(
            "Sheet",
            docname,
            title="Budget",
            sheets_data=json.dumps(workbook or {"cells": []}),
            head_seq=7,
            head_snapshot=version if snapshot is not None else None,
        )
        if snapshot is not None:
            self.insert(
                "Sheet Snapshot",
                version,
                sheet=docname,
                seq=7,
                kind="milestone",
                pinned=1,
                actor=self.owner,
                sheets_data=json.dumps(snapshot),
            )
        return node

    def deck_fixture(self, *, elements=None, background=None) -> dict:
        """A deck with two Files on one blob, a thumbnail, and two slides."""
        docname = self.prefix + "deck"
        node = self.content_pair(docname, "Presentation", title="Deck")
        media = self.blob(png_bytes((8, 8), self.prefix + "media"), "media.png")
        thumb = self.blob(png_bytes((600, 300), self.prefix + "thumb"), "thumb.png")
        media_url = f"/files/{self.prefix}a.png"
        thumb_url = f"/files/{self.prefix}thumb.png"
        self.insert(
            "Presentation",
            docname,
            title="Deck",
            thumbnail=thumb_url,
            is_template=0,
            is_composite=0,
        )
        keeper = self.prefix + "m1"
        for name, url, creation, field in (
            (keeper, media_url, OLDER, None),
            (self.prefix + "m2", f"/files/{self.prefix}b.png", STAMP, None),
        ):
            self.legacy_file(
                name,
                file_name=name + ".png",
                file_url=url,
                blob=media.name,
                attached_to_doctype="Presentation",
                attached_to_name=docname,
                attached_to_field=field,
                file_modified=STAMP,
                creation=creation,
            )
        self.legacy_file(
            self.prefix + "m3",
            file_name="thumb.png",
            file_url=thumb_url,
            blob=thumb.name,
            attached_to_doctype="Presentation",
            attached_to_name=docname,
            attached_to_field="thumbnail",
            file_modified=STAMP,
        )
        if elements is None:
            elements = [{"type": "image", "src": media_url, "attachmentName": "a.png"}]
        # Spaced JSON in, compact JSON out: the rollback fixture restores the
        # exact stored string, separators included.
        first = self.slide(
            self.prefix + "s1",
            docname,
            1,
            json.dumps(elements),
            background=background if background is not None else media_url,
        )
        # Already compact, no media, no attachment. §12 writes no transition
        # for it, so the deck proves an unchanged Slide stays unchanged.
        untouched = json.dumps([{"type": "text", "text": "hi"}], separators=(",", ":"))
        second = self.slide(self.prefix + "s2", docname, 2, untouched)
        return {
            "docname": docname,
            "node": node,
            "keeper": keeper,
            "thumbnail": self.prefix + "m3",
            "media_blob": media.name,
            "thumb_blob": thumb.name,
            "media_url": media_url,
            "slides": (first.name, second.name),
        }

    def convert_all(self):
        """Steps 7, 8, and 10 in the accepted order."""
        convert_history_and_comments(self.environment())
        convert_slides_and_templates(self.environment())
        return link_content_documents(self.environment())

    # -- readers

    def node_row(self, name) -> dict:
        return SiteContentTarget().nodes((name,))[name]

    def media_children(self, node) -> list[dict]:
        return [row for row in SiteContentTarget().child_nodes(node) if row.get("kind") == "file"]

    def target_snapshot(self) -> dict:
        like = self.prefix + "%"
        found = {}
        for doctype in TARGET_DOCTYPES:
            rows = frappe.get_all(
                doctype, filters={"name": ("like", like)}, fields=["*"], order_by="name asc"
            )
            for row in rows:
                found[(doctype, row["name"])] = dict(row)
        return found

    def source_snapshot(self) -> dict:
        like = self.prefix + "%"
        found = {}
        for doctype in SOURCE_DOCTYPES:
            rows = frappe.get_all(
                doctype,
                filters={"name": ("like", like)},
                fields=["*"],
                order_by="name asc",
            )
            for row in rows:
                found[(doctype, row["name"])] = dict(row)
        return found

    def blob_snapshot(self) -> dict:
        target = SiteContentTarget()
        like = self.prefix + "%"
        found = {}
        for doctype in ("Drive Node Version", "Drive Node Preview"):
            for row in frappe.get_all(
                doctype, filters={"name": ("like", like)}, fields=["name", "blob"], order_by="name asc"
            ):
                found[(doctype, row.name)] = (row.blob, target.read_blob(row.blob))
        return found

    def assert_controller_accepts(self, doctype: str, name: str) -> None:
        """Replay one stored row through the two checks `_save` would run.

        Bulk SQL fires no refusal, so a written row is only proved legal by
        putting it back through the rules an insert applies. `run_method`
        runs the controller alone; `_validate` is what adds mandatory
        fields, Select options and column lengths (`Document._save` calls
        both). Neither covers `before_insert`, and it cannot: `Drive Node`
        and `Drive Root` refuse an insert without the lifecycle flag, which
        is exactly why Build writes them as bulk SQL.
        """
        stored = frappe.get_all(doctype, filters={"name": name}, fields=["*"], limit=1)[0]
        doc = frappe.new_doc(doctype)
        doc.update(dict(stored))
        doc.name = stored["name"]
        doc.run_method("validate")
        doc._validate()


class TestMigratedHistory(BuildContentCase):
    """§8: Writer versions, Sheet snapshots, and the bytes behind them."""

    def test_writer_ids_labels_and_bytes_survive_an_identical_rerun(self):
        """§8 keeps the id, the sequence, the label, and the pinning."""
        old = f"<p>{self.prefix} old</p>"
        node = self.writer_fixture(
            versions=(
                ("a", old, None, 0, STAMP),
                ("b", f"<p>{self.prefix} named</p>", "Named", 1, STAMP),
            )
        )

        first = convert_history_and_comments(self.environment())
        second = convert_history_and_comments(self.environment())
        rows = frappe.get_all(
            "Drive Node Version",
            filters={"node": node},
            fields=["name", "seq", "kind", "label", "pinned", "actor", "blob"],
            order_by="seq",
        )
        self.blobs.update(row.blob for row in rows)
        # `manual` is the only source of `kind`, and `title` is the only
        # source of `label`. A migration that dropped either would still
        # produce two rows in the right order.
        self.assertEqual(
            [(row.name, row.seq, row.kind, row.label, row.pinned, row.actor) for row in rows],
            [
                (self.prefix + "a", 1, "auto", None, 0, self.owner),
                (self.prefix + "b", 2, "named", "Named", 0, self.owner),
            ],
        )
        self.assertEqual(SiteContentTarget().read_blob(rows[0].blob), old.encode("utf-8"))
        self.assertEqual(first.versions_seen, second.versions_seen)

    def test_sheet_payload_and_sparse_head_id_survive_an_identical_rerun(self):
        workbook = {"cells": [self.prefix]}
        self.sheet_fixture(snapshot=workbook)
        version = self.prefix + "snap"

        convert_history_and_comments(self.environment())
        report = convert_history_and_comments(self.environment())
        row = frappe.db.get_value(
            "Drive Node Version", version, ["name", "seq", "blob", "pinned", "kind"], as_dict=True
        )
        self.blobs.add(row.blob)
        payload = json.loads(SiteContentTarget().read_blob(row.blob))
        self.assertEqual((row.name, row.seq, row.pinned, row.kind), (version, 7, 1, "milestone"))
        self.assertEqual(
            payload,
            {"schema": "sheet/1", "sheets_data": json.dumps(workbook), "head_seq": 7},
        )
        # §8 repoints the stored head at the migrated row by keeping its id.
        self.assertEqual(frappe.db.get_value("Sheet", self.prefix + "sheet", "head_snapshot"), version)
        self.assertTrue(report.history_completed)

    def test_bulk_insert_keeps_every_explicit_source_id(self):
        """`autoname: hash` would have thrown these names away on insert.

        `Document.insert` always calls `set_new_name`, which nulls a
        caller-supplied name for a hash-named doctype
        (`frappe/model/naming.py:161-162`). Only the two paths that skip it
        keep a migrated id: `bulk_insert`, which Build uses, and `db_insert`
        with the name already set, which this fixture uses for its sources.
        """
        thread = self.prefix + "th"
        reply = self.prefix + "rp"
        node = self.writer_fixture(
            comments=writer_comments(
                {
                    thread: {
                        "id": thread,
                        "text": "First",
                        "owner": self.owner,
                        "creation": 1_000,
                        "replies": [{"id": reply, "text": "Later", "owner": self.owner, "creation": 2_000}],
                    }
                }
            ),
            versions=(("a", f"<p>{self.prefix} one</p>", None, 0, STAMP),),
        )

        convert_history_and_comments(self.environment())

        self.assertEqual(
            frappe.get_all("Drive Node Version", filters={"node": node}, pluck="name"),
            [self.prefix + "a"],
        )
        self.assertEqual(
            frappe.get_all("Drive Comment Thread", filters={"node": node}, pluck="name"),
            [thread],
        )
        self.assertEqual(
            frappe.get_all("Drive Comment", filters={"node": node}, pluck="name", order_by="idx asc"),
            [thread, reply],
        )

    def test_version_blobs_are_private_ready_and_byte_exact(self):
        html = f"<p>{self.prefix}</p>"
        workbook = {"cells": [self.prefix]}
        self.writer_fixture(versions=(("a", html, None, 0, STAMP),))
        self.sheet_fixture(snapshot=workbook)
        target = SiteContentTarget()

        convert_history_and_comments(self.environment())

        expected = {
            self.prefix + "a": html.encode("utf-8"),
            self.prefix + "snap": sheet_version_bytes(json.dumps(workbook), 7),
        }
        for name, raw in expected.items():
            row = frappe.db.get_value("Drive Node Version", name, ["blob", "size"], as_dict=True)
            self.blobs.add(row.blob)
            blob = target.blob(row.blob)
            self.assertEqual(row.size, len(raw))
            self.assertEqual(blob.status, "Ready")
            self.assertEqual(blob.is_private, 1)
            self.assertEqual(blob.file_size, len(raw))
            self.assertEqual(target.read_blob(row.blob), raw)

    def test_both_adapters_restore_a_migrated_version(self):
        """§8: migration must not create history the products cannot read.

        Reached through the registry, not through `suite.writer` and
        `suite.sheets`. The charter bars Drive from importing a content
        product, and §10.3 is the seam that makes the import unnecessary.
        """
        html = f"<p>{self.prefix} restored</p>"
        workbook = {"cells": [self.prefix]}
        self.writer_fixture(versions=(("a", html, None, 0, STAMP),))
        self.sheet_fixture(snapshot=workbook)
        target = SiteContentTarget()

        convert_history_and_comments(self.environment())

        writer_blob = frappe.db.get_value("Drive Node Version", self.prefix + "a", "blob")
        sheet_blob = frappe.db.get_value("Drive Node Version", self.prefix + "snap", "blob")
        self.blobs.update((writer_blob, sheet_blob))
        with registered_content_types():
            spec_for("Writer Document").restore_version(
                self.prefix + "wdoc", io.BytesIO(target.read_blob(writer_blob))
            )
            spec_for("Sheet").restore_version(self.prefix + "sheet", io.BytesIO(target.read_blob(sheet_blob)))

        restored = frappe.db.get_value(
            "Writer Document", self.prefix + "wdoc", ["content", "html", "collab"], as_dict=True
        )
        self.assertEqual((restored.content, restored.html, restored.collab), ("AAA=", html, 0))
        sheet = frappe.db.get_value("Sheet", self.prefix + "sheet", ["sheets_data", "head_seq"], as_dict=True)
        self.assertEqual(json.loads(decode_sheets_data(sheet.sheets_data)), workbook)
        self.assertEqual(sheet.head_seq, 1)

    def test_an_interrupted_version_run_resumes_without_duplicates(self):
        """A stopped batch leaves its written rows; the next run adds the rest."""

        class StopsOnTheSecondBatch(SiteContentTarget):
            def __init__(self):
                self.batches = 0

            def insert_versions(self, rows):
                self.batches += 1
                if self.batches > 1:
                    raise InterruptedRun("stopped between two version batches")
                super().insert_versions(rows)

        node = self.writer_fixture(
            versions=(
                ("a", f"<p>{self.prefix} first</p>", None, 0, OLDER),
                ("b", f"<p>{self.prefix} second</p>", None, 0, STAMP),
            )
        )

        with self.assertRaises(InterruptedRun):
            convert_history_and_comments(self.environment(StopsOnTheSecondBatch()), batch_size=2)
        self.assertEqual(
            frappe.get_all("Drive Node Version", filters={"node": node}, pluck="name"),
            [self.prefix + "a"],
        )

        report = convert_history_and_comments(self.environment(), batch_size=2)

        rows = frappe.get_all(
            "Drive Node Version",
            filters={"node": node},
            fields=["name", "seq"],
            order_by="seq asc",
        )
        self.assertEqual(
            [(row.name, row.seq) for row in rows],
            [(self.prefix + "a", 1), (self.prefix + "b", 2)],
        )
        self.assertEqual(report.versions_seen, 2)
        self.assertTrue(report.history_completed)

    def test_the_unique_version_index_refuses_a_second_row_at_one_sequence(self):
        """§8 preflights `(node, seq)`; the database is what makes that true."""
        node = self.writer_fixture(versions=(("a", f"<p>{self.prefix} one</p>", None, 0, STAMP),))
        convert_history_and_comments(self.environment())
        stored = frappe.db.get_value("Drive Node Version", self.prefix + "a", ["blob", "size"], as_dict=True)
        self.blobs.add(stored.blob)

        duplicate = frappe.new_doc("Drive Node Version")
        duplicate.update(
            {
                "node": node,
                "seq": 1,
                "kind": "auto",
                "actor": self.owner,
                "size": stored.size,
                "blob": stored.blob,
            }
        )
        duplicate.name = self.prefix + "dupe"
        duplicate.flags.ignore_validate = True

        frappe.db.savepoint("drive_fixture_version")
        with self.assertRaises(frappe.UniqueValidationError):
            duplicate.db_insert()
        frappe.db.rollback(save_point="drive_fixture_version")

        self.assertEqual(
            frappe.get_all("Drive Node Version", filters={"node": node}, pluck="name"),
            [self.prefix + "a"],
        )


class TestMigratedComments(BuildContentCase):
    """§9: anchors, authors, display names, mentions, and stamps."""

    def test_writer_comment_authors_mentions_and_stamps_survive(self):
        thread = self.prefix + "th"
        reply = self.prefix + "rp"
        node = self.writer_fixture(
            comments=writer_comments(
                {
                    thread: {
                        "id": thread,
                        "text": "First",
                        "owner": "deleted@example.invalid",
                        "creation": 1_000,
                        "mentions": [{"id": "a@example.invalid"}],
                        "resolved": True,
                        "replies": [
                            {
                                "id": reply,
                                "text": "Later",
                                "owner": "",
                                "creation": 2_000,
                                "mentions": ["b@example.invalid"],
                            }
                        ],
                    }
                }
            )
        )
        timezone = SiteContentSource().site_timezone()

        report = convert_history_and_comments(self.environment())

        stored = frappe.db.get_value(
            "Drive Comment Thread",
            thread,
            ["node", "anchor", "resolved", "resolved_by", "resolved_at", "owner"],
            as_dict=True,
        )
        self.assertEqual(stored.node, node)
        self.assertEqual(stored.anchor, thread)
        self.assertEqual(stored.resolved, 1)
        # The reply has a blank author, so §9's last complete entry is the
        # first comment, deleted user and all.
        self.assertEqual(stored.resolved_by, "deleted@example.invalid")
        self.assertEqual(stored.resolved_at, get_datetime(epoch_millis(1_000, timezone)))
        self.assertEqual(stored.owner, "deleted@example.invalid")

        first = frappe.db.get_value(
            "Drive Comment",
            thread,
            ["content", "author", "author_name", "mentions", "creation", "idx"],
            as_dict=True,
        )
        self.assertEqual(first.content, "First")
        self.assertEqual(first.author, "deleted@example.invalid")
        self.assertIsNone(first.author_name)
        self.assertEqual(json.loads(first.mentions), ["a@example.invalid"])
        self.assertEqual(first.creation, get_datetime(epoch_millis(1_000, timezone)))
        self.assertEqual(first.idx, 1)

        second = frappe.db.get_value(
            "Drive Comment", reply, ["author", "mentions", "creation", "idx"], as_dict=True
        )
        self.assertEqual(second.author, "Guest")
        self.assertEqual(json.loads(second.mentions), ["b@example.invalid"])
        self.assertEqual(second.creation, get_datetime(epoch_millis(2_000, timezone)))
        self.assertEqual(second.idx, 2)
        self.assertEqual(report.comments_seen, 2)

    def test_sheet_comment_anchor_display_name_and_ids_survive(self):
        docname = self.prefix + "sheet"
        workbook = {
            "comments": {
                "Résumé": {
                    "A/1": {
                        "resolved": False,
                        "thread": [
                            {
                                "text": "Cell note",
                                "author": self.owner,
                                "name": "Cell User",
                                "ts": 3_000,
                                "mentions": [{"id": "m@example.invalid"}],
                            }
                        ],
                    }
                }
            }
        }
        node = self.sheet_fixture(workbook=workbook)
        timezone = SiteContentSource().site_timezone()

        convert_history_and_comments(self.environment())

        thread_id = derived_name("drive-sheet-thread/1", docname, "Résumé", "A/1")
        comment_id = derived_name("drive-sheet-comment/1", thread_id, 0)
        thread = frappe.db.get_value(
            "Drive Comment Thread",
            thread_id,
            ["node", "anchor", "resolved", "resolved_by", "resolved_at"],
            as_dict=True,
        )
        self.assertEqual(thread.node, node)
        self.assertEqual(thread.anchor, sheet_anchor("Résumé", "A/1"))
        self.assertEqual(thread.anchor, '["Résumé","A/1"]')
        self.assertEqual(thread.resolved, 0)
        self.assertIsNone(thread.resolved_by)
        self.assertIsNone(thread.resolved_at)

        comment = frappe.db.get_value(
            "Drive Comment",
            comment_id,
            ["thread", "content", "author", "author_name", "mentions", "creation"],
            as_dict=True,
        )
        self.assertEqual(comment.thread, thread_id)
        self.assertEqual(comment.content, "Cell note")
        self.assertEqual(comment.author, self.owner)
        self.assertEqual(comment.author_name, "Cell User")
        self.assertEqual(json.loads(comment.mentions), ["m@example.invalid"])
        self.assertEqual(comment.creation, get_datetime(epoch_millis(3_000, timezone)))


class TestContentLinksAndSources(BuildContentCase):
    """§6 and §16: the reciprocal link, and everything Build must not touch."""

    def full_fixture(self) -> dict:
        """One document of each governed kind, plus a preserved share.

        No `Writer Template`. Step 8 creates a `Writer Document` row for one,
        and this fixture backs `test_sources_survive_except_slide_bodies_and_new_links`,
        which asserts the source tables hold the same rows before and after.
        A template is a new source row by design, so it belongs in
        `TestTemplates`, which runs both template types through step 8 and
        step 10.
        """
        thread = self.prefix + "th"
        writer = self.writer_fixture(
            comments=writer_comments(
                {thread: {"id": thread, "text": "First", "owner": self.owner, "creation": 1_000}}
            ),
            versions=(("a", f"<p>{self.prefix}</p>", None, 0, STAMP),),
        )
        sheet = self.sheet_fixture(snapshot={"cells": [self.prefix]})
        deck = self.deck_fixture()
        self.insert(
            "DocShare",
            self.prefix + "share",
            share_doctype="Writer Document",
            share_name=self.prefix + "wdoc",
            user=None,
            read=1,
            everyone=1,
        )
        return {"writer": writer, "sheet": sheet, "deck": deck, "thread": thread}

    def test_the_content_link_is_reciprocal_and_the_pair_is_immutable(self):
        node = self.writer_fixture(versions=(("a", f"<p>{self.prefix} one</p>", None, 0, STAMP),))

        report = self.convert_all()

        self.assertEqual(frappe.db.get_value("Writer Document", self.prefix + "wdoc", "node"), node)
        stored = self.node_row(node)
        self.assertEqual(stored["content_doctype"], "Writer Document")
        self.assertEqual(stored["content_docname"], self.prefix + "wdoc")
        self.assertEqual(report.orphan_content_docs_adopted, 0)

        document = frappe.get_doc("Drive Node", node)
        document.content_docname = self.prefix + "other"
        # Link validation would refuse the missing document first, and the
        # controller rule is what this asserts.
        document.flags.ignore_links = True
        with self.assertRaises(frappe.ValidationError):
            document.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Drive Node", node, "content_docname"), self.prefix + "wdoc")

    def test_an_orphan_document_is_adopted_into_its_owner_personal_root(self):
        """§6: a content document no `File` claims still gets a node."""
        docname = self.prefix + "orphan"
        self.insert("Writer Document", docname, content="AAA=", html="<p>lost</p>", collab=0)

        report = link_content_documents(self.environment())
        second = link_content_documents(self.environment())

        # The orphan node takes the document id, and the Personal Root is
        # the owner's, not Administrator's.
        node = self.node_row(docname)
        self.assertEqual(node["parent"], self.root)
        self.assertEqual(node["root"], self.root)
        self.assertEqual(node["kind"], "document")
        self.assertEqual(node["mime"], MIMES["Writer Document"])
        self.assertEqual(node["state"], ACTIVE)
        self.assertEqual(node["is_template"], 0)
        # `documents()` reads no title for a Writer Document, so §6's
        # fallback is what names it.
        self.assertEqual(node["title"], "Untitled Document")
        self.assertEqual(frappe.db.get_value("Writer Document", docname, "node"), docname)
        self.assertEqual(report.orphan_content_docs_adopted, 1)
        # Adoption is reported every run, and it writes one node, not two.
        self.assertEqual(second.orphan_content_docs_adopted, 1)
        self.assertEqual(
            frappe.get_all("Drive Node", filters={"content_docname": docname}, pluck="name"),
            [docname],
        )
        self.assert_controller_accepts("Drive Node", docname)

    def test_every_written_row_passes_its_controller(self):
        """Bulk SQL fires no refusal, so every row is replayed through one."""
        self.full_fixture()

        self.convert_all()

        like = self.prefix + "%"
        checked = 0
        for doctype in TARGET_DOCTYPES:
            for name in frappe.get_all(doctype, filters={"name": ("like", like)}, pluck="name"):
                self.assert_controller_accepts(doctype, name)
                checked += 1
        # The root pair, the deck, the two documents, the sheet, one media
        # child, one version, one thread, one comment, and one preview at
        # least. A silent zero would make this test vacuous.
        self.assertGreaterEqual(checked, 10)

    def test_sources_survive_except_slide_bodies_and_new_links(self):
        """§16: only `node` links and journaled Slide bodies may change."""
        fixture = self.full_fixture()
        deck = fixture["deck"]
        before = self.source_snapshot()

        self.convert_all()

        after = self.source_snapshot()
        self.assertEqual(sorted(after), sorted(before))
        changed = {}
        for key, row in after.items():
            difference = {field: value for field, value in row.items() if before[key].get(field) != value}
            if difference:
                changed[key] = set(difference)
        self.assertEqual(
            changed,
            {
                ("Writer Document", self.prefix + "wdoc"): {"node"},
                ("Sheet", self.prefix + "sheet"): {"node"},
                ("Presentation", deck["docname"]): {"node"},
                ("Slide", deck["slides"][0]): {"elements", "background"},
            },
        )
        self.assertEqual(
            after[("Presentation", deck["docname"])]["modified"],
            before[("Presentation", deck["docname"])]["modified"],
        )
        preserved = after[("DocShare", self.prefix + "share")]
        self.assertEqual((preserved["read"], preserved["everyone"]), (1, 1))
        self.assertEqual(
            frappe.db.get_value("Drive Grant", {"node": fixture["writer"], "principal": GENERAL}, "role"),
            READ,
        )


class TestSlideMedia(BuildContentCase):
    """§11 and §12: media children, previews, and the durable journal."""

    def test_one_media_child_per_deck_and_blob(self):
        deck = self.deck_fixture()

        report = convert_slides_and_templates(self.environment())

        children = self.media_children(deck["node"])
        self.assertEqual([row["name"] for row in children], [deck["keeper"]])
        self.assertEqual(children[0]["blob"], deck["media_blob"])
        self.assertEqual(children[0]["parent"], deck["node"])
        self.assertEqual(children[0]["path"], f"/{deck['node']}/")
        self.assertEqual(children[0]["mime"], "image/png")
        self.assertEqual(report.media_nodes_created, 1)
        self.assertEqual(report.media_duplicates_collapsed, 1)
        self.assertEqual(report.blobless_nodes, 0)

        rewritten = json.loads(frappe.db.get_value("Slide", deck["slides"][0], "elements"))
        self.assertEqual(rewritten, [{"type": "image", "src": deck["keeper"]}])
        self.assertEqual(frappe.db.get_value("Slide", deck["slides"][0], "background"), deck["keeper"])
        self.assertEqual(report.slide_elements_rewritten, 1)

    def test_the_deck_preview_is_named_by_its_file_and_unique_per_node(self):
        deck = self.deck_fixture()
        target = SiteContentTarget()

        report = convert_slides_and_templates(self.environment())

        preview = frappe.db.get_value(
            "Drive Node Preview",
            {"node": deck["node"]},
            ["name", "node", "source_blob", "blob"],
            as_dict=True,
        )
        self.blobs.add(preview.blob)
        self.assertEqual(preview.name, deck["thumbnail"])
        self.assertIsNone(preview.source_blob)
        self.assertNotEqual(preview.blob, deck["thumb_blob"])
        blob = target.blob(preview.blob)
        self.assertEqual(blob.mime_type, "image/webp")
        self.assertEqual(blob.is_private, 1)
        self.assertEqual(blob.status, "Ready")
        with Image.open(io.BytesIO(target.read_blob(preview.blob))) as image:
            self.assertEqual(image.size, (512, 256))
        self.assertEqual(report.deck_previews_created, 1)
        # The thumbnail File is excluded from ordinary media (§11).
        self.assertNotIn(deck["thumbnail"], [row["name"] for row in self.media_children(deck["node"])])

        second = frappe.new_doc("Drive Node Preview")
        second.update({"node": deck["node"], "source_blob": None, "blob": preview.blob})
        second.name = self.prefix + "dupe"
        second.flags.ignore_validate = True
        frappe.db.savepoint("drive_fixture_preview")
        with self.assertRaises(frappe.UniqueValidationError):
            second.db_insert()
        frappe.db.rollback(save_point="drive_fixture_preview")
        self.assertEqual(
            frappe.get_all("Drive Node Preview", filters={"node": deck["node"]}, pluck="name"),
            [deck["thumbnail"]],
        )

    def test_rollback_restores_the_exact_slide_columns(self):
        """§12: the journal reverses the one destructive rewrite Build makes."""
        deck = self.deck_fixture()
        slide = deck["slides"][0]
        before = frappe.db.get_value("Slide", slide, ["elements", "background"], as_dict=True)

        convert_slides_and_templates(self.environment())

        current = frappe.db.get_value("Slide", slide, ["elements", "background"], as_dict=True)
        self.assertNotEqual(current.elements, before.elements)
        bodies = {slide: SlideBody(current.elements, current.background)}
        plan = self.journal.plan_rollback(deck["docname"], bodies)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0].slide, slide)
        self.assertEqual(plan[0].expected, bodies[slide])
        self.assertEqual(plan[0].restore, SlideBody(before.elements, before.background))

        for step in plan:
            stored = frappe.db.get_value("Slide", step.slide, ["elements", "background"], as_dict=True)
            self.assertEqual(SlideBody(stored.elements, stored.background), step.expected)
            frappe.db.set_value(
                "Slide",
                step.slide,
                {"elements": step.restore.elements, "background": step.restore.background},
                update_modified=False,
            )

        restored = frappe.db.get_value("Slide", slide, ["elements", "background"], as_dict=True)
        self.assertEqual(restored.elements, before.elements)
        self.assertEqual(restored.background, before.background)


class TestTemplates(BuildContentCase):
    """§10: the template unit, and the principal it lists through."""

    def test_templates_list_through_general_and_not_public(self):
        name = self.prefix + "tpl"
        self.insert(
            "Writer Template",
            name,
            title=f"{self.prefix} Template",
            content="<p>body</p>",
            keymap="mod-b",
        )

        report = convert_slides_and_templates(self.environment())

        document = frappe.db.get_value(
            "Writer Document", name, ["node", "content", "html", "settings", "collab"], as_dict=True
        )
        self.assertEqual(document.node, name)
        self.assertEqual(document.content, "AAA=")
        self.assertEqual(document.html, "<p>body</p>")
        self.assertEqual(document.settings, '{"keymap":"mod-b"}')
        self.assertEqual(document.collab, 0)
        node = self.node_row(name)
        self.assertEqual(node["is_template"], 1)
        self.assertEqual(node["mime"], "frappe/writer")
        self.assertEqual(node["content_doctype"], "Writer Document")
        self.assertEqual(node["content_docname"], name)
        self.assertEqual(report.writer_templates_converted, 1)
        self.assertEqual(report.template_nodes_created, 1)

        grants = frappe.get_all(
            "Drive Grant",
            filters={"node": name},
            fields=["principal", "role"],
            order_by="principal asc",
        )
        self.assertEqual(
            [(row.principal, row.role) for row in grants],
            [(GENERAL, READ), (self.owner, MANAGE)],
        )
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": name, "principal": PUBLIC}))

        listed = views(principals_for_principal(GENERAL), "templates", limit=200)
        anonymous = views(principals_for_principal(PUBLIC), "templates", limit=200)
        self.assertIn(name, [row.name for row in listed["rows"]])
        self.assertNotIn(name, [row.name for row in anonymous["rows"]])

    def test_a_slides_template_becomes_a_granted_node_and_a_reciprocal_link(self):
        """The second template type. It writes a node, not a new document."""
        name = self.prefix + "deck-tpl"
        self.insert(
            "Presentation",
            name,
            title=f"{self.prefix} Deck Template",
            is_template=1,
            is_composite=0,
        )

        report = convert_slides_and_templates(self.environment())

        self.assertEqual(frappe.db.get_value("Presentation", name, "node"), name)
        node = self.node_row(name)
        self.assertEqual(node["is_template"], 1)
        self.assertEqual(node["mime"], "frappe/slides")
        self.assertEqual(node["kind"], "document")
        self.assertEqual(node["content_doctype"], "Presentation")
        self.assertEqual(node["content_docname"], name)
        self.assertEqual(node["title"], f"{self.prefix} Deck Template")
        # The shared folder is Administrator's, so its id is the site's, not
        # this run's. What the unit owes is that the node lands inside it.
        self.assertEqual(frappe.db.get_value("Drive Node", node["parent"], "title"), "Templates")
        # A deck template creates no Writer Document, and it is not a Writer
        # template, so only the node counter moves.
        self.assertEqual(report.template_nodes_created, 1)
        self.assertEqual(report.writer_templates_converted, 0)
        self.assertFalse(frappe.db.exists("Writer Document", name))

        grants = frappe.get_all(
            "Drive Grant",
            filters={"node": name},
            fields=["principal", "role"],
            order_by="principal asc",
        )
        self.assertEqual(
            [(row.principal, row.role) for row in grants],
            [(GENERAL, READ), (self.owner, MANAGE)],
        )
        self.assert_controller_accepts("Drive Node", name)

        listed = views(principals_for_principal(GENERAL), "templates", limit=200)
        self.assertIn(name, [row.name for row in listed["rows"]])

    def test_step_10_keeps_both_template_kinds_where_step_8_put_them(self):
        """§14.7 owns a template; §14.6's orphan rule must leave it alone.

        A `Writer Document` step 8 mints has no `File` row, so step 10 reads
        it back in the orphan loop. Adopting it would move it out of the
        shared `Templates` folder, and re-deriving it there refuses the node
        step 8 just wrote, on the first run and on every run after it.
        """
        writer = self.prefix + "tpl"
        deck = self.prefix + "deck-tpl"
        self.insert(
            "Writer Template",
            writer,
            title=f"{self.prefix} Template",
            content="<p>body</p>",
            keymap="mod-b",
        )
        self.insert("Presentation", deck, title=f"{self.prefix} Deck", is_template=1, is_composite=0)

        convert_slides_and_templates(self.environment())
        before = {name: self.node_row(name) for name in (writer, deck)}
        folders = {name: before[name]["parent"] for name in (writer, deck)}
        for parent in folders.values():
            self.assertEqual(frappe.db.get_value("Drive Node", parent, "title"), "Templates")

        report = link_content_documents(self.environment())

        self.assertEqual([issue.reason for issue in report.issues], [])
        self.assertTrue(report.links_completed)
        self.assertEqual(report.orphan_content_docs_adopted, 0)
        for name in (writer, deck):
            self.assertEqual(self.node_row(name), before[name])
            self.assertEqual(self.node_row(name)["is_template"], 1)
            self.assert_controller_accepts("Drive Node", name)
        self.assertEqual(frappe.db.get_value("Writer Document", writer, "node"), writer)
        self.assertEqual(frappe.db.get_value("Presentation", deck, "node"), deck)
        # The template owner keeps the one root `setUp` wrote. Adopting a
        # template document would have put it under a root of its owner's.
        self.assertEqual(
            frappe.get_all(
                "Drive Root", filters={"user": self.owner, "name": ("like", self.prefix + "%")}, pluck="name"
            ),
            [self.root],
        )

        again = link_content_documents(self.environment())

        self.assertEqual([issue.reason for issue in again.issues], [])
        self.assertEqual(again.orphan_content_docs_adopted, 0)
        for name in (writer, deck):
            self.assertEqual(self.node_row(name), before[name])


class TestSecondRun(BuildContentCase):
    """§13: an exact rerun changes no row, blob, grant, or stable counter."""

    def test_a_second_run_repeats_every_row_blob_grant_and_counter(self):
        thread = self.prefix + "th"
        self.writer_fixture(
            comments=writer_comments(
                {thread: {"id": thread, "text": "First", "owner": self.owner, "creation": 1_000}}
            ),
            versions=(("a", f"<p>{self.prefix}</p>", None, 0, STAMP),),
        )
        self.sheet_fixture(snapshot={"cells": [self.prefix]})
        deck = self.deck_fixture()

        first = self.convert_all()
        rows = self.target_snapshot()
        blobs = self.blob_snapshot()
        # Every source column, so the three `node` links and both document
        # bodies are compared across the rerun and not only the rows Build
        # writes.
        sources = self.source_snapshot()
        bodies = frappe.get_all(
            "Slide",
            filters={"name": ("like", self.prefix + "%")},
            fields=["name", "elements", "background"],
            order_by="name asc",
        )
        # The root pair, three documents, one media child, one Templates
        # folder, two versions, one thread, one comment, one preview. An
        # empty snapshot would make both equality checks below vacuous.
        self.assertGreaterEqual(len(rows), 10)
        self.assertGreaterEqual(len(blobs), 3)

        second = self.convert_all()

        self.assertEqual(self.target_snapshot(), rows)
        self.assertEqual(self.blob_snapshot(), blobs)
        self.assertEqual(self.source_snapshot(), sources)
        self.assertEqual(
            frappe.get_all(
                "Slide",
                filters={"name": ("like", self.prefix + "%")},
                fields=["name", "elements", "background"],
                order_by="name asc",
            ),
            bodies,
        )
        self.assertEqual(second.as_dict(), first.as_dict())
        self.assertEqual(second.media_nodes_created, 1)
        self.assertEqual(second.media_duplicates_collapsed, 1)
        self.assertEqual(second.deck_previews_created, 1)
        self.assertEqual(second.slide_elements_rewritten, 1)
        self.assertEqual(second.versions_seen, 2)
        self.assertEqual(second.comments_seen, 1)
        self.assertEqual(second.documents_seen, 3)
        self.assertTrue(second.completed)
        self.assertEqual([row["name"] for row in self.media_children(deck["node"])], [deck["keeper"]])
