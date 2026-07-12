# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

# import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestSieveScript(IntegrationTestCase):
	"""
	Integration tests for SieveScript.
	Use this class for testing interactions between multiple components.
	"""

	def test_sender_match_condition(self):
		from suite.mail.doctype.sieve_script.sieve_script import _sender_match_condition

		# A plain email matches the full From address.
		self.assertEqual(
			_sender_match_condition("john@example.com"),
			'address :is "from" "john@example.com"',
		)
		# A '@domain' entry matches every sender from that domain via the :domain address part.
		self.assertEqual(
			_sender_match_condition("@example.com"),
			'address :domain :is "from" "example.com"',
		)
		# Blank / bare '@' values produce no condition.
		self.assertIsNone(_sender_match_condition(""))
		self.assertIsNone(_sender_match_condition("   "))
		self.assertIsNone(_sender_match_condition("@"))

	def test_build_screening_block_with_domain(self):
		from suite.mail.doctype.sieve_script.sieve_script import _build_screening_block

		# A mix of an address and a domain OR-es both address tests inside a single anyof block.
		block = _build_screening_block(
			"Rejected Emails", ["spammer@bad.com", "@bad-domain.io"], ["  discard;", "  stop;"]
		)
		self.assertIn('address :is "from" "spammer@bad.com"', block)
		self.assertIn('address :domain :is "from" "bad-domain.io"', block)
		self.assertIn("if anyof (", block)
		self.assertIn("# Rejected Emails", block)

	def test_remove_sieve_block_removes_multi_stop_block(self):
		from suite.mail.doctype.sieve_script.sieve_script import remove_sieve_block

		# The Screening gate is an if/elsif block with two `stop;` statements; removal must strip the
		# whole thing, not just up to the first `stop;`.
		script = (
			'require ["fileinto"];\n\n'
			"# Screening\n"
			'if address :is "from" "boss@work.com" {\n'
			'  fileinto "INBOX";\n'
			"  stop;\n"
			"}\n"
			'elsif not spamtest :value "ge" :comparator "i;ascii-numeric" "2" {\n'
			'  fileinto "Screener";\n'
			"  stop;\n"
			"}\n"
		)

		result = remove_sieve_block(script, "Screening")

		self.assertNotIn("# Screening", result)
		self.assertNotIn("elsif", result)
		self.assertNotIn("Screener", result)
		self.assertIn('require ["fileinto"];', result)

	def test_remove_sieve_block_preserves_following_block(self):
		from suite.mail.doctype.sieve_script.sieve_script import remove_sieve_block

		script = (
			"# Rejected Emails\n"
			'if address :is "from" "x@bad.com" {\n'
			"  discard;\n"
			"  stop;\n"
			"}\n\n"
			"# Mailbox: Work\n"
			'if address :is "from" "team@work.com" {\n'
			'  fileinto "Work";\n'
			"  stop;\n"
			"}\n"
		)

		result = remove_sieve_block(script, "Rejected Emails")

		self.assertNotIn("# Rejected Emails", result)
		self.assertNotIn("x@bad.com", result)
		self.assertIn("# Mailbox: Work", result)
		self.assertIn("team@work.com", result)
