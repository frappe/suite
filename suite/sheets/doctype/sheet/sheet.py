import json

import frappe
from frappe.model.document import Document

from suite.sheets.doctype.sheet.storage import (
	MAX_SHEETS_DATA_BYTES,
	decode_sheets_data,
	effective_size,
)

# Defence in depth — anything that bypasses the whitelisted API (Desk form,
# fixture import, future scripted insert) still gets these checks. The cap
# applies to the *uncompressed* workbook bytes; storage.py handles the
# envelope detection so we accept both compressed and legacy plain values.
MAX_TITLE_LEN = 280


class Sheet(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		sheets_data: DF.JSON | None
		title: DF.Data
	# end: auto-generated types

	def validate(self):
		title = (self.title or "").strip()
		if not title:
			frappe.throw("Title is required")
		self.title = title[:MAX_TITLE_LEN]

		if self.sheets_data:
			if not isinstance(self.sheets_data, str):
				frappe.throw("sheets_data must be a string")
			size = effective_size(self.sheets_data)
			if size > MAX_SHEETS_DATA_BYTES:
				limit_mb = MAX_SHEETS_DATA_BYTES // (1024 * 1024)
				size_mb = size / (1024 * 1024)
				frappe.throw(
					f"This spreadsheet is {size_mb:.1f} MB, over the {limit_mb} MB limit. "
					f"Remove some data or split it across multiple spreadsheets."
				)
			try:
				json.loads(decode_sheets_data(self.sheets_data))
			except (ValueError, TypeError):
				frappe.throw("sheets_data is not valid JSON")
