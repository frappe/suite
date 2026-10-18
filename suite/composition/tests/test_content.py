import frappe
from frappe.tests import UnitTestCase

from suite.composition.content import HTTP
from suite.composition.tests.http_conformance import HttpConformanceMixin


def setUpModule():
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


class TestHttpConformance(HttpConformanceMixin, UnitTestCase):
    HTTP = HTTP
