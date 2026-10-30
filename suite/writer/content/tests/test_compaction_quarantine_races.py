import threading
from unittest.mock import patch

import frappe

from suite.content import compaction, jobs, quarantine, suspect
from suite.writer import content as writer_content
from suite.writer.content.tests.compaction_case import CompactionCase


class TestInstallQuarantineRace(CompactionCase):
    def quarantined_revs(self, node: str) -> list[int]:
        rows = frappe.db.sql(
            "SELECT `rev` FROM `__writer_content_update` WHERE `doc_id` = %s AND `state` = 'quarantined' ORDER BY `rev`",
            self.doc_row(node).id,
        )
        return [int(rev) for (rev,) in rows]

    def test_a_quarantine_between_the_snapshot_and_the_install_stays_out_of_the_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        snapshot, compacted = self.compacted(node)
        frappe.db.rollback()
        taken: list[list[int]] = []

        def judge_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                taken.append(quarantine.quarantine(writer_content.APP, doc_id, {2}, "yjs_refused"))
            finally:
                frappe.destroy()

        thread = threading.Thread(target=judge_elsewhere)
        thread.start()
        thread.join()
        self.assertEqual(taken, [[2, 3]])

        self.compaction_job(doc_id).install(snapshot, compacted)
        frappe.db.rollback()

        body_text = self.text_of(self.body_of(node))
        doc = self.doc_row(node)
        self.assertNotIn("two", body_text)
        self.assertNotIn("three", body_text)
        self.assertEqual(int(doc.q_epoch), 1)
        self.assertEqual(self.quarantined_revs(node), [2, 3])

    def test_a_judge_during_a_compaction_answers_busy_and_quarantines_nothing(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        bundle = jobs.spec_of(writer_content.APP).checker_build
        verdicts: list[str | None] = []
        real_compact = compaction.compact

        def judge_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                frappe.db.sql(
                    "UPDATE `__writer_content_doc` SET `suspect` = 'client' WHERE `id` = %s", doc_id
                )
                frappe.db.commit()
                verdicts.append(suspect.judge(writer_content.APP, doc_id, writer_content.PART_MAP, bundle))
                frappe.db.commit()
            finally:
                frappe.destroy()

        def judge_while_compacting(*args, **kwargs):
            # Off-lock, after the snapshot and before the install
            thread = threading.Thread(target=judge_elsewhere)
            thread.start()
            thread.join()
            return real_compact(*args, **kwargs)

        with patch.object(compaction, "compact", judge_while_compacting):
            self.compaction_job(doc_id).run()

        frappe.db.rollback()

        self.assertEqual(verdicts, ["busy"])
        self.assertEqual(self.quarantined_revs(node), [])
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")
        self.assertEqual(int(self.doc_row(node).q_epoch), 0)
