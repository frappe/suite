# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class MailClientConfiguration(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		connection_security: DF.Literal["SSL/TLS", "STARTTLS", "None"]
		hostname: DF.Data
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		port: DF.Int
		protocol: DF.Literal["SMTP", "IMAP", "POP3"]
	# end: auto-generated types

	pass
