# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class MeetSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        allow_guest: DF.Check
        codec_strategy: DF.Literal["svc", "simulcast"]
        enable_recording: DF.Check
    # end: auto-generated types

    pass
