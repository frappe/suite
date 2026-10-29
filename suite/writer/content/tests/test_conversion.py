import base64
import contextlib
import dataclasses
import functools
import io
import json
import os
import threading
import time
from datetime import datetime, timedelta
from html import escape
from unittest.mock import MagicMock, call, patch
from urllib.parse import quote
from zoneinfo import ZoneInfo

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe.tests.test_api import make_request
from frappe.utils import CallbackManager, get_datetime, get_system_timezone, get_test_client
from frappe.utils.background_jobs import create_job_id, get_redis_conn
from frappe.utils.logging import connection_for
from rq.job import Job, JobStatus
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.composition import lifecycle
from suite.composition.contract import _contract_path
from suite.content import (
    checker,
    compaction,
    conversions,
    convert,
    copies,
    jobs,
    live,
    log,
    scheduling,
    selftest,
)
from suite.content.editors import HtmlCopy, spec_of
from suite.content.http import routes
from suite.drive._core.access import grant
from suite.drive._core.nodes import _restore, _trash, purge
from suite.drive._core.principals import Principals
from suite.drive._core.roots import lock_trees
from suite.drive._core.versions import read_version, restore_version
from suite.drive.framework import begin_drive_write
from suite.drive.patches.build.content_mapping import derived_name, epoch_millis
from suite.tests.utils import session_for
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.api import docs
from suite.writer.content import conversion
from suite.writer.content.readable_copy import is_html_complete
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase
from suite.writer.content.tests.support import OUTSIDER, READER, WRITER, call_route, read_open
from suite.writer.http import routes as writer_routes

TIME = 1_690_000_000_000
OLD_THREAD = {"uuid": "u1", "comments": [{"userName": "Ann", "time": TIME, "content": "Old note"}]}
REAL_CONVERT = convert.convert
# The conversion's lock on a node, as qb renders it
NODE_LOCK = "SELECT `name` FROM `tabDrive Node` WHERE `name`=%(param1)s FOR UPDATE"
PNG_SOURCE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


def old_comments(*comments: tuple[str, str, list[str]]) -> str:
    doc = pycrdt.Doc()
    listed = doc.get("comments", type=pycrdt.Map)
    for key, words, replies in comments:
        listed[key] = {"id": key, "anchorText": words, "replies": [{"id": reply} for reply in replies]}

    return base64.b64encode(doc.get_update()).decode()


def renamed(node: str, source_id: str) -> str:
    return derived_name("drive-comment-rename/1", node, source_id)


@dataclasses.dataclass(frozen=True)
class LossyHtmlCopy(HtmlCopy):
    writes: list[dict[str, str | None]] = dataclasses.field(default_factory=list)

    def write(self, doctype: str, docname: str, changed: dict[str, str | None]) -> None:
        self.writes.append(changed)
        super().write(doctype, docname, {key: f"{value}<p>lost</p>" for key, value in changed.items()})


class TestConversion(DriveCallbackCase):
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
            frappe._dict(job_name="test_conversion", after_job=CallbackManager()),
            create=True,
        )
        job_patch.start()
        self.addCleanup(job_patch.stop)

    def old_document(self, html: str | None, ycomments: str | None = None) -> str:
        node = self.new_document()
        self.delete_log(node)
        old = {"content": None, "html": html, "collab": 0, "ycomments": ycomments}
        frappe.db.set_value("Writer Document", self.docname_of(node), old, update_modified=False)
        frappe.db.commit()
        return node

    def old_yjs_document(self, *children: pycrdt.XmlElement) -> str:
        node = self.new_document()
        self.delete_log(node)
        doc = pycrdt.Doc()
        body = doc.get("default", type=pycrdt.XmlFragment)
        for child in children:
            body.children.append(child)

        old = {
            "content": base64.b64encode(doc.get_update()).decode(),
            "html": "",
            "collab": 1,
            "ycomments": None,
        }
        frappe.db.set_value("Writer Document", self.docname_of(node), old, update_modified=False)
        frappe.db.commit()
        return node

    def build_thread(self, node: str, name: str, comments: list[str]) -> None:
        thread = frappe.get_doc({"doctype": "Drive Comment Thread", "node": node, "anchor": name})
        thread.name = name
        thread.db_insert()
        for index, name in enumerate(comments, 1):
            row = {"thread": thread.name, "node": node, "content": "Kept", "author": WRITER, "idx": index}
            comment = frappe.get_doc({"doctype": "Drive Comment", **row, "author_name": "Kept"})
            comment.name = name
            comment.db_insert()

        frappe.db.commit()

    def records(self, node: str) -> list[tuple]:
        return frappe.db.sql(
            "SELECT `outcome`, `reason`, `dropped` FROM `__writer_content_conversion` WHERE `node` = %s", node
        )

    def failures(self, node: str) -> list[int]:
        return frappe.db.sql_list(
            "SELECT `failures` FROM `__writer_content_conversion` WHERE `node` = %s", node
        )

    def threads_of(self, node: str) -> list[frappe._dict]:
        return frappe.get_all("Drive Comment Thread", {"node": node}, ["name", "anchor"], order_by="name")

    def as_before(self, node: str) -> dict:
        docname = self.docname_of(node)
        return {
            "row": frappe.db.get_value("Writer Document", docname, conversion.FIELDS, as_dict=True),
            "threads": self.threads_of(node),
            "versions": frappe.db.count("Drive Node Version", {"node": node}),
            "log": log.find(writer_content.APP, node),
            "evidence": frappe.db.count("__writer_content_recovery", {"node": node}),
        }

    def before_collaboration(self, node: str) -> dict:
        filters = {"node": node, "kind": "milestone", "label": "Before collaboration"}
        [seq] = frappe.get_all("Drive Node Version", filters, pluck="seq")
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with read_version(owner, node, seq) as stream:
            return json.loads(stream.read())

    def started_state(self, node: str) -> bytes:
        return read_open(call_route(routes.document_get, node).get_data()).checkpoint

    def text_of_log(self, node: str) -> str:
        doc = pycrdt.Doc()
        doc.apply_update(self.started_state(node))
        return str(doc.get("default", type=pycrdt.XmlFragment))

    def test_converts_an_old_document_and_keeps_its_body_as_a_version(self):
        node = self.old_document("<p>Hello world</p>")

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        old = {"schema": "writer-document/1", "content": "AAA=", "html": "<p>Hello world</p>", "collab": 0}
        self.assertEqual(self.before_collaboration(node), old)
        self.assertEqual(self.text_of_log(node), "<paragraph>Hello world</paragraph>")
        row = frappe.db.get_value(
            "Writer Document", self.docname_of(node), ["html", "ycomments"], as_dict=True
        )
        self.assertIn("Hello world", row.html)
        text = BeautifulSoup(row.html, "html.parser").get_text()
        self.assertTrue(is_html_complete(self.started_state(node), row.html, text))
        self.assertEqual(self.records(node), (("converted", None, "[]"),))
        kept = frappe.db.sql(
            "SELECT `reason`, `payload` FROM `__writer_content_recovery` WHERE `node` = %s", node
        )
        self.assertEqual(
            [(reason, bytes(payload)) for reason, payload in kept], [("copy_first", b"<p>Hello world</p>")]
        )

    def test_converts_an_empty_document_into_an_empty_copy(self):
        node = self.old_document(None)

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        old = {"schema": "writer-document/1", "content": "AAA=", "html": "", "collab": 0}
        self.assertEqual(self.before_collaboration(node), old)
        html = frappe.db.get_value("Writer Document", self.docname_of(node), "html")
        self.assertEqual(BeautifulSoup(html, "html.parser").get_text(), "")

    def test_keeps_an_https_embed_and_a_png_data_picture_in_the_copy(self):
        embed = "https://www.youtube.com/embed/abc"
        node = self.old_yjs_document(
            pycrdt.XmlElement("paragraph", None, [pycrdt.XmlText("Watch this")]),
            pycrdt.XmlElement("iframe", {"src": embed}),
            pycrdt.XmlElement("image", {"src": PNG_SOURCE}),
        )

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        copy = BeautifulSoup(
            frappe.db.get_value("Writer Document", self.docname_of(node), "html"), "html.parser"
        )
        iframe = copy.find("iframe")
        self.assertEqual(
            (iframe["src"], " ".join(iframe["sandbox"])),
            (embed, "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"),
        )
        self.assertEqual(copy.find("img")["src"], PNG_SOURCE)

    def test_refuses_a_body_whose_embed_or_picture_the_copy_cannot_keep(self):
        for name, tag, src in (
            # nh3 strips this scheme before kept_value sees it
            ("javascript iframe", "iframe", "javascript:alert(1)"),
            ("html data iframe", "iframe", "data:text/html,<p>Hi</p>"),
            ("http iframe", "iframe", "http://www.youtube.com/embed/abc"),
            ("relative iframe", "iframe", "/files/talk.mp4"),
            ("svg data picture", "image", "data:image/svg+xml;base64,PHN2Zy8+"),
            ("html data picture", "image", "data:text/html,<p>Hi</p>"),
            ("upper case html data picture", "image", "DATA:text/html,<p>Hi</p>"),
            ("spaced html data picture", "image", " \tdata:text/html,<p>Hi</p>"),
        ):
            with self.subTest(name):
                node = self.old_yjs_document(
                    pycrdt.XmlElement("paragraph", None, [pycrdt.XmlText("Watch this")]),
                    pycrdt.XmlElement(tag, {"src": src}),
                )
                before = self.as_before(node)

                self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

                self.assertEqual(self.as_before(node), before)

    def test_refuses_a_body_whose_embed_is_on_the_site_host(self):
        site = frappe.local.site
        wide = chr(ord(site[0]) + 0xFEE0) + site[1:]
        encoded = "%" + site[0].encode().hex() + site[1:]
        shouted = site.upper()
        domains = ["files.example.net", {"domain": "share.example.io"}]
        past_bad = {"domains": ["x" * 64 + ".example.com", "files.example.net"]}
        ignored = site[:2] + "\U000e0100" + site[2:]
        escaped = site[:2] + "%f3%a0%84%80" + site[2:]
        capital = "%" + site[0].upper().encode().hex() + site[1:]
        long_label = "x" * 64 + ".example.com"
        for name, src, conf in (
            ("site", f"https://{site}/files/x.html", {}),
            ("upper case", f"https://{shouted}/files/x.html", {}),
            ("trailing dot", f"https://{site}./files/x.html", {}),
            ("port", f"https://{site}:8443/files/x.html", {}),
            ("subdomain", f"https://a.{site}/files/x.html", {}),
            ("userinfo", f"https://x@{site}/files/x.html", {}),
            ("backslash", f"https://{site}\\@example.com/", {}),
            ("percent", f"https://{encoded}/files/x.html", {}),
            ("full width", f"https://{wide}/files/x.html", {}),
            ("host name", "https://docs.example.org/x", {"host_name": "https://docs.example.org"}),
            ("domain", "https://files.example.net/x", {"domains": domains}),
            ("domain entry", "https://share.example.io/x", {"domains": domains}),
            ("past a bad domain", "https://files.example.net/x", past_bad),
            ("no host", "https:///files/x.html", {}),
            ("ignored char", f"https://{ignored}/files/x.html", {}),
            ("ideographic dot", f"https://{site}\u3002/files/x.html", {}),
            ("encoded ignored char", f"https://{escaped}/files/x.html", {}),
            ("upper escape", f"https://{capital}/files/x.html", {}),
            ("long label", f"https://{long_label}/x", {}),
        ):
            with self.subTest(name), patch.dict(frappe.local.conf, conf):
                node = self.old_yjs_document(
                    pycrdt.XmlElement("paragraph", None, [pycrdt.XmlText("Watch this")]),
                    pycrdt.XmlElement("iframe", {"src": src}),
                )
                before = self.as_before(node)

                self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

                self.assertEqual(self.as_before(node), before)

    def test_keeps_an_embed_whose_host_only_looks_like_the_site(self):
        site = frappe.local.site
        bad_domain = {"domains": ["x" * 64 + ".example.com", "files.example.net"]}
        for name, src, conf in (
            ("site as a subdomain", f"https://{site}.example.com/embed", {}),
            ("site as a suffix", f"https://not{site}/embed", {}),
            ("site in the query", f"https://example.com/?u=https://{site}/", {}),
            ("site in the fragment", f"https://example.com/#@{site}", {}),
            ("beside a bad domain", "https://www.youtube.com/embed/x", bad_domain),
        ):
            with self.subTest(name), patch.dict(frappe.local.conf, conf):
                node = self.old_yjs_document(
                    pycrdt.XmlElement("paragraph", None, [pycrdt.XmlText("Watch this")]),
                    pycrdt.XmlElement("iframe", {"src": src}),
                )

                self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

                html = frappe.db.get_value("Writer Document", self.docname_of(node), "html")
                self.assertEqual(BeautifulSoup(html, "html.parser").find("iframe")["src"], src)

    def test_anchors_each_old_comment_on_the_drive_thread_build_made_for_it(self):
        for name, thread in (("kept", lambda node, id_: id_), ("renamed", renamed)):
            with self.subTest(name):
                node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", ["r1"])))
                self.build_thread(node, thread(node, "c1"), [thread(node, "c1"), thread(node, "r1")])

                self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

                [stored] = self.threads_of(node)
                self.assertEqual(stored.name, thread(node, "c1"))
                self.assertEqual(json.loads(stored.anchor)["q"], "world")
                self.assertIsNone(frappe.db.get_value("Writer Document", self.docname_of(node), "ycomments"))
                self.assertEqual(self.records(node), (("converted", None, "[]"),))

    def test_writes_the_body_and_clears_the_comments_on_the_same_row_of_a_node_with_two_rows(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", ["r1"])))
        self.build_thread(node, "c1", ["c1", "r1"])
        twin = frappe.copy_doc(frappe.get_doc("Writer Document", self.docname_of(node)))
        twin.name = "zz" + frappe.generate_hash(length=8)
        twin.creation = frappe.utils.add_days(frappe.utils.now_datetime(), 1)
        twin.modified = twin.creation
        twin.db_insert()
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Writer Document", twin.name)

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        rows = frappe.get_all("Writer Document", {"node": node}, ["name", "content", "ycomments"])
        written = {row.name for row in rows if row.content}
        cleared = {row.name for row in rows if row.ycomments is None}
        self.assertEqual(len(written), 1)
        self.assertEqual(written, cleared)

    def test_fingerprints_the_row_the_body_is_written_to_on_a_node_with_two_rows(self):
        node = self.old_document("<p>Hello world</p>")
        twin = frappe.copy_doc(frappe.get_doc("Writer Document", self.docname_of(node)))
        twin.name = "zz" + frappe.generate_hash(length=8)
        twin.html = "<p>Another body</p>"
        twin.creation = frappe.utils.add_days(frappe.utils.now_datetime(), 1)
        twin.modified = twin.creation
        twin.db_insert()
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Writer Document", twin.name)

        written = frappe.db.get_value(
            "Writer Document", self.docname_of(node), list(conversion.FIELDS), as_dict=True
        )
        self.assertEqual(conversion.read_fingerprint(node), conversion.fingerprint_of(written))

    def test_names_a_renamed_thread_as_build_does(self):
        self.assertEqual(conversion.renamed_id("node-b", "top"), renamed("node-b", "top"))

    def test_a_checked_document_repr_hides_its_html(self):
        checked = conversion.CheckedDocument("<p>secret</p>", [], {}, [])

        self.assertNotIn("<p>secret</p>", repr(checked))

    def test_installs_a_2023_thread_once_at_its_own_time_telling_no_one(self):
        data = json.dumps(OLD_THREAD)
        html = f"<p>Hello <span data-comment='{data}'>old</span> world</p>"
        node = self.old_document(html)
        notifications = frappe.db.count("Drive Notification")

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        self.assertEqual(conversions.convert_document(writer_content.APP, node), "logged")

        [thread] = self.threads_of(node)
        self.assertEqual(json.loads(thread.anchor)["q"], "old")
        fields = ["content", "author_name", "creation"]
        [comment] = frappe.get_all("Drive Comment", {"thread": thread.name}, fields)
        stamp = get_datetime(epoch_millis(TIME, get_system_timezone()))
        self.assertEqual((comment.content, comment.author_name, comment.creation), ("Old note", "Ann", stamp))
        self.assertEqual(frappe.db.count("Drive Notification"), notifications)
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node, "kind": "milestone"}), 1)

    def test_installs_an_html_2023_comment_as_text_with_its_mention(self):
        content = (
            f'<p>Hi <span data-type="mention" class="mention" data-id="{WRITER}" data-label="W">@W</span>, '
            'see <a href="https://x.example/doc">the doc</a> &amp; reply</p>'
        )
        old = {"uuid": "u1", "comments": [{"userName": "Ann", "time": TIME, "content": content}]}
        data = escape(json.dumps(old))
        node = self.old_document(f'<p>Hello <span data-comment="{data}">old</span> world</p>')

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        [thread] = self.threads_of(node)
        [comment] = frappe.get_all("Drive Comment", {"thread": thread.name}, ["content", "mentions"])
        self.assertEqual(comment.content, f"Hi @[{WRITER}], see the doc (https://x.example/doc) & reply")
        self.assertEqual(json.loads(comment.mentions), [WRITER])

    def test_a_blank_old_comment_in_any_form_stops_the_conversion(self):
        for content in ("   ", "<p></p>", "<p><br></p>", "<p> </p>"):
            with self.subTest(content=content):
                old = {"uuid": "u1", "comments": [{"userName": "Ann", "time": TIME, "content": content}]}
                data = escape(json.dumps(old))
                node = self.old_document(f'<p>Hello <span data-comment="{data}">old</span> world</p>')
                before = self.as_before(node)

                self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

                self.assertEqual(self.as_before(node), before)
                self.assertEqual(self.threads_of(node), [])
                self.assertEqual(frappe.db.count("Drive Comment", {"node": node}), 0)
                self.assertEqual(self.records(node), (("check", None, None),))

    def test_refuses_an_old_comment_or_reply_no_drive_thread_holds(self):
        for name, held in (("comment", []), ("reply", ["c1"])):
            node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", ["r1"])))
            if held:
                self.build_thread(node, "c1", held)

            before = self.as_before(node)

            self.assertEqual(conversions.convert_document(writer_content.APP, node), "check", msg=name)

            self.assertEqual(self.as_before(node), before, msg=name)
            self.assertEqual(self.records(node), (("check", "orphan", None),), msg=name)

    def test_drops_a_comment_mark_no_old_comment_lists_and_records_it(self):
        node = self.old_document(
            '<p>Hello <span data-comment-id="m1">world</span><span data-comment-id="c2"></span></p>'
        )
        self.build_thread(node, "m1", ["m1"])

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        self.assertEqual(self.threads_of(node), [{"name": "m1", "anchor": "m1"}])
        self.assertEqual(frappe.db.count("Drive Comment", {"node": node}), 1)
        [(_outcome, _reason, dropped)] = self.records(node)
        self.assertEqual(
            json.loads(dropped),
            [
                {"kind": "comment-deleted", "id": "c2"},
                {"kind": "dead-highlight", "key": "m1"},
                {"kind": "unknown-anchor", "thread": "m1"},
            ],
        )

    def test_refuses_an_old_reply_with_no_id(self):
        doc = pycrdt.Doc()
        doc.get("comments", type=pycrdt.Map)["c1"] = {"id": "c1", "anchorText": "world", "replies": [{}]}
        node = self.old_document("<p>Hello world</p>", base64.b64encode(doc.get_update()).decode())
        self.build_thread(node, "c1", ["c1"])
        before = self.as_before(node)

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), (("check", "comments", None),))

    def test_records_a_drive_thread_no_old_comment_names(self):
        node = self.old_document("<p>Hello world</p>")
        self.build_thread(node, "x1", ["x1"])

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        self.assertEqual([thread.anchor for thread in self.threads_of(node)], ["x1"])
        [(_outcome, _reason, dropped)] = self.records(node)
        self.assertEqual(json.loads(dropped), [{"kind": "unknown-anchor", "thread": "x1"}])

    def test_records_a_drive_thread_made_while_the_conversion_writes(self):
        node = self.old_document("<p>Hello world</p>")
        site = frappe.local.site
        errors: list[Exception] = []

        def comment_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                self.build_thread(node, "late", ["late"])
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        commenter = threading.Thread(target=comment_elsewhere)
        converted = False
        real_sql = frappe.db.sql

        def converting(*args, **kwargs):
            nonlocal converted
            converted = True
            return REAL_CONVERT(*args, **kwargs)

        # Comment from another connection just before the write first locks a Drive Node
        def sql(query, *args, **kwargs):
            locks_a_node = "`tabDrive Node`" in str(query) and "FOR UPDATE" in str(query).upper()
            if converted and locks_a_node and commenter.ident is None:
                commenter.start()
                commenter.join(10)

            return real_sql(query, *args, **kwargs)

        with patch.object(convert, "convert", side_effect=converting), patch.object(frappe.db, "sql", sql):
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        self.assertIsNotNone(commenter.ident)
        self.assertFalse(commenter.is_alive())
        self.assertEqual(errors, [])
        [(_outcome, _reason, dropped)] = self.records(node)
        self.assertEqual(json.loads(dropped), [{"kind": "unknown-anchor", "thread": "late"}])

    def test_purges_a_document_converted_after_the_purge_read_and_marks_its_new_log_purged(self):
        node = self.old_document("<p>Hello world</p>")
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        site = frappe.local.site
        errors: list[Exception] = []
        read = threading.Event()
        converted = threading.Event()

        def purge_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                # A plain read at REPEATABLE READ, as a job makes, snapshots before the conversion commits
                frappe.db.get_value("Drive Node", node, "state")
                read.set()
                converted.wait(60)
                _trash(owner, node)
                purge(owner, node)
                frappe.db.commit()
            except Exception as error:
                errors.append(error)
            finally:
                read.set()
                frappe.destroy()

        purger = threading.Thread(target=purge_elsewhere)
        purger.start()
        self.assertTrue(read.wait(30))
        try:
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        finally:
            converted.set()
            purger.join(30)

        self.assertFalse(purger.is_alive())
        self.assertEqual(errors, [])
        self.assertFalse(frappe.db.exists("Writer Document", {"node": node}))
        self.assertEqual(
            frappe.db.sql("SELECT `mode` FROM `__writer_content_doc` WHERE `node` = %s", node), (("purged",),)
        )

    def test_refuses_a_restore_read_before_the_conversion_committed_its_log(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        site = frappe.local.site
        errors: list[Exception] = []
        read = threading.Event()
        converted = threading.Event()

        def restore_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                frappe.db.get_value("Drive Node", node, "state")
                read.set()
                converted.wait(60)
                restore_version(owner, node, seq)
                frappe.db.commit()
            except Exception as error:
                errors.append(error)
            finally:
                read.set()
                frappe.destroy()

        restorer = threading.Thread(target=restore_elsewhere)
        restorer.start()
        self.assertTrue(read.wait(30))
        try:
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
            converted_state = self.as_before(node)
        finally:
            converted.set()
            restorer.join(30)

        self.assertFalse(restorer.is_alive())
        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])
        self.assertEqual(str(errors[0]), "Open the document to restore this version")
        frappe.db.rollback()
        self.assertEqual(self.as_before(node), converted_state)

    def test_refuses_a_desk_save_read_before_the_conversion_committed_its_log(self):
        node = self.old_document("<p>Hello world</p>")

        errors = self.save_while_converting(node, read_committed=False)

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])
        self.assertNotEqual(
            frappe.db.get_value("Writer Document", {"node": node}, "content"), "<p>Edited</p>"
        )

    def test_refuses_a_drive_write_save_read_before_the_conversion_committed_its_log(self):
        node = self.old_document("<p>Hello world</p>")

        errors = self.save_while_converting(node, read_committed=True)

        self.assertEqual([type(error) for error in errors], [drive.DriveConflict])
        self.assertNotEqual(
            frappe.db.get_value("Writer Document", {"node": node}, "content"), "<p>Edited</p>"
        )

    def save_while_converting(self, node: str, read_committed: bool) -> list[Exception]:
        errors: list[Exception] = []
        read = threading.Event()
        converted = threading.Event()
        args = (frappe.local.site, self.docname_of(node), read_committed, errors, read, converted)
        saver = threading.Thread(target=self.save_elsewhere, args=args)
        saver.start()
        self.assertTrue(read.wait(30))
        try:
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        finally:
            converted.set()
            saver.join(30)

        self.assertFalse(saver.is_alive())
        frappe.db.rollback()
        return errors

    def save_elsewhere(
        self,
        site: str,
        docname: str,
        read_committed: bool,
        errors: list,
        read: threading.Event,
        converted: threading.Event,
    ):
        frappe.init(site=site)
        frappe.connect()
        frappe.set_user(WRITER)
        try:
            if read_committed:
                begin_drive_write()

            # The form's copy, read before the conversion commits
            doc = frappe.get_doc("Writer Document", docname)
            doc.content = "<p>Edited</p>"
            read.set()
            converted.wait(60)
            doc.save()
            frappe.db.commit()
        except Exception as error:
            errors.append(error)
        finally:
            read.set()
            frappe.destroy()

    def purge_as_writer(self, node: str) -> None:
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _trash(owner, node)
        purge(owner, node)

    def purge_elsewhere(
        self,
        site: str,
        node: str,
        heavier: bool,
        errors: list,
        locked: threading.Event,
        release: threading.Event,
    ):
        frappe.init(site=site)
        frappe.connect()
        frappe.set_user(WRITER)
        real_sql = frappe.db.sql

        # Hold the purge's conversion rows until the snapshot, so the conversion's failure count never waits on them
        def sql(query, *args, **kwargs):
            if "DELETE FROM `__writer_content_conversion`" in str(query) and not release.wait(60):
                raise AssertionError("snapshot never ran")

            return real_sql(query, *args, **kwargs)

        try:
            if heavier:
                # More locks than the conversion holds, so InnoDB rolls the conversion back instead
                frappe.db.sql("SELECT `name` FROM `tabDocField` FOR UPDATE")

            # The tree lock the trash takes first, held before the conversion asks for it
            lock_trees(frappe.db.get_value("Drive Node", node, "root"))
            locked.set()
            with patch.object(frappe.db, "sql", sql):
                self.purge_as_writer(node)

            frappe.db.commit()
        except Exception as error:
            errors.append(error)
        finally:
            locked.set()
            frappe.destroy()

    # Convert `page` and, once the conversion locks its first node, purge that node from another connection
    def purge_while_converting(self, page: list[str], heavier: bool, release: threading.Event) -> list:
        errors: list[Exception] = []
        locked = threading.Event()
        waited: list[bool] = []
        purger = threading.Thread(
            target=self.purge_elsewhere, args=(frappe.local.site, page[0], heavier, errors, locked, release)
        )
        real_sql = frappe.db.sql

        def sql(query, *args, **kwargs):
            answer = real_sql(query, *args, **kwargs)
            if NODE_LOCK in str(query) and purger.ident is None:
                purger.start()
                waited.append(locked.wait(10))

            return answer

        rows = [frappe._dict(node=name) for name in page]
        try:
            with patch.object(frappe.db, "sql", sql):
                self.assertTrue(conversions.convert_page(writer_content.APP, rows, time.monotonic() + 600))
        finally:
            release.set()
            if purger.ident is not None:
                purger.join(30)

        self.assertEqual(waited, [True])
        self.assertFalse(purger.is_alive())
        return errors

    def test_a_conversion_rolled_back_by_a_purge_deadlock_loses_nothing_and_the_run_goes_on(self):
        node = self.old_document("<p>Hello world</p>")
        self.addCleanup(self.delete_document, node)
        [other] = self.old_documents(1)
        self.forget_logged(f"{node}: QueryDeadlockError")
        before = {
            **self.as_before(node),
            "state": "Active",
            "records": ((None, None, None),),
            "failures": [1],
        }
        release = threading.Event()
        during: dict = {}

        # Look at the document once the run reaches the next one, before the purge commits
        def snapshot():
            during.update(self.as_before(node), state=frappe.db.get_value("Drive Node", node, "state"))
            during.update(records=self.records(node), failures=self.failures(node))
            release.set()

        real_sql = frappe.db.sql

        # Snapshot as the conversion starts the second node, before that waits on the purge's locks
        def sql(query, *args, **kwargs):
            if (
                not release.is_set()
                and "INSERT INTO `__writer_content_conversion`" in str(query)
                and other in args[0].values()
            ):
                snapshot()

            return real_sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", sql):
            errors = self.purge_while_converting([node, other], heavier=True, release=release)

        self.assertEqual(errors, [])
        self.assertEqual(during, before)
        deadlock = {
            "method": "Collab conversion: writer did not run",
            "error": ("like", f"%{node}: QueryDeadlockError%"),
        }
        self.assertTrue(connection_for("Error Log").exists("Error Log", deadlock))
        self.assertEqual(self.records(other), (("converted", None, "[]"),))
        self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertFalse(frappe.db.exists("Writer Document", {"node": node}))

    def test_a_purge_rolled_back_by_a_conversion_deadlock_writes_nothing_and_goes_through_again(self):
        node = self.old_document("<p>Hello world</p>")
        release = threading.Event()
        release.set()

        errors = self.purge_while_converting([node], heavier=False, release=release)

        self.assertEqual([type(error) for error in errors], [frappe.QueryDeadlockError])
        self.assertEqual(frappe.db.get_value("Drive Node", node, "state"), "Active")
        self.assertEqual(self.records(node), (("converted", None, "[]"),))
        self.assertEqual(
            frappe.db.sql("SELECT `mode` FROM `__writer_content_doc` WHERE `node` = %s", node), (("active",),)
        )
        self.purge_as_writer(node)
        frappe.db.commit()
        self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertEqual(
            frappe.db.sql("SELECT `mode` FROM `__writer_content_doc` WHERE `node` = %s", node), (("purged",),)
        )

    def restore_elsewhere(self, site: str, node: str, seq: int, errors: list, locked: threading.Event):
        frappe.init(site=site)
        frappe.connect()
        frappe.set_user(WRITER)
        real_sql = frappe.db.sql

        def sql(query, *args, **kwargs):
            answer = real_sql(query, *args, **kwargs)
            if "`tabDrive Node Version`" in str(query) and "FOR UPDATE" in str(query):
                locked.set()

            return answer

        try:
            # More locks than the conversion holds, so InnoDB rolls the conversion back instead
            frappe.db.sql("SELECT `name` FROM `tabDocField` FOR UPDATE")
            with patch.object(frappe.db, "sql", sql):
                restore_version(Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)), node, seq)

            frappe.db.commit()
        except Exception as error:
            errors.append(error)
        finally:
            locked.set()
            frappe.destroy()

    # Convert `page` and, holding its first node's row, have another connection restore version `seq`
    # of that node, which locks the node before the row
    def restore_while_converting(self, page: list[str], seq: int) -> list:
        node = page[0]
        errors: list[Exception] = []
        locked = threading.Event()
        waited: list[bool] = []
        restorer = threading.Thread(
            target=self.restore_elsewhere, args=(frappe.local.site, node, seq, errors, locked)
        )
        real_sql = frappe.db.sql

        def sql(query, *args, **kwargs):
            if NODE_LOCK in str(query) and restorer.ident is None:
                restorer.start()
                waited.append(locked.wait(10))

            return real_sql(query, *args, **kwargs)

        rows = [frappe._dict(node=name) for name in page]
        try:
            with patch.object(frappe.db, "sql", sql):
                self.assertTrue(conversions.convert_page(writer_content.APP, rows, time.monotonic() + 600))
        finally:
            if restorer.ident is not None:
                restorer.join(30)

        self.assertEqual(waited, [True])
        self.assertFalse(restorer.is_alive())
        return errors

    def test_a_conversion_rolled_back_by_a_restore_deadlock_loses_nothing_and_the_run_goes_on(self):
        node = self.old_document("<p>Kept</p>")
        seq = drive.take_version(node)
        frappe.db.set_value("Writer Document", self.docname_of(node), "html", "<p>Edited</p>")
        frappe.db.commit()
        [other] = self.old_documents(1)
        self.forget_logged(f"{node}: QueryDeadlockError")

        errors = self.restore_while_converting([node, other], seq)

        self.assertEqual(errors, [])
        deadlock = {
            "method": "Collab conversion: writer did not run",
            "error": ("like", f"%{node}: QueryDeadlockError%"),
        }
        self.assertTrue(connection_for("Error Log").exists("Error Log", deadlock))
        self.assertEqual(frappe.db.get_value("Writer Document", self.docname_of(node), "html"), "<p>Kept</p>")
        [captured] = frappe.get_all("Drive Node Version", {"node": node, "seq": [">", seq]}, pluck="seq")
        with read_version(Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)), node, captured) as stream:
            self.assertEqual(json.loads(stream.read())["html"], "<p>Edited</p>")

        self.assertIsNone(log.find(writer_content.APP, node))
        self.assertEqual((self.records(node), self.failures(node)), (((None, None, None),), [1]))
        self.assertEqual(self.records(other), (("converted", None, "[]"),))
        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        self.assertEqual(self.before_collaboration(node)["html"], "<p>Kept</p>")
        self.assertEqual(self.text_of_log(node), "<paragraph>Kept</paragraph>")

    def purge_after_pick_elsewhere(
        self, site: str, node: str, errors: list, nowaits: list, locked: threading.Event
    ):
        frappe.init(site=site)
        frappe.connect()
        frappe.set_user(WRITER)
        real_sql = frappe.db.sql

        def sql(query, *args, **kwargs):
            if "`tabWriter Document`" in str(query) and "NOWAIT" in str(query):
                nowaits.append(str(query))

            answer = real_sql(query, *args, **kwargs)
            if "INSERT INTO `tabDrive Activity`" in str(query):
                locked.set()

            return answer

        try:
            with patch.object(frappe.db, "sql", sql):
                purge(Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)), node)

            frappe.db.commit()
        except Exception as error:
            errors.append(error)
        finally:
            locked.set()
            frappe.destroy()

    # Convert `page` and, holding its first node's row, have another connection purge that trashed node,
    # which locks the node before its callback asks for the row
    def purge_after_pick_while_converting(
        self, page: list[str], node_locked: threading.Event
    ) -> tuple[list, list]:
        errors: list[Exception] = []
        nowaits: list[str] = []
        locked = threading.Event()
        waited: list[bool] = []
        args = (frappe.local.site, page[0], errors, nowaits, locked)
        purger = threading.Thread(target=self.purge_after_pick_elsewhere, args=args)
        real_sql = frappe.db.sql

        def sql(query, *args, **kwargs):
            if NODE_LOCK not in str(query) or purger.ident is not None:
                return real_sql(query, *args, **kwargs)

            purger.start()
            waited.append(locked.wait(10))
            answer = real_sql(query, *args, **kwargs)
            node_locked.set()
            return answer

        rows = [frappe._dict(node=name) for name in page]
        try:
            with patch.object(frappe.db, "sql", sql):
                self.assertTrue(conversions.convert_page(writer_content.APP, rows, time.monotonic() + 600))
        finally:
            if purger.ident is not None:
                purger.join(30)

        self.assertEqual(waited, [True])
        self.assertFalse(purger.is_alive())
        return errors, nowaits

    def test_a_purge_meeting_a_conversion_is_refused_and_loses_nothing(self):
        node = self.old_document("<p>Hello world</p>")
        self.addCleanup(self.delete_document, node)
        [other] = self.old_documents(1)
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _trash(owner, node)
        frappe.db.commit()
        before = self.as_before(node)
        self.forget_logged(f"{node}: DriveForbidden")
        node_locked = threading.Event()

        errors, nowaits = self.purge_after_pick_while_converting([node, other], node_locked)

        self.assertEqual([type(error) for error in errors], [frappe.QueryTimeoutError])
        self.assertEqual(len(nowaits), 1)
        self.assertTrue(node_locked.is_set())
        self.assertEqual(frappe.db.get_value("Drive Node", node, "state"), "Trashed")
        self.assertEqual(self.as_before(node), before)
        self.assertEqual((self.records(node), self.failures(node)), (((None, None, None),), [1]))
        refused = {
            "method": "Collab conversion: writer did not run",
            "error": ("like", f"%{node}: DriveForbidden%"),
        }
        self.assertTrue(connection_for("Error Log").exists("Error Log", refused))
        self.assertEqual(self.records(other), (("converted", None, "[]"),))
        purge(owner, node)
        frappe.db.commit()
        self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertFalse(frappe.db.exists("Writer Document", {"node": node}))

    def test_converts_a_collaborative_version_from_its_yjs_body_not_its_stale_html(self):
        node = self.new_document()
        self.delete_log(node)
        doc = pycrdt.Doc()
        doc.get("default", type=pycrdt.XmlFragment).children.append(
            pycrdt.XmlElement("paragraph", None, [pycrdt.XmlText("Yjs text")])
        )
        old = {"content": base64.b64encode(doc.get_update()).decode(), "html": "<p>stale</p>", "collab": 1}
        frappe.db.set_value("Writer Document", self.docname_of(node), old)
        frappe.db.commit()
        seq = drive.take_version(node)
        frappe.db.commit()

        self.assertEqual(
            self.restored_body(self.poll_conversion(node, seq)), "<paragraph>Yjs text</paragraph>"
        )

    # Asks for version `seq` as the page does, outside a job, runs the job it queued, and asks again
    def poll_conversion(self, node: str, seq: int) -> dict:
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue") as enqueue:
            self.assertEqual(docs.convert_version(node, seq), {"pending": True})
            queued = call(
                "suite.writer.api.docs.run_version_conversion",
                f"suite-writer-convert-version-{node}-{seq}",
                timeout=300,
                node=node,
                seq=seq,
            )
            self.assertEqual(enqueue.call_args_list, [queued])

        docs.run_version_conversion(node=node, seq=seq)
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue") as enqueue:
            answer = docs.convert_version(node, seq)
            enqueue.assert_not_called()

        return answer

    def restored_body(self, answer: dict) -> str:
        restored = pycrdt.Doc()
        restored.apply_update(base64.b64decode(answer["state"]))
        return str(restored.get("default", type=pycrdt.XmlFragment))

    def test_converts_an_old_version_in_a_job_the_page_waits_on(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()

        self.assertEqual(
            self.restored_body(self.poll_conversion(node, seq)), "<paragraph>Hello world</paragraph>"
        )

    def test_queues_a_version_again_once_another_child_kept_its_job_waiting(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue"):
            docs.convert_version(node, seq)

        with patch.object(checker, "ask", side_effect=checker.CheckerBusy("busy")):
            docs.run_version_conversion(node=node, seq=seq)

        self.assertEqual(
            self.restored_body(self.poll_conversion(node, seq)), "<paragraph>Hello world</paragraph>"
        )

    def test_converts_an_old_version_for_an_editor_who_holds_only_an_edit_link(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        code = grant(node, "$LINK", drive.EDIT, admin)["principal"].removeprefix("$LINK:")
        frappe.db.commit()
        environ = EnvironBuilder(path="/api/v2/method/suite.writer.api.docs.convert_version")
        previous = getattr(frappe.local, "request", None)
        self.addCleanup(setattr, frappe.local, "request", previous)
        frappe.set_user("Guest")

        frappe.local.request = Request(environ.get_environ())
        with self.assertRaises(drive.DriveError):
            docs.convert_version(node, seq)

        environ.headers["X-Drive-Links"] = code
        frappe.local.request = Request(environ.get_environ())
        self.assertEqual(
            self.restored_body(self.poll_conversion(node, seq)), "<paragraph>Hello world</paragraph>"
        )

    def test_answers_crashed_only_to_a_system_manager_when_the_conversion_job_raises(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()

        with patch.object(convert, "convert", side_effect=RuntimeError("Hello world")):
            writer_sees = self.poll_conversion(node, seq)

        frappe.set_user("Administrator")
        with patch.object(frappe.local, "job", None):
            manager_sees = docs.convert_version(node, seq)

        self.assertEqual(writer_sees, {})
        self.assertEqual(manager_sees, {"reason": "crashed"})
        self.assertEqual(self.crashes_logged(node), [f"{node} v{seq}: RuntimeError"])

    def test_converts_a_version_only_for_an_editor_though_a_reader_reads_it(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(READER)
        with drive.read_version(node, seq) as stream:
            self.assertIn(b"Hello world", stream.read())

        with patch.object(scheduling, "enqueue") as enqueue, self.assertRaises(drive.DriveForbidden):
            docs.convert_version(node, seq)

        enqueue.assert_not_called()
        frappe.set_user(OUTSIDER)
        with self.assertRaises(drive.DriveNotFound):
            drive.read_version(node, seq)

    def test_answers_a_refused_version_with_its_reason_only_to_a_system_manager(self):
        refusals = {
            "check": {"return_value": convert.Refused("check")},
            "unavailable": {"return_value": None},
            "converter_changed": {"side_effect": convert.ConverterChanged("2")},
        }
        for reason, converting in refusals.items():
            node = self.old_document("<p>Hello world</p>")
            seq = drive.take_version(node)
            frappe.db.commit()
            with patch.object(convert, "convert", **converting):
                writer_sees = self.poll_conversion(node, seq)

            frappe.set_user("Administrator")
            with patch.object(frappe.local, "job", None):
                manager_sees = docs.convert_version(node, seq)

            frappe.set_user(WRITER)
            self.assertEqual((writer_sees, manager_sees), ({}, {"reason": reason}), msg=reason)

    def old_version(self) -> tuple[str, int]:
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()
        return node, seq

    # Saved on no queue, so no live worker takes it
    def waiting_job(self, node: str, seq: int) -> Job:
        job_id = create_job_id(f"suite-writer-convert-version-{node}-{seq}")
        job = Job.create("frappe.ping", id=job_id, status=JobStatus.QUEUED, connection=get_redis_conn())
        job.save()
        self.addCleanup(get_redis_conn().delete, job.key)
        return job

    def ask_version(self, node: str, seq: int) -> dict:
        with patch.object(frappe.local, "job", None):
            return docs.convert_version(node, seq)

    def stored_input(self, node: str, seq: int) -> bool:
        return bool(frappe.cache.exists(docs.version_key("input", node, seq)))

    def test_waits_on_another_version_while_the_stored_one_has_its_job_waiting(self):
        frappe.cache.delete_value(docs.VERSION_SLOT, user=True)
        first = self.old_version()
        second = self.old_version()
        self.waiting_job(*first)
        self.waiting_job(*second)
        self.ask_version(*first)

        self.assertEqual(self.ask_version(*second), {"pending": True})
        self.assertEqual((self.stored_input(*first), self.stored_input(*second)), (True, False))

    def test_stores_another_version_in_place_of_one_whose_job_has_gone(self):
        frappe.cache.delete_value(docs.VERSION_SLOT, user=True)
        first = self.old_version()
        second = self.old_version()
        first_job = self.waiting_job(*first)
        self.waiting_job(*second)
        self.ask_version(*first)
        first_job.delete()

        self.assertEqual(self.ask_version(*second), {"pending": True})
        self.assertEqual((self.stored_input(*first), self.stored_input(*second)), (False, True))

    def test_closes_the_version_it_reads_whether_or_not_it_fits(self):
        frappe.cache.delete_value(docs.VERSION_SLOT, user=True)
        fits = self.old_version()
        too_large = self.old_version()
        opened: list[io.IOBase] = []
        real_read = drive.read_version

        def tracked(node: str, seq: int):
            stream = real_read(node, seq)
            opened.append(stream)
            return stream

        with patch.object(drive, "read_version", side_effect=tracked), patch.object(scheduling, "enqueue"):
            self.assertEqual(self.ask_version(*fits), {"pending": True})
            with (
                patch.object(writer_drive, "MAX_VERSION_BYTES", 1),
                self.assertRaises(writer_drive.VersionTooLarge),
            ):
                self.ask_version(*too_large)

        self.assertEqual([stream.closed for stream in opened], [True, True])

    def test_keeps_an_answer_a_minute_at_most(self):
        node, seq = self.old_version()
        self.waiting_job(node, seq)
        self.ask_version(node, seq)
        docs.run_version_conversion(node=node, seq=seq)

        kept = frappe.cache.ttl(frappe.cache.make_key(docs.version_key("answer", node, seq)))
        a_minute = 60
        self.assertTrue(0 < kept <= a_minute, kept)

    def crashes_logged(self, node: str) -> list[str]:
        return frappe.get_all(
            "Error Log",
            filters={"method": "Writer: version conversion crashed", "error": ["like", f"{node}%"]},
            pluck="error",
        )

    def run_as_job(self, node: str, seq: int):
        # As the job runner does when a job raises: a log with each frame's locals
        try:
            docs.run_version_conversion(node=node, seq=seq)
        except Exception:
            frappe.log_error(title="suite.writer.api.docs.run_version_conversion")

    def test_logs_no_document_text_when_the_conversion_job_cannot_keep_its_answer(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()
        logged_before = connection_for("Error Log").count("Error Log", {"error": ["like", "%Hello world%"]})
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue"):
            docs.convert_version(node, seq)

        with patch.object(frappe.cache, "set_value", side_effect=ConnectionError) as write:
            self.run_as_job(node, seq)

        state = write.call_args_list[0].args[1]["state"]
        self.assertEqual(
            connection_for("Error Log").count("Error Log", {"error": ["like", "%Hello world%"]}),
            logged_before,
        )
        self.assertEqual(
            connection_for("Error Log").count("Error Log", {"error": ["like", f"%{state[:40]}%"]}), 0
        )

    def test_logs_no_document_text_when_the_conversion_job_cannot_read_its_input(self):
        node = self.old_document("<p>Hello world</p>")
        seq = drive.take_version(node)
        frappe.db.commit()
        logged_before = connection_for("Error Log").count("Error Log", {"error": ["like", "%Hello world%"]})
        with patch.object(frappe.local, "job", None), patch.object(scheduling, "enqueue"):
            docs.convert_version(node, seq)

        read = frappe.cache.get_value

        def failing_read(key, *args, **kwargs):
            payload = read(key, *args, **kwargs)
            if key == docs.version_key("input", node, seq):
                raise ConnectionError(payload)

            return payload

        with patch.object(frappe.cache, "get_value", side_effect=failing_read):
            self.run_as_job(node, seq)

        self.assertEqual(
            connection_for("Error Log").count("Error Log", {"error": ["like", "%Hello world%"]}),
            logged_before,
        )
        self.assertEqual(self.crashes_logged(node), [f"{node} v{seq}: ConnectionError"])

    def edit_while_converting(self, node: str, edits: int):
        docname = self.docname_of(node)
        calls: list[int] = []

        def edited(*args, **kwargs):
            converted = REAL_CONVERT(*args, **kwargs)
            calls.append(1)
            edit = len(calls)
            if edit <= edits:
                frappe.db.set_value("Writer Document", docname, "html", f"<p>Edit {edit}</p>")
                frappe.db.commit()

            return converted

        return patch.object(convert, "convert", side_effect=edited)

    def test_reads_a_row_again_when_it_changes_under_the_converter(self):
        node = self.old_document("<p>Hello world</p>")

        with self.edit_while_converting(node, edits=1):
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")

        self.assertEqual(self.before_collaboration(node)["html"], "<p>Edit 1</p>")
        self.assertEqual(self.text_of_log(node), "<paragraph>Edit 1</paragraph>")

    def test_leaves_a_row_that_keeps_changing_to_the_next_run(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.build_thread(node, "c1", ["c1"])

        with self.edit_while_converting(node, edits=conversions.ATTEMPTS):
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

        after = self.as_before(node)
        self.assertEqual(after["row"]["html"], f"<p>Edit {conversions.ATTEMPTS}</p>")
        self.assertEqual(
            (after["threads"], after["versions"], after["log"]), (self.threads_of(node), 0, None)
        )
        self.assertEqual(self.records(node), ())

    def test_a_refusal_at_any_step_writes_only_its_record(self):
        def converted_with(**changes):
            return lambda *args, **kwargs: dataclasses.replace(REAL_CONVERT(*args, **kwargs), **changes)

        failed = compaction.CompactionFailed("unreadable")
        fallback = compaction.Compacted(b"", integrated=False)
        for name, target, attribute, stub, refusal in (
            (
                "over quota",
                drive,
                "take_version",
                {"side_effect": drive.DriveOverQuota()},
                ("over_quota", None),
            ),
            ("checker failed", compaction, "compact", {"side_effect": failed}, ("check", "unreadable")),
            ("checker fallback", compaction, "compact", {"return_value": fallback}, ("check", "fallback")),
            ("copy missing", writer_content, "is_html_complete", {"return_value": False}, ("check", "copy")),
            ("copy not written", copies, "replace_copy", {"return_value": None}, ("check", "copy")),
            (
                "copy mismatch",
                copies,
                "replace_copy",
                {"side_effect": copies.CopyMismatch("x")},
                ("check", "copy"),
            ),
            (
                "copy emptied",
                convert,
                "convert",
                {"side_effect": converted_with(html="")},
                ("check", "empty"),
            ),
            (
                "converter",
                convert,
                "convert",
                {"return_value": convert.Refused("too_large")},
                ("too_large", None),
            ),
        ):
            key = name.replace(" ", "-")
            node = self.old_document("<p>Hello world</p>", old_comments((key, "world", [])))
            self.build_thread(node, key, [key])
            before = self.as_before(node)

            with patch.object(target, attribute, **stub):
                self.assertEqual(conversions.convert_document(writer_content.APP, node), refusal[0], msg=name)

            self.assertEqual(self.as_before(node), before, msg=name)
            self.assertEqual(self.records(node), ((*refusal, None),), msg=name)

    def test_a_copy_that_reads_back_differently_rolls_back_the_conversion(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.build_thread(node, "c1", ["c1"])
        before = self.as_before(node)
        lossy = LossyHtmlCopy("html", is_html_complete)

        def converting(*args, **kwargs):
            return dataclasses.replace(REAL_CONVERT(*args, **kwargs), html="<p>Hello world</p><p>New</p>")

        with (
            patch.object(convert, "convert", side_effect=converting),
            patch.object(
                writer_content, "EDITOR", dataclasses.replace(writer_content.EDITOR, readable_copy=lossy)
            ),
        ):
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

        self.assertEqual(len(lossy.writes), 1)
        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), (("check", "copy", None),))

    def test_the_converter_runs_with_the_editors_build_and_version(self):
        node = self.old_document("<p>Hello world</p>")
        self.addCleanup(self.delete_document, node)
        build = writer_content.CONVERTER_BUILD.with_name("next.cjs")
        legacy = conversion.read_old(node).legacy
        following = dataclasses.replace(writer_content.EDITOR.conversion, build=build, version="next")

        with (
            patch.object(convert, "convert", return_value=None) as converting,
            patch.object(
                writer_content, "EDITOR", dataclasses.replace(writer_content.EDITOR, conversion=following)
            ),
        ):
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

        converting.assert_called_once_with(build, "next", legacy)

    def test_a_failure_after_the_first_write_keeps_the_old_comments(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.build_thread(node, "c1", ["c1"])
        before = self.as_before(node)

        with (
            patch.object(drive, "install_threads", side_effect=RuntimeError("down")),
            self.assertRaises(RuntimeError),
        ):
            conversions.convert_document(writer_content.APP, node)

        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), ((None, None, None),))
        self.assertEqual(self.failures(node), [1])

    def test_tries_a_failing_body_again_and_records_it_crashed_at_its_third_failure_under_a_converter(self):
        node = self.old_document("<p>Crash text</p>")
        self.addCleanup(self.delete_document, node)
        before = self.as_before(node)

        with patch.object(convert, "convert", side_effect=RuntimeError("down")) as converting:
            for failures in (1, 2):
                self.assertRaises(RuntimeError, conversions.convert_document, writer_content.APP, node)
                self.assertEqual(self.records(node), ((None, None, None),))
                self.assertEqual(self.failures(node), [failures])
                self.assertEqual(conversions.conversion_status(writer_content.APP, node)["state"], "pending")

            self.assertRaises(RuntimeError, conversions.convert_document, writer_content.APP, node)
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))
            self.assertEqual(converting.call_count, 3)
            self.assertEqual(conversions.conversion_status(writer_content.APP, node)["state"], "refused")

            with (
                patch.object(
                    writer_content,
                    "EDITOR",
                    dataclasses.replace(
                        writer_content.EDITOR,
                        conversion=dataclasses.replace(writer_content.EDITOR.conversion, version="next"),
                    ),
                ),
                self.assertRaises(RuntimeError),
            ):
                conversions.convert_document(writer_content.APP, node)

        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), (("crashed", None, None), (None, None, None)))
        self.assertEqual(self.failures(node), [3, 1])

    def test_leaves_a_body_to_the_next_run_counting_nothing_while_another_child_runs(self):
        [node] = self.old_documents(1)
        before = self.as_before(node)

        with patch.object(checker, "ask", side_effect=checker.CheckerBusy("busy")):
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), ())
        self.assertEqual(conversions.conversion_status(writer_content.APP, node)["state"], "pending")

    def test_tries_a_failed_child_body_again_and_keeps_its_reason_at_the_third_failure(self):
        for reason in ("child_timeout", "child_crash"):
            [node] = self.old_documents(1)
            before = self.as_before(node)
            with patch.object(convert, "convert", return_value=convert.Refused(reason)):
                outcomes = [conversions.convert_document(writer_content.APP, node) for _ in range(4)]

            self.assertEqual(outcomes, [None, None, reason, None], msg=reason)
            self.assertEqual(self.as_before(node), before, msg=reason)
            self.assertEqual(self.records(node), ((reason, None, None),), msg=reason)
            self.assertEqual(self.failures(node), [3], msg=reason)

    def test_tries_an_over_quota_body_again_once_retried_and_leaves_other_refusals(self):
        over, refused = self.old_documents(2)
        frappe.db.set_value(
            "Writer Document", self.docname_of(refused), "ycomments", old_comments(("c1", "world", []))
        )
        frappe.db.commit()
        with patch.object(drive, "take_version", side_effect=drive.DriveOverQuota()):
            self.assertEqual(conversions.convert_document(writer_content.APP, over), "over_quota")

        self.assertEqual(conversions.convert_document(writer_content.APP, refused), "check")

        self.assertEqual(conversions.retry_over_quota(writer_content.APP), 1)

        self.assertEqual(conversions.convert_document(writer_content.APP, over), "converted")
        self.assertIsNone(conversions.convert_document(writer_content.APP, refused))
        self.assertEqual(self.records(refused), (("check", "orphan", None),))

    def test_leaves_a_document_purged_under_the_converter(self):
        node = self.old_document("<p>Hello world</p>")

        def purged(*args, **kwargs):
            self.delete_document(node)
            return REAL_CONVERT(*args, **kwargs)

        with patch.object(convert, "convert", side_effect=purged):
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

        self.assertEqual(self.records(node), ())

    def test_keeps_a_record_for_each_body_it_refuses(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")
        frappe.db.set_value("Writer Document", self.docname_of(node), "html", "<p>Hello again</p>")
        frappe.db.commit()

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

        self.assertEqual(len(self.records(node)), 2)

    def test_a_refusal_after_a_failed_run_updates_the_bodys_one_record(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        with patch.object(convert, "convert", side_effect=RuntimeError("down")):
            self.assertRaises(RuntimeError, conversions.convert_document, writer_content.APP, node)

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")

        self.assertEqual(self.records(node), (("check", "orphan", None),))
        self.assertEqual(self.failures(node), [1])

    def test_gives_a_reader_the_rooms_a_waiting_document_is_told_its_outcome_on(self):
        [waiting] = self.old_documents(1)
        refused = self.refused_document()
        grant(waiting, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        frappe.set_user(READER)
        reader_sees = writer_routes.document(self.docname_of(waiting))["conversion"]
        frappe.set_user(OUTSIDER)
        self.assertRaises(frappe.PermissionError, writer_routes.document, self.docname_of(waiting))
        frappe.set_user(WRITER)

        self.assertEqual(writer_routes.document(self.docname_of(refused))["conversion"], {"state": "refused"})
        self.assertEqual(sorted(reader_sees), ["rooms", "state"])
        self.assertEqual(reader_sees["state"], "pending")
        self.assertEqual(len(set(reader_sees["rooms"]["keys"])), 2)
        for key in reader_sees["rooms"]["keys"]:
            self.assertRegex(key, r"^sc:[A-Za-z0-9_-]{32}$")

    def test_a_page_reading_a_document_gets_its_conversion_and_last_save(self):
        node = self.old_document("<p>Hello world</p>")
        frappe.set_user(WRITER)
        self.addCleanup(frappe.set_user, "Administrator")
        drive.touch("Writer Document", self.docname_of(node))
        frappe.db.commit()
        stamped = frappe.db.get_value("Drive Node", node, "content_modified")

        response = self.contract_request("documents.get", WRITER, name=self.docname_of(node))

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        row = response.json["data"]
        self.assertLessEqual({"conversion", "content_modified"}, row.keys())
        self.assertEqual(row["conversion"]["state"], "pending")
        saved = stamped.replace(tzinfo=ZoneInfo(get_system_timezone()))
        self.assertEqual(datetime.fromisoformat(row["content_modified"]), saved)

    def test_a_page_reading_a_logged_document_gets_no_body(self):
        node = self.old_document("<p>Hello world</p>")
        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        docname = self.docname_of(node)

        response = self.contract_request("documents.get", WRITER, name=docname)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsNone(response.json["data"]["content"])
        self.assertTrue(frappe.db.get_value("Writer Document", docname, "content"))

    def test_a_page_saving_settings_keeps_them_for_an_editor_only(self):
        docname = self.docname_of(self.old_document("<p>Hello world</p>"))
        settings = json.dumps({"fullWidth": True})

        saved = self.contract_request("documents.updateSettings", WRITER, name=docname, data=settings)
        refused = self.contract_request("documents.updateSettings", OUTSIDER, name=docname, data="{}")

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertIn(refused.status_code, (403, 404))
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value("Writer Document", docname, "settings"), settings)

    def contract_request(self, public_name: str, user: str, **params):
        contract = json.loads(_contract_path("writer").read_text())
        [operation] = [row for row in contract["operations"] if row["publicName"] == public_name]
        path = operation["path"]
        if not path.startswith("/"):
            path = contract["prefix"] + path

        for name in operation["pathParams"]:
            value = quote(params.pop(name), safe="")
            path = path.replace("{" + name + "}", value)

        sid = session_for(user)
        sent = {"method": operation["method"], "headers": {"Cookie": f"sid={sid}"}}
        if operation["method"] == "GET":
            sent["query_string"] = params
        else:
            sent["json"] = params

        return make_request(target=get_test_client(use_cookies=False).open, args=(path,), kwargs=sent)

    def refused_document(self) -> str:
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.addCleanup(self.delete_document, node)
        self.assertEqual(conversions.convert_document(writer_content.APP, node), "check")
        return node

    def heard(self, node: str, run) -> list[tuple]:
        keys = writer_routes.document(self.docname_of(node))["conversion"]["rooms"]["keys"]
        told: list[tuple] = []

        def publish(event, message=None, room=None, **kwargs):
            if event != "suite_collab_converted":
                return

            # Anything not yet committed is gone, as for a tab that reloads on hearing it
            frappe.db.rollback()
            committed = [outcome for outcome, _reason, _dropped in self.records(node)]
            told.append((message, room in keys, committed))

        with patch("frappe.publish_realtime", side_effect=publish):
            run(node)

        return told

    def test_tells_the_tabs_waiting_on_a_document_its_outcome_once_committed(self):
        converted, too_large, child_crash, stale = self.old_documents(4)
        orphan = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        self.addCleanup(self.delete_document, orphan)
        stale_start = frappe.utils.now_datetime() - conversions.STALE_ATTEMPT - timedelta(seconds=1)
        conversions.start_attempt(
            writer_content.APP, stale, conversion.read_old(stale).fingerprint, stale_start, retry=False
        )

        def thrice(node):
            for _ in range(3):
                conversions.convert_document(writer_content.APP, node)

        self.assertEqual(
            self.heard(converted, functools.partial(conversions.convert_document, writer_content.APP)),
            [({"state": "converted"}, True, ["converted"])],
        )
        self.assertEqual(
            self.heard(orphan, functools.partial(conversions.convert_document, writer_content.APP)),
            [({"state": "refused"}, True, ["check"])],
        )
        self.assertEqual(
            self.heard(stale, functools.partial(conversions.convert_document, writer_content.APP)),
            [({"state": "refused"}, True, ["crashed"])],
        )
        with patch.object(convert, "convert", return_value=convert.Refused("too_large")):
            told = self.heard(too_large, functools.partial(conversions.convert_document, writer_content.APP))

        self.assertEqual(told, [({"state": "refused"}, True, ["too_large"])])
        with patch.object(convert, "convert", return_value=convert.Refused("child_crash")):
            told = self.heard(child_crash, thrice)

        self.assertEqual(told, [({"state": "refused"}, True, ["child_crash"])])

    def forget_blocks(self) -> None:
        def forget():
            for cause in ("node", "scheduler"):
                frappe.db.set_global(f"suite_collab_blocked_{cause}", None)

            frappe.db.delete(
                "Notification Log", {"subject": ("like", "Collaborative documents can't be upgraded%")}
            )
            frappe.db.commit()

        forget()
        self.addCleanup(forget)

    def make_manager(self) -> None:
        frappe.set_user("Administrator")
        frappe.get_doc("User", WRITER).add_roles("System Manager")
        frappe.set_user(WRITER)

        def unmake():
            frappe.set_user("Administrator")
            frappe.get_doc("User", WRITER).remove_roles("System Manager")
            frappe.db.commit()

        self.addCleanup(unmake)

    def notified(self, cause: str) -> int:
        subject = f"Collaborative documents can't be upgraded: {cause}"
        return frappe.db.count("Notification Log", {"for_user": WRITER, "subject": subject})

    def reason_for_a_manager(self, node: str) -> str | None:
        frappe.set_user("Administrator")
        try:
            return writer_routes.document(self.docname_of(node))["conversion"].get("reason")
        finally:
            frappe.set_user(WRITER)

    def test_gives_only_a_system_manager_why_waiting_documents_do_not_convert(self):
        self.forget_blocks()
        [node] = self.old_documents(1)
        convert.report_block("scheduler")

        self.assertNotIn("reason", writer_routes.document(self.docname_of(node))["conversion"])
        self.assertEqual(self.reason_for_a_manager(node), "scheduler")

    def test_a_run_without_node_tells_system_managers_once_until_node_is_fixed(self):
        no_node = "Node 22.13 or newer is missing"
        self.forget_blocks()
        self.forget_logged(no_node)
        self.make_manager()
        logged = self.reasons_logged(no_node)
        [node] = self.old_documents(1)
        convert.report_block("scheduler")

        with patch.object(checker, "usable_node", return_value=None):
            self.assertEqual(self.run_on([node]), [])
            self.assertEqual(self.run_on([node]), [])

        self.assertEqual(self.records(node), ())
        self.assertEqual(self.reasons_logged(no_node), logged + 1)
        self.assertEqual((self.notified(no_node), self.notified("the scheduler is off")), (1, 1))
        self.assertEqual(self.reason_for_a_manager(node), "node")

        with patch.object(convert, "bundle_ready", return_value=True):
            self.run_on([])

        self.assertIsNone(self.reason_for_a_manager(node))
        with patch.object(checker, "usable_node", return_value=None):
            self.run_on([])

        self.assertEqual(self.notified(no_node), 2)

    def migrate_output(self) -> list[str]:
        self.addCleanup(frappe.flags.pop, "suite_collab_blocks_checked", None)
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            self.assertIsNone(lifecycle.before_migrate())

        return [line for line in printed.getvalue().splitlines() if "upgrade" in line]

    def blocked_migrate_output(self, enabled: bool, **pending) -> list[str]:
        with (
            patch.object(log, "enabled", return_value=enabled),
            patch.object(checker, "usable_node", return_value=None),
            patch.object(convert, "is_scheduler_disabled", return_value=True),
            patch.object(convert, "pending_page", **pending),
        ):
            return self.migrate_output()

    def test_before_migrate_prints_each_cause_every_time_and_tells_system_managers_once(self):
        self.forget_blocks()
        self.make_manager()
        [node] = self.old_documents(1)
        lines = [
            "Collaborative documents can't be upgraded: Node 22.13 or newer is missing",
            "Collaborative documents can't be upgraded: the scheduler is off",
        ]

        self.assertEqual(self.blocked_migrate_output(True, wraps=convert.pending_page), lines)
        self.assertEqual(self.blocked_migrate_output(True, wraps=convert.pending_page), lines)

        self.assertEqual(
            (self.notified("Node 22.13 or newer is missing"), self.notified("the scheduler is off")), (1, 1)
        )
        self.assertEqual(self.reason_for_a_manager(node), "node")

        with (
            patch.object(log, "enabled", return_value=True),
            patch.object(convert, "is_scheduler_disabled", return_value=False),
        ):
            self.assertEqual(self.migrate_output(), [])

        self.assertIsNone(self.reason_for_a_manager(node))

    def test_before_migrate_says_nothing_with_nothing_to_convert_or_when_its_check_fails(self):
        self.forget_blocks()
        [node] = self.old_documents(1)

        off = self.blocked_migrate_output(False, wraps=convert.pending_page)
        none_waits = self.blocked_migrate_output(True, return_value=[])
        failed = self.blocked_migrate_output(True, side_effect=RuntimeError("Hello world"))

        self.assertEqual((off, none_waits, failed), ([], [], []))
        self.assertIsNone(self.reason_for_a_manager(node))

    def migrate_once(self, before: dict, after: dict) -> list[str]:
        frappe.flags.pop("suite_collab_blocks_checked", None)
        self.addCleanup(frappe.flags.pop, "suite_collab_blocks_checked", None)
        others = (
            "suite.mail.install.after_migrate",
            "suite.content.ensure_tables",
            "suite.drive.install.index_group_membership",
            "suite.drive.framework.validate_content_registry",
            "suite.slides.install.seed_system_templates",
        )
        printed = io.StringIO()
        with contextlib.ExitStack() as stack:
            for other in others:
                stack.enter_context(patch(other))

            stack.enter_context(patch.object(checker, "usable_node", return_value=None))
            stack.enter_context(patch.object(convert, "is_scheduler_disabled", return_value=False))
            stack.enter_context(contextlib.redirect_stdout(printed))
            with patch.object(log, "enabled", **before):
                lifecycle.before_migrate()

            with patch.object(log, "enabled", **after):
                lifecycle.after_migrate()

        return [line for line in printed.getvalue().splitlines() if "upgrade" in line]

    def test_a_first_upgrade_is_told_once_from_after_migrate(self):
        self.forget_blocks()
        self.make_manager()
        self.old_documents(1)

        lines = self.migrate_once({"return_value": False}, {"return_value": True})

        self.assertEqual(lines, ["Collaborative documents can't be upgraded: Node 22.13 or newer is missing"])
        self.assertEqual(self.notified("Node 22.13 or newer is missing"), 1)

    def test_a_migrate_with_collaboration_on_is_told_once_from_before_migrate(self):
        self.forget_blocks()
        self.make_manager()
        self.old_documents(1)

        lines = self.migrate_once({"return_value": True}, {"side_effect": RuntimeError("Hello world")})

        self.assertEqual(lines, ["Collaborative documents can't be upgraded: Node 22.13 or newer is missing"])
        self.assertEqual(self.notified("Node 22.13 or newer is missing"), 1)

    def test_a_notice_that_fails_to_send_is_sent_on_the_next_migrate(self):
        self.forget_blocks()
        self.make_manager()
        self.old_documents(1)
        on = {"return_value": True}
        with patch.object(convert, "make_notification_logs", side_effect=RuntimeError("Hello world")):
            self.migrate_once(on, on)

        self.migrate_once(on, on)

        self.assertEqual(self.notified("Node 22.13 or newer is missing"), 1)

    def test_a_migrate_whose_checks_both_fail_says_so_once(self):
        self.forget_blocks()
        self.old_documents(1)
        missing = frappe.db.TableMissingError(1146, "Table 'tabSuite Collab App' doesn't exist")

        lines = self.migrate_once({"side_effect": missing}, {"side_effect": RuntimeError("Hello world")})

        self.assertEqual(
            lines, ["Couldn't check whether collaborative documents can be upgraded: RuntimeError"]
        )

    def test_gives_the_reason_for_a_refusal_only_to_a_system_manager(self):
        node = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        conversions.convert_document(writer_content.APP, node)
        docname = self.docname_of(node)

        writer_sees = writer_routes.document(docname)["conversion"]
        frappe.set_user("Administrator")
        manager_sees = writer_routes.document(docname)["conversion"]

        self.assertEqual(writer_sees, {"state": "refused"})
        self.assertEqual(manager_sees, {"state": "refused", "reason": "check: orphan"})

    def test_drops_the_conversion_state_once_converted(self):
        node = self.old_document("<p>Hello world</p>")
        conversions.convert_document(writer_content.APP, node)

        self.assertNotIn("conversion", writer_routes.document(self.docname_of(node)))

    def test_a_purge_leaves_no_record_of_a_converted_or_refused_document(self):
        converted = self.old_document("<p>Hello world</p>")
        refused = self.old_document("<p>Hello world</p>", old_comments(("c1", "world", [])))
        for node in (converted, refused):
            conversions.convert_document(writer_content.APP, node)
            self.assertEqual(len(self.records(node)), 1)

            self.delete_document(node)

            self.assertEqual(self.records(node), ())

    def old_documents(self, count: int) -> list[str]:
        nodes = [self.old_document("<p>Hello world</p>") for _ in range(count)]
        for node in nodes:
            self.addCleanup(self.delete_document, node)

        return nodes

    def run_on(self, mine: list[str], each=None) -> list[str]:
        """Run the job, converting only `mine`; the nodes it went to, in order."""
        writer = spec_of(writer_content.APP).conversion
        real = conversions.convert_document
        seen = []

        def only_mine(app, node):
            seen.append(node)
            if each is not None:
                each(node)

            if node in mine:
                return real(app, node)

        with patch.object(conversions, "convert_document", only_mine):
            conversions.run_pending(writer_content.APP, writer)

        return seen

    def reasons_logged(self, reason: str) -> int:
        return connection_for("Error Log").count(
            "Error Log", {"method": "Collab conversion: writer did not run", "error": reason}
        )

    def forget_logged(self, reason: str) -> None:
        frappe.cache.delete_value(f"suite-convert-{writer_content.APP}-{reason}")
        self.addCleanup(frappe.cache.delete_value, f"suite-convert-{writer_content.APP}-{reason}")

    def test_a_run_converts_or_records_each_old_document_and_a_second_run_changes_nothing(self):
        good, other, refused = self.old_documents(3)
        frappe.db.set_value(
            "Writer Document", self.docname_of(refused), "ycomments", old_comments(("c1", "world", []))
        )
        frappe.db.commit()

        self.run_on([good, other, refused])

        self.assertEqual(
            [bool(log.find(writer_content.APP, node)) for node in (good, other, refused)], [True, True, False]
        )
        self.assertEqual(self.records(refused), (("check", "orphan", None),))
        after = {node: (self.as_before(node), self.records(node)) for node in (good, other, refused)}

        self.run_on([good, other, refused])

        self.assertEqual({node: (self.as_before(node), self.records(node)) for node in after}, after)

    def test_a_new_converter_version_tries_a_refused_body_again(self):
        [node] = self.old_documents(1)
        with patch.object(convert, "convert", return_value=convert.Refused("too_large")):
            self.assertEqual(conversions.convert_document(writer_content.APP, node), "too_large")
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

            with patch.object(
                writer_content,
                "EDITOR",
                dataclasses.replace(
                    writer_content.EDITOR,
                    conversion=dataclasses.replace(writer_content.EDITOR.conversion, version="next"),
                ),
            ):
                self.assertEqual(conversions.convert_document(writer_content.APP, node), "too_large")

        self.assertEqual(self.records(node), (("too_large", None, None),) * 2)

    def test_converts_a_quoted_font_family_body_refused_under_converter_2(self):
        node = self.old_document("<p>a<span style='font-family: \"Inter\"'>b</span></p>")
        self.addCleanup(self.delete_document, node)
        fingerprint = conversion.read_old(node).fingerprint
        frappe.db.sql(
            """INSERT INTO `__writer_content_conversion`
            (`node`, `fingerprint`, `converter_version`, `started`, `finished`, `outcome`, `reason`)
            VALUES (%s, %s, '2', NOW(), NOW(), 'check', NULL)""",
            (node, fingerprint),
        )
        frappe.db.commit()

        self.assertEqual(conversions.convert_document(writer_content.APP, node), "converted")
        self.assertIsNotNone(log.find(writer_content.APP, node))

    def test_records_a_body_crashed_once_its_attempt_outlives_the_job_and_skips_a_running_one(self):
        running, crashed = self.old_documents(2)
        now = frappe.utils.now_datetime()
        for node, age in (
            (running, timedelta(seconds=60)),
            (crashed, conversions.STALE_ATTEMPT + timedelta(seconds=1)),
        ):
            conversions.start_attempt(
                writer_content.APP, node, conversion.read_old(node).fingerprint, now - age, retry=False
            )

        before = {node: self.as_before(node) for node in (running, crashed)}

        self.assertIsNone(conversions.convert_document(writer_content.APP, running))
        self.assertEqual(conversions.convert_document(writer_content.APP, crashed), "crashed")

        self.assertEqual({node: self.as_before(node) for node in before}, before)
        self.assertEqual(self.records(running), ((None, None, None),))
        self.assertEqual(self.records(crashed), (("crashed", None, None),))

    def test_the_next_run_converts_a_document_made_during_a_run(self):
        [first] = self.old_documents(1)
        made = []

        def make_one(node):
            if node == first and not made:
                made.extend(self.old_documents(1))

        seen = self.run_on([first], each=make_one)
        self.assertNotIn(made[0], seen)

        self.run_on(made)

        self.assertIsNotNone(log.find(writer_content.APP, made[0]))

    def test_skips_a_trashed_document_and_converts_it_once_restored(self):
        [node] = self.old_documents(1)
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        _trash(owner, node)
        frappe.db.commit()
        before = self.as_before(node)

        self.assertNotIn(node, self.run_on([node]))
        self.assertEqual(self.as_before(node), before)
        self.assertEqual(self.records(node), ())

        _restore(owner, node, parent_node=None)
        frappe.db.commit()
        self.run_on([node])

        self.assertIsNotNone(log.find(writer_content.APP, node))

    def test_refuses_a_document_trashed_after_the_page_was_picked_and_writes_nothing(self):
        node, other = self.old_documents(2)
        _trash(Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)), node)
        frappe.db.commit()
        before = self.as_before(node)
        self.forget_logged(f"{node}: DriveForbidden")
        rows = [frappe._dict(node=name) for name in (node, other)]

        self.assertTrue(conversions.convert_page(writer_content.APP, rows, time.monotonic() + 600))

        refused = {
            "method": "Collab conversion: writer did not run",
            "error": ("like", f"%{node}: DriveForbidden%"),
        }
        self.assertTrue(connection_for("Error Log").exists("Error Log", refused))
        self.assertEqual(self.as_before(node), before)
        self.assertEqual((self.records(node), self.failures(node)), (((None, None, None),), [1]))
        self.assertEqual(self.records(other), (("converted", None, "[]"),))

    def test_goes_through_every_page_newest_first_once(self):
        nodes = self.old_documents(3)

        with patch.object(convert, "PAGE", 2):
            seen = self.run_on([])

        self.assertEqual(seen[:3], nodes[::-1])
        self.assertEqual(len(seen), len(set(seen)))

    def test_goes_through_documents_tied_on_modified_across_a_page_edge(self):
        nodes = self.old_documents(3)
        tied = frappe.db.get_value("Writer Document", self.docname_of(nodes[-1]), "modified")
        for node in nodes:
            frappe.db.set_value(
                "Writer Document", self.docname_of(node), "modified", tied, update_modified=False
            )

        frappe.db.commit()

        with patch.object(convert, "PAGE", 2):
            seen = self.run_on([])

        ours = [node for node in seen if node in nodes]
        self.assertEqual(ours, sorted(nodes, key=self.docname_of, reverse=True))
        self.assertEqual(len(seen), len(set(seen)))

    def test_starts_no_document_once_its_time_is_up(self):
        [node] = self.old_documents(1)

        with patch.object(convert, "RUN_FOR", -1):
            self.assertEqual(self.run_on([node]), [])

        self.assertIsNone(log.find(writer_content.APP, node))

    def test_stops_and_logs_why_when_the_converter_changes(self):
        reason = "the bundle answered version 9, not 1"
        self.forget_logged(reason)
        logged = self.reasons_logged(reason)
        self.old_documents(2)

        def changed(node):
            raise convert.ConverterChanged(reason)

        self.assertEqual(len(self.run_on([], each=changed)), 1)
        self.assertEqual(self.reasons_logged(reason), logged + 1)

    def test_logs_a_converter_crash_by_type_once_an_hour_and_converts_the_rest_of_the_page(self):
        crashing = self.old_document("<p>Crash text</p>")
        self.addCleanup(self.delete_document, crashing)
        [other] = self.old_documents(1)
        self.forget_logged(f"{crashing}: RuntimeError")
        page = [frappe._dict(node=crashing), frappe._dict(node=other)]
        since = frappe.utils.now_datetime()

        def crash_on_first(bundle, version, legacy, *args, **kwargs):
            if "Crash text" in (legacy["html"] or ""):
                raise RuntimeError(legacy["html"])

            return REAL_CONVERT(bundle, version, legacy, *args, **kwargs)

        def new_logs() -> list[str]:
            filters = {"method": "Collab conversion: writer did not run", "creation": (">=", since)}
            return frappe.get_all("Error Log", filters, pluck="error")

        with patch.object(convert, "convert", side_effect=crash_on_first):
            self.assertTrue(conversions.convert_page(writer_content.APP, page, time.monotonic() + 600))
            self.assertIsNotNone(log.find(writer_content.APP, other))
            self.assertEqual(self.records(crashing), ((None, None, None),))
            [logged] = new_logs()

            conversions.convert_page(writer_content.APP, page[:1], time.monotonic() + 600)

        self.assertIn("RuntimeError", logged)
        self.assertNotIn("Crash text", logged)
        self.assertEqual(new_logs(), [logged])

    def test_without_the_bundle_writes_nothing_and_logs_once_an_hour(self):
        reason = "no converter bundle of this version"
        self.forget_logged(reason)
        logged = self.reasons_logged(reason)
        [node] = self.old_documents(1)

        for stub in ({"return_value": False}, {"side_effect": checker.CheckerFailed("down")}):
            with patch.object(convert, "bundle_ready", **stub):
                self.assertEqual(self.run_on([node]), [])

        self.assertIsNone(log.find(writer_content.APP, node))
        self.assertEqual(self.records(node), ())
        self.assertEqual(self.reasons_logged(reason), logged + 1)

    def test_queues_one_conversion_job_for_each_app_with_a_converter(self):
        writer = spec_of(writer_content.APP)
        apps = {"writer": writer, "plain": dataclasses.replace(writer, conversion=None)}

        with patch.object(jobs, "editors", return_value=apps), patch.object(frappe, "enqueue") as enqueue:
            jobs.queue_conversion()

        [(_, queued)] = [(call.args, call.kwargs) for call in enqueue.call_args_list]
        self.assertEqual((queued["app"], queued["job_id"]), ("writer", "suite-convert-writer"))

    def test_queues_and_runs_no_conversion_while_the_app_is_off(self):
        frappe.get_cached_doc("Suite Collab Settings")
        self.addCleanup(frappe.clear_document_cache, "Suite Collab Settings", "Suite Collab Settings")
        row = frappe.db.get_value(
            "Suite Collab App",
            {"parent": "Suite Collab Settings", "parentfield": "apps", "app": writer_content.APP},
        )
        self.addCleanup(frappe.db.set_value, "Suite Collab App", row, "mode", "on")
        frappe.db.set_value("Suite Collab App", row, "mode", "off")
        with (
            patch.object(frappe, "enqueue") as enqueue,
            patch.object(conversions, "run_pending") as running,
        ):
            jobs.queue_conversion()
            jobs.convert_pending(writer_content.APP)

        enqueue.assert_not_called()
        running.assert_not_called()

    def test_starts_no_node_when_no_document_waits(self):
        writer = spec_of(writer_content.APP).conversion

        with (
            patch.object(convert, "pending_page", return_value=[]),
            patch.object(convert, "bundle_ready") as ready,
        ):
            conversions.run_pending(writer_content.APP, writer)

        ready.assert_not_called()

    def refused_for(self, reason: str, *patches) -> None:
        self.forget_logged(reason)
        logged = self.reasons_logged(reason)
        [node] = self.old_documents(1)

        with contextlib.ExitStack() as stack:
            for target, name, value in patches:
                stack.enter_context(patch.object(target, name, value))

            self.assertEqual(self.run_on([node]), [])

        self.assertIsNone(log.find(writer_content.APP, node))
        self.assertEqual(self.records(node), ())
        self.assertEqual(self.reasons_logged(reason), logged + 1)

    def test_converts_nothing_on_a_database_other_than_mariadb(self):
        self.refused_for("the database isn't MariaDB", (frappe.db, "db_type", "postgres"))

    def test_converts_nothing_and_raises_nothing_while_a_content_table_is_missing(self):
        tables = [name for name in frappe.db.get_tables(cached=False) if name != "__writer_content_copy"]
        missing = MagicMock(return_value=tables)

        self.refused_for("content table __writer_content_copy is missing", (frappe.db, "get_tables", missing))

    def test_converts_nothing_while_the_self_test_fails(self):
        mismatch = MagicMock(return_value="content_mismatch")

        self.refused_for(
            "the collaboration self-test fails: content_mismatch", (selftest, "compaction_check", mismatch)
        )

    def test_converts_nothing_under_another_pycrdt_version(self):
        self.refused_for(
            "the collaboration self-test fails: pycrdt 0.14.6, expected 0.14.8",
            (pycrdt, "__version__", "0.14.6"),
        )

    def test_runs_no_self_test_when_no_document_waits(self):
        writer = spec_of(writer_content.APP).conversion

        with (
            patch.object(convert, "pending_page", return_value=[]),
            patch.object(selftest, "compaction_check", wraps=selftest.compaction_check) as checking,
        ):
            conversions.run_pending(writer_content.APP, writer)

        checking.assert_not_called()

    def test_reads_a_refused_body_again_only_once_it_changes(self):
        [node] = self.old_documents(1)
        docname = self.docname_of(node)
        frappe.db.set_value("Writer Document", docname, "ycomments", old_comments(("c1", "world", [])))
        frappe.db.commit()
        self.run_on([node])
        self.assertEqual(self.records(node), (("check", "orphan", None),))

        self.assertNotIn(node, self.run_on([node]))

        frappe.db.set_value("Writer Document", docname, "html", "<p>Hello again</p>")
        frappe.db.commit()
        self.assertIn(node, self.run_on([node]))

    def test_reads_a_refused_body_once_after_a_save_that_leaves_it_alone(self):
        [node] = self.old_documents(1)
        docname = self.docname_of(node)
        frappe.db.set_value("Writer Document", docname, "ycomments", old_comments(("c1", "world", [])))
        frappe.db.commit()
        self.run_on([node])
        self.assertEqual(self.records(node), (("check", "orphan", None),))
        frappe.get_doc("Writer Document", docname).update_settings('{"x": 1}')
        frappe.db.commit()

        seen = self.run_on([node]) + self.run_on([node])

        self.assertEqual(seen.count(node), 1)
        version = spec_of(writer_content.APP).conversion.version
        first_page = convert.pending_page(writer_content.APP, version, None)
        self.assertNotIn(node, [row.node for row in first_page])

    def test_converts_a_refused_body_again_once_it_changes_after_its_check(self):
        [node] = self.old_documents(1)
        docname = self.docname_of(node)
        frappe.db.set_value("Writer Document", docname, "ycomments", old_comments(("c1", "world", [])))
        frappe.db.commit()
        self.run_on([node])
        frappe.get_doc("Writer Document", docname).update_settings('{"x": 1}')
        frappe.db.commit()
        self.run_on([node])
        frappe.db.set_value("Writer Document", docname, "html", "<p>Hello again</p>")
        frappe.db.commit()

        self.assertIn(node, self.run_on([node]))

        fingerprints = frappe.db.sql_list(
            "SELECT `fingerprint` FROM `__writer_content_conversion` WHERE `node` = %s", node
        )
        self.assertEqual(len(fingerprints), 2)
        self.assertIn(conversion.read_fingerprint(node), fingerprints)

    def test_converts_a_body_saved_while_a_check_reads_the_one_before_it(self):
        [node] = self.old_documents(1)
        docname = self.docname_of(node)
        frappe.db.set_value("Writer Document", docname, "ycomments", old_comments(("c1", "world", [])))
        frappe.db.commit()
        self.run_on([node])
        frappe.get_doc("Writer Document", docname).update_settings('{"x": 1}')
        frappe.db.commit()
        before_save = conversion.read_old(node)
        frappe.db.set_value("Writer Document", docname, "html", "<p>Hello again</p>")
        frappe.db.commit()
        editor = writer_content.EDITOR
        from_snapshot = dataclasses.replace(editor.conversion, read_old=lambda node, lock=False: before_save)
        with patch.object(writer_content, "EDITOR", dataclasses.replace(editor, conversion=from_snapshot)):
            self.assertIsNone(conversions.convert_document(writer_content.APP, node))

        self.assertIn(node, self.run_on([node]))

    def test_takes_both_rows_of_a_refused_node_off_the_page_after_one_check(self):
        [node] = self.old_documents(1)
        docname = self.docname_of(node)
        frappe.db.set_value("Writer Document", docname, "ycomments", old_comments(("c1", "world", [])))
        frappe.db.commit()
        self.run_on([node])
        twin = frappe.copy_doc(frappe.get_doc("Writer Document", docname))
        twin.name = "zz" + frappe.generate_hash(length=8)
        twin.creation = frappe.utils.add_days(frappe.utils.now_datetime(), 1)
        twin.modified = twin.creation
        twin.db_insert()
        frappe.db.commit()
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.delete, "Writer Document", twin.name)
        self.assertIn(node, self.run_on([node]))

        self.assertNotIn(node, self.run_on([node]))
