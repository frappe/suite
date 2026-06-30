import frappe
from frappe.model.document import Document


# Stable taxonomy of op_types — keep the list narrow so the UI can render
# meaningful summaries without a per-op switch statement.  Add to this set
# rather than inventing new values at the call site.
VALID_OP_TYPES = {
	# ── Lifecycle (written by versioning.save) ─────────────────────────
	"create",        # initial save when a new Sheet is inserted
	"save",          # subsequent save events advancing the head pointer
	"restore",       # non-destructive restore of a snapshot
	# ── User actions ───────────────────────────────────────────────────
	"edit",          # single-cell typed edit
	"paste",         # paste from clipboard (internal or external)
	"fill",          # drag-fill / fill series
	"import",        # CSV/XLSX import
	"find-replace",  # bulk find & replace
	"delete",        # delete row(s) / col(s)
	"insert",        # insert row(s) / col(s)
	"format",        # formatting (excluded from cell-history per spec)
	"sort",
	"filter",
	"merge",
	"unmerge",
	"resize",
	"freeze",
	"hide",
	"unhide",
	"sheet",         # add/rename/delete/duplicate/reorder sheets
	"validation",
	"comment",
	"cond-format",
	"chart",         # chart add / edit / move / resize / delete
	"ai_assist",     # cells written by an accepted AI Assist action plan
}


class SheetOpLog(Document):
	# begin: auto-generated types
	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		actor: DF.Link | None
		after_json: DF.LongText | None
		before_json: DF.LongText | None
		cell_refs: DF.LongText | None
		op_type: DF.Data
		seq: DF.Int
		sheet: DF.Link
		sub_sheet: DF.Data | None
		summary: DF.Data | None
	# end: auto-generated types

	def validate(self):
		if self.op_type not in VALID_OP_TYPES:
			frappe.throw(f"Unknown op_type: {self.op_type}")
