# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What the mail doctypes make of a call the JMAP layer refuses, and of a read it has to split."""

import unittest
from itertools import count
from unittest import mock

import frappe
import httpx
from jmap import AuthenticationError
from jmap.auth import BasicAuth
from jmap.capabilities.registry import UnsupportedMethodError
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail import jmap as suite_jmap
from suite.mail.doctype.address_book import address_book
from suite.mail.doctype.contact_card import contact_card
from suite.mail.doctype.mailbox import mailbox
from suite.mail.doctype.sieve_script import sieve_script
from suite.mail.doctype.vacation_response import vacation_response
from suite.mail.jmap import MailServerUnavailableError, SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
URNS = [
    CORE,
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:contacts",
    "urn:ietf:params:jmap:sieve",
    "urn:ietf:params:jmap:blob",
    "urn:ietf:params:jmap:vacationresponse",
]
ACCOUNT = "f7"
USER = "user@example.test"
SCRIPT = 'require ["fileinto"];\nkeep;\n'
DOCTYPES = (address_book, contact_card, mailbox, sieve_script, vacation_response)


def _server(
    core: dict | None = None, urns: list[str] = URNS, primary: bool = True, **account
) -> FakeJMAPServer:
    capabilities = {**{urn: {} for urn in urns}, CORE: core or {}}
    return FakeJMAPServer(
        capabilities=capabilities,
        accounts={
            ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": capabilities, **account}
        },
        primary_accounts=dict.fromkeys(urns, ACCOUNT) if primary else {},
    )


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


class _Doctypes(unittest.TestCase):
    """The doctypes, talking to `self.server` instead of the user's mail server."""

    def serve(self, server: FakeJMAPServer) -> None:
        self.server = server
        client = _client(server)
        for module in DOCTYPES:
            patcher = mock.patch.object(module, "get_account_client", return_value=client)
            patcher.start()
            self.addCleanup(patcher.stop)

        # What jmaplib said of a call it refused is noted in the log file, not shown to the user -
        # nor put in the Error Log, where a refusal a user can run into is no error.
        patcher = mock.patch.object(suite_jmap.frappe, "logger")
        self.noted = patcher.start().return_value.info
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(suite_jmap, "log_mail_error")
        self.logged = patcher.start()
        self.addCleanup(patcher.stop)

    def note(self) -> str:
        """What the refusal left in the log file."""

        self.logged.assert_not_called()
        return self.noted.call_args.args[0]

    def sent(self) -> list[str]:
        return [call[0] for request in self.server.requests for call in request["methodCalls"]]

    def refusal_of(self, write, *args, **kwargs) -> str:
        with self.assertRaises(frappe.ValidationError) as raised:
            write(*args, **kwargs)

        self.assertFalse([name for name in self.sent() if name.endswith(("/set", "/upload"))])
        return str(raised.exception)


class ReadOnlyAccount(_Doctypes):
    """An account the session marks read-only - one shared for reading - takes no write."""

    def setUp(self) -> None:
        self.serve(_server(isReadOnly=True))
        # What an update reads before it writes.
        script = {"id": "s1", "name": "bills", "blobId": "B1", "isActive": False}
        self.server.respond("SieveScript/get", {"state": "s", "list": [script], "notFound": []})
        self.server.respond("SieveScript/query", {"queryState": "q", "ids": [], "position": 0, "total": 0})
        self.server.respond(
            "VacationResponse/get",
            {"state": "v", "list": [{"id": "singleton", "isEnabled": False}], "notFound": []},
        )

    def assert_refused(self, write, *args, **kwargs) -> None:
        with self.assertRaises(frappe.ValidationError) as raised:
            write(*args, **kwargs)

        self.assertIn("read-only", str(raised.exception))
        self.assertFalse([name for name in self.sent() if name.endswith(("/set", "/upload"))])

    def test_a_mailbox_is_not_created(self):
        self.assert_refused(mailbox.add_mailbox, ACCOUNT, "Bills")

    def test_a_mailbox_is_not_updated(self):
        self.assert_refused(mailbox.update_mailbox, ACCOUNT, "m1", "Bills", parent="m2")

    def test_mailboxes_are_not_deleted(self):
        self.assert_refused(mailbox.delete_mailboxes, ACCOUNT, ["m1"])

    def test_a_mailbox_is_not_moved(self):
        mailboxes = [
            {"id": id, "name": id, "role": None, "sortOrder": order}
            for id, order in (("m1", 100), ("m2", 200))
        ]
        self.server.respond("Mailbox/get", {"state": "m", "list": mailboxes, "notFound": []})

        self.assert_refused(mailbox.update_mailbox_position, ACCOUNT, "m1", "m2")

    def test_address_books_are_not_deleted(self):
        self.assert_refused(address_book.delete_address_books, ACCOUNT, ["ab1"])

    def test_contact_cards_are_not_added_in_bulk(self):
        card = {"address_book_ids": ["ab1"], "full_name": "Asha Rao"}

        self.assert_refused(contact_card.bulk_add_contact_cards, ACCOUNT, [card])

    def test_contact_cards_are_not_filed_elsewhere(self):
        self.assert_refused(contact_card.contact_card_add_to_address_book, ACCOUNT, ["c1"], "ab1")

    def test_contact_cards_are_not_deleted(self):
        self.assert_refused(contact_card.delete_contact_cards, ACCOUNT, ["c1"])

    def test_an_address_book_is_not_created(self):
        self.assert_refused(address_book.add_address_book, ACCOUNT, "Suppliers")

    def test_an_address_book_is_not_updated(self):
        self.assert_refused(address_book.update_address_book, ACCOUNT, "ab1", "Suppliers")

    def test_a_contact_card_is_not_created(self):
        self.assert_refused(contact_card.add_contact_card, ACCOUNT, ["ab1"], "Asha Rao")

    def test_a_contact_card_is_not_updated(self):
        self.assert_refused(contact_card.update_contact_card, ACCOUNT, "c1", ["ab1"], "Asha Rao")

    def test_a_sieve_script_is_not_created(self):
        self.assert_refused(sieve_script.SieveScript._add_sieve_script, ACCOUNT, "bills", SCRIPT)

    def test_a_sieve_script_is_not_updated(self):
        self.assert_refused(sieve_script.SieveScript._update_sieve_script, ACCOUNT, "s1", "bills", SCRIPT)

    def test_a_sieve_script_is_not_deleted(self):
        self.assert_refused(sieve_script.SieveScript._delete_sieve_scripts, ACCOUNT, ["s1"])

    def test_a_vacation_response_is_not_updated(self):
        self.assert_refused(vacation_response.update_vacation_response, ACCOUNT, True, subject="Away")


class UnofferedCall(_Doctypes):
    """A call the session has no account or no capability for is refused in the user's words;
    what jmaplib says of it - account ids, method names, capability URNs - is for the log."""

    def test_a_write_to_an_account_the_session_does_not_name_says_so_plainly(self):
        self.serve(_server(primary=False))

        message = self.refusal_of(mailbox.add_mailbox, ACCOUNT, "Bills")

        self.assertIn("This account is not available on the mail server.", message)
        self.assertNotIn("accountId", message)
        self.assertIn("Mailbox/set needs an accountId", self.note())

    def test_a_method_the_session_does_not_provide_says_so_plainly(self):
        # jmaplib refuses the method where it is queued by name. No doctype queues one that
        # way, so this is the refusal itself, put through what the doctypes put theirs through.
        self.serve(_server(urns=[CORE, "urn:ietf:params:jmap:mail"]))
        client = mailbox.get_account_client(ACCOUNT)

        with self.assertRaises(UnsupportedMethodError) as refused, client.batch() as b:
            b.add("AddressBook/set", {"create": {"k1": {"name": "Suppliers"}}})
        message = suite_jmap.format_method_error(refused.exception)

        self.assertEqual(message, "The mail server does not support this action.")
        self.assertIn("AddressBook/set", self.note())
        self.assertEqual(self.sent(), [])

    def test_a_write_to_a_read_only_account_does_not_name_the_account(self):
        self.serve(_server(isReadOnly=True))

        message = self.refusal_of(mailbox.add_mailbox, ACCOUNT, "Bills")

        self.assertIn("This account is read-only.", message)
        self.assertNotIn(ACCOUNT, message)
        self.assertIn(ACCOUNT, self.note())


class NotARefusal(_Doctypes):
    """What is not the server or jmaplib refusing the call is not reported as one."""

    def setUp(self) -> None:
        self.serve(_server())

    def test_rejected_credentials_stay_an_authentication_error(self):
        self.server.quirks.scripted_failures = [httpx.Response(401)]

        with self.assertRaises(AuthenticationError):
            mailbox.add_mailbox(ACCOUNT, "Bills")

    def test_an_outage_stays_the_mail_server_being_unavailable(self):
        for failure in (httpx.Response(503), httpx.ReadTimeout("timed out")):
            with self.subTest(failure=failure):
                if isinstance(failure, httpx.Response):
                    self.server.quirks.scripted_failures = [failure]
                else:
                    self.server.intercept = mock.Mock(side_effect=failure)

                with self.assertRaises(MailServerUnavailableError):
                    mailbox.add_mailbox(ACCOUNT, "Bills")

                self.server.intercept = None


class PartlyRefused(_Doctypes):
    """A write the server takes for some objects and refuses for others."""

    def setUp(self) -> None:
        self.serve(_server())
        patcher = mock.patch.object(mailbox, "invalidate_jmap_mailboxes_cache")
        self.invalidated = patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_delete_refused_for_one_mailbox_still_drops_the_cached_list(self):
        refused = {"m2": {"type": "mailboxHasChild", "description": "The mailbox has children."}}
        self.server.respond("Mailbox/set", {"destroyed": ["m1"], "notDestroyed": refused})

        with self.assertRaisesRegex(frappe.ValidationError, "The mailbox has children."):
            mailbox.delete_mailboxes(ACCOUNT, ["m1", "m2"])

        self.invalidated.assert_called_once_with(ACCOUNT)

    def test_a_delete_refused_outright_still_drops_the_cached_list(self):
        self.server.fail("Mailbox/set", "serverFail", description="try again later")

        with self.assertRaisesRegex(frappe.ValidationError, "try again later"):
            mailbox.delete_mailboxes(ACCOUNT, ["m1"])

        self.invalidated.assert_called_once_with(ACCOUNT)

    def test_a_refused_move_still_drops_the_cached_list(self):
        mailboxes = [
            {"id": id, "name": id, "role": None, "sortOrder": order}
            for id, order in (("m1", 100), ("m2", 200))
        ]
        self.server.respond("Mailbox/get", {"state": "m", "list": mailboxes, "notFound": []})
        self.server.respond("Mailbox/set", {"notUpdated": {"m1": {"type": "forbidden"}}})

        with self.assertRaisesRegex(frappe.ValidationError, "forbidden"):
            mailbox.update_mailbox_position(ACCOUNT, "m1", "m2")

        self.invalidated.assert_called_once_with(ACCOUNT)

    def position(self, answer: dict) -> None:
        """Moves mailbox "m1" after "m2" on a server that answers the reorder with `answer`."""

        mailboxes = [
            {"id": id, "name": id, "role": None, "sortOrder": order}
            for id, order in (("m1", 100), ("m2", 200), ("m3", 201))
        ]
        self.server.respond("Mailbox/get", {"state": "m", "list": mailboxes, "notFound": []})
        self.server.respond("Mailbox/set", answer)

        mailbox.update_mailbox_position(ACCOUNT, "m1", "m2")

    def test_a_mailbox_refused_its_place_is_not_reported_moved_for_its_neighbours_sake(self):
        refused = {"m1": {"type": "forbidden", "description": "The mailbox cannot be moved."}}

        with self.assertRaisesRegex(frappe.ValidationError, "The mailbox cannot be moved."):
            self.position({"updated": {"m3": None}, "notUpdated": refused})

    def test_a_neighbour_left_out_of_place_by_its_refusal_is_not_reported_as_the_order_asked_for(self):
        # Making room renumbers m2, m1, m3 to 1000, 2000, 3000. Left at 201, m3 lists first.
        refused = {"m3": {"type": "forbidden", "description": "The mailbox cannot be moved."}}

        with self.assertRaisesRegex(frappe.ValidationError, "The mailbox cannot be moved."):
            self.position({"updated": {"m1": None, "m2": None}, "notUpdated": refused})

    def test_a_refused_neighbour_that_lists_where_it_would_have_is_only_logged(self):
        # Left at 200, m2 still lists before m1 at 2000 and m3 at 3000.
        refused = {"m2": {"type": "forbidden", "description": "The mailbox cannot be moved."}}

        with mock.patch.object(mailbox, "log_mail_error") as logged:
            self.position({"updated": {"m1": None, "m3": None}, "notUpdated": refused})

        self.assertIn("m2: The mailbox cannot be moved.", logged.call_args.args[1])

    def test_an_error_being_raised_is_not_replaced_by_a_cache_that_fails_to_drop(self):
        self.invalidated.side_effect = RuntimeError("the store is locked")
        self.server.fail("Mailbox/set", "serverFail", description="try again later")

        with (
            mock.patch.object(mailbox, "log_mail_error") as logged,
            self.assertRaisesRegex(frappe.ValidationError, "try again later"),
        ):
            mailbox.delete_mailboxes(ACCOUNT, ["m1"])

        self.assertIn("the store is locked", logged.call_args.args[1])

    def test_a_vacation_response_the_server_refuses_as_an_object_is_not_reported_saved(self):
        self.server.respond(
            "VacationResponse/get",
            {"state": "v", "list": [{"id": "singleton", "isEnabled": False}], "notFound": []},
        )
        self.server.respond("SieveScript/query", {"queryState": "q", "ids": [], "position": 0, "total": 0})
        refused = {"singleton": {"type": "invalidProperties", "description": "toDate is before fromDate."}}
        self.server.respond("VacationResponse/set", {"notUpdated": refused})

        with (
            mock.patch.object(vacation_response, "set_last_active_sieve_script_id") as remembered,
            self.assertRaisesRegex(frappe.ValidationError, "toDate is before fromDate."),
        ):
            vacation_response.update_vacation_response(ACCOUNT, True, subject="Away")

        remembered.assert_not_called()


class LargeRead(_Doctypes):
    """More ids than the server takes in one /get are read in several, whatever happens between."""

    def test_sieve_scripts_changing_mid_read_are_all_returned(self):
        self.serve(_server(core={"maxObjectsInGet": 2}))
        states = count()

        def get(arguments: dict, _server: FakeJMAPServer) -> dict:
            scripts = [{"id": id, "name": id, "blobId": None, "isActive": False} for id in arguments["ids"]]
            return {"state": f"s{next(states)}", "list": scripts, "notFound": []}

        self.server.handle("SieveScript/get", get)
        ids = ["s1", "s2", "s3", "s4", "s5"]

        scripts = sieve_script.SieveScript._get_sieve_scripts(ACCOUNT, ids)

        self.assertEqual([s["id"] for s in scripts], ids)
        asked = [call[1]["ids"] for request in self.server.requests for call in request["methodCalls"]]
        self.assertTrue(all(len(chunk) <= 2 for chunk in asked), asked)
