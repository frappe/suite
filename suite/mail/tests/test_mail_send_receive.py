# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import io
import zipfile

import frappe

from suite.mail.api.mail import (
    create_mail,
    delete_mail,
    fetch_attachment,
    fetch_attachments_as_zip,
    fetch_mail_as_eml,
    get_all_inbox_threads,
    get_all_inbox_unread_count,
    get_mailboxes,
    get_mime_message,
    get_thread,
    get_threads,
    update_draft_mail,
)
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailSendReceive(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.sender)
        cls.disable_screening(cls.receiver)
        cls.sender_account = cls.personal_account(cls.sender)
        cls.receiver_account = cls.personal_account(cls.receiver)

    def _mailbox_id(self, member, account, role):
        with self.set_user(member.email):
            return {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(account)}[role]

    def test_send_and_receive(self):
        subject = f"Hello {unique_name('subject')}"
        with self.set_user(self.sender.email):
            result = create_mail(
                account=self.sender_account,
                from_email=self.sender.email,
                to=[{"email": self.receiver.email, "display_name": "Receiver"}],
                cc=[{"email": self.sender.email}],
                bcc=[],
                subject=subject,
                html_body="<p>A <b>rich</b> body.</p>",
            )
        self.assertEqual(result["status"], "Submitted", result.get("error"))
        self.assertTrue(result["thread_id"])

        thread = self.wait_until(
            lambda: next((t for t in self.get_inbox_threads(self.receiver) if t["subject"] == subject), None),
            timeout=60,
            message="Mail did not arrive in the receiver's inbox.",
        )
        self.assertEqual(thread["from_email"], self.sender.email)
        self.assertIn("rich", thread["preview"])
        recipients = {(r["type"], r["email"]) for r in thread["recipients"]}
        self.assertIn(("To", self.receiver.email), recipients)
        self.assertIn(("Cc", self.sender.email), recipients)
        self.assertFalse(thread["seen"])

        # The unread badge across all accounts counts it.
        with self.set_user(self.receiver.email):
            self.assertGreaterEqual(get_all_inbox_unread_count(), 1)
            merged = get_all_inbox_threads(limit=10)
            self.assertIn(subject, [t["subject"] for t in merged])
            self.assertEqual(merged[0]["account"], self.receiver_account)

    def test_reply_keeps_the_thread(self):
        subject = f"Thread {unique_name('subject')}"
        thread = self.deliver_mail(self.sender, self.receiver, subject=subject)
        original = thread["messages"][-1]

        with self.set_user(self.receiver.email):
            reply = create_mail(
                account=self.receiver_account,
                from_email=self.receiver.email,
                to=[{"email": self.sender.email}],
                cc=[],
                bcc=[],
                subject=f"Re: {subject}",
                html_body="<p>Replying.</p>",
                in_reply_to=original["message_id"],
                in_reply_to_id=original["id"],
            )
        self.assertEqual(reply["status"], "Submitted", reply.get("error"))

        # The sender sees the reply in the same conversation.
        sender_thread = self.wait_until(
            lambda: next((t for t in self.get_inbox_threads(self.sender) if t["subject"] == subject), None),
            timeout=60,
            message="Reply did not arrive in the sender's inbox.",
        )
        with self.set_user(self.sender.email):
            messages = get_thread(self.sender_account, sender_thread["thread_id"])
        self.assertGreaterEqual(len(messages), 2)
        self.assertEqual({m["thread_id"] for m in messages}, {sender_thread["thread_id"]})

        # The receiver's own Inbox row keeps the date of the mail that arrived. Their reply is in Sent
        # and never in the Inbox, so answering a thread must not move it off the day it was received —
        # though the row still describes the conversation's latest message, which is now the reply.
        answered = self.wait_until(
            lambda: next(
                (
                    t
                    for t in self.get_inbox_threads(self.receiver)
                    if t["subject"] == subject and len(t["messages"]) > 1
                ),
                None,
            ),
            timeout=60,
            message="The reply did not join the receiver's copy of the thread.",
        )
        self.assertEqual(answered["received_at"], original["received_at"])
        self.assertIn("Replying", answered["preview"])

    def test_draft_lifecycle(self):
        subject = f"Draft {unique_name('subject')}"
        with self.set_user(self.sender.email):
            draft = create_mail(
                account=self.sender_account,
                from_email=self.sender.email,
                to=[{"email": self.receiver.email}],
                cc=[],
                bcc=[],
                subject=subject,
                html_body="<p>Draft body.</p>",
                save_as_draft=True,
            )
            self.assertNotEqual(draft["status"], "Submitted")

            drafts_id = self._mailbox_id(self.sender, self.sender_account, "drafts")
            threads, _ = self.wait_until(
                lambda: get_threads(self.sender_account, drafts_id, limit=20),
                message="Draft did not appear in the Drafts mailbox.",
            )
            row = next(t for t in threads if t["subject"] == subject)
            self.assertTrue(row["draft"])

            # Edit, then submit.
            edited_subject = f"{subject} v2"
            update_draft_mail(
                account=self.sender_account,
                id=draft["id"],
                from_email=self.sender.email,
                to=[{"email": self.receiver.email}],
                cc=[],
                bcc=[],
                subject=edited_subject,
                html_body="<p>Edited body.</p>",
                submit=False,
            )

            edited = self.wait_until(
                lambda: next(
                    (
                        t
                        for t in get_threads(self.sender_account, drafts_id, limit=20)[0]
                        if t["subject"] == edited_subject
                    ),
                    None,
                ),
                message="Edited draft did not show the new subject.",
            )

            submitted = update_draft_mail(
                account=self.sender_account,
                id=edited["messages"][-1]["id"],
                from_email=self.sender.email,
                to=[{"email": self.receiver.email}],
                cc=[],
                bcc=[],
                subject=edited_subject,
                html_body="<p>Edited body.</p>",
                submit=True,
            )
            self.assertEqual(submitted["status"], "Submitted", submitted.get("error"))

        self.wait_until(
            lambda: any(t["subject"] == edited_subject for t in self.get_inbox_threads(self.receiver)),
            timeout=60,
            message="Submitted draft did not reach the receiver.",
        )

    def test_attachments(self):
        content = b"attachment payload %s" % unique_name("blob").encode()
        file = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": "note.txt",
                "content": content,
                "is_private": 1,
            }
        ).insert(ignore_permissions=True)

        subject = f"Attachment {unique_name('subject')}"
        with self.set_user(self.sender.email):
            result = create_mail(
                account=self.sender_account,
                from_email=self.sender.email,
                to=[{"email": self.receiver.email}],
                cc=[],
                bcc=[],
                subject=subject,
                html_body="<p>See attachment.</p>",
                attachments=[
                    {
                        "file_url": file.file_url,
                        "file_name": "note.txt",
                        "type": "text/plain",
                        "size": len(content),
                        "disposition": "attachment",
                    }
                ],
            )
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        thread = self.wait_until(
            lambda: next((t for t in self.get_inbox_threads(self.receiver) if t["subject"] == subject), None),
            timeout=60,
            message="Attachment mail did not arrive.",
        )
        message = thread["messages"][-1]
        attachments = message["attachments"]
        self.assertEqual([a["filename"] for a in attachments], ["note.txt"])

        with self.set_user(self.receiver.email):
            fetched = fetch_attachment(self.receiver_account, attachments[0]["blob_id"])
            self.assertEqual(bytes(fetched), content)

            archive = fetch_attachments_as_zip(self.receiver_account, attachments + attachments)
            with zipfile.ZipFile(io.BytesIO(archive)) as zf:
                # The duplicate filename gets a counter suffix.
                self.assertEqual(sorted(zf.namelist()), ["note (1).txt", "note.txt"])

            eml = fetch_mail_as_eml(message["name"])
            self.assertIn(subject.encode(), bytes(eml))

            mime = get_mime_message(message["name"])
            self.assertIn(subject, mime["subject"]["value"])
            self.assertIn(self.sender.email, mime["from"]["value"])
            self.assertIn(self.receiver.email, mime["to"]["value"])

    def test_reply_factories_and_delete(self):
        thread = self.deliver_mail(self.sender, self.receiver)
        message = thread["messages"][-1]

        with self.set_user(self.receiver.email):
            doc = frappe.get_doc("Mail Message", message["name"])
            reply = doc.reply()
            self.assertIn(self.sender.email, str(reply.as_dict().get("recipients")))
            self.assertEqual(reply.in_reply_to_id, message["id"])
            forward = doc.forward()
            self.assertFalse(forward.as_dict().get("recipients"))
            self.assertIn(doc.subject, forward.subject)

            delete_mail(self.receiver_account, message["id"])

        self.wait_until(
            lambda: thread["subject"] not in [t["subject"] for t in self.get_inbox_threads(self.receiver)],
            message="Deleted mail is still in the inbox.",
        )
