"""A public file's redirect must reach the browser as `private`.

The requests go through Frappe's whole request path; only the file lookup is
replaced, with the answer Frappe gives for a file in object storage.
"""

from unittest import mock

from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client
from werkzeug.test import TestResponse
from werkzeug.utils import redirect
from werkzeug.wrappers import Response

SIGNED_LINK = "https://bucket.example.test/blob?X-Amz-Expires=3600"


def signed_redirect(path: str) -> Response:
    response = redirect(SIGNED_LINK, 302)
    response.headers["Cache-Control"] = "public, max-age=1800"
    return response


def file_bytes(path: str) -> Response:
    return Response(b"bytes", headers={"Cache-Control": "public, max-age=1800"})


def get(path: str) -> TestResponse:
    return make_request(target=get_test_client().open, args=(path,), kwargs={"method": "GET"})


class TestFileRedirectCaching(IntegrationTestCase):
    def test_public_file_redirect_leaves_as_private_with_its_max_age(self):
        with mock.patch("frappe.storage.serve.serve_public_file", signed_redirect):
            response = get("/files/blob/logo.png")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], SIGNED_LINK)
        self.assertEqual(response.headers["Cache-Control"], "private, max-age=1800")

    def test_public_file_served_directly_stays_public(self):
        with mock.patch("frappe.storage.serve.serve_public_file", file_bytes):
            response = get("/files/blob/logo.png")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "public, max-age=1800")

    def test_redirect_outside_public_files_keeps_its_header(self):
        with mock.patch("frappe.storage.serve.serve_private_file", signed_redirect):
            response = get("/private/files/blob/report.pdf")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Cache-Control"], "public, max-age=1800")
