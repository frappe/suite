from datetime import datetime
from email.utils import parsedate_to_datetime as parsedate

import frappe
from frappe import _
from frappe.utils import convert_utc_to_system_timezone


def parsedate_to_datetime(date_header: str) -> "datetime":
	"""Returns datetime object from parsed date header."""

	utc_dt = parsedate(date_header)
	if not utc_dt:
		frappe.throw(_("Invalid date format: {0}").format(date_header))

	return convert_utc_to_system_timezone(utc_dt)
