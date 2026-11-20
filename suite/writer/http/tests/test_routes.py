import frappe
from frappe.tests import UnitTestCase

from suite.composition.tests.http_conformance import HttpConformanceMixin
from suite.writer.http.framework import HTTP


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP
