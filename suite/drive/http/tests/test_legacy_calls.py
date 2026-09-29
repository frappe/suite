"""The legacy-call counter: every legacy name, by name and user agent (§11.7).

Every case sends a whole request through Frappe's WSGI application, the way
`test_dispatch` does, so the counter sees the same request a released client
sends. A request only buffers its call; `legacy_calls.flush()` is what the
scheduler job runs, and each case runs it directly, so nothing here waits for
a worker.

Where a case only needs to know that a call was counted, dispatch is stubbed
out after the counter has run (`frappe.api.handle`, `frappe.handler.handle`).
That keeps 69 legacy bodies, some of them guest-callable and rate-limited, from
running for real.
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_datetime, get_test_client, now_datetime
from werkzeug.wrappers import Response

from suite.drive.http import legacy_calls, shims
from suite.tests.utils import ensure_user

DOCTYPE = "Drive Legacy Call"
AGENT_PREFIX = "suite-test/legacy-calls"
# What `FileUploader.vue` sends: it runs in the Desk page, so it is the browser.
DESK_PICKER = f"{AGENT_PREFIX} Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36"
WEBDAV_CLIENT = f"{AGENT_PREFIX} Microsoft-WebDAV-MiniRedir/10.0.19045"
SYSTEM_MANAGER = "drive-legacy-sm@example.com"
PLAIN_USER = "drive-legacy-user@example.com"
DOC_METHODS = ("overrides.file.File.share", "overrides.file.File.unshare", "overrides.file.File.rename")


class LegacyCallCase(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # Drain whatever earlier traffic left in the buffer, so a count below
        # is this case's own.
        legacy_calls.flush()
        self.agent = f"{AGENT_PREFIX} {frappe.generate_hash(length=10)}"
        self.addCleanup(self.drop_rows)

    def drop_rows(self):
        frappe.db.rollback()
        legacy_calls.flush()
        frappe.db.delete(DOCTYPE, {"user_agent": ["like", f"{AGENT_PREFIX}%"]})
        frappe.db.commit()

    def call(self, path, *, agent=None, method="GET", query=None, body=None):
        kwargs = {
            "method": method,
            "headers": {"User-Agent": agent or self.agent},
            "query_string": query or {},
        }
        if body is not None:
            kwargs["json"] = body
        return make_request(target=self.CLIENT.open, args=(path,), kwargs=kwargs)

    def counted(self, agent=None) -> dict:
        legacy_calls.flush()
        rows = frappe.get_all(
            DOCTYPE,
            filters={"user_agent": agent or self.agent},
            fields=["legacy_name", "user_agent", "count", "first_seen", "last_seen"],
        )
        return {row.legacy_name: row for row in rows}

    @contextmanager
    def no_dispatch(self):
        """Stop every request after `before_request`, where the counter runs."""
        with (
            patch("frappe.api.handle", return_value=Response("{}", content_type="application/json")),
            patch("frappe.handler.handle", return_value=None),
        ):
            yield


class TestEveryNameIsCounted(LegacyCallCase):
    def doc_method_spellings(self, method):
        """The four addresses Frappe answers a `File` document method on."""
        docname = "legacy-call-probe"
        return [
            ("GET", "/api/method/run_doc_method", {"dt": "File", "dn": docname, "method": method}, None),
            (
                "POST",
                "/api/v2/method/run_doc_method",
                None,
                {"method": method, "document": {"doctype": "File", "name": docname}},
            ),
            ("POST", f"/api/resource/File/{docname}", None, {"run_method": method}),
            ("POST", f"/api/v2/document/File/{docname}/method/{method}", None, {}),
        ]

    def test_the_counted_names_are_exactly_the_classified_names(self):
        with self.no_dispatch():
            for name in shims.CLASSIFICATION:
                if name in DOC_METHODS:
                    method = name.rsplit(".", 1)[1]
                    verb, path, query, body = self.doc_method_spellings(method)[0]
                    self.call(path, method=verb, query=query, body=body)
                else:
                    self.call(f"/api/method/suite.drive.{name}")
            # None of these is a legacy name, so none may become a row.
            self.call("/api/method/frappe.ping")
            self.call("/api/method/suite.drive.http.routes.node_get")
            self.call("/api/method/suite.drive.api.files.not_a_legacy_name")
            self.call("/api/method/run_doc_method", query={"dt": "File", "dn": "x", "method": "save"})
            self.call("/api/method/run_doc_method", query={"dt": "Note", "dn": "x", "method": "share"})

        counted = self.counted()
        self.assertEqual(set(counted), set(shims.CLASSIFICATION))
        self.assertEqual({row.count for row in counted.values()}, {1})

    def test_every_address_of_a_name_counts_under_that_one_name(self):
        name = "suite.drive.api.files.get_root_folder"
        with self.no_dispatch():
            self.call(f"/api/method/{name}")
            self.call(f"/api/v1/method/{name}")
            self.call(f"/api/v2/method/{name}", method="POST", body={})
            self.call("/", query={"cmd": name})
            for method in ("share", "unshare", "rename"):
                for verb, path, query, body in self.doc_method_spellings(method):
                    self.call(path, method=verb, query=query, body=body)
            self.call(
                "/api/method/run_doc_method",
                query={"docs": json.dumps({"doctype": "File", "name": "x"}), "method": "share"},
            )
            # v1 answers `run_method` on a GET of the document too.
            self.call("/api/resource/File/legacy-call-probe", query={"run_method": "share"})

        counted = self.counted()
        self.assertEqual(counted["api.files.get_root_folder"].count, 4)
        self.assertEqual(counted["overrides.file.File.share"].count, 6)
        self.assertEqual(counted["overrides.file.File.unshare"].count, 4)
        self.assertEqual(counted["overrides.file.File.rename"].count, 4)

    def test_a_verb_that_runs_no_method_is_not_counted(self):
        with self.no_dispatch():
            # PUT updates the document and DELETE deletes it; neither runs `share`.
            for verb in ("PUT", "DELETE"):
                self.call("/api/resource/File/x", method=verb, query={"run_method": "share"})
                self.call("/api/v2/document/File/x/method/share", method=verb)
                self.call(
                    "/api/v2/method/run_doc_method",
                    method=verb,
                    body={"method": "share", "document": {"doctype": "File"}},
                )
            # A CORS preflight is answered before any dispatch.
            self.call("/api/method/suite.drive.api.files.search", method="OPTIONS")
            self.call("/", method="OPTIONS", query={"cmd": "suite.drive.api.files.search"})
        self.assertEqual(self.counted(), {})


class TestWhatARowHolds(LegacyCallCase):
    def test_each_client_is_its_own_row_with_count_and_times(self):
        before = now_datetime().replace(microsecond=0)
        # A refused call is still a call: both of these answer 403 to a guest.
        for _ in range(2):
            self.call("/api/method/suite.drive.api.files.get_root_folder", agent=DESK_PICKER)
        self.call("/api/method/suite.drive.api.list.files", agent=WEBDAV_CLIENT)

        # The request only buffered its call. Nothing is stored until a flush.
        self.assertFalse(frappe.db.exists(DOCTYPE, {"user_agent": ["in", (DESK_PICKER, WEBDAV_CLIENT)]}))

        picker = self.counted(DESK_PICKER)
        webdav = self.counted(WEBDAV_CLIENT)
        self.assertEqual(list(picker), ["api.files.get_root_folder"])
        self.assertEqual(list(webdav), ["api.list.files"])
        self.assertEqual(picker["api.files.get_root_folder"].count, 2)
        self.assertEqual(webdav["api.list.files"].count, 1)

        row = picker["api.files.get_root_folder"]
        self.assertLessEqual(before, get_datetime(row.first_seen))
        self.assertLessEqual(get_datetime(row.first_seen), get_datetime(row.last_seen))
        self.assertLessEqual(get_datetime(row.last_seen), now_datetime())

        # A later flush adds to the same row and keeps when it was first seen.
        self.call("/api/method/suite.drive.api.files.get_root_folder", agent=DESK_PICKER)
        again = self.counted(DESK_PICKER)["api.files.get_root_folder"]
        self.assertEqual(again.count, 3)
        self.assertEqual(again.first_seen, row.first_seen)
        self.assertGreaterEqual(get_datetime(again.last_seen), get_datetime(row.last_seen))
        self.assertEqual(frappe.db.count(DOCTYPE, {"user_agent": DESK_PICKER}), 1)

    def test_a_long_user_agent_is_cut_to_a_fixed_length(self):
        long_agent = self.agent + " " + "x" * 400
        other_tail = self.agent + " " + "x" * 300 + "y" * 100
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.search", agent=long_agent)
            self.call("/api/method/suite.drive.api.files.search", agent=other_tail)

        cut = long_agent[: legacy_calls.USER_AGENT_LENGTH]
        self.assertEqual(legacy_calls.USER_AGENT_LENGTH, 255)
        row = self.counted(cut)["api.files.search"]
        self.assertEqual(row.user_agent, cut)
        self.assertEqual(row.count, 2)

    def test_a_call_with_no_user_agent_is_still_counted(self):
        anonymous = {"legacy_name": "api.storage.storage_bar_data", "user_agent": ["is", "not set"]}

        def calls() -> int:
            legacy_calls.flush()
            return sum(frappe.get_all(DOCTYPE, filters=anonymous, pluck="count"))

        before = calls()
        with self.no_dispatch():
            make_request(
                target=self.CLIENT.open,
                args=("/api/method/suite.drive.api.storage.storage_bar_data",),
                kwargs={"method": "GET", "headers": {"User-Agent": ""}},
            )
        self.assertEqual(calls(), before + 1)
        frappe.db.delete(DOCTYPE, anonymous)
        frappe.db.commit()

    def test_user_agents_past_the_cap_share_one_other_row_and_every_call_counts(self):
        name = "api.product.signup_disabled"
        self.addCleanup(self.forget_agents, name)
        self.forget_agents(name)
        with patch.object(legacy_calls, "AGENT_CAP", 3), self.no_dispatch():
            for i in range(5):
                self.call(f"/api/method/suite.drive.{name}", agent=f"{self.agent} {i}")
            legacy_calls.flush()
            self.assertEqual(
                self.calls_by_agent(name), {f"{self.agent} {i}": 1 for i in range(3)} | {"(other)": 2}
            )

            # Redis forgets which agents it saw. The table still holds the cap.
            frappe.cache.delete(legacy_calls._agents_key(name))
            for i in range(5, 7):
                self.call(f"/api/method/suite.drive.{name}", agent=f"{self.agent} {i}")
            legacy_calls.flush()
            self.assertEqual(
                self.calls_by_agent(name), {f"{self.agent} {i}": 1 for i in range(3)} | {"(other)": 4}
            )

    def calls_by_agent(self, name) -> dict:
        rows = frappe.get_all(DOCTYPE, filters={"legacy_name": name}, fields=["user_agent", "count"])
        return {
            row.user_agent: row.count
            for row in rows
            if row.user_agent.startswith(self.agent) or row.user_agent == "(other)"
        }

    def forget_agents(self, name):
        frappe.cache.delete(legacy_calls._agents_key(name))
        frappe.db.delete(DOCTYPE, {"legacy_name": name, "user_agent": "(other)"})
        frappe.db.commit()


class TestNoCallIsLost(LegacyCallCase):
    """An overcount is tolerable; an undercount would fake a zero."""

    def test_a_flush_that_dies_before_its_commit_loses_no_call(self):
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.rename")
            self.call("/api/method/suite.drive.api.files.move")
        stored = legacy_calls._store
        calls = []

        def dies_on_the_second_row(*args):
            calls.append(args)
            if len(calls) == 2:
                raise SystemExit("worker killed")
            stored(*args)

        with patch.object(legacy_calls, "_store", side_effect=dies_on_the_second_row):
            with self.assertRaises(SystemExit):
                legacy_calls.flush()
        frappe.db.rollback()  # what the dead worker's connection does
        self.assertFalse(frappe.db.exists(DOCTYPE, {"user_agent": self.agent}))

        # A call that lands after the failed flush is counted alongside it.
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.rename")
        counted = self.counted()
        self.assertEqual(counted["api.files.rename"].count, 2)
        self.assertEqual(counted["api.files.move"].count, 1)

        # The leftover batch was stored once, not again on the next flush.
        self.assertEqual(legacy_calls.flush(), 0)
        self.assertEqual(self.counted()["api.files.rename"].count, 2)

    def test_flushes_and_reads_take_turns(self):
        """The scheduler's flush and the command's flush-then-read hold one lock.

        So the command never reads while another flush holds a batch in flight
        and has not committed it.
        """
        for step in (legacy_calls.flush, legacy_calls.rows):
            with self.subTest(step=step.__name__):
                with self.no_dispatch():
                    self.call("/api/method/suite.drive.api.files.move")
                held = legacy_calls._lock()
                self.assertTrue(held.acquire(blocking=False))
                threading.Timer(0.5, held.release).start()
                started = time.monotonic()
                step()
                self.assertGreaterEqual(time.monotonic() - started, 0.45)
        self.assertEqual(self.counted()["api.files.move"].count, 2)

    def test_a_counter_fault_never_fails_the_call(self):
        with (
            patch.object(legacy_calls, "_buffer", side_effect=ConnectionError("redis gone")),
            patch("frappe.log_error", side_effect=RuntimeError("logging broke too")),
            self.no_dispatch(),
        ):
            response = self.call("/api/method/suite.drive.api.files.move")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_a_path_that_names_no_legacy_call_does_not_load_the_shims(self):
        probe = (
            "import sys\n"
            "from suite.drive.http import legacy_calls\n"
            "for path in ('/api/method/frappe.ping', '/api/suite/drive/nodes/x', '/app/file'):\n"
            "    assert legacy_calls.legacy_name('GET', path, {}) is None, path\n"
            "assert 'suite.drive.http.shims' not in sys.modules\n"
            "assert legacy_calls.legacy_name('GET', '/api/method/suite.drive.api.files.move', {}) == 'api.files.move'\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe], capture_output=True, text=True, env=os.environ, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)


class TestTheReport(LegacyCallCase):
    def test_the_report_lists_every_row_newest_first_and_totals_them(self):
        older = f"{self.agent} older"
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.move", agent=older)
        self.counted(older)
        # Datetime columns keep microseconds, but make the order unmistakable.
        frappe.db.set_value(
            DOCTYPE, {"user_agent": older}, "last_seen", "2026-01-01 00:00:00", update_modified=False
        )
        frappe.db.commit()
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.move")
            self.call("/api/method/suite.drive.api.files.move")

        text = legacy_calls.report()
        lines = text.splitlines()
        newer_line = next(i for i, line in enumerate(lines) if self.agent in line and "older" not in line)
        older_line = next(i for i, line in enumerate(lines) if older in line)
        self.assertLess(newer_line, older_line)
        self.assertIn("api.files.move", lines[newer_line])
        self.assertRegex(lines[newer_line], r"\b2\b")

        rows = frappe.get_all(DOCTYPE, fields=["legacy_name", "count"])
        calls = sum(row.count for row in rows)
        names = len({row.legacy_name for row in rows})
        self.assertEqual(lines[-1], f"total: {calls} calls over {names} names")

        payload = json.loads(legacy_calls.report(as_json=True))
        self.assertEqual(payload["total"], {"calls": calls, "names": names})
        mine = [row for row in payload["rows"] if row["user_agent"] in (self.agent, older)]
        self.assertEqual([row["user_agent"] for row in mine], [self.agent, older])
        self.assertEqual(set(mine[0]), {"legacy_name", "user_agent", "count", "first_seen", "last_seen"})
        self.assertEqual(mine[0]["count"], 2)
        seen = [row["last_seen"] for row in payload["rows"]]
        self.assertEqual(seen, sorted(seen, reverse=True))

    def test_the_command_is_registered_with_bench(self):
        from frappe.utils.bench_helper import get_app_commands

        command = get_app_commands("suite").get("drive-legacy-calls")
        self.assertIsNotNone(command)
        self.assertEqual([param.name for param in command.params], ["as_json"])
        self.assertTrue(re.search(r"--json", " ".join(command.params[0].opts)))


class TestWhoMayReadIt(LegacyCallCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(SYSTEM_MANAGER)
        ensure_user(PLAIN_USER)
        frappe.get_doc("User", SYSTEM_MANAGER).add_roles("System Manager")
        frappe.db.commit()

    def test_a_system_manager_reads_and_nobody_writes(self):
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.search")
        self.counted()

        self.assertTrue(frappe.has_permission(DOCTYPE, "read", user=SYSTEM_MANAGER))
        frappe.set_user(SYSTEM_MANAGER)
        listed = frappe.get_list(DOCTYPE, filters={"user_agent": self.agent}, pluck="legacy_name")
        self.assertEqual(listed, ["api.files.search"])
        frappe.set_user("Administrator")

        for ptype in ("write", "create", "delete", "submit", "cancel", "amend", "import"):
            self.assertFalse(frappe.has_permission(DOCTYPE, ptype, user=SYSTEM_MANAGER), ptype)

        for ptype in ("read", "write", "create", "delete"):
            self.assertFalse(frappe.has_permission(DOCTYPE, ptype, user=PLAIN_USER), ptype)
        frappe.set_user(PLAIN_USER)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_list(DOCTYPE)
        frappe.set_user("Administrator")

        # No permission row, standard or custom, lets any role change a row.
        for perm in frappe.get_meta(DOCTYPE).permissions:
            for ptype in ("write", "create", "delete", "submit", "cancel", "amend", "import"):
                self.assertFalse(perm.get(ptype), f"{perm.role} {ptype}")

    def test_not_even_administrator_can_edit_add_or_delete_a_row(self):
        with self.no_dispatch():
            self.call("/api/method/suite.drive.api.files.search")
        self.counted()
        row = frappe.get_value(DOCTYPE, {"user_agent": self.agent}, "name")

        doc = frappe.get_doc(DOCTYPE, row)
        doc.count = 0
        with self.assertRaises(frappe.PermissionError):
            doc.save()
        with self.assertRaises(frappe.PermissionError):
            frappe.delete_doc(DOCTYPE, row)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc(
                {"doctype": DOCTYPE, "legacy_name": "api.files.move", "user_agent": self.agent, "count": 1}
            ).insert()
        frappe.db.rollback()

        token = self.administrator_token()
        path = f"/api/resource/{DOCTYPE}/{row}"
        headers = {"Authorization": f"token {token}", "User-Agent": self.agent}
        for verb, body in (("PUT", {"count": 0}), ("DELETE", None)):
            kwargs = {"method": verb, "headers": headers}
            if body is not None:
                kwargs["json"] = body
            response = make_request(target=self.CLIENT.open, args=(path,), kwargs=kwargs)
            self.assertEqual(response.status_code, 403, f"{verb} {response.get_data(as_text=True)}")
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(DOCTYPE, row, "count"), 1)

    def administrator_token(self) -> str:
        from frappe.core.doctype.user.user import generate_keys

        user = frappe.get_doc("User", "Administrator")
        if not user.api_key:
            generate_keys("Administrator")
            user.reload()
        secret = user.get_password("api_secret")
        frappe.db.commit()
        return f"{user.api_key}:{secret}"
