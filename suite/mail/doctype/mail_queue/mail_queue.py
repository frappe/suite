# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from email import message_from_string
from email.utils import make_msgid, parseaddr
from mimetypes import guess_type
from pathlib import Path
from typing import Any, Literal
from uuid import uuid7

import frappe
from frappe import _
from frappe.core.doctype.file.file import File
from frappe.core.doctype.file.file import has_permission as has_file_permission
from frappe.core.doctype.file.utils import find_file_by_url
from frappe.model.document import Document
from frappe.query_builder import Case, Order
from frappe.utils import (
    add_to_date,
    cint,
    create_batch,
    get_datetime,
    get_datetime_str,
    now,
    now_datetime,
    random_string,
    time_diff_in_seconds,
    validate_email_address,
)
from jmap import CreationRef, MethodError

from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.mail.jmap import (
    build_email_draft,
    build_submission_envelope,
    get_account_client,
    get_identities,
    get_identity_id_by_email,
    get_mailbox_id_by_role,
    get_max_delayed_send,
    get_set_error_message,
)
from suite.mail.utils import get_config, log_mail_error
from suite.mail.utils.dt import parsedate_to_datetime
from suite.mail.utils.user import is_jmap_configured
from suite.utils.permissions import OwnerFromUser
from suite.utils.user import is_administrator

SUBMISSION_PROPERTIES = ["id", "emailId", "undoStatus", "sendAt"]


class MailQueue(OwnerFromUser, Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        _response: DF.JSON | None
        account: DF.Link
        attachments: DF.JSON | None
        blob_id: DF.Data | None
        cancelled_at: DF.Datetime | None
        delivery_mode: DF.Literal["Immediate", "Enqueue", "Batch"]
        destroy_after_submit: DF.Check
        drafted_at: DF.Datetime | None
        error_log: DF.Code | None
        forwarded_from_id: DF.Data | None
        from_email: DF.Data | None
        from_ip: DF.Data | None
        from_name: DF.Data | None
        headers: DF.JSON | None
        html_body: DF.Code | None
        id: DF.Data | None
        in_reply_to: DF.Data | None
        in_reply_to_id: DF.Data | None
        mailbox_id: DF.Data | None
        max_retries: DF.Int
        message_id: DF.Data | None
        newsletter: DF.Check
        next_retry_after: DF.Datetime | None
        priority: DF.Literal["", "Low", "Normal", "High"]
        queued_at: DF.Datetime | None
        raw_message: DF.Code | None
        recipients: DF.JSON | None
        reply_to: DF.JSON | None
        retries: DF.Int
        save_as_draft: DF.Check
        send_at: DF.Datetime | None
        sent_at: DF.Datetime | None
        size: DF.Int
        status: DF.Literal[
            "",
            "Pending",
            "Queued",
            "Failed",
            "Drafted",
            "Failed to Draft",
            "Submitted",
            "Failed to Submit",
            "Scheduled",
            "Cancelled",
        ]
        subject: DF.SmallText | None
        submission_id: DF.Data | None
        submitted_at: DF.Datetime | None
        text_body: DF.Code | None
        thread_id: DF.Data | None
        user: DF.Link
        via_api: DF.Check
    # end: auto-generated types

    @staticmethod
    def clear_old_logs(days: int = 3) -> None:
        MQ = frappe.qb.DocType("Mail Queue")
        cutoff = get_datetime(add_to_date(now(), days=-days))
        (
            frappe.qb.from_(MQ)
            .where(
                ((MQ.status.isin(["Drafted", "Submitted", "Cancelled"])) & (MQ.creation < cutoff))
                # A Scheduled row whose hold elapsed this long ago has delivered (or surfaced
                # in the MTA queue) — without this, rows never reconciled by the Scheduled
                # page (e.g. every undo-send hold) would accumulate forever.
                | ((MQ.status == "Scheduled") & (MQ.send_at < cutoff))
            )
            .delete()
        ).run()

    @staticmethod
    def _get_file(
        name: str | None = None,
        file_url: str | None = None,
        user: str | None = None,
        check_permission: bool = True,
    ) -> File:
        """Returns the File document for the given name or file URL."""

        if not name and not file_url:
            frappe.throw(_("Either name or file URL is required."))

        file = None
        if name:
            file = frappe.get_doc("File", name)
        elif file_url:
            file = find_file_by_url(file_url)

        if not file:
            frappe.throw(_("File <code>{0}</code> not found.").format(name or file_url))

        if check_permission:
            if not has_file_permission(file, "read", user=user):
                frappe.throw(
                    _("User {0} do not have permission to access the file <code>{1}</code>.").format(
                        frappe.bold(user or frappe.session.user), name or file_url
                    )
                )

        return file

    @staticmethod
    def _create(do_not_save: bool = False, **kwargs) -> MailQueue:
        """Create a new MailQueue document."""

        kwargs = frappe._dict(kwargs)

        doc = frappe.new_doc("Mail Queue")
        doc.user = kwargs.user
        doc.account = kwargs.account
        doc.from_name = kwargs.from_name
        doc.from_email = kwargs.from_email
        doc.subject = kwargs.subject

        for field in ["reply_to", "headers", "recipients", "attachments"]:
            if kwargs.get(field):
                setattr(doc, field, json.dumps(kwargs[field]))

        doc.html_body = kwargs.html_body
        doc.text_body = kwargs.text_body
        doc.forwarded_from_id = kwargs.forwarded_from_id
        doc.message_id = kwargs.message_id
        doc.id = kwargs.id
        doc.via_api = cint(kwargs.via_api)
        doc.newsletter = cint(kwargs.newsletter)
        doc.priority = kwargs.priority
        doc.sent_at = kwargs.sent_at
        doc.send_at = kwargs.send_at
        doc.in_reply_to = kwargs.in_reply_to
        doc.in_reply_to_id = kwargs.in_reply_to_id
        doc.save_as_draft = cint(kwargs.save_as_draft)
        doc.destroy_after_submit = cint(kwargs.destroy_after_submit)
        doc.delivery_mode = kwargs.delivery_mode or "Immediate"
        doc.raw_message = kwargs.raw_message

        if not do_not_save:
            if frappe.flags.read_only:
                if not doc.name:
                    doc.set_new_name()

                doc.delivery_mode = "Immediate"
                doc.validate()
                doc._process()

                if doc.status in ["Failed", "Failed to Draft", "Failed to Submit"]:
                    error_message = doc.error_message or "Request Failed"
                    frappe.throw(error_message)
            else:
                doc.insert()

        return doc

    @property
    def _priority(self) -> int:
        """Returns the MT-Priority value based on the priority field."""

        mt_priority_map = {
            "Low": -4,
            "Normal": 0,
            "High": 4,
        }
        return mt_priority_map.get(self.priority, 0)

    @property
    def _hold_until(self) -> int | None:
        """Returns the scheduled delivery time as epoch seconds (the RFC 4865 HOLDUNTIL value), or None if not scheduled."""

        if not self.send_at:
            return None

        from suite.utils.dt import convert_to_utc

        return int(convert_to_utc(get_datetime(self.send_at)).timestamp())

    @property
    def identity(self) -> dict:
        """Returns the identity used to send the email."""

        identity = {}

        if self.from_email:
            for i in get_identities(self.account):
                if self.from_email.lower() == i.get("email").lower():
                    identity = i
                    break

        return identity

    @property
    def to(self) -> list[dict[str, str | None]]:
        """Returns the recipients in the To field."""

        return self._get_recipients("To")

    @property
    def cc(self) -> list[dict[str, str | None]]:
        """Returns the recipients in the Cc field."""

        return self._get_recipients("Cc")

    @property
    def bcc(self) -> list[dict[str, str | None]]:
        """Returns the recipients in the Bcc field."""

        return self._get_recipients("Bcc")

    @property
    def received_after(self) -> float:
        """Returns the time difference in seconds between creation and sent time."""

        if self.sent_at and self.creation:
            time_diff = time_diff_in_seconds(self.creation, self.sent_at)
            if time_diff > 0:
                return time_diff

        return 0.0

    @property
    def queued_after(self) -> float:
        """Returns the time difference in seconds between queued and creation time."""

        return time_diff_in_seconds(self.queued_at, self.creation) if self.queued_at else 0.0

    @property
    def drafted_after(self) -> float:
        """Returns the time difference in seconds between drafted and creation time."""

        return time_diff_in_seconds(self.drafted_at, self.creation) if self.drafted_at else 0.0

    @property
    def submitted_after(self) -> float:
        """Returns the time difference in seconds between submitted and creation time."""

        return time_diff_in_seconds(self.submitted_at, self.creation) if self.submitted_at else 0.0

    @property
    def message(self) -> str | None:
        """Returns the message content if available."""

        from suite.mail.doctype.mail_message.mail_message import _get_cached_blobs

        if self.blob_id:
            blobs = _get_cached_blobs(self.account, [self.blob_id])
            if content := blobs.get(self.blob_id):
                return content.decode("utf-8")

    @property
    def response(self) -> str | None:
        """Returns the indented JSON response."""

        _response = json_loads(self._response)
        return json.dumps(_response, indent=4) if _response else None

    @property
    def error_message(self) -> str | None:
        """Returns the error message."""

        if not self._response or self.status not in ["Failed to Draft", "Failed to Submit"]:
            return None

        response = json_loads(self._response)

        data = None
        if "methodResponses" in response:
            # Rows written before the jmaplib switch store the raw JMAP response.
            if self.status == "Failed to Draft":
                data = response["methodResponses"][0][1].get("notCreated", {}).get(f"draft-{self.name}")
            elif self.status == "Failed to Submit":
                data = response["methodResponses"][-1][1].get("notCreated", {}).get(f"submit-{self.name}")
        elif self.status == "Failed to Draft":
            data = (response.get("draft") or {}).get("notCreated", {}).get(f"draft-{self.name}")
        elif self.status == "Failed to Submit":
            data = (response.get("submit") or {}).get("notCreated", {}).get(f"submit-{self.name}")

        if data:
            message = f"{data['type']}: {data['description']}"

            if data.get("properties"):
                message += f" ({', '.join(data['properties'])})"

            return message

    def autoname(self) -> None:
        self.name = str(uuid7())

    def validate(self) -> None:
        if self.is_new():
            self.validate_status()
            self.validate_account()
            self.validate_raw_message()
            self.validate_from_email()
            self.validate_from_name()
            self.validate_send_at_window()
            self.validate_destroy_after_submit()
            self.validate_delivery_mode()
            self.validate_reply_to()
            self.validate_headers()
            self.validate_recipients()
            self.validate_attachments()
            self.validate_message_id()
            self.validate_from_ip()
            self.validate_sent_at()
            self.validate_priority()
            self.validate_in_reply_to()
            self.validate_in_reply_to_id()
            self.validate_forwarded_in_reply_to()

    def after_insert(self) -> None:
        if self.delivery_mode == "Immediate":
            self._process()
        elif self.delivery_mode == "Enqueue":
            frappe.enqueue_doc(self.doctype, self.name, "_process", queue="short", enqueue_after_commit=True)

    def validate_status(self) -> None:
        """Validates the status."""

        if self.delivery_mode == "Immediate":
            self.status = None
            self.queued_at = None
        elif self.delivery_mode == "Enqueue":
            self.status = "Queued"
            self.queued_at = now()
        elif self.delivery_mode == "Batch":
            self.status = "Pending"
            self.queued_at = None

    def validate_account(self) -> None:
        """Validates the JMAP account."""

        if not is_jmap_configured(self.user):
            frappe.throw(
                _("User {0} does not have JMAP settings configured.").format(frappe.bold(self.user)),
                frappe.PermissionError,
            )

        is_jmap_account_belongs_to_user(self.account, self.user, raise_exception=True)

    def validate_raw_message(self) -> None:
        """Validates the raw message."""

        if not self.raw_message:
            return

        self.from_name = None
        self.from_email = None
        self.subject = None
        self.reply_to = None
        self.headers = None
        self.html_body = None
        self.text_body = None
        self.attachments = None
        self.message_id = None
        self.sent_at = None
        self.in_reply_to = None

        message = message_from_string(self.raw_message)
        if from_header := message.get("From"):
            self.from_name, self.from_email = parseaddr(from_header)

        if message_id := message.get("Message-ID"):
            self.message_id = message_id.strip("<>")

        if not json_loads(self.recipients):
            recipients = []
            for rcpt_type in ["To", "Cc", "Bcc"]:
                if _rcpt := message.get(rcpt_type):
                    for rcpt in _rcpt.split(","):
                        recipients.append(
                            {
                                "type": rcpt_type,
                                "display_name": parseaddr(rcpt)[0],
                                "email": parseaddr(rcpt)[1],
                            }
                        )

            self.recipients = json.dumps(recipients)

        if date_header := message.get("Date"):
            self.sent_at = get_datetime_str(parsedate_to_datetime(date_header))
        if in_reply_to := message.get("In-Reply-To"):
            self.in_reply_to = in_reply_to.strip("<>")

    def validate_from_email(self) -> None:
        """Validates the from email."""

        if self.from_email:
            if not self.identity:
                frappe.throw(
                    _(
                        "The From Email {0} is not a valid identity. Please add it as an identity or use a different email address."
                    ).format(self.from_email)
                )
        else:
            frappe.throw(_("From Email is required."))

    def validate_from_name(self) -> None:
        """Validates the from name."""

        self.from_name = self.from_name or self.identity["_name"]

    def validate_send_at_window(self) -> None:
        """Validates the scheduled delivery time (FUTURERELEASE)."""

        if not self.send_at:
            return

        if self.save_as_draft:
            frappe.throw(_("Cannot schedule an email that is being saved as a draft."))

        if self.destroy_after_submit:
            frappe.throw(_("Cannot schedule an email that is set to be destroyed after submission."))

        self.send_at = get_datetime_str(get_datetime(self.send_at))
        if get_datetime(self.send_at) <= now_datetime():
            frappe.throw(_("Send At must be in the future."))

        max_delay = 2_592_000
        try:
            max_delay = get_max_delayed_send(get_account_client(self.account), self.account)
        except Exception:
            pass  # best-effort; the server enforces its own limit at submission

        if time_diff_in_seconds(self.send_at, now()) > max_delay:
            frappe.throw(_("Send At cannot be more than {0} days in the future.").format(max_delay // 86400))

    def validate_destroy_after_submit(self) -> None:
        """Validates the destroy after submit setting."""

        if self.save_as_draft or self.destroy_after_submit:
            return

        if self.send_at:
            # A scheduled email must outlive submission: cancel reverts it to Drafts and
            # reschedule/send-now reference it by id, so never auto-destroy it.
            return

        if self.newsletter:
            if frappe.db.get_value("JMAP Account", self.account, "destroy_newsletter_after_submit"):
                self.destroy_after_submit = 1
        elif frappe.db.get_value("JMAP Account", self.account, "destroy_email_after_submit"):
            self.destroy_after_submit = 1

    def validate_delivery_mode(self) -> None:
        """Validates the delivery mode."""

        if self.delivery_mode:
            if self.delivery_mode not in ["Immediate", "Enqueue", "Batch"]:
                frappe.throw(_("Invalid delivery mode: {0}").format(self.delivery_mode))
        else:
            self.delivery_mode = "Immediate"

    def validate_reply_to(self) -> None:
        """Validates the reply to."""

        if self.raw_message:
            return

        if not json_loads(self.reply_to):
            if reply_to := self.identity["reply_to"]:
                self.reply_to = json.dumps(reply_to)

    def validate_headers(self) -> None:
        """Validates the headers."""

        standard_headers = {
            "from",
            "to",
            "cc",
            "bcc",
            "subject",
            "date",
            "message-id",
            "in-reply-to",
            "references",
            "reply-to",
            "user-agent",
            "sender",
            "return-path",
            "mime-version",
            "content-type",
            "content-transfer-encoding",
            "content-language",
            "x-mailer",
            "x-priority",
            "x-mail-queue",
        }

        headers = {}
        for key, value in json_loads(self.headers, default={}).items():
            if key.lower() in standard_headers:
                frappe.throw(
                    _(
                        "The header <b>{0}</b> is a standard email header and cannot be overridden. Please use custom headers prefixed with <code>X-</code>."
                    ).format(key)
                )

            headers[key] = value

        self.headers = json.dumps(headers)

    def validate_recipients(self) -> None:
        """Validates the recipients."""

        recipients = []
        for rcpt in json_loads(self.recipients, default=[]):
            if not rcpt["type"] or not rcpt["email"]:
                continue

            validate_email_address(rcpt["email"], throw=True)

            recipients.append(
                {
                    "type": rcpt["type"],
                    "display_name": rcpt.get("display_name"),
                    "email": rcpt["email"],
                }
            )

        if not recipients and not self.save_as_draft:
            frappe.throw(_("Please add at least one recipient."))

        self.recipients = json.dumps(recipients)

    def validate_attachments(self) -> None:
        """Validates the attachments."""

        user = self.user if is_administrator(frappe.session.user) else frappe.session.user

        normalized = []
        seen_blob_ids = set()

        for a in json_loads(self.attachments, default=[]):
            disposition = a["disposition"]
            cid = a.get("cid", random_string(length=10))

            if blob_id := a.get("blob_id"):
                if blob_id in seen_blob_ids:
                    continue

                if not a.get("type"):
                    frappe.throw(_("type is required for blob attachments."))

                normalized.append(
                    {
                        "blob_id": blob_id,
                        "type": a["type"],
                        "size": a["size"],
                        "filename": a["filename"],
                        "disposition": disposition,
                        "cid": cid,
                    }
                )
                seen_blob_ids.add(blob_id)

            elif file_url := a.get("file_url"):
                if file_url.startswith("/private/files"):
                    MailQueue._get_file(file_url=file_url, user=user, check_permission=True)
                elif not file_url.startswith("/files"):
                    frappe.throw(
                        _(
                            "Invalid file URL: {0}. File URLs must start with '/files/' or '/private/files/'."
                        ).format(file_url)
                    )

                normalized.append(
                    {
                        "file_url": file_url,
                        "filename": a.get("filename") or Path(file_url).name,
                        "disposition": disposition,
                        "cid": cid,
                    }
                )

            else:
                frappe.throw(_("Either blob_id or file_url is required for attachments."))

        self.attachments = json.dumps(normalized)

    def validate_message_id(self) -> None:
        """Validates the message ID."""

        if not self.message_id:
            self.message_id = make_msgid(domain=self.from_email.split("@")[-1]).strip("<>")

    def validate_from_ip(self) -> None:
        """Validates the from IP address."""

        self.from_ip = frappe.local.request_ip

    def validate_sent_at(self) -> None:
        """Validates the sent at date."""

        self.sent_at = self.sent_at or now()

    def validate_priority(self) -> None:
        """Validates the priority."""

        if self.priority:
            return

        if self.newsletter:
            self.priority = "Low"
        elif self.received_after <= 5:
            self.priority = "High"
        else:
            self.priority = "Normal"

    def validate_in_reply_to(self) -> None:
        """Validates the In Reply To (Message ID)."""

        if self.in_reply_to:
            self.in_reply_to = self.in_reply_to.strip("<>")

    def validate_in_reply_to_id(self) -> None:
        """Validates the In Reply To ID."""

        if self.in_reply_to and not self.in_reply_to_id:
            try:
                client = get_account_client(self.account)
                with client.batch() as b:
                    h = b.mail.email.query(
                        filter={"header": ["Message-ID", self.in_reply_to]},
                        sort=[{"property": "receivedAt", "isAscending": False}],
                        limit=50,
                        calculate_total=True,
                    )
                if ids := h.result.ids:
                    self.in_reply_to_id = ids[0]
            except Exception:
                self.in_reply_to_id = None
                log_mail_error(_("Failed to fetch In Reply To ID"), frappe.get_traceback(with_context=True))

    def validate_forwarded_in_reply_to(self) -> None:
        """Threads a forwarded email with the original.

        When the account has "Keep Forwarded Email In Thread" enabled, sets the
        In-Reply-To (Message-ID) of the forwarded email to the original's Message-ID
        so the mail server assigns it the same thread as the original. The
        In-Reply-To ID is intentionally left untouched: a forward should mark the
        original as ``$forwarded`` (via ``forwarded_from_id``), not ``$answered``.
        """

        if not self.forwarded_from_id or self.in_reply_to:
            return

        if not frappe.db.get_value("JMAP Account", self.account, "keep_forwarded_email_in_thread"):
            return

        try:
            client = get_account_client(self.account)
            with client.batch() as b:
                h = b.mail.email.get(ids=[self.forwarded_from_id], properties=["messageId"])
            emails = [e.to_wire() for e in h.result.items]
            # JMAP returns messageId as a list of Message-ID strings (RFC 5322 msg-id values).
            if emails and (message_ids := emails[0].get("messageId")):
                self.in_reply_to = message_ids[0].strip("<>")
        except Exception:
            log_mail_error(
                _("Failed to fetch forwarded email Message-ID"), frappe.get_traceback(with_context=True)
            )

    @frappe.whitelist()
    def retry(self) -> None:
        """Retries Create, Update or Submit the Email."""

        frappe.only_for("System Manager")

        if self.status not in ["Failed", "Failed to Draft", "Failed to Submit"]:
            frappe.throw(_("Cannot retry a mail with status {0}").format(self.status))

        self._process()

    @frappe.whitelist()
    def reschedule(self, send_at: str) -> None:
        """Moves the scheduled delivery time by canceling the held submission and creating a
        new one — undoStatus is the only mutable property of a submission (RFC 8621 §7.5)."""

        self.check_permission("write")
        self._lock_and_validate_scheduled()

        self.send_at = send_at
        self.validate_send_at_window()

        self._cancel_submission()
        self._resubmit(hold_until=self._hold_until)

    @frappe.whitelist()
    def send_now(self) -> None:
        """Delivers a scheduled email immediately by canceling the held submission and creating an unheld one."""

        self.check_permission("write")
        self._lock_and_validate_scheduled()

        self._cancel_submission()
        self._resubmit(hold_until=None)

    @frappe.whitelist()
    def cancel_schedule(self) -> None:
        """Cancels scheduled delivery and moves the message back to Drafts for editing."""

        self.check_permission("write")
        self._lock_and_validate_scheduled()
        self._cancel_submission()

        client = get_account_client(self.account)
        drafts_mailbox_id = get_mailbox_id_by_role(
            self.account, "drafts", create_if_not_exists=True, raise_exception=True
        )

        # Replace (not patch) mailboxIds so the message leaves Sent; restore $draft.
        with client.batch() as b:
            h = b.mail.email.set(
                update={self.id: {"mailboxIds": {drafts_mailbox_id: True}, "keywords/$draft": True}}
            )
        result = h.result
        if self.id not in result.updated:
            # The submission is already canceled; retrying this action skips the cancel
            # step (undoStatus is "canceled") and reattempts the move.
            frappe.throw(get_set_error_message(result, "update", self.id))

        # Evict the cached copy — it still carries the Sent mailbox and would show a
        # stale folder label in Drafts until the next sync.
        from suite.mail.doctype.mail_message.mail_message import _remove_cached_messages

        _remove_cached_messages(self.account, [self.id])

        previous_mailbox_id = self.mailbox_id
        self._db_set(notify=True, status="Cancelled", cancelled_at=now(), mailbox_id=drafts_mailbox_id)

        # Refresh the open mailbox view the way the message actions do. It can't be driven
        # from the composer that raised the undo toast: the dialog drops its content when it
        # closes, so that component is already gone by the time the undo runs.
        if mailbox_ids := [m for m in {drafts_mailbox_id, previous_mailbox_id} if m]:
            frappe.publish_realtime("new_mail_created", mailbox_ids, user=self.user)

    def _lock_and_validate_scheduled(self) -> None:
        """Serializes the scheduled-send actions on this row and validates it is still held.

        Each action cancels the current submission and may create a replacement, so two of
        them reading the same state both pass validation and race: the loser either fails
        on an already-canceled submission or — the damaging case — resubmits a message the
        winner just cancelled and moved back to Drafts, delivering mail the user undid.

        The lock is held until the request's transaction ends, so a second action blocks
        and then re-reads what the first committed. The state is re-read from the locked
        row rather than trusted from the in-memory doc, which may predate that write.
        """

        current = frappe.db.get_value(
            "Mail Queue",
            self.name,
            ["status", "submission_id", "send_at"],
            for_update=True,
            as_dict=True,
        )
        if not current:
            frappe.throw(_("Mail Queue {0} no longer exists.").format(self.name))

        self.status = current.status
        self.submission_id = current.submission_id
        self.send_at = current.send_at

        if self.status != "Scheduled":
            frappe.throw(_("Only scheduled emails can be modified. Current status: {0}").format(self.status))

    def _cancel_submission(self) -> None:
        """Cancels the held submission; reconciles the row and throws if it already went final."""

        if not self.submission_id:
            return  # an earlier resubmit failed after canceling; nothing left to cancel

        client = get_account_client(self.account)
        with client.batch() as b:
            h = b.submission.email_submission.get(ids=[self.submission_id], properties=SUBMISSION_PROPERTIES)
        submissions = [s.to_wire() for s in h.result.items]
        undo_status = submissions[0].get("undoStatus") if submissions else "final"

        if undo_status == "pending":
            with client.batch() as b:
                h = b.submission.email_submission.set(update={self.submission_id: {"undoStatus": "canceled"}})
            result = h.result
            if self.submission_id not in result.updated:
                raise ValueError(get_set_error_message(result, "update", self.submission_id))
        elif undo_status != "canceled":
            self._db_set(notify=True, status="Submitted", submitted_at=now())
            frappe.throw(_("This email has already been delivered and can no longer be changed."))

    def _resubmit(self, hold_until: int | None) -> None:
        """Creates a replacement submission for the (already canceled) previous one.

        The created object's echoed undoStatus is unreliable (Stalwart echoes "final" for
        held submissions) — only its id is trusted here.
        """

        submit_ref = f"submit-{self.name}"

        try:
            identity_id = get_identity_id_by_email(self.account, self.from_email, raise_exception=True)
            client = get_account_client(self.account)
            with client.batch() as b:
                h = b.submission.email_submission.set(
                    create={
                        submit_ref: {
                            "identityId": identity_id,
                            "emailId": self.id,
                            "envelope": build_submission_envelope(
                                self.from_email,
                                [r["email"].lower() for r in json_loads(self.recipients, default=[])],
                                self.name,
                                self._priority,
                                hold_until,
                            ),
                        }
                    }
                )
            result = h.result
            created = result.created.get(submit_ref)
            if not created:
                raise ValueError(get_set_error_message(result, "create", submit_ref))
            created = created.to_wire()
        except Exception:
            # The old submission is already canceled: fail closed. The row stays Scheduled
            # without a submission id, so a retried action skips the cancel step.
            self._db_set(notify=True, submission_id=None, error_log=frappe.get_traceback(with_context=True))
            raise

        if hold_until:
            self._db_set(
                notify=True,
                status="Scheduled",
                submission_id=created["id"],
                send_at=get_datetime_str(get_datetime(self.send_at)),
            )
        else:
            self._db_set(
                notify=True,
                status="Submitted",
                submission_id=created["id"],
                submitted_at=now(),
                send_at=None,
            )

    @frappe.whitelist()
    def get_mime_message(self) -> str:
        """Returns the MIME message content."""

        if not self.blob_id:
            frappe.throw(_("Email does not have a blob ID."))

        from suite.mail.doctype.mail_message.mail_message import fetch_blob

        return fetch_blob(self.account, self.blob_id).decode("utf-8")

    def _process(self) -> None:
        """Create, Update or Submit the Email."""

        kwargs = {}
        draft_ref = f"draft-{self.name}"
        submit_ref = f"submit-{self.name}"

        try:
            client = get_account_client(self.account)

            draft_mailbox_id = get_mailbox_id_by_role(
                self.account, "drafts", create_if_not_exists=True, raise_exception=True
            )
            sent_mailbox_id = get_mailbox_id_by_role(
                self.account, "sent", create_if_not_exists=True, raise_exception=True
            )

            headers: list[dict] = []
            reply_to: list[dict] = []
            attachments: list[dict] = []
            raw_blob_id = None

            if self.raw_message:
                blob = client.upload(self.raw_message.encode("utf-8"), content_type="message/rfc822")
                raw_blob_id = str(blob.blob_id)
            else:
                headers = [
                    {"name": key, "value": value}
                    for key, value in json_loads(self.headers, default={}).items()
                ]
                reply_to = [
                    {"name": r["display_name"], "email": r["email"].lower()}
                    for r in json_loads(self.reply_to, default=[])
                ]

                _attachments = []
                for a in json_loads(self.attachments, default=[]):
                    blob_id = a.get("blob_id")
                    if not blob_id:
                        file = MailQueue._get_file(file_url=a["file_url"], check_permission=False)
                        content = file.get_content()
                        if isinstance(content, str):
                            content = content.encode("utf-8")
                        content_type = guess_type(file.file_name)[0]
                        blob = client.upload(content, content_type=content_type)
                        a.update({"type": blob.type, "size": blob.size, "blob_id": str(blob.blob_id)})
                    _attachments.append(a)

                kwargs["attachments"] = json.dumps(_attachments)
                attachments = [
                    {
                        "name": a["filename"],
                        "type": a["type"],
                        "cid": a["cid"],
                        "blob_id": a["blob_id"],
                        "disposition": a["disposition"],
                    }
                    for a in _attachments
                ]

            recipients = [
                {"type": r["type"].lower(), "name": r["display_name"], "email": r["email"].lower()}
                for r in json_loads(self.recipients)
            ]

            with client.batch() as b:
                if self.raw_message:
                    draft_h = b.add(
                        "Email/import",
                        {
                            "emails": {
                                draft_ref: {
                                    "blobId": raw_blob_id,
                                    "mailboxIds": {draft_mailbox_id: True},
                                    "keywords": {"$draft": True, "$seen": True},
                                }
                            }
                        },
                    )
                    if self.id:
                        b.mail.email.set(destroy=[self.id])
                else:
                    draft = build_email_draft(
                        from_email=self.from_email,
                        recipients=recipients,
                        draft_mailbox_id=draft_mailbox_id,
                        queue_name=self.name,
                        from_name=self.from_name,
                        subject=self.subject,
                        sent_at=self.sent_at,
                        message_id=self.message_id,
                        reply_to=reply_to,
                        in_reply_to=self.in_reply_to,
                        headers=headers,
                        text_body=self.text_body,
                        html_body=self.html_body,
                        attachments=attachments,
                    )
                    if self.id:
                        draft_h = b.mail.email.set(create={draft_ref: draft}, destroy=[self.id])
                    else:
                        draft_h = b.mail.email.set(create={draft_ref: draft})

                submit_h = None
                if not self.save_as_draft:
                    identity_id = get_identity_id_by_email(
                        self.account, self.from_email, raise_exception=True
                    )

                    on_success = {}
                    if self.destroy_after_submit:
                        # No Mailbox updates, just destroy the draft email after submission.
                        on_success["onSuccessDestroyEmail"] = [f"#{submit_ref}"]
                    else:
                        # Move the draft to the Sent mailbox and update keywords after submission.
                        on_success["onSuccessUpdateEmail"] = {
                            f"#{submit_ref}": {
                                f"mailboxIds/{draft_mailbox_id}": None,
                                f"mailboxIds/{sent_mailbox_id}": True,
                                "keywords/$draft": None,
                                "keywords/$seen": True,
                            }
                        }

                    for target_id, keyword in [
                        (self.forwarded_from_id, "$forwarded"),
                        (self.in_reply_to_id, "$answered"),
                    ]:
                        if target_id:
                            on_success.setdefault("onSuccessUpdateEmail", {}).setdefault(target_id, {})[
                                f"keywords/{keyword}"
                            ] = True

                    submit_h = b.submission.email_submission.set(
                        create={
                            submit_ref: {
                                "identityId": identity_id,
                                "emailId": CreationRef(draft_ref),
                                "envelope": build_submission_envelope(
                                    from_email=self.from_email,
                                    rcpt_emails={r["email"] for r in recipients},
                                    envelope_id=self.name,
                                    priority=self._priority,
                                    hold_until=self._hold_until,
                                ),
                            }
                        },
                        **on_success,
                    )

            response_payload: dict[str, Any] = {}

            draft_created = draft_error = None
            try:
                draft_result = draft_h.result
            except MethodError as e:
                response_payload["draft"] = {"error": {"type": e.type, **e.arguments}}
            else:
                if isinstance(draft_result, dict):
                    # Email/import is a custom method; its result stays a raw wire dict.
                    created_map = draft_result.get("created") or {}
                    not_created = draft_result.get("notCreated") or {}
                else:
                    created_map = {k: v.to_wire() for k, v in draft_result.created.items()}
                    not_created = draft_result.not_created

                response_payload["draft"] = {"created": created_map, "notCreated": not_created}
                draft_created = created_map.get(draft_ref)
                draft_error = not_created.get(draft_ref)

            submit_created = submit_error = None
            if submit_h is not None:
                try:
                    submit_result = submit_h.result
                except MethodError as e:
                    response_payload["submit"] = {"error": {"type": e.type, **e.arguments}}
                else:
                    created_map = {k: v.to_wire() for k, v in submit_result.created.items()}
                    response_payload["submit"] = {
                        "created": created_map,
                        "notCreated": submit_result.not_created,
                    }
                    submit_created = created_map.get(submit_ref)
                    submit_error = submit_result.not_created.get(submit_ref)

            kwargs.update({"status": "Failed", "_response": json.dumps(response_payload)})
            if draft_created:
                kwargs.update(
                    {
                        "status": "Drafted",
                        "id": draft_created["id"],
                        "blob_id": draft_created["blobId"],
                        "size": draft_created["size"],
                        "drafted_at": now(),
                        "thread_id": draft_created["threadId"],
                        "mailbox_id": draft_mailbox_id,
                    }
                )
            elif draft_error:
                retries = cint(self.retries) + 1
                kwargs.update(
                    {
                        "status": "Failed to Draft",
                        "retries": retries,
                        "next_retry_after": get_next_retry_after(retries),
                    }
                )

            if submit_h is not None:
                if submit_created:
                    kwargs.update(
                        {
                            "submission_id": submit_created["id"],
                            "mailbox_id": sent_mailbox_id,
                        }
                    )
                    if self.send_at:
                        # The server holds delivery (FUTURERELEASE); submitted_at is set once
                        # the submission goes final (reconciliation or send-now).
                        kwargs["status"] = "Scheduled"
                    else:
                        kwargs.update({"status": "Submitted", "submitted_at": now()})
                elif submit_error:
                    retries = cint(self.retries) + 1
                    kwargs.update(
                        {
                            "status": "Failed to Submit",
                            "retries": retries,
                            "next_retry_after": get_next_retry_after(retries),
                        }
                    )
        except Exception:
            retries = cint(self.retries) + 1
            kwargs.update(
                {
                    "status": "Failed",
                    "retries": retries,
                    "next_retry_after": get_next_retry_after(retries),
                    "error_log": frappe.get_traceback(with_context=True),
                }
            )

        if frappe.flags.read_only:
            for key, value in kwargs.items():
                setattr(self, key, value)
        else:
            self._db_set(notify=True, **kwargs)

    def _get_recipients(self, type: Literal["To", "Cc", "Bcc"] | None = None) -> list[dict[str, str | None]]:
        """Returns the recipients."""

        recipients = []
        for rcpt in json_loads(self.recipients, default=[]):
            if type and rcpt["type"] != type:
                continue

            recipients.append({"name": rcpt["display_name"], "email": rcpt["email"]})

        return recipients

    def _db_set(
        self,
        update_modified: bool = True,
        commit: bool = False,
        notify: bool = False,
        **kwargs,
    ) -> None:
        """Updates the document with the given key-value pairs."""

        self.db_set(kwargs, update_modified=update_modified, notify=notify, commit=commit)


@frappe.whitelist()
def bulk_retry(names: str | list[str]) -> None:
    """Retries the emails with the given names."""

    frappe.only_for("System Manager")

    if isinstance(names, str):
        names = json.loads(names)

    for name in names:
        doc = frappe.get_doc("Mail Queue", name)
        if doc.status in ["Failed", "Failed to Draft", "Failed to Submit"]:
            doc.retry()

    frappe.msgprint(
        _("Successfully retried {0} emails.").format(frappe.bold(len(names))),
        indicator="green",
        alert=True,
    )


def json_loads(data: str | None, default: Any = None) -> list | dict | None:
    """Loads the given JSON data and returns it as a list or dict."""

    if data:
        return json.loads(data)

    return default


def get_next_retry_after(retries: int) -> str:
    """Returns the next retry after datetime."""

    next_retry_after_minutes = retries * (retries + 1)  # 2, 6, 12, 20, 30 ...
    return add_to_date(now(), minutes=next_retry_after_minutes)


def process_pending_emails(mails: list[str]) -> None:
    """Process pending emails."""

    failed_mails = []
    total_count = len(mails)

    for mail in mails:
        doc: MailQueue = frappe.get_doc("Mail Queue", mail)
        doc._process()

        if doc.status in ["Failed", "Failed to Draft", "Failed to Submit"]:
            failed_mails.append(mail)

            retries = len(failed_mails)
            failure_ratio = retries / total_count

            if failure_ratio > 0.33 and retries > 50:
                frappe.throw(
                    _(
                        "Email processing aborted: {retries} out of {total_count} emails failed "
                        "({failure_rate:.2%} failure rate). Please investigate the issue before retrying."
                    ).format(retries=retries, total_count=total_count, failure_rate=failure_ratio)
                )


def apply_reconciled_submissions(submitted: list[str], cancelled: list[str]) -> None:
    """Moves Scheduled rows to the terminal state their submission reports.

    Batched on purpose: the Scheduled page reconciles on its read path, so a per-row write
    would make page latency grow with the number of finalized rows — and with undo send,
    every UI send leaves one behind between hourly sweeps.

    Still-Scheduled guard: an action may have moved a row to a terminal state since the
    submission states were read, and must not be clobbered back.
    """

    MQ = frappe.qb.DocType("Mail Queue")
    timestamp = now()

    for names, status, field in (
        (submitted, "Submitted", MQ.submitted_at),
        (cancelled, "Cancelled", MQ.cancelled_at),
    ):
        # Chunked so a backlog (e.g. the first sweep after downtime) can't build an
        # oversized IN list.
        for batch in create_batch(names, 500):
            (
                frappe.qb.update(MQ)
                .set(MQ.status, status)
                .set(field, timestamp)
                .where(MQ.name.isin(batch) & (MQ.status == "Scheduled"))
            ).run()


def reconcile_scheduled_emails() -> None:
    """Flips Scheduled rows whose hold has elapsed to their real submission state.

    The Scheduled page reconciles lazily and clear_old_logs purges eventually, but with
    undo send every UI send passes through Scheduled — without this sweep the queue log
    would show delivered mail as Scheduled (and never record submitted_at) until purged.

    Hourly is deliberate: nothing user-facing waits on it (the page reconciles on load),
    and a row survives days before purge, so it gets many attempts.
    """

    rows = frappe.db.get_all(
        "Mail Queue",
        filters={
            "status": "Scheduled",
            "submission_id": ("is", "set"),
            # Small buffer past the hold so in-flight releases aren't queried mid-flip.
            "send_at": ("<", add_to_date(now(), minutes=-1)),
        },
        fields=["name", "account", "submission_id"],
    )
    if not rows:
        return

    by_account: dict[str, list] = {}
    for row in rows:
        by_account.setdefault(row.account, []).append(row)

    for account, account_rows in by_account.items():
        try:
            client = get_account_client(account, ignore_permissions=True)
            with client.batch() as b:
                h = b.submission.email_submission.get(
                    ids=[r.submission_id for r in account_rows], properties=SUBMISSION_PROPERTIES
                )
            submissions = [s.to_wire() for s in h.result.items]
            undo_by_id = {s["id"]: s.get("undoStatus") for s in submissions}
        except Exception:
            log_mail_error(_("Failed - Reconcile Scheduled Emails"), frappe.get_traceback(with_context=True))
            continue

        # Unknown ids (submission object gone) are left alone — same conservative call as
        # the Scheduled page; clear_old_logs picks them up eventually.
        submitted = [r.name for r in account_rows if undo_by_id.get(r.submission_id) == "final"]
        cancelled = [r.name for r in account_rows if undo_by_id.get(r.submission_id) == "canceled"]

        apply_reconciled_submissions(submitted, cancelled)


def enqueue_process_pending_emails(batch_size: int | None = None, max_batch_size: int | None = None) -> None:
    """Enqueue process pending emails."""

    batch_size = batch_size or cint(get_config("process_pending_emails_batch_size"))
    max_batch_size = max_batch_size or cint(get_config("process_pending_emails_max_batch_size"))

    if batch_size > max_batch_size:
        batch_size = max_batch_size

    MQ = frappe.qb.DocType("Mail Queue")

    priority_order = Case()
    priority_order.when(MQ.priority == "High", 1)
    priority_order.when(MQ.priority == "Normal", 2)
    priority_order.when(MQ.priority == "Low", 3)
    priority_order.else_(4)

    mails = (
        frappe.qb.from_(MQ)
        .select(MQ.name)
        .where(
            (MQ.status == "Pending")
            | (
                (MQ.retries > 0)
                & (MQ.retries < MQ.max_retries)
                & (MQ.next_retry_after <= now_datetime())
                & (MQ.status.isin(["Failed", "Failed to Draft", "Failed to Submit"]))
            )
            | ((MQ.status == "Queued") & (MQ.queued_at <= get_datetime(add_to_date(now(), minutes=-30))))
        )
        .orderby(priority_order, MQ.creation, MQ.retries, order=Order.asc)
        .limit(max_batch_size)
    ).run(pluck="name")

    if not mails:
        return

    try:
        (
            frappe.qb.update(MQ)
            .set(MQ.status, "Queued")
            .set(MQ.queued_at, now())
            .where((MQ.name.isin(mails)) & (MQ.status.notin(["Drafted", "Submitted"])))
        ).run()

        for i, batch in enumerate(create_batch(mails, batch_size), start=1):
            frappe.enqueue(
                process_pending_emails,
                queue="long",
                timeout=cint(get_config("process_pending_emails_timeout")),
                job_name=f"process_pending_emails_{i}_{len(batch)}",
                enqueue_after_commit=False,
                mails=batch,
            )

        # Recursively process next batch if the limit was reached.
        if len(mails) == max_batch_size:
            enqueue_process_pending_emails(batch_size, max_batch_size)

    except Exception:
        log_mail_error(_("Failed - Enqueue Process Pending Emails"), frappe.get_traceback(with_context=True))
