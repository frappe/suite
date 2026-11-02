import base64
import hashlib
import json
import struct
import uuid
from collections.abc import Callable
from dataclasses import replace
from unittest.mock import MagicMock, patch

import frappe
import pycrdt
from frappe.tests import IntegrationTestCase
from frappe.utils.logging import connection_for

from suite import content, drive
from suite.content import capacity, conversions, convert, copies, jobs, log, logged
from suite.content.editors import MediaReferences, editors
from suite.content.tables import KINDS, ensure_tables, table
from suite.content.tests import multi_copy, note
from suite.drive._core.content import clear_registry_cache

APP_TABLE = f"tab{note.EDITOR.doctype}"
OWNED = (APP_TABLE, *(table(note.EDITOR.app, kind) for kind in KINDS))
NOTE_HOOK = "suite.content.tests.note.EDITOR"
DRIVE_HOOK = "suite.content.tests.note.SPEC"


def typed(client_id: int, text: str) -> bytes:
    doc = pycrdt.Doc(client_id=client_id)
    doc.get("text", type=pycrdt.Text).insert(0, text)
    return doc.get_update()


def drop_owned_tables() -> None:
    for name in OWNED:
        frappe.db.sql_ddl(f"DROP TABLE IF EXISTS `{name}`")


def text_of(state: bytes) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(state)
    return str(doc.get("text", type=pycrdt.Text))


def hooks_with_note(real_get_hooks: Callable) -> Callable:
    added = {"suite_content_editors": NOTE_HOOK, "drive_content_types": DRIVE_HOOK}

    def get_hooks(hook=None, *args, **kwargs):
        found = real_get_hooks(hook, *args, **kwargs)
        if hook in added:
            return [*found, added[hook]]

        return found

    return get_hooks


class NoteAppCase(IntegrationTestCase):
    """The note app's hooks, tables and switch, and a note with a log for each test."""

    @classmethod
    def create_note_tables(cls) -> None:
        # Cleanup drops these, so a site that already has any of them is refused before anything is made
        taken = frappe.db.sql(
            "SELECT `table_name` FROM information_schema.tables WHERE `table_schema` = DATABASE() AND `table_name` IN %s",
            [OWNED],
        )
        if taken:
            raise RuntimeError(f"The note app's tables already exist: {taken}")

        cls.addClassCleanup(drop_owned_tables)
        frappe.db.sql_ddl(
            f"""CREATE TABLE `{APP_TABLE}` (`name` varchar(140) NOT NULL, `node` varchar(140),
            `body` longtext, `html` longtext, `modified` datetime(6), PRIMARY KEY (`name`))"""
        )
        ensure_tables(note.EDITOR.app)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        get_hooks = hooks_with_note(frappe.get_hooks)
        # The apps the site ships, as they were switched
        cls.others = {name: log.mode(name) for name in editors()}
        cls.addClassCleanup(clear_registry_cache)
        cls.hooks = patch.object(frappe, "get_hooks", get_hooks)
        cls.hooks.start()
        cls.addClassCleanup(cls.hooks.stop)
        clear_registry_cache()
        cls.create_note_tables()

    @classmethod
    def tearDownClass(cls):
        # A note with a log can't be removed, so its tables go first
        drop_owned_tables()
        settings = frappe.get_single("Suite Collab Settings")
        settings.apps = [row for row in settings.apps if row.app != note.EDITOR.app]
        settings.save(ignore_permissions=True)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        super().tearDownClass()

    def setUp(self):
        log.set_mode(note.EDITOR.app, "on")
        self.node = frappe.generate_hash(length=10)
        frappe.db.sql(
            f"INSERT INTO `{APP_TABLE}` (`name`, `node`, `body`) VALUES (%s, %s, '')", (self.node, self.node)
        )
        self.doc_id = log.create(note.EDITOR.app, self.node)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.sid = uuid.uuid4().hex
        self.client_id = content.issue_session(note.EDITOR.app, self.doc_id, self.sid, "Administrator")

    def remove_note(self, node: str) -> None:
        doc_id = log.mark_purged(note.EDITOR.app, node)
        if doc_id:
            log.delete_purged(note.EDITOR.app, doc_id)

        for conversion_table in ("__note_content_conversion", "__writer_content_conversion"):
            frappe.db.sql(f"DELETE FROM `{conversion_table}` WHERE `node` = %s", node)

        frappe.db.sql(f"DELETE FROM `{APP_TABLE}` WHERE `name` = %s", node)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def push(self, payload: bytes) -> dict:
        doc = content.find(note.EDITOR.app, self.node)
        fields = {
            "lineage": doc.lineage,
            "sid": self.sid,
            "from": 1,
            "to": 1,
            "cid": self.client_id,
            "seen_rev": 0,
            "schema": 1,
            "shas": [hashlib.sha256(payload).hexdigest()],
        }
        encoded = json.dumps(fields).encode()
        header, body = content.parse_push(struct.pack(">I", len(encoded)) + encoded + payload)
        return content.push(note.EDITOR.app, self.doc_id, doc.head_rev, header, body, "Administrator")

    def purge_every_log(self) -> None:
        doc_table = table(note.EDITOR.app, "doc")
        for (node,) in frappe.db.sql(f"SELECT `node` FROM `{doc_table}` WHERE `mode` != 'purged'"):
            log.delete_purged(note.EDITOR.app, log.mark_purged(note.EDITOR.app, node))

        frappe.db.commit()  # nosemgrep: frappe-manual-commit


class TestNoteEditor(NoteAppCase):
    """An app with no product code keeps its documents in the layer, under its own declarations and switch."""

    def test_a_note_takes_a_push_and_reads_back_as_written(self):
        self.assertEqual(self.push(typed(self.client_id, "hello"))["rev"], 1)

        rows = content.read(note.EDITOR.app, self.doc_id).rows
        doc = pycrdt.Doc()
        for _rev, payload in rows:
            doc.apply_update(payload)

        self.assertEqual(str(doc.get("text", type=pycrdt.Text)), "hello")

    def html_field(self) -> str:
        [[html]] = frappe.db.sql(f"SELECT `html` FROM `{APP_TABLE}` WHERE `name` = %s", self.node)
        return html

    def test_a_copy_of_many_rows_is_installed_and_read_back(self):
        self.push(typed(self.client_id, "hello"))
        copy = multi_copy.MultiCopy()
        rows = {"b": "<p>two</p>", "a": "<p>one</p>"}

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=copy)):
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 1, json.dumps(rows), copy))
            readable = content.readable_copy(note.EDITOR.app, self.doc_id)

        serialized = '{"a":"<p>one</p>","b":"<p>two</p>"}'
        self.assertEqual(self.html_field(), serialized)
        self.assertEqual(readable, "<p>one</p><p>two</p>")
        projection_table = table(note.EDITOR.app, "projection")
        [[stored_hash]] = frappe.db.sql(
            f"SELECT `projection_hash` FROM `{projection_table}` WHERE `doc_id` = %s", self.doc_id
        )
        self.assertEqual(bytes(stored_hash), hashlib.sha256(serialized.encode()).digest())

    def test_moving_pictures_rewrites_only_the_copy_rows_that_name_them(self):
        self.push(typed(self.client_id, "hello"))
        jobs.compact(note.EDITOR.app, self.doc_id)
        copy = multi_copy.MultiCopy()
        media = MediaReferences(
            node_ids=lambda state: set(),
            value_rewriter=lambda mapping: lambda value: value.replace("old", mapping["old"]),
        )
        rows = {"a": '<img src="/files/old">', "b": "<p>two</p>"}

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=copy, media=media)):
            copies.write(note.EDITOR.app, self.doc_id, 1, json.dumps(rows), copy)
            copy.writes.clear()
            self.assertTrue(logged.remap(note.EDITOR.app, self.node, {"old": "new"}))

        self.assertEqual(copy.writes, [{"a": '<img src="/files/new">'}])
        self.assertEqual(self.html_field(), '{"a":"<img src=\\"/files/new\\">","b":"<p>two</p>"}')

    def test_a_copy_that_matches_the_last_one_writes_nothing(self):
        self.push(typed(self.client_id, "hello"))
        copy = multi_copy.MultiCopy()
        rows = json.dumps({"a": "<p>one</p>", "b": "<p>two</p>"})

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=copy)):
            copies.write(note.EDITOR.app, self.doc_id, 1, rows, copy)
            copy.writes.clear()
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 2, rows, copy))

        self.assertEqual(copy.writes, [])
        projection_table = table(note.EDITOR.app, "projection")
        [[projected_rev]] = frappe.db.sql(
            f"SELECT `projected_rev` FROM `{projection_table}` WHERE `doc_id` = %s", self.doc_id
        )
        self.assertEqual(projected_rev, 2)
        copy_table = table(note.EDITOR.app, "copy")
        kept = frappe.db.sql(f"SELECT `rev`, `html` FROM `{copy_table}` WHERE `doc_id` = %s", self.doc_id)
        self.assertEqual([(int(rev), html) for rev, html in kept], [(2, rows)])

    def test_a_new_copy_writes_only_the_rows_that_changed(self):
        self.push(typed(self.client_id, "hello"))
        copy = multi_copy.MultiCopy()
        first = {"a": "<p>one</p>", "b": "<p>two</p>", "c": "<p>three</p>"}
        second = {"a": "<p>one</p>", "b": "<p>two more</p>"}

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=copy)):
            copies.write(note.EDITOR.app, self.doc_id, 1, json.dumps(first), copy)
            copy.writes.clear()
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 2, json.dumps(second), copy))

        self.assertEqual(copy.writes, [{"b": "<p>two more</p>", "c": None}])
        self.assertEqual(self.html_field(), '{"a":"<p>one</p>","b":"<p>two more</p>"}')

    def test_the_same_copy_overwrites_a_foreign_write(self):
        self.push(typed(self.client_id, "hello"))
        copy = multi_copy.MultiCopy()
        rows = json.dumps({"a": "<p>one</p>", "b": "<p>two</p>"})
        foreign = '{"a":"<p>foreign</p>","b":"<p>two</p>"}'

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=copy)):
            copies.write(note.EDITOR.app, self.doc_id, 1, rows, copy)
            frappe.db.sql(f"UPDATE `{APP_TABLE}` SET `html` = %s WHERE `name` = %s", (foreign, self.node))
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 2, rows, copy))

        self.assertEqual(self.html_field(), '{"a":"<p>one</p>","b":"<p>two</p>"}')
        recovery_table = table(note.EDITOR.app, "recovery")
        evidence = frappe.db.sql(
            f"SELECT `reason`, `payload` FROM `{recovery_table}` WHERE `doc_id` = %s", self.doc_id
        )
        self.assertEqual(
            [(reason, bytes(payload)) for reason, payload in evidence], [("copy_foreign", foreign.encode())]
        )

    def test_a_copy_that_reads_back_differently_is_refused_and_the_old_one_kept(self):
        self.push(typed(self.client_id, "hello"))
        good = multi_copy.MultiCopy()
        lossy = multi_copy.LossyCopy()
        first = json.dumps({"a": "<p>one</p>", "b": "<p>two</p>"})
        second = json.dumps({"a": "<p>one</p>", "b": "<p>two more</p>"})
        kept = '{"a":"<p>one</p>","b":"<p>two</p>"}'
        lost = '{"a":"<p>one</p>","b":"<p>two more</p>"}'

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=good)):
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 1, first, good))

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=lossy)):
            self.assertFalse(copies.write(note.EDITOR.app, self.doc_id, 2, second, lossy))

        projection_table = table(note.EDITOR.app, "projection")
        copy_table = table(note.EDITOR.app, "copy")
        recovery_table = table(note.EDITOR.app, "recovery")
        self.assertEqual(self.html_field(), '{"a":"<p>one</p>","b":"<p>two</p>"}')
        [[projected_rev, stored_hash]] = frappe.db.sql(
            f"SELECT `projected_rev`, `projection_hash` FROM `{projection_table}` WHERE `doc_id` = %s",
            self.doc_id,
        )
        self.assertEqual(projected_rev, 1)
        self.assertEqual(bytes(stored_hash), hashlib.sha256(kept.encode()).digest())
        kept_copies = frappe.db.sql(
            f"SELECT `rev`, `html` FROM `{copy_table}` WHERE `doc_id` = %s", self.doc_id
        )
        self.assertEqual([(int(rev), html) for rev, html in kept_copies], [(1, first)])
        evidence = frappe.db.sql(
            f"SELECT `reason`, `payload` FROM `{recovery_table}` WHERE `doc_id` = %s", self.doc_id
        )
        self.assertEqual(
            [(reason, bytes(payload)) for reason, payload in evidence],
            [("copy_mismatch", b'{"a":"<p>one</p>"}')],
        )

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=good)):
            self.assertTrue(copies.write(note.EDITOR.app, self.doc_id, 2, second, good))

        self.assertEqual(self.html_field(), lost)

    def test_a_repeated_mismatch_alerts_once(self):
        self.push(typed(self.client_id, "hello"))
        good = multi_copy.MultiCopy()
        lossy = multi_copy.LossyCopy()
        second = json.dumps({"a": "<p>one</p>", "b": "<p>two more</p>"})

        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=good)):
            self.assertTrue(
                copies.write(note.EDITOR.app, self.doc_id, 1, json.dumps({"a": "<p>one</p>"}), good)
            )

        alerts = connection_for("Error Log").count("Error Log", {"method": ["like", "Collab readable copy%"]})
        with patch.object(note, "EDITOR", replace(note.EDITOR, readable_copy=lossy)):
            self.assertFalse(copies.write(note.EDITOR.app, self.doc_id, 2, second, lossy))
            self.assertFalse(copies.write(note.EDITOR.app, self.doc_id, 2, second, lossy))

        recovery_table = table(note.EDITOR.app, "recovery")
        evidence = frappe.db.sql(f"SELECT `reason` FROM `{recovery_table}` WHERE `doc_id` = %s", self.doc_id)
        self.assertEqual([reason for (reason,) in evidence], ["copy_mismatch"])
        self.assertEqual(
            connection_for("Error Log").count("Error Log", {"method": ["like", "Collab readable copy%"]}),
            alerts + 1,
        )

    def test_compaction_writes_a_note_body_into_the_apps_own_row(self):
        self.push(typed(self.client_id, "kept"))

        jobs.compact(note.EDITOR.app, self.doc_id)

        [[body]] = frappe.db.sql(f"SELECT `body` FROM `{APP_TABLE}` WHERE `name` = %s", self.node)
        self.assertEqual(text_of(base64.b64decode(body)), "kept")

    def test_a_change_over_the_layers_cap_is_malformed(self):
        with patch.object(capacity, "CHANGE_MAX", 2**16), self.assertRaises(content.Refusal) as refused:
            self.push(typed(self.client_id, "x" * (2**16 + 1)))

        self.assertEqual(refused.exception.body, {"collab": "malformed"})

    def test_notes_with_a_log_cannot_be_turned_off_or_removed(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Collaboration in note can't be turned off"):
            log.set_mode(note.EDITOR.app, "off")

        settings = frappe.get_single("Suite Collab Settings")
        settings.apps = [row for row in settings.apps if row.app != note.EDITOR.app]
        with self.assertRaisesRegex(frappe.ValidationError, "Collaboration in note can't be turned off"):
            settings.save(ignore_permissions=True)

        self.assertTrue(content.enabled(note.EDITOR.app))

    def test_only_a_log_that_is_not_purged_counts(self):
        self.assertTrue(log.has_logs(note.EDITOR.app))

        self.purge_every_log()

        self.assertFalse(log.has_logs(note.EDITOR.app))
        # An app whose tables were never made
        self.assertFalse(log.has_logs("absent"))

    def test_an_always_on_app_cannot_be_turned_off_with_no_logs(self):
        self.purge_every_log()

        with (
            patch.object(note, "EDITOR", replace(note.EDITOR, always_on=True)),
            self.assertRaisesRegex(frappe.ValidationError, "Collaboration in note can't be turned off"),
        ):
            log.set_mode(note.EDITOR.app, "off")

        self.assertTrue(content.enabled(note.EDITOR.app))

    def test_settings_refuse_an_unknown_app_and_a_second_row_for_one_app(self):
        settings = frappe.get_single("Suite Collab Settings")
        settings.append("apps", {"app": "absent", "mode": "off"})
        with self.assertRaisesRegex(
            frappe.ValidationError, "No app named absent keeps its documents in the content layer"
        ):
            settings.save(ignore_permissions=True)

        settings = frappe.get_single("Suite Collab Settings")
        settings.append("apps", {"app": note.EDITOR.app, "mode": "on"})
        with self.assertRaisesRegex(frappe.ValidationError, "note has more than one row"):
            settings.save(ignore_permissions=True)

    def test_notes_off_answer_disabled_and_leave_the_other_apps_on(self):
        self.purge_every_log()
        content.require_enabled(note.EDITOR.app)

        log.set_mode(note.EDITOR.app, "off")

        with self.assertRaises(content.Refusal) as refused:
            content.require_enabled(note.EDITOR.app)

        self.assertEqual(refused.exception.body, {"collab": "disabled"})
        self.assertEqual(
            {name: content.enabled(name) for name in self.others},
            {name: mode == "on" for name, mode in self.others.items()},
        )

    def test_an_old_note_converts_through_the_layer(self):
        node = frappe.generate_hash(length=10)
        frappe.db.sql(
            f"INSERT INTO `{APP_TABLE}` (`name`, `node`, `body`, `html`) VALUES (%s, %s, '', '<p>Old</p>')",
            (node, node),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.addCleanup(self.remove_note, node)
        converted = convert.Converted(
            state=typed(1, "Hello"), source="html", dropped=[], anchors={}, threads=[], html="<p>Hello</p>"
        )
        fix_up = MagicMock(wraps=note.EDITOR.conversion.fix_up)
        conversion = replace(note.EDITOR.conversion, fix_up=fix_up)

        with (
            patch.object(note, "EDITOR", replace(note.EDITOR, conversion=conversion)),
            patch.object(convert, "convert", return_value=converted),
            patch.object(drive, "take_version") as take_version,
        ):
            outcome = conversions.convert_document(note.EDITOR.app, node)

        self.assertEqual(outcome, "converted")
        self.assertEqual(
            text_of(content.read(note.EDITOR.app, log.find(note.EDITOR.app, node).id).checkpoint), "Hello"
        )
        [[html]] = frappe.db.sql(f"SELECT `html` FROM `{APP_TABLE}` WHERE `name` = %s", node)
        self.assertEqual(html, "<p>Hello</p>")
        self.assertEqual(
            frappe.db.sql("SELECT `outcome` FROM `__note_content_conversion` WHERE `node` = %s", node),
            (("converted",),),
        )
        self.assertFalse(frappe.db.sql("SELECT 1 FROM `__writer_content_conversion` WHERE `node` = %s", node))
        take_version.assert_called_once_with(node, kind="milestone", label="Before collaboration")
        fix_up.assert_called_once()
        [[fixed_node, _old, checked]] = [call.args for call in fix_up.call_args_list]
        self.assertEqual(fixed_node, node)
        self.assertEqual(checked.html, "<p>Hello</p>")

    def test_a_note_its_check_refuses_keeps_its_old_body(self):
        node = frappe.generate_hash(length=10)
        frappe.db.sql(
            f"INSERT INTO `{APP_TABLE}` (`name`, `node`, `body`, `html`) VALUES (%s, %s, '', '<p>Old</p>')",
            (node, node),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.addCleanup(self.remove_note, node)
        converted = convert.Converted(
            state=typed(1, ""), source="html", dropped=[], anchors={}, threads=[], html=""
        )
        fix_up = MagicMock(wraps=note.EDITOR.conversion.fix_up)
        conversion = replace(note.EDITOR.conversion, fix_up=fix_up)

        with (
            patch.object(note, "EDITOR", replace(note.EDITOR, conversion=conversion)),
            patch.object(convert, "convert", return_value=converted),
            patch.object(drive, "take_version") as take_version,
        ):
            outcome = conversions.convert_document(note.EDITOR.app, node)

        self.assertEqual(outcome, "check")
        self.assertIsNone(log.find(note.EDITOR.app, node))
        [[html]] = frappe.db.sql(f"SELECT `html` FROM `{APP_TABLE}` WHERE `name` = %s", node)
        self.assertEqual(html, "<p>Old</p>")
        self.assertEqual(
            frappe.db.sql(
                "SELECT `outcome`, `reason` FROM `__note_content_conversion` WHERE `node` = %s", node
            ),
            (("check", "empty"),),
        )
        self.assertFalse(frappe.db.sql("SELECT 1 FROM `__writer_content_conversion` WHERE `node` = %s", node))
        take_version.assert_not_called()
        fix_up.assert_not_called()
