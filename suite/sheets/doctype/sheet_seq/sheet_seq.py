"""Sheet Seq — per-sheet monotonic counter for op-log sequence numbers.

One row per sheet. Nothing allocates from it since the content layer keeps a
sheet's history; its rows stay for Drive's develop migration
(`suite.drive.patches.build`), which still reads them.
"""

import frappe
from frappe.model.document import Document


class SheetSeq(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        next_seq: DF.Int
        sheet: DF.Link
    # end: auto-generated types

    def validate(self):
        if self.next_seq is None or self.next_seq < 1:
            frappe.throw("next_seq must be >= 1")
