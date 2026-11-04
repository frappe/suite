import io
import os
import threading
import time
from collections.abc import Callable
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils import CallbackManager

from suite import drive
from suite.content import checker, conversions, convert, copies
from suite.content.checkpoints import replace_start
from suite.content.editors import spec_of
from suite.drive._core.nodes import _trash, purge
from suite.drive._core.principals import Principals
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests import test_conversion
from suite.writer.content.tests.compaction_case import CompactionCase
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase
from suite.writer.content.tests.support import WRITER


def takes_row_lock(query) -> bool:
    statement = str(query).upper()
    on_locked_tables = "`TABWRITER DOCUMENT`" in statement or "`__WRITER_CONTENT_DOC`" in statement
    writes = statement.lstrip().startswith(("UPDATE", "INSERT", "DELETE"))
    return on_locked_tables and ("FOR UPDATE" in statement or writes)


class TestLockOrder(CompactionCase, DriveCallbackCase):
    old_document = test_conversion.TestConversion.old_document

    def setUp(self):
        super().setUp()
        if not checker.usable_node(convert.NODE_MIN) or not writer_content.CONVERTER_BUILD.is_file():
            reason = f"needs Node and the built bundle at {writer_content.CONVERTER_BUILD}; run bench build"
            if os.environ.get("CI"):
                self.fail(reason)

            self.skipTest(reason)

        job_patch = patch.object(
            frappe.local,
            "job",
            frappe._dict(job_name="test_lock_order", after_job=CallbackManager()),
            create=True,
        )
        job_patch.start()
        self.addCleanup(job_patch.stop)

    # Run `first` here up to its second row lock, then `second` in another session until it locks; answer every error
    def race(self, first: Callable[[], object], second: Callable[[], object]) -> list[Exception]:
        errors: list[Exception] = []
        reached = threading.Event()
        other = threading.Thread(
            target=self.second_elsewhere, args=(frappe.local.site, second, errors, reached)
        )
        try:
            with patch.object(frappe.db, "sql", self.pausing_sql(other, reached, errors)):
                first()
                frappe.db.commit()
        except Exception as error:
            if error not in errors:
                errors.append(error)

        frappe.db.rollback()
        if not other.ident:
            other.start()

        other.join(60)
        self.assertFalse(other.is_alive())
        return errors

    def second_elsewhere(
        self, site: str, second: Callable[[], object], errors: list[Exception], reached: threading.Event
    ) -> None:
        frappe.init(site=site)
        frappe.connect()
        frappe.local.job = frappe._dict(job_name="test_lock_order", after_job=CallbackManager())
        real_sql = frappe.db.sql

        def signal_first_lock(query, *args, **kwargs):
            if takes_row_lock(query):
                reached.set()

            return real_sql(query, *args, **kwargs)

        try:
            with patch.object(frappe.db, "sql", signal_first_lock):
                second()

            frappe.db.commit()
        except Exception as error:
            errors.append(error)
        finally:
            reached.set()
            frappe.destroy()

    def pausing_sql(
        self, other: threading.Thread, reached: threading.Event, errors: list[Exception]
    ) -> Callable[..., object]:
        real_sql = frappe.db.sql
        locks: list[str] = []

        def pause_at_second_lock(query, *args, **kwargs):
            if takes_row_lock(query):
                if locks and not other.ident:
                    other.start()
                    reached.wait(60)
                    # Long enough for the other session's lock to start waiting
                    time.sleep(0.5)

                locks.append(str(query))

            try:
                return real_sql(query, *args, **kwargs)
            except Exception as error:
                errors.append(error)
                raise

        return pause_at_second_lock

    def desk_save(self, docname: str) -> None:
        doc = frappe.get_doc("Writer Document", docname)
        doc.content = "<p>Edited</p>"
        doc.save()

    def logged_document(self) -> str:
        node = self.new_document()
        self.type_into(node, ["one"])
        return node

    def test_a_save_and_a_checkpoint_install_neither_deadlocks(self):
        node = self.logged_document()
        snapshot, compacted = self.compacted(node)
        job = self.compaction_job(self.doc_row(node).id)

        errors = self.race(
            lambda: job.install(snapshot, compacted), lambda: self.desk_save(self.docname_of(node))
        )

        # The save waited for the install, which moved the row's `modified` on
        self.assertEqual([type(error) for error in errors], [frappe.TimestampMismatchError])
        self.assertEqual(self.doc_row(node).body_rev, snapshot.head_rev)

    def test_a_save_and_a_start_replacement_neither_deadlocks(self):
        node = self.new_document()
        doc_id = self.doc_row(node).id
        start = pycrdt.Doc()
        start.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlElement("paragraph"))

        errors = self.race(
            lambda: replace_start(
                writer_content.APP, doc_id, start.get_update(), writer_content.SCHEMA.version
            ),
            lambda: self.desk_save(self.docname_of(node)),
        )

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])
        self.assertEqual(self.body_of(node), start.get_update())

    def test_a_save_and_a_conversion_neither_deadlocks(self):
        node = self.old_document("<p>Hello world</p>")
        outcomes: list[str | None] = []

        errors = self.race(
            lambda: outcomes.append(conversions.convert_document(writer_content.APP, node)),
            lambda: self.desk_save(self.docname_of(node)),
        )

        self.assertEqual([error for error in errors if frappe.db.is_deadlocked(error)], [])
        self.assertEqual(outcomes, ["converted"])

    def test_a_save_and_a_conversion_of_a_logged_document_neither_deadlocks(self):
        node = self.logged_document()

        errors = self.race(
            lambda: self.desk_save(self.docname_of(node)),
            lambda: conversions.convert_document(writer_content.APP, node),
        )

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])

    def test_a_checkpoint_install_and_a_conversion_of_a_logged_document_neither_deadlocks(self):
        node = self.logged_document()
        snapshot, compacted = self.compacted(node)
        job = self.compaction_job(self.doc_row(node).id)

        errors = self.race(
            lambda: job.install(snapshot, compacted),
            lambda: conversions.convert_document(writer_content.APP, node),
        )

        self.assertEqual(errors, [])
        self.assertEqual(self.doc_row(node).body_rev, snapshot.head_rev)

    def test_a_restore_and_a_conversion_neither_deadlocks(self):
        node = self.old_document("<p>Hello world</p>")
        docname = self.docname_of(node)

        errors = self.race(
            lambda: writer_drive.SPEC.restore_version(docname, io.BytesIO(b"<p>Restored</p>")),
            lambda: conversions.convert_document(writer_content.APP, node),
        )

        self.assertEqual(errors, [])
        self.assertEqual(frappe.db.get_value("Writer Document", docname, "html"), "<p>Restored</p>")

    def test_a_restore_and_a_conversion_of_a_logged_document_neither_deadlocks(self):
        node = self.logged_document()
        docname = self.docname_of(node)

        errors = self.race(
            lambda: writer_drive.SPEC.restore_version(docname, io.BytesIO(b"<p>Restored</p>")),
            lambda: conversions.convert_document(writer_content.APP, node),
        )

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])

    def test_a_purge_meeting_a_checkpoint_install_is_refused_and_loses_nothing(self):
        node = self.logged_document()
        docname = self.docname_of(node)
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _trash(owner, node)
        frappe.db.commit()
        trashed = frappe.db.get_value("Drive Node", node, ["state", "trash_root", "trashed_at"], as_dict=True)
        snapshot, compacted = self.compacted(node)
        job = self.compaction_job(self.doc_row(node).id)

        errors = self.race(lambda: job.install(snapshot, compacted), lambda: purge(owner, node))

        self.assertEqual([type(error) for error in errors], [frappe.QueryTimeoutError])
        self.assertEqual(self.doc_row(node).body_rev, snapshot.head_rev)
        self.assertNotEqual(self.doc_row(node).mode, "purged")
        self.assertTrue(frappe.db.exists("Writer Document", docname))
        self.assertEqual(
            frappe.db.get_value("Drive Node", node, ["state", "trash_root", "trashed_at"], as_dict=True),
            trashed,
        )

    def test_a_save_and_a_readable_copy_write_neither_deadlocks(self):
        node = self.logged_document()
        doc_row = self.doc_row(node)
        html_copy = spec_of(writer_content.APP).readable_copy

        errors = self.race(
            lambda: copies.write(writer_content.APP, doc_row.id, doc_row.head_rev, "<p>one</p>", html_copy),
            lambda: self.desk_save(self.docname_of(node)),
        )

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])
