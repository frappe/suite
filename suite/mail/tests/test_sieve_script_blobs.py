# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""How a Sieve script's content reaches the server: in the request, or through the upload endpoint."""

import unittest
from unittest import mock

import frappe
import httpx
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy
from jmap.testing.fake import FakeJMAPServer

from suite.mail.doctype.sieve_script import sieve_script
from suite.mail.doctype.sieve_script.sieve_script import SCRIPT_BLOB, SieveScript, _script_blob
from suite.mail.jmap import SuiteJMAPClient

CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
SIEVE = "urn:ietf:params:jmap:sieve"
BLOB = "urn:ietf:params:jmap:blob"
ACCOUNT = "f7"
USER = "user@example.test"
SCRIPT = 'require ["fileinto"];\nif header :contains "subject" "invoice" { fileinto "Bills"; }\n'


def _server(with_blob: bool) -> FakeJMAPServer:
    urns = [CORE, MAIL, SIEVE] + ([BLOB] if with_blob else [])
    server = FakeJMAPServer(
        capabilities={urn: {} for urn in urns},
        accounts={
            ACCOUNT: {"name": USER, "isPersonal": True, "accountCapabilities": {urn: {} for urn in urns}}
        },
        primary_accounts=dict.fromkeys(urns, ACCOUNT),
    )
    server.respond("SieveScript/set", {"created": {"c1": {"id": "s1", "isActive": False}}})
    server.respond("SieveScript/validate", {"error": None})
    return server


def _client(server: FakeJMAPServer) -> SuiteJMAPClient:
    http = httpx.Client(auth=BasicAuth(USER, "pw"), **server.client_kwargs())
    return SuiteJMAPClient.connect(
        "https://jmap.example.com/.well-known/jmap",
        auth=BasicAuth(USER, "pw"),
        http=http,
        experimental=True,
        retry_policy=RetryPolicy(max_attempts=1),
    )


class ScriptBlobs(unittest.TestCase):
    def test_a_server_with_blob_management_takes_the_script_inside_the_request(self):
        server = _server(with_blob=True)
        client = _client(server)

        with client.batch() as b:
            blob_id, _upload = _script_blob(client, b, SCRIPT)
            b.sieve.sieve_script.set(create={"c1": {"name": "bills", "blobId": blob_id}})

        # One request: the upload, then the /set naming the blob it is about to create.
        (request,) = server.requests
        upload, create = request["methodCalls"][0], request["methodCalls"][1]
        self.assertEqual(upload[0], "Blob/upload")
        self.assertEqual(
            upload[1]["create"][SCRIPT_BLOB],
            {"data": [{"data:asText": SCRIPT}], "type": "application/sieve"},
        )
        self.assertEqual(create[0], "SieveScript/set")
        self.assertEqual(create[1]["create"]["c1"]["blobId"], f"#{SCRIPT_BLOB}")

    def test_a_method_argument_names_the_uploaded_blob_by_result_reference(self):
        server = _server(with_blob=True)
        client = _client(server)

        with client.batch() as b:
            blob_id, _upload = _script_blob(client, b, SCRIPT, argument=True)
            handle = b.sieve.sieve_script.validate(blob_id=blob_id)

        (request,) = server.requests
        upload, validate = request["methodCalls"][0], request["methodCalls"][1]
        self.assertEqual(validate[0], "SieveScript/validate")
        self.assertEqual(
            validate[1]["#blobId"],
            {"resultOf": upload[2], "name": "Blob/upload", "path": f"/created/{SCRIPT_BLOB}/id"},
        )
        self.assertIsNone(handle.result.error)

    def test_without_blob_management_the_script_goes_to_the_upload_endpoint_first(self):
        server = _server(with_blob=False)
        client = _client(server)

        with client.batch() as b:
            blob_id, _upload = _script_blob(client, b, SCRIPT)
            b.sieve.sieve_script.set(create={"c1": {"name": "bills", "blobId": blob_id}})

        # The blob exists before the request is sent, and the /set names its real id.
        (request,) = server.requests
        (create,) = request["methodCalls"]
        self.assertEqual(create[0], "SieveScript/set")
        self.assertEqual(create[1]["create"]["c1"]["blobId"], str(blob_id))
        self.assertFalse(str(blob_id).startswith("#"))
        self.assertEqual(server.blobs[str(blob_id)][0], SCRIPT.encode())


OVER_QUOTA = "The script would take the account over its storage quota."
UNRESOLVED = {"type": "invalidProperties", "properties": ["blobId"], "description": "Blob not found."}


def _refuse_upload(arguments: dict, _server: FakeJMAPServer) -> dict:
    refused = {key: {"type": "overQuota", "description": OVER_QUOTA} for key in arguments["create"]}
    return {"accountId": arguments["accountId"], "created": None, "notCreated": refused}


def _refuse_unresolved_blob(arguments: dict, _server: FakeJMAPServer) -> dict:
    """A SieveScript/set whose `#script` names a blob that was never created."""

    return {
        "accountId": arguments["accountId"],
        "notCreated": dict.fromkeys(arguments.get("create") or {}, UNRESOLVED),
        "notUpdated": dict.fromkeys(arguments.get("update") or {}, UNRESOLVED),
    }


class RefusedUpload(unittest.TestCase):
    """The user is told why the script could not be stored, not that a reference to it failed."""

    def setUp(self) -> None:
        self.server = _server(with_blob=True)
        self.server.handle("Blob/upload", _refuse_upload)
        self.server.handle("SieveScript/set", _refuse_unresolved_blob)
        script = {"id": "s1", "name": "bills", "blobId": "B0", "isActive": False}
        self.server.respond("SieveScript/get", {"state": "s", "list": [script], "notFound": []})

        patcher = mock.patch.object(sieve_script, "get_account_client", return_value=_client(self.server))
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_reports_the_upload(self, save, *args) -> None:
        with self.assertRaises(frappe.ValidationError) as raised:
            save(*args)

        self.assertIn(OVER_QUOTA, str(raised.exception))

    def test_creating_a_script(self):
        self.assert_reports_the_upload(SieveScript._add_sieve_script, ACCOUNT, "bills", SCRIPT)

    def test_updating_a_script(self):
        self.assert_reports_the_upload(SieveScript._update_sieve_script, ACCOUNT, "s1", "bills", SCRIPT)

    def test_validating_a_script(self):
        # Nothing is canned for the validate: its `blobId` points into an upload that created
        # nothing, and the server answers that with invalidResultReference.
        self.assert_reports_the_upload(SieveScript._validate_sieve_script, ACCOUNT, SCRIPT)

    def test_an_upload_the_server_would_not_run(self):
        self.server.fail("Blob/upload", "forbidden", description="Blob management is disabled.")

        with self.assertRaises(frappe.ValidationError) as raised:
            SieveScript._add_sieve_script(ACCOUNT, "bills", SCRIPT)

        self.assertIn("Blob management is disabled.", str(raised.exception))
