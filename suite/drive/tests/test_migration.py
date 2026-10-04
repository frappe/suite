"""One `bench migrate`, rehearsed: Build, then Cleanup, against a real database.

The two patches run in that order from `suite/patches.txt`. This test puts a
small pre-migration Drive back onto the site (`legacy_schema` recreates the
tables and columns the source tree no longer ships, and the rows below fill
them), runs both patches through their real `execute()` entry points, and
then checks what a user would notice: the tree, the grants, the bytes and
the old links all still work, and nothing of the legacy backend is left.

**This test changes the site's schema and runs Cleanup over every Drive row
on it.** It is for a throwaway site only and refuses to run anywhere else:

    bench new-site cleanup-test.localhost --admin-password admin
    bench --site cleanup-test.localhost install-app suite
    bench --site cleanup-test.localhost set-config drive_migration_rehearsal 1
    bench --site cleanup-test.localhost run-tests --app suite --module suite.drive.tests.test_migration
    bench drop-site cleanup-test.localhost

DDL commits implicitly in MariaDB, so the test framework's transaction cannot
undo any of this; the class drops what it created on the way out instead.
"""

import json
import os
import unittest
from collections import defaultdict

import frappe
from frappe.storage.tests import reset_file_controller
from frappe.tests import IntegrationTestCase
from frappe.utils import get_files_path

from suite import drive
from suite.composition.redirects import resolve
from suite.drive._core import content
from suite.drive._core.roles import EDIT, READ
from suite.drive.framework import principals_for
from suite.drive.patches import build, cleanup
from suite.drive.patches.build.ports import SiteContentSource
from suite.drive.patches.build.tests import legacy_schema
from suite.drive.patches.cleanup.environment import BACKUP_CONFIG_KEY
from suite.drive.patches.cleanup.state import CleanupState

REHEARSAL_FLAG = "drive_migration_rehearsal"
BACKUP = "rehearsal: no backup, throwaway site"

LINK_PREFIX = "$LINK:"

# The legacy columns Build reads once per document, by the keyset it pages in.
INDEXED_READS = {
    "Writer Version": ("doc", "creation", "name"),
    "File": ("content_doctype", "content_docname"),
}


def index_columns(doctype: str) -> list[tuple[str, ...]]:
    """Every index on the table, as its ordered column names."""
    parts = defaultdict(list)
    for row in frappe.db.sql(f"SHOW INDEX FROM `tab{doctype}`", as_dict=True):
        parts[row.Key_name].append((int(row.Seq_in_index), row.Column_name))
    return sorted(tuple(column for _, column in sorted(columns)) for columns in parts.values())


@unittest.skipUnless(
    frappe.conf.get(REHEARSAL_FLAG),
    f"runs Build and Cleanup over the whole site; set `{REHEARSAL_FLAG}` in a throwaway site's config",
)
class TestBuildThenCleanup(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.prefix = "mig" + frappe.generate_hash(length=6)
        cls.schema = legacy_schema.install()
        cls.previous_conf = {key: frappe.conf.get(key) for key in ("storage_v2", BACKUP_CONFIG_KEY)}
        cls.files_written = []
        try:
            cls.remove_seeded_drive()
            cls.seed()
            # A rehearsal site may have run this once already: both patches
            # would otherwise read "completed" from their state files and skip.
            for path in (build.BuildState.for_site().path, CleanupState.for_site().path):
                path.unlink(missing_ok=True)
            frappe.conf["storage_v2"] = 1
            reset_file_controller()
            build.execute()
            # Cleanup drops the legacy tables, so Build's indexes are read now.
            # A resumed Build indexes again, and must find its first index.
            SiteContentSource().index_document_reads()
            cls.indexes_after_build = {doctype: index_columns(doctype) for doctype in INDEXED_READS}
            cls.history_read_key = frappe.db.sql(
                """EXPLAIN SELECT `name` FROM `tabWriter Version` WHERE `doc` = %(doc)s
                   ORDER BY `creation`, `name` LIMIT 10""",
                {"doc": cls.docname},
                as_dict=True,
            )[0].key
            frappe.conf[BACKUP_CONFIG_KEY] = BACKUP
            cleanup.execute()
        except BaseException:
            # DDL has committed; a failed setup must still take the legacy
            # schema back or the next run finds half of it in place.
            cls.tearDownClass()
            raise
        frappe.clear_cache()

    @classmethod
    def remove_seeded_drive(cls):
        """Start from the Drive a pre-migration site has: none.

        A fresh install's `after_install` seeds the shipped Slides templates
        (§8.10) into Administrator's Personal root. A real upgrade runs Build
        before that seed, so Build never meets a node it did not write; a
        rehearsal site was installed fresh and carries the seed already.
        """
        roots = frappe.get_all("Drive Root", filters={"user": "Administrator"}, pluck="node")
        if not roots:
            return
        nodes = frappe.get_all("Drive Node", filters={"root": ("in", roots)}, pluck="name")
        decks = frappe.get_all(
            "Drive Node",
            filters={"name": ("in", nodes), "content_doctype": "Presentation"},
            pluck="content_docname",
        )
        for doctype, column, values in (
            ("Drive Grant", "node", nodes),
            ("Drive Node Preview", "node", nodes),
            ("Slide", "parent", decks),
            ("Presentation", "name", decks),
            ("Drive Root", "node", roots),
            ("Drive Node", "name", nodes),
        ):
            if values:
                frappe.db.delete(doctype, {column: ("in", values)})
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        like = cls.prefix + "%"
        for doctype, column in (
            ("Drive Grant", "node"),
            ("Drive Node Version", "node"),
            ("Drive Comment Thread", "node"),
            ("Drive Node Preview", "node"),
            ("Drive Activity", "node"),
            ("Drive Legacy Route", "name"),
            ("Drive Root", "node"),
            ("Drive Node", "name"),
            ("Writer Document", "name"),
            ("Slide", "parent"),
            ("Presentation", "name"),
            ("Drive Settings", "name"),
            # Cleanup's `Home` copy of the avatar (§14.4).
            ("File", "attached_to_name"),
            ("User", "name"),
        ):
            if frappe.db.table_exists(doctype):
                frappe.db.delete(doctype, {column: ("like", like)})
        for path in cls.files_written:
            if os.path.exists(path):
                os.remove(path)
        cls.schema.remove()
        for key, value in cls.previous_conf.items():
            if value is None:
                frappe.conf.pop(key, None)
            else:
                frappe.conf[key] = value
        reset_file_controller()
        super().tearDownClass()

    # the pre-migration site

    @classmethod
    def seed(cls):
        cls.owner = cls.user("owner")
        cls.editor = cls.user("editor")
        cls.bytes = f"{cls.prefix} quarterly report".encode()

        cls.home = cls.prefix + "home"
        cls.folder = cls.prefix + "fold"
        cls.file = cls.prefix + "file"
        cls.trashed = cls.prefix + "old"
        cls.docname = cls.prefix + "doc"
        cls.document = cls.prefix + "docf"
        cls.avatar = cls.prefix + "avat"
        cls.deck = cls.prefix + "deck"
        cls.deck_file = cls.prefix + "deckf"
        cls.picture = cls.prefix + "pict"
        cls.old_team = cls.prefix + "team"

        cls.file_row("Drive", folder=None, is_folder=1, file_name="Drive")
        cls.file_row("Users", folder=None, is_folder=1, file_name="Users")
        cls.file_row(cls.home, folder="Users", is_folder=1, file_name=cls.owner, owner=cls.owner)
        legacy_schema.insert_row(
            "Drive Settings", cls.owner, user=cls.owner, user_folder=cls.home, quota=1024
        )

        cls.file_row(cls.folder, folder="Drive", is_folder=1, file_name="Reports", owner=cls.owner)
        cls.file_row(
            cls.file, folder=cls.folder, file_name="report.txt", owner=cls.owner, **cls.local_bytes(cls.bytes)
        )
        cls.file_row(
            cls.trashed,
            folder=cls.folder,
            file_name="old.txt",
            owner=cls.owner,
            status="Trashed",
            **cls.local_bytes(b"superseded"),
        )

        # A framework attachment legacy Drive filed under a Drive folder: a
        # user's avatar, uploaded while the legacy hooks were live (B73).
        avatar = cls.local_bytes(b"not really a png")
        cls.avatar_url = avatar["file_url"]
        cls.file_row(
            cls.avatar,
            folder=cls.folder,
            file_name="avatar.png",
            owner=cls.owner,
            attached_to_doctype="User",
            attached_to_name=cls.owner,
            attached_to_field="user_image",
            **avatar,
        )

        legacy_schema.insert_row(
            "Writer Document", cls.docname, owner=cls.owner, content="AAA=", html="<p>notes</p>", collab=1
        )
        cls.file_row(
            cls.document,
            folder=cls.folder,
            file_name="Notes",
            owner=cls.owner,
            content_doctype="Writer Document",
            content_docname=cls.docname,
        )
        legacy_schema.insert_row(
            "Writer Version",
            cls.prefix + "v1",
            owner=cls.owner,
            doc=cls.docname,
            snapshot="<p>notes</p>",
            manual=0,
        )

        # A deck with one picture. Legacy Slides stored the picture as a `File`
        # attached to the Presentation, under Frappe's `Home`, and named it in
        # the slide body by its `/private/files/` url (B81).
        legacy_schema.insert_row(
            "Presentation", cls.deck, owner=cls.owner, title="Keynote", is_template=0, is_composite=0
        )
        cls.file_row(
            cls.deck_file,
            folder=cls.folder,
            file_name="Keynote",
            owner=cls.owner,
            content_doctype="Presentation",
            content_docname=cls.deck,
        )
        picture = cls.local_bytes(b"not really a png")
        cls.file_row(
            cls.picture,
            folder="Home",
            file_name="logo.png",
            owner=cls.owner,
            attached_to_doctype="Presentation",
            attached_to_name=cls.deck,
            **picture,
        )
        legacy_schema.insert_row(
            "Slide",
            cls.prefix + "s1",
            owner=cls.owner,
            parent=cls.deck,
            parenttype="Presentation",
            parentfield="slides",
            idx=1,
            elements=json.dumps(
                [{"type": "image", "src": picture["file_url"], "attachmentName": cls.picture}]
            ),
        )

        # A named editor, everyone on the site as readers, and "anyone with
        # the link" above READ, which Build turns into a `$PUBLIC` read plus
        # one minted link token.
        legacy_schema.insert_row(
            "Drive Permission", cls.prefix + "p1", entity=cls.folder, user=cls.editor, write=1
        )
        legacy_schema.insert_row(
            "Drive Permission", cls.prefix + "p2", entity=cls.folder, user="$GENERAL", read=1
        )
        legacy_schema.insert_row(
            "Drive Permission", cls.prefix + "p3", entity=cls.folder, user="", read=1, write=1
        )

        legacy_schema.insert_row("Drive Legacy Route", cls.old_team, old_id=cls.old_team, entity=cls.folder)
        legacy_schema.insert_row(
            "Drive Entity Activity Log",
            cls.prefix + "a1",
            entity=cls.file,
            action_type="create",
            owner=cls.owner,
        )

    @classmethod
    def user(cls, role: str) -> str:
        user = frappe.new_doc("User")
        user.update(
            {"email": f"{cls.prefix}-{role}@example.invalid", "first_name": role.title(), "enabled": 1}
        )
        user.db_insert()
        return user.name

    @classmethod
    def file_row(cls, name, *, folder, is_folder=0, file_name, status="Active", **columns):
        return legacy_schema.insert_row(
            "File",
            name,
            folder=folder,
            is_folder=is_folder,
            file_name=file_name,
            is_private=1,
            status=status,
            **columns,
        )

    @classmethod
    def local_bytes(cls, content: bytes) -> dict:
        filename = f"{cls.prefix}-{frappe.generate_hash(length=8)}.txt"
        path = get_files_path(filename, is_private=True)
        with open(path, "wb") as handle:
            handle.write(content)
        cls.files_written.append(path)
        return {
            "file_url": "/private/files/" + filename,
            "file_size": len(content),
            "file_type": "TXT",
            "mime_type": "text/plain",
        }

    def node(self, name) -> frappe._dict:
        return frappe.db.get_value(
            "Drive Node",
            name,
            ["name", "parent_node", "root", "kind", "state", "blob", "content_docname"],
            as_dict=True,
        )

    def as_user(self, user):
        frappe.set_user(user)
        self.addCleanup(frappe.set_user, "Administrator")

    # what survived

    def test_the_tree_keeps_its_ids_shape_and_bytes(self):
        shared = self.node("Drive")
        self.assertEqual((shared.kind, shared.state, shared.parent_node), ("root", "Active", None))
        self.assertEqual(frappe.db.get_value("Drive Root", "Drive", "kind"), "Shared")
        self.assertEqual(
            frappe.db.get_value("Drive Root", self.home, ["kind", "user"]), ("Personal", self.owner)
        )
        self.assertIsNone(frappe.db.exists("Drive Node", "Users"), "the Users scaffold row is not a node")

        folder, file, trashed = self.node(self.folder), self.node(self.file), self.node(self.trashed)
        self.assertEqual((folder.parent_node, folder.root, folder.kind), ("Drive", "Drive", "folder"))
        self.assertEqual((file.parent_node, file.root, file.state), (self.folder, "Drive", "Active"))
        self.assertEqual(trashed.state, "Trashed")
        self.assertTrue(file.blob)

        # §14.4: the type comes from the stored bytes, as for an upload, not
        # from the legacy row's `text/plain`.
        self.as_user(self.owner)
        stream, mime = drive.read_file(self.file)
        stored = frappe.db.get_value("File Blob", file.blob, "mime_type")
        self.assertEqual((stream.read(), mime), (self.bytes, stored))

    def test_a_framework_attachment_under_a_drive_folder_is_a_drive_file(self):
        """§14.4: whatever legacy Drive filed under a Drive root is Drive's, attachment or not.

        The avatar becomes a file node from its own bytes, so Cleanup's gate 1
        (every reachable row has a node) never refuses because of it. Its
        Drive `File` row leaves with the rest in Cleanup, which first keeps a
        copy under `Home`, so the user's attachment, its URL and the blob's
        reference all stay.
        """
        avatar = self.node(self.avatar)
        self.assertEqual(
            (avatar.parent_node, avatar.root, avatar.kind, avatar.state),
            (self.folder, "Drive", "file", "Active"),
        )
        self.assertTrue(avatar.blob)
        self.assertIsNone(frappe.db.exists("File", self.avatar))
        kept = frappe.get_all(
            "File",
            filters={"attached_to_doctype": "User", "attached_to_name": self.owner},
            fields=["folder", "attached_to_field", "blob", "file_url"],
        )
        self.assertEqual(
            [(row.folder, row.attached_to_field, row.blob, row.file_url) for row in kept],
            [("Home", "user_image", avatar.blob, self.avatar_url)],
        )

    def test_a_deck_names_its_picture_the_way_the_renderer_resolves_it(self):
        """§14.7 stores the media node id; §6.8 and §10.6 turn it into a signed url.

        The Slides renderer resolves a bare id through the deck's media listing,
        keyed by node, and the unused-media sweep keeps what the body names. The
        value Build wrote must be exactly the picture's node under the deck.
        """
        deck = self.node(self.deck_file)
        self.assertEqual((deck.kind, deck.content_docname), ("document", self.deck))
        self.assertEqual(frappe.db.get_value("Presentation", self.deck, "node"), self.deck_file)

        (element,) = json.loads(frappe.db.get_value("Slide", {"parent": self.deck}, "elements"))
        self.assertNotIn("attachmentName", element)
        picture = self.node(element["src"])
        self.assertEqual(
            (picture.parent_node, picture.kind, picture.state), (self.deck_file, "file", "Active")
        )
        self.assertTrue(picture.blob)
        # The sweep over-reports by design (every string in the body), so this
        # checks the id is kept, not that it is the only one named. Drive reads
        # it through the registered spec, as the unused-media sweep does.
        self.assertIn(element["src"], content.spec_for("Presentation").used_nodes(self.deck))

        # What `GET /nodes/<deck>/media` answers the owner's browser.
        (listed,) = content.list_media(principals_for(self.owner), self.deck_file)
        self.assertEqual(listed["node"], element["src"])
        self.assertTrue(listed["url"].startswith(f"/f/{picture.blob}/"), listed["url"])
        # The picture's legacy `File` row sat under frappe's `Home`, attached to
        # the Presentation. Its node now holds the picture and nothing names
        # the row, so Cleanup deletes it (§14.10); the picture still renders
        # through the node above.
        self.assertIsNone(frappe.db.exists("File", self.picture))
        self.assertGreaterEqual(CleanupState.for_site().get("slides_media_rows").rows_deleted, 1)

    def test_the_writer_document_is_linked_both_ways_with_its_history(self):
        node = self.node(self.document)
        self.assertEqual((node.kind, node.content_docname), ("document", self.docname))
        self.assertEqual(frappe.db.get_value("Writer Document", self.docname, "node"), self.document)
        self.assertGreaterEqual(frappe.db.count("Drive Node Version", {"node": self.document}), 1)

    def test_build_indexes_the_legacy_columns_it_reads_per_document(self):
        """B108: without the index, each history lookup read the whole table."""
        for doctype, columns in INDEXED_READS.items():
            with self.subTest(doctype=doctype):
                self.assertEqual(self.indexes_after_build[doctype].count(columns), 1)
        self.assertIsNotNone(self.history_read_key)

    def test_the_grants_say_who_may_do_what(self):
        grants = {
            row.principal: row.role
            for row in frappe.get_all(
                "Drive Grant", filters={"node": self.folder}, fields=["principal", "role"]
            )
        }
        self.assertEqual(grants.get(self.editor), EDIT)
        self.assertEqual(grants.get("$GENERAL"), READ)
        self.assertEqual(grants.get("$PUBLIC"), READ)
        self.assertEqual(len([p for p in grants if p.startswith(LINK_PREFIX)]), 1)

        self.as_user(self.editor)
        drive.check(self.file, EDIT)  # inherited from the folder, must not raise
        self.as_user(self.owner)
        drive.check(self.folder, EDIT)  # the owner, through the anchor and the row

    def test_old_urls_and_the_share_link_still_resolve(self):
        self.as_user(self.owner)
        new_url = drive.node_url(self.folder)
        self.assertEqual(resolve(f"/drive/folder/{self.folder}"), new_url)
        self.assertEqual(resolve(f"/drive/file/{self.file}"), drive.node_url(self.file))
        # The old team id reaches the folder the team became.
        self.assertEqual(resolve(f"/drive/t/{self.old_team}"), new_url)

        (principal,) = frappe.get_all(
            "Drive Grant",
            filters={"node": self.folder, "principal": ("like", LINK_PREFIX + "%")},
            pluck="principal",
        )
        token = principal[len(LINK_PREFIX) :]
        self.assertEqual(resolve(f"/drive/l/{token}"), f"/l/{token}")
        self.assertEqual(drive.resolve_share_link(token)["node"], self.folder)

    # what is gone

    def test_no_legacy_table_column_row_or_custom_field_is_left(self):
        for doctype in legacy_schema.LEGACY_DOCTYPES:
            with self.subTest(doctype=doctype):
                self.assertFalse(frappe.db.exists("DocType", doctype))
                self.assertFalse(frappe.db.table_exists(doctype))
        for doctype, columns in legacy_schema.LEGACY_COLUMNS.items():
            for column, _fieldtype in columns:
                with self.subTest(doctype=doctype, column=column):
                    self.assertFalse(frappe.db.has_column(doctype, column))
        for spec in legacy_schema.FILE_CUSTOM_FIELDS:
            with self.subTest(custom_field=spec["fieldname"]):
                self.assertFalse(
                    frappe.db.exists("Custom Field", {"dt": "File", "fieldname": spec["fieldname"]})
                )
                if spec["fieldtype"] not in ("Section Break", "Column Break"):
                    self.assertFalse(frappe.db.has_column("File", spec["fieldname"]))
        self.assertEqual(frappe.db.count("Property Setter", {"doc_type": "File"}), 0)
        self.assertEqual(
            frappe.db.sql_list(
                "SELECT `field` FROM `tabSingles` WHERE `doctype` = 'Drive Disk Settings' AND `field` IN %(fields)s",
                {"fields": tuple(legacy_schema.DISK_SETTINGS_SINGLES)},
            ),
            [],
        )
        for name in (
            "Drive",
            "Users",
            self.home,
            self.folder,
            self.file,
            self.trashed,
            self.document,
            self.avatar,
        ):
            with self.subTest(file=name):
                self.assertIsNone(frappe.db.exists("File", name))

    def test_cleanup_finished_every_phase_with_the_backup_on_record(self):
        state = CleanupState.for_site()
        self.assertEqual(state.get_backup(), BACKUP)
        for name, _phase in cleanup.PHASES:
            with self.subTest(phase=name):
                self.assertTrue(state.get(name).completed)


@unittest.skipUnless(
    frappe.conf.get(REHEARSAL_FLAG),
    f"changes the site's schema; set `{REHEARSAL_FLAG}` in a throwaway site's config",
)
class TestLegacyReadIndexes(IntegrationTestCase):
    """B108 on a site where an operator indexed the history before Build ran."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.schema = legacy_schema.install()

    @classmethod
    def tearDownClass(cls):
        cls.schema.remove()
        super().tearDownClass()

    def test_an_index_added_by_hand_is_kept_and_not_duplicated(self):
        frappe.db.sql_ddl("ALTER TABLE `tabWriter Version` ADD INDEX `by_hand` (`doc`, `creation`, `name`)")
        SiteContentSource().index_document_reads()
        self.assertEqual(index_columns("Writer Version").count(INDEXED_READS["Writer Version"]), 1)
        self.assertEqual(index_columns("File").count(INDEXED_READS["File"]), 1)


if __name__ == "__main__":
    unittest.main()
