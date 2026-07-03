# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

# import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestScreenedEmailAddress(IntegrationTestCase):
	"""
	Integration tests for ScreenedEmailAddress.
	Use this class for testing interactions between multiple components.
	"""

	def test_normalize_screened_value(self):
		from suite.mail.utils.validation import normalize_screened_value

		# Trims whitespace and leaves a plain email address untouched.
		self.assertEqual(normalize_screened_value("  john@example.com  "), "john@example.com")
		# Lowercases the domain of a '@domain' entry so it collapses to a single rule.
		self.assertEqual(normalize_screened_value("@Frappe.io"), "@frappe.io")
		self.assertEqual(normalize_screened_value(" @Example.COM "), "@example.com")

	def test_validate_screened_value(self):
		from suite.mail.utils.validation import validate_screened_value

		# Valid: full email addresses and '@domain' entries.
		self.assertTrue(validate_screened_value("john@example.com"))
		self.assertTrue(validate_screened_value("@example.com"))
		self.assertTrue(validate_screened_value("@sub.example.co.uk"))

		# Invalid: bare domains, bare '@', local parts, and blanks.
		self.assertFalse(validate_screened_value("example.com"))
		self.assertFalse(validate_screened_value("@"))
		self.assertFalse(validate_screened_value("@example"))
		self.assertFalse(validate_screened_value("john"))
		self.assertFalse(validate_screened_value(""))
