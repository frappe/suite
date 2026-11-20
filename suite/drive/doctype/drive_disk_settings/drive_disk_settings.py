# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

from suite.drive._core.previews import MAX_PREVIEW_SIZE, MIN_PREVIEW_SIZE, is_plausible_preview_size
from suite.drive._core.quota import site_quota_bytes
from suite.drive.webdav import ALLOWED_METHODS, parse_webdav_methods


class DriveDiskSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        default_personal_quota: DF.Int
        preview_size: DF.Int
        shared_quota: DF.Int
        webdav_allowed_methods: DF.SmallText | None
        webdav_enabled: DF.Check
    # end: auto-generated types

    def validate(self):
        self._validate_preview_size()
        self._validate_drive_quotas()
        self._validate_webdav_methods()

    def _validate_preview_size(self):
        if not is_plausible_preview_size(cint(self.preview_size)):
            frappe.throw(
                _("Preview size must be between {0} and {1} pixels").format(
                    MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE
                ),
                frappe.ValidationError,
            )

    def _validate_drive_quotas(self):
        # Validate both quotas even when a caller sets them as text before saving.
        self.set(
            "default_personal_quota",
            site_quota_bytes(self.get("default_personal_quota"), _("Default personal quota")),
        )
        self.set("shared_quota", site_quota_bytes(self.get("shared_quota"), _("Shared quota")))

    def _validate_webdav_methods(self):
        methods, unknown = parse_webdav_methods(self.webdav_allowed_methods)
        if unknown:
            frappe.throw(
                "Unsupported WebDAV method(s): {}. Valid methods are: {}".format(
                    ", ".join(unknown), ", ".join(ALLOWED_METHODS)
                ),
                frappe.ValidationError,
            )
        # store the canonical form, implied methods (OPTIONS, GET→HEAD) included
        self.webdav_allowed_methods = (
            ", ".join(methods) if self.webdav_allowed_methods and self.webdav_allowed_methods.strip() else ""
        )
