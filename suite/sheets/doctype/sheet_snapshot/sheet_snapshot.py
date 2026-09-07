"""Sheet Snapshot — checkpointed full-state captures of a Sheet at a given op-log seq.

A snapshot is *derived* state: deleting one is non-destructive because the
canonical history lives in `Sheet Op Log`. Snapshots exist to bound the cost
of reconstructing past state and to anchor user-facing restore points.

Lifecycle is owned by the versioning module (`suite.sheets.versioning`),
not by Desk forms — the controller is intentionally minimal.
"""

import frappe
from frappe.model.document import Document


class SheetSnapshot(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        actor: DF.Link | None
        byte_size: DF.Int
        kind: DF.Literal["auto", "milestone", "named"]
        label: DF.Data | None
        op_count: DF.Int
        pinned: DF.Check
        seq: DF.Int
        sheet: DF.Link
        sheets_data: DF.JSON | None
    # end: auto-generated types

    def validate(self):
        self._refuse_linked_parent()
        if self.kind not in {"auto", "milestone", "named"}:
            frappe.throw(f"Unknown snapshot kind: {self.kind}")
        if self.kind == "named" and not (self.label or "").strip():
            frappe.throw("Named snapshots require a label")
        if self.seq is None or self.seq < 0:
            frappe.throw("seq must be non-negative")

    def on_trash(self):
        self._refuse_linked_parent()

    def _refuse_linked_parent(self):
        from suite.sheets.drive import refuse_drive_native

        refuse_drive_native(self.sheet, "Drive version history")
