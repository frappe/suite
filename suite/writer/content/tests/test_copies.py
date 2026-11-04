import hashlib
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.utils.logging import connection_for

from suite.content import copies, jobs, logged, scheduling, steps
from suite.content.http import routes
from suite.content.stage import PIECE_MAX
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    OUTSIDER,
    CheckpointCase,
    answer,
    call_route,
    piece_body,
    pieces_of,
)


class TestReadableCopies(CheckpointCase):
    """A tab's render of the document becomes its readable copy only when it holds the document at its rev."""

    def setUp(self):
        super().setUp()
        self.node = self.new_document()
        self.type_into(self.node, ["one", " two"])
        self.doc = self.doc_row(self.node)

    def install(self, rev: int, html: str, **render) -> str:
        fields = {"lineage": self.doc.lineage, "q_epoch": int(self.doc.q_epoch), **render}
        return copies.install(
            writer_content.APP,
            self.doc.id,
            rev,
            html=html,
            html_copy=writer_content.EDITOR.readable_copy,
            **fields,
        )

    def html_field(self) -> str:
        return frappe.db.get_value("Writer Document", {"node": self.node}, "html") or ""

    def evidence(self) -> list[tuple[str, str, bytes]]:
        rows = frappe.db.sql(
            """SELECT `owner`, `reason`, `payload` FROM `__writer_content_recovery`
            WHERE `doc_id` = %s ORDER BY `created`, `reason`""",
            self.doc.id,
        )
        return [(owner, reason, bytes(payload)) for owner, reason, payload in rows]

    def kept_copies(self) -> list[tuple[int, str | None]]:
        rows = frappe.db.sql(
            "SELECT `rev`, `html` FROM `__writer_content_copy` WHERE `doc_id` = %s ORDER BY `rev`",
            self.doc.id,
        )
        return [(int(rev), html) for rev, html in rows]

    def alerts(self) -> int:
        return connection_for("Error Log").count("Error Log", {"method": ["like", "Collab readable copy%"]})

    def test_a_render_of_the_head_becomes_the_documents_copy(self):
        self.assertEqual(self.install(2, "<p>one two</p>"), "installed")

        self.assertEqual(self.html_field(), "<p>one two</p>")
        self.assertEqual(self.kept_copies(), [(2, "<p>one two</p>")])

    def test_a_render_is_checked_against_the_document_at_its_own_rev(self):
        self.assertEqual(self.install(1, "<p>one</p>"), "installed")
        self.assertEqual(self.html_field(), "<p>one</p>")

        self.assertEqual(self.install(2, "<p>one</p>"), "refused")
        self.assertEqual(self.html_field(), "<p>one</p>")

    def test_the_copy_only_moves_forward(self):
        self.install(2, "<p>one two</p>")

        self.assertEqual(self.install(1, "<p>one</p>"), "stale")
        self.assertEqual(self.install(2, "<p>one two!</p>"), "stale")
        self.assertEqual(self.html_field(), "<p>one two</p>")

    def test_a_render_of_another_log_or_from_before_a_quarantine_is_stale(self):
        stale_renders = [
            {"lineage": "0" * 32},
            {"q_epoch": int(self.doc.q_epoch) + 1},
        ]
        for render in stale_renders:
            with self.subTest(render=render):
                self.assertEqual(self.install(2, "<p>one two</p>", **render), "stale")

        self.assertEqual(self.install(3, "<p>one two</p>"), "stale")
        self.assertEqual(self.html_field(), "")

    def test_a_render_missing_text_is_kept_as_evidence_and_never_published(self):
        alerts = self.alerts()

        self.assertEqual(self.install(2, "<p>one</p>"), "refused")

        self.assertEqual(self.html_field(), "")
        self.assertEqual(self.evidence(), [("system", "copy_refused", b"<p>one</p>")])
        self.assertEqual(self.alerts(), alerts + 1)

    def test_markup_a_browser_would_run_is_taken_out_before_the_copy_is_published(self):
        self.install(2, '<p onclick="steal()">one two</p><script>steal()</script>')

        self.assertEqual(self.html_field(), "<p>one two</p>")

    def test_a_body_from_before_the_log_is_kept_quietly_when_the_first_copy_replaces_it(self):
        frappe.db.set_value(
            "Writer Document", {"node": self.node}, "html", "<p>legacy</p>", update_modified=False
        )
        frappe.db.commit()
        alerts = self.alerts()

        self.install(2, "<p>one two</p>")

        self.assertEqual(self.evidence(), [("system", "copy_first", b"<p>legacy</p>")])
        self.assertEqual(self.alerts(), alerts)

    def test_a_copy_written_over_by_something_else_is_kept_as_evidence_and_alerted(self):
        self.install(1, "<p>one</p>")
        frappe.db.set_value(
            "Writer Document", {"node": self.node}, "html", "<p>foreign</p>", update_modified=False
        )
        frappe.db.commit()
        alerts = self.alerts()

        self.assertEqual(self.install(2, "<p>one two</p>"), "installed")

        self.assertEqual(self.html_field(), "<p>one two</p>")
        self.assertEqual(self.evidence(), [("system", "copy_foreign", b"<p>foreign</p>")])
        self.assertEqual(self.alerts(), alerts + 1)

    def test_a_newer_copy_drops_the_older_one(self):
        self.install(1, "<p>one</p>")

        self.install(2, "<p>one two</p>")

        self.assertEqual(self.kept_copies(), [(2, "<p>one two</p>")])
        ((stored_hash,),) = frappe.db.sql(
            "SELECT `projection_hash` FROM `__writer_content_projection` WHERE `doc_id` = %s", self.doc.id
        )
        self.assertEqual(bytes(stored_hash), hashlib.sha256(b"<p>one two</p>").digest())

    def test_a_remap_rewrites_the_html_copy(self):
        picture = '<img src="/api/method/suite.writer.api.embed.get?id={}">'
        self.assertEqual(self.install(2, "<p>one two</p>" + picture.format("old")), "installed")
        jobs.compact(writer_content.APP, self.doc.id)
        self.assertEqual(self.html_field(), "<p>one two</p>" + picture.format("old"))

        self.assertTrue(logged.remap(writer_content.APP, self.node, {"old": "new"}))

        self.assertEqual(self.html_field(), "<p>one two</p>" + picture.format("new"))

    def age_copy(self, seconds: int):
        frappe.db.sql(
            "UPDATE `__writer_content_projection` SET `updated` = %s WHERE `doc_id` = %s",
            (frappe.utils.now_datetime() - timedelta(seconds=seconds), self.doc.id),
        )
        frappe.db.commit()

    def test_a_push_asks_for_a_render_when_the_copy_is_behind_and_a_minute_old(self):
        self.assertIs(self.last_answer["copy"], True)

        self.install(2, "<p>one two</p>")
        self.type_into(self.node, [" three"])
        self.assertIs(self.last_answer["copy"], False)

        self.age_copy(60)
        self.type_into(self.node, [" four"])
        self.assertIs(self.last_answer["copy"], True)

        self.install(4, "<p>one two three four</p>")
        self.age_copy(3600)
        self.assertFalse(
            copies.wanted_on(writer_content.APP, steps.due_after_push(writer_content.APP, self.doc.id))
        )


class TestStagedRenders(CheckpointCase):
    """An editing tab stages its render at a rev and submits it; the document's copy check installs the newest."""

    def setUp(self):
        super().setUp()
        self.node = self.new_document()
        self.type_into(self.node, ["one", " two"])
        self.doc = self.doc_row(self.node)
        self.sid = uuid.uuid4().hex
        session = call_route(routes.sessions_post, self.node, body=json.dumps({"sid": self.sid}).encode())
        self.assertEqual(session.status_code, 200)

    def stage_render(self, rev: int, html: bytes, *, indexes=None, **header) -> str:
        stage_id = uuid.uuid4().hex
        pieces = pieces_of(html)
        if indexes is None:
            indexes = range(len(pieces))

        fields = {"purpose": "render", "rev": rev, "q_epoch": int(self.doc.q_epoch), **header}
        for index in indexes:
            body = piece_body(self.doc.lineage, self.sid, 1, html, pieces[index], **fields)
            put = call_route(lambda node: routes.stage_put(node, stage_id, str(index)), self.node, body=body)
            self.assertEqual((put.status_code, answer(put)), (200, {"staged": index}))

        return stage_id

    def submit(self, stage_id: str) -> tuple[int, dict]:
        with patch.object(scheduling, "enqueue") as enqueue:
            response = call_route(
                routes.html_post, self.node, body=json.dumps({"stage_id": stage_id}).encode()
            )

        self.queued = enqueue.call_count
        return response.status_code, answer(response)

    def staged_revs(self) -> list[int]:
        rows = frappe.db.sql(
            "SELECT DISTINCT `rev` FROM `__writer_content_stage` WHERE `doc_id` = %s ORDER BY `rev`",
            self.doc.id,
        )
        return [int(rev) for (rev,) in rows]

    def html_field(self) -> str:
        return frappe.db.get_value("Writer Document", {"node": self.node}, "html") or ""

    def check(self):
        jobs.check_render(writer_content.APP, self.doc.id)

    def test_a_submitted_render_is_queued_and_its_check_makes_it_the_copy(self):
        self.assertEqual(self.submit(self.stage_render(2, b"<p>one two</p>")), (202, {"render": "queued"}))
        self.assertEqual(self.queued, 1)

        self.check()

        self.assertEqual(self.html_field(), "<p>one two</p>")
        self.assertEqual(self.staged_revs(), [])

    def test_a_newer_render_replaces_an_older_one_waiting(self):
        self.submit(self.stage_render(1, b"<p>one</p>"))
        self.submit(self.stage_render(2, b"<p>one two</p>"))

        self.assertEqual(self.staged_revs(), [2])

    def test_a_render_still_arriving_leaves_an_older_whole_one_to_be_checked(self):
        self.submit(self.stage_render(1, b"<p>one</p>"))
        self.stage_render(2, b"<p>" + b"x" * PIECE_MAX + b"</p>", indexes=[0])

        self.check()

        self.assertEqual(self.html_field(), "<p>one</p>")
        self.assertEqual(self.staged_revs(), [2])

    def test_a_render_that_cant_become_the_copy_is_answered_stale_and_dropped(self):
        copies.install(
            writer_content.APP,
            self.doc.id,
            1,
            self.doc.lineage,
            int(self.doc.q_epoch),
            "<p>one</p>",
            writer_content.EDITOR.readable_copy,
        )
        stale_renders = [
            {"rev": 1},
            {"rev": 3},
            {"rev": 2, "q_epoch": int(self.doc.q_epoch) + 1},
        ]
        for render in stale_renders:
            with self.subTest(render=render):
                stage_id = self.stage_render(html=b"<p>one two</p>", **render)

                self.assertEqual(self.submit(stage_id), (200, {"render": "stale"}))
                self.assertEqual(self.queued, 0)
                self.assertEqual(self.staged_revs(), [])

    def test_a_tab_that_has_saved_changes_still_stages_its_render(self):
        frappe.db.sql("UPDATE `__writer_content_session` SET `acked_seq` = 5 WHERE `sid` = %s", self.sid)
        frappe.db.commit()

        self.assertEqual(self.submit(self.stage_render(2, b"<p>one two</p>")), (202, {"render": "queued"}))

    def test_a_render_staged_in_someone_elses_session_cant_be_submitted(self):
        stage_id = self.stage_render(2, b"<p>one two</p>")
        frappe.db.sql(
            "UPDATE `__writer_content_session` SET `user` = %s WHERE `sid` = %s", (OUTSIDER, self.sid)
        )
        frappe.db.commit()

        self.assertEqual(self.submit(stage_id), (409, {"collab": "session_owner"}))
        self.assertEqual(self.queued, 0)

    def test_only_a_whole_staged_render_can_be_submitted(self):
        html = b"<p>" + b"x" * PIECE_MAX + b"</p>"

        self.assertEqual(
            self.submit(self.stage_render(2, html, indexes=[0])), (409, {"collab": "stage_incomplete"})
        )
        self.assertEqual(self.submit(uuid.uuid4().hex), (409, {"collab": "stage_incomplete"}))
        self.assertEqual(self.submit("not a stage"), (400, {"collab": "malformed"}))

    def test_a_render_and_a_change_never_take_each_others_stage(self):
        render = self.stage_render(2, b"<p>one two</p>")
        body = piece_body(self.doc.lineage, self.sid, 1, b"change", b"change")
        put = call_route(lambda node: routes.stage_put(node, render, "0"), self.node, body=body)
        self.assertEqual((put.status_code, answer(put)), (409, {"collab": "stage_conflict"}))

        change = uuid.uuid4().hex
        call_route(lambda node: routes.stage_put(node, change, "0"), self.node, body=body)
        self.assertEqual(self.submit(change), (409, {"collab": "stage_conflict"}))

    def test_a_staged_render_outlives_the_quarter_hour_that_expires_changes(self):
        stage_id = self.stage_render(2, b"<p>one two</p>")
        frappe.db.sql(
            "UPDATE `__writer_content_stage` SET `created` = %s WHERE `stage_id` = %s",
            (frappe.utils.now_datetime() - timedelta(minutes=16), stage_id),
        )
        frappe.db.commit()

        with patch.object(scheduling, "enqueue"):
            jobs.sweep()

        self.assertEqual(self.submit(stage_id), (202, {"render": "queued"}))

    def test_the_sweeper_checks_a_render_whose_job_never_ran(self):
        self.submit(self.stage_render(2, b"<p>one two</p>"))

        with patch.object(scheduling, "enqueue") as enqueue:
            jobs.sweep()

        render_checks = [call for call in enqueue.call_args_list if call.args[0] == jobs.CHECK_RENDER]
        self.assertIn(
            (
                (jobs.CHECK_RENDER, f"suite-collab-render-writer-{self.doc.id}"),
                {"app": "writer", "doc_id": self.doc.id},
            ),
            [(call.args, call.kwargs) for call in render_checks],
        )
