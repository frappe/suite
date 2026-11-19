# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A chunked `send_raw` upload is refused from its first chunk when the user cannot send, and
what is left of an upload that never finished is swept away."""

import io
import os
import time
from contextlib import contextmanager

import frappe
from frappe.tests import IntegrationTestCase
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.mail.api.outbound import ABANDONED_UPLOAD_AGE, clean_abandoned_chunked_uploads, send_raw
from suite.mail.utils import get_messages_directory
from suite.tests.utils import ABSENT, restore_local

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

NO_MAIL_USER = "test1@example.com"


@contextmanager
def chunk_request(content: bytes, **form: str):
    """One chunk of a chunked upload, as a mail client posts it."""

    kept = {name: getattr(frappe.local, name, ABSENT) for name in ("request", "form_dict", "request_ip")}
    builder = EnvironBuilder(method="POST", data={"raw_message": (io.BytesIO(content), "chunk.eml"), **form})
    frappe.local.request = Request(builder.get_environ())
    frappe.local.form_dict = frappe._dict(form)
    frappe.local.request_ip = "127.0.0.1"  # send_raw is rate limited by IP
    try:
        yield
    finally:
        for name, value in kept.items():
            restore_local(name, value)


class TestSendRawChunks(IntegrationTestCase):
    def setUp(self):
        self.directory = get_messages_directory()

    def _files(self) -> set[str]:
        return set(os.listdir(self.directory))

    def test_someone_without_a_mail_account_writes_nothing_to_disk(self):
        self.assertFalse(frappe.db.exists("User Account", {"user": NO_MAIL_USER}))
        before = self._files()

        frappe.set_user(NO_MAIL_USER)
        self.addCleanup(frappe.set_user, "Administrator")
        with (
            chunk_request(b"From: a@example.test\r\n", chunk_index="0", total_chunk_count="2", uuid="u1"),
            self.assertRaises(frappe.ValidationError),
        ):
            send_raw(from_="a@example.test", to="b@example.test")

        self.assertEqual(self._files(), before)

    def test_an_upload_left_unfinished_is_swept_and_one_in_progress_is_kept(self):
        abandoned = os.path.join(self.directory, "test-abandoned.eml")
        in_progress = os.path.join(self.directory, "test-in-progress.eml")
        for path in (abandoned, in_progress):
            with open(path, "wb") as f:
                f.write(b"From: a@example.test\r\n")
            self.addCleanup(lambda p=path: os.path.exists(p) and os.remove(p))
        old = time.time() - ABANDONED_UPLOAD_AGE - 60
        os.utime(abandoned, (old, old))

        clean_abandoned_chunked_uploads()

        self.assertFalse(os.path.exists(abandoned))
        self.assertTrue(os.path.exists(in_progress))
