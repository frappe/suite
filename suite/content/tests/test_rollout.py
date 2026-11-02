import hashlib
import json
import struct
import threading
import time
from unittest.mock import MagicMock, patch

import frappe
from frappe.utils import now_datetime
from frappe.utils.logging import connection_for

from suite import content, drive
from suite.content import conversions, convert, jobs, log, steps
from suite.content.tests import note
from suite.content.tests.test_note import APP_TABLE, NoteAppCase, typed

NOTE_ROW = {"parent": "Suite Collab Settings", "parentfield": "apps", "app": note.EDITOR.app}


def pause_conversion(paused: bool) -> int:
    frappe.db.sql(
        """UPDATE `tabSuite Collab App` SET `conversion_paused` = %s
        WHERE `parent` = %s AND `parentfield` = %s AND `app` = %s""",
        (int(paused), NOTE_ROW["parent"], NOTE_ROW["parentfield"], NOTE_ROW["app"]),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return frappe.db.get_value("Suite Collab App", NOTE_ROW, "conversion_paused")


class TestRollout(NoteAppCase):
    """Pausing an app's conversion stops new conversions at every place one starts."""

    def setUp(self):
        super().setUp()
        self.addCleanup(pause_conversion, False)

    def old_note(self) -> str:
        node = frappe.generate_hash(length=10)
        frappe.db.sql(
            f"INSERT INTO `{APP_TABLE}` (`name`, `node`, `body`, `html`) VALUES (%s, %s, '', '<p>Old</p>')",
            (node, node),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.addCleanup(self.remove_note, node)
        return node

    def test_a_paused_app_queues_no_conversion(self):
        with patch.object(frappe, "enqueue") as enqueue:
            jobs.queue_conversion()

        self.assertIn(note.EDITOR.app, [call.kwargs["app"] for call in enqueue.call_args_list])

        self.assertEqual(pause_conversion(True), 1)
        with patch.object(frappe, "enqueue") as enqueue:
            jobs.queue_conversion()

        self.assertNotIn(note.EDITOR.app, [call.kwargs["app"] for call in enqueue.call_args_list])

    def test_a_paused_app_runs_no_pending_conversion(self):
        with patch.object(conversions, "run_pending") as run_pending:
            jobs.convert_pending(note.EDITOR.app)

        run_pending.assert_called_once()

        self.assertEqual(pause_conversion(True), 1)
        with patch.object(conversions, "run_pending") as run_pending:
            jobs.convert_pending(note.EDITOR.app)

        run_pending.assert_not_called()

    def test_a_paused_page_leaves_an_old_note_unconverted(self):
        node = self.old_note()
        converted = convert.Converted(
            state=typed(1, "Hello"), source="html", dropped=[], anchors={}, threads=[], html="<p>Hello</p>"
        )
        self.assertEqual(pause_conversion(True), 1)

        with (
            patch.object(convert, "convert", return_value=converted) as converting,
            patch.object(drive, "take_version"),
        ):
            went_on = conversions.convert_page(
                note.EDITOR.app, [frappe._dict(node=node)], time.monotonic() + 60
            )

        self.assertFalse(went_on)
        self.assertIsNone(log.find(note.EDITOR.app, node))
        [[html]] = frappe.db.sql(f"SELECT `html` FROM `{APP_TABLE}` WHERE `name` = %s", node)
        self.assertEqual(html, "<p>Old</p>")
        self.assertFalse(frappe.db.sql("SELECT 1 FROM `__note_content_conversion` WHERE `node` = %s", node))
        converting.assert_not_called()

    def test_a_pause_flipped_mid_page_stops_the_next_document(self):
        site = frappe.local.site
        errors: list[Exception] = []
        stored: list[int] = []
        seen: list[int] = []
        alive: list[bool] = []

        def pause_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                stored.append(pause_conversion(True))
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        def first_document(app: str, node: str) -> str:
            if convert_document.call_count == 1:
                frappe.db.commit()  # nosemgrep: frappe-manual-commit
                # A plain read opens the snapshot the next document's pause read sees unless it is current
                seen.append(frappe.db.get_value("Suite Collab App", NOTE_ROW, "conversion_paused"))
                admin = threading.Thread(target=pause_elsewhere)
                admin.start()
                admin.join(30)
                alive.append(admin.is_alive())

            return "converted"

        convert_document = MagicMock(side_effect=first_document)
        page = [frappe._dict(node=frappe.generate_hash(length=10)) for _ in range(2)]

        with patch.object(conversions, "convert_document", convert_document):
            went_on = conversions.convert_page(note.EDITOR.app, page, time.monotonic() + 60)

        self.assertEqual((seen, alive, errors, stored), ([0], [False], [], [1]))
        self.assertEqual(convert_document.call_count, 1)
        self.assertFalse(went_on)

    def test_a_locked_pause_read_leaves_other_apps_rows_free(self):
        writer_row = {**NOTE_ROW, "app": "writer"}
        site = frappe.local.site
        errors: list[Exception] = []
        stored: list[int] = []

        def free_writer():
            frappe.db.rollback()
            frappe.db.set_value(
                "Suite Collab App",
                frappe.db.get_value("Suite Collab App", writer_row),
                "conversion_paused",
                0,
            )
            frappe.db.commit()  # nosemgrep: frappe-manual-commit

        def pause_writer_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 2")
                frappe.db.sql(
                    "UPDATE `tabSuite Collab App` SET `conversion_paused` = 1 WHERE `name` = %s", writer_name
                )
                frappe.db.commit()  # nosemgrep: frappe-manual-commit
                stored.append(frappe.db.get_value("Suite Collab App", writer_row, "conversion_paused"))
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        self.addCleanup(free_writer)
        writer_name = frappe.db.get_value("Suite Collab App", writer_row)
        self.assertEqual(frappe.db.get_value("Suite Collab App", writer_name, "conversion_paused"), 0)

        self.assertTrue(convert.may_convert(note.EDITOR.app, lock=True))
        admin = threading.Thread(target=pause_writer_elsewhere)
        admin.start()
        admin.join(30)

        self.assertFalse(admin.is_alive())
        self.assertEqual((errors, stored), ([], [1]))

    def test_a_cached_on_doesnt_convert_an_app_turned_off(self):
        frappe.get_cached_doc("Suite Collab Settings")
        self.addCleanup(frappe.clear_document_cache, "Suite Collab Settings", "Suite Collab Settings")
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.set_value, "Suite Collab App", NOTE_ROW, "mode", "on")
        frappe.db.set_value("Suite Collab App", NOTE_ROW, "mode", "off")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        cached = {row.app: row.mode for row in frappe.get_cached_doc("Suite Collab Settings").apps}
        stored = frappe.db.get_value("Suite Collab App", NOTE_ROW, "mode")
        self.assertEqual((cached[note.EDITOR.app], stored), ("on", "off"))

        allowed = (convert.may_convert(note.EDITOR.app), convert.may_convert(note.EDITOR.app, lock=True))

        self.assertEqual(allowed, (False, False))

    def test_a_cached_on_starts_no_log_for_an_app_turned_off(self):
        frappe.get_cached_doc("Suite Collab Settings")
        self.addCleanup(frappe.clear_document_cache, "Suite Collab Settings", "Suite Collab Settings")
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.set_value, "Suite Collab App", NOTE_ROW, "mode", "on")
        frappe.db.set_value("Suite Collab App", NOTE_ROW, "mode", "off")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        cached = {row.app: row.mode for row in frappe.get_cached_doc("Suite Collab Settings").apps}
        stored = frappe.db.get_value("Suite Collab App", NOTE_ROW, "mode")
        self.assertEqual((cached[note.EDITOR.app], stored), ("on", "off"))
        node = frappe.generate_hash(length=10)
        self.addCleanup(self.remove_note, node)

        content.start(note.EDITOR.app, node)

        self.assertIsNone(log.find(note.EDITOR.app, node))

    def test_a_cached_off_doesnt_refuse_an_app_turned_on(self):
        self.addCleanup(frappe.clear_document_cache, "Suite Collab Settings", "Suite Collab Settings")
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.set_value, "Suite Collab App", NOTE_ROW, "mode", "on")
        frappe.db.set_value("Suite Collab App", NOTE_ROW, "mode", "off")
        frappe.clear_document_cache("Suite Collab Settings", "Suite Collab Settings")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        frappe.get_cached_doc("Suite Collab Settings")
        frappe.db.set_value("Suite Collab App", NOTE_ROW, "mode", "on")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        cached = {row.app: row.mode for row in frappe.get_cached_doc("Suite Collab Settings").apps}
        stored = frappe.db.get_value("Suite Collab App", NOTE_ROW, "mode")
        self.assertEqual((cached[note.EDITOR.app], stored), ("off", "on"))

        log.require_enabled(note.EDITOR.app)

    def test_a_failed_document_keeps_its_error_log(self):
        page = [frappe._dict(node=frappe.generate_hash(length=10)) for _ in range(2)]
        convert_document = MagicMock(side_effect=[RuntimeError("bad body"), "converted"])

        with patch.object(conversions, "convert_document", convert_document):
            went_on = conversions.convert_page(note.EDITOR.app, page, time.monotonic() + 60)

        self.assertTrue(went_on)
        self.assertEqual(convert_document.call_count, 2)
        logged = {"method": "Collab conversion: note did not run", "error": f"{page[0].node}: RuntimeError"}
        self.assertEqual(connection_for("Error Log").count("Error Log", logged), 1)

    def test_a_converted_note_takes_pushes_while_paused(self):
        payload = typed(self.client_id, "hello")
        fields = {
            "lineage": content.find(note.EDITOR.app, self.node).lineage,
            "sid": self.sid,
            "from": 1,
            "to": 1,
            "cid": self.client_id,
            "seen_rev": 0,
            "schema": 1,
            "shas": [hashlib.sha256(payload).hexdigest()],
        }
        encoded = json.dumps(fields).encode()
        body = struct.pack(">I", len(encoded)) + encoded + payload
        self.assertEqual(pause_conversion(True), 1)

        status, answer = steps.push_rows(self.node, body, lambda user: note.EDITOR.app)

        self.assertEqual((status, answer["rev"]), (200, 1))

    def test_a_note_app_with_only_a_refused_conversion_cant_be_turned_off(self):
        self.addCleanup(log.set_mode, note.EDITOR.app, "on")
        self.purge_every_log()
        node = self.old_note()
        fingerprint = hashlib.sha256(b"<p>Old</p>").hexdigest()
        conversions.record(note.EDITOR.app, node, fingerprint, now_datetime(), "check", "empty")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.assertFalse(log.has_logs(note.EDITOR.app))
        self.assertEqual(
            frappe.db.sql("SELECT `outcome` FROM `__note_content_conversion` WHERE `node` = %s", node),
            (("check",),),
        )

        with self.assertRaisesRegex(frappe.ValidationError, "Collaboration in note can't be turned off"):
            log.set_mode(note.EDITOR.app, "off")

        self.assertTrue(log.enabled(note.EDITOR.app))

    def test_a_note_app_with_only_an_open_attempt_cant_be_turned_off(self):
        self.addCleanup(log.set_mode, note.EDITOR.app, "on")
        self.purge_every_log()
        node = self.old_note()
        fingerprint = hashlib.sha256(b"<p>Old</p>").hexdigest()
        conversions.start_attempt(note.EDITOR.app, node, fingerprint, now_datetime(), retry=False)
        self.assertFalse(log.has_logs(note.EDITOR.app))
        self.assertEqual(
            frappe.db.sql("SELECT `outcome` FROM `__note_content_conversion` WHERE `node` = %s", node),
            ((None,),),
        )

        with self.assertRaisesRegex(frappe.ValidationError, "Collaboration in note can't be turned off"):
            log.set_mode(note.EDITOR.app, "off")

        self.assertTrue(log.enabled(note.EDITOR.app))

    def test_a_job_that_reaches_its_lock_after_an_off_save_converts_nothing(self):
        self.addCleanup(log.set_mode, note.EDITOR.app, "on")
        self.purge_every_log()
        node = self.old_note()
        site = frappe.local.site
        errors: list[Exception] = []
        turned_off: list[bool] = []
        converted = convert.Converted(
            state=typed(1, "Hello"), source="html", dropped=[], anchors={}, threads=[], html="<p>Hello</p>"
        )
        real_sql = frappe.db.sql

        def turn_off_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                log.set_mode(note.EDITOR.app, "off")
                frappe.db.commit()  # nosemgrep: frappe-manual-commit
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        def sql(query, *args, **kwargs):
            text = str(query)
            if not turned_off and "FOR UPDATE" in text and "`tabSuite Collab App`" in text:
                turned_off.append(True)
                admin = threading.Thread(target=turn_off_elsewhere)
                admin.start()
                admin.join(30)

            return real_sql(query, *args, **kwargs)

        with (
            patch.object(frappe.db, "sql", sql),
            patch.object(convert, "convert", return_value=converted),
            patch.object(drive, "take_version"),
        ):
            went_on = conversions.convert_page(
                note.EDITOR.app, [frappe._dict(node=node)], time.monotonic() + 60
            )

        self.assertEqual((errors, turned_off), ([], [True]))
        self.assertFalse(went_on)
        self.assertIsNone(log.find(note.EDITOR.app, node))
        self.assertFalse(frappe.db.sql("SELECT 1 FROM `__note_content_conversion` WHERE `node` = %s", node))

    def test_an_off_save_behind_a_job_holding_the_app_row_is_refused(self):
        self.addCleanup(log.set_mode, note.EDITOR.app, "on")
        self.purge_every_log()
        node = self.old_note()
        site = frappe.local.site
        errors: list[Exception] = []
        allowed: list[bool] = []
        locked = threading.Event()
        asking = threading.Event()
        granted = threading.Event()
        real_sql = frappe.db.sql

        def convert_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                allowed.append(convert.may_convert(note.EDITOR.app, lock=True))
                locked.set()
                if not asking.wait(10):
                    raise AssertionError("the save never asked for the app row")

                if granted.wait(1):
                    raise AssertionError("the save took the app row the job holds")

                fingerprint = note.fingerprint_of("<p>Old</p>")
                conversions.start_attempt(note.EDITOR.app, node, fingerprint, now_datetime(), retry=False)
            except Exception as error:
                errors.append(error)
            finally:
                locked.set()
                frappe.destroy()

        # The save asks for the app row the job holds; the job commits its attempt then
        def sql(query, *args, **kwargs):
            text = str(query)
            writes = text.lstrip().startswith(("UPDATE", "DELETE"))
            if "`tabSuite Collab App`" not in text or not ("FOR UPDATE" in text or writes):
                return real_sql(query, *args, **kwargs)

            asking.set()
            found = real_sql(query, *args, **kwargs)
            granted.set()
            return found

        job = threading.Thread(target=convert_elsewhere)
        job.start()
        locked.wait(30)
        try:
            with (
                patch.object(frappe.db, "sql", sql),
                self.assertRaisesRegex(
                    frappe.ValidationError,
                    "Collaboration in note can't be turned off",
                    msg="the save checked before the job's attempt committed",
                ),
            ):
                log.set_mode(note.EDITOR.app, "off")
        finally:
            asking.set()
            frappe.db.rollback()
            job.join(30)

        self.assertFalse(job.is_alive())
        self.assertEqual((allowed, errors), ([True], []))
        self.assertTrue(log.enabled(note.EDITOR.app))

    def test_a_retry_after_the_body_changed_converts_nothing_once_turned_off(self):
        self.addCleanup(log.set_mode, note.EDITOR.app, "on")
        self.purge_every_log()
        node = self.old_note()
        site = frappe.local.site
        errors: list[Exception] = []
        turned_off: list[bool] = []
        converted = convert.Converted(
            state=typed(1, "Edited"), source="html", dropped=[], anchors={}, threads=[], html="<p>Edited</p>"
        )
        real_drop_attempt = conversions.drop_attempt

        def edit_while_converting(*args, **kwargs):
            if not turned_off:
                frappe.db.sql(f"UPDATE `{APP_TABLE}` SET `html` = '<p>Edited</p>' WHERE `node` = %s", node)
                frappe.db.commit()  # nosemgrep: frappe-manual-commit

            return converted

        def turn_off_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                log.set_mode(note.EDITOR.app, "off")
                frappe.db.commit()  # nosemgrep: frappe-manual-commit
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        # The off-save lands after the dropped attempt commits, before the retry starts its own
        def drop_attempt(*args, **kwargs):
            real_drop_attempt(*args, **kwargs)
            if not turned_off:
                turned_off.append(True)
                admin = threading.Thread(target=turn_off_elsewhere)
                admin.start()
                admin.join(30)

        with (
            patch.object(convert, "convert", side_effect=edit_while_converting),
            patch.object(conversions, "drop_attempt", drop_attempt),
            patch.object(drive, "take_version"),
        ):
            conversions.convert_page(note.EDITOR.app, [frappe._dict(node=node)], time.monotonic() + 60)

        self.assertEqual((errors, turned_off), ([], [True]))
        self.assertFalse(log.enabled(note.EDITOR.app))
        self.assertIsNone(log.find(note.EDITOR.app, node))
        self.assertFalse(frappe.db.sql("SELECT 1 FROM `__note_content_conversion` WHERE `node` = %s", node))

    def test_a_paused_backlog_is_not_waiting(self):
        with (
            patch.object(convert, "editors", return_value={note.EDITOR.app: note.EDITOR}),
            patch.object(convert, "pending_page", return_value=[frappe._dict(node="waiting")]),
        ):
            self.assertTrue(convert.any_waiting())
            self.assertEqual(pause_conversion(True), 1)

            self.assertFalse(convert.any_waiting())
