from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.composition.tests.http_conformance import HttpConformanceMixin
from suite.slides.http import routes
from suite.slides.http.framework import HTTP


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP


class TestAgentGuide(IntegrationTestCase):
    def test_a_guest_reads_the_guide_as_markdown_with_this_sites_address(self):
        frappe.set_user("Guest")
        self.addCleanup(frappe.set_user, "Administrator")
        # Frappe's own gate, which refuses a guest a handler that needs a token
        frappe.is_whitelisted(routes.agent_guide)

        with patch.dict(frappe.local.conf, {"host_name": "https://agents.example.test"}):
            answer = routes.agent_guide()

        self.assertEqual(answer.status_code, 200)
        self.assertEqual(answer.mimetype, "text/markdown")
        self.assertIn("SITE=https://agents.example.test\n", answer.get_data(as_text=True))
