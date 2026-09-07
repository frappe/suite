# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from suite.drive._core.quota import site_quota_bytes
from suite.drive.webdav import ALLOWED_METHODS, parse_webdav_methods


class DriveDiskSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        aws_key: DF.Data | None
        aws_secret: DF.Password | None
        bucket: DF.Data | None
        default_personal_quota: DF.LongInt
        enabled: DF.Check
        endpoint_url: DF.Data | None
        flat: DF.Check
        preview_size: DF.Int
        quota: DF.Int
        root_folder: DF.Data | None
        signature_version: DF.Data | None
        shared_quota: DF.LongInt
        thumbnail_prefix: DF.Data | None
        webdav_allowed_methods: DF.SmallText | None
        webdav_enabled: DF.Check
    # end: auto-generated types

    def validate(self):
        # A mirrored tree on S3 means a folder move copies and deletes every object
        # under it, which times out on large folders.
        if self.enabled:
            self.flat = 1
        self._validate_drive_quotas()
        self._validate_webdav_methods()

    def _validate_drive_quotas(self):
        # Both quotas are `Long Int` on a Single, so a reloaded doc carries them as
        # text. Normalize to the integer the quota engine and the counters expect.
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

    def __getattribute__(self, attr):
        """
        We want explicit denial of , so require '/' at the DB level.
        However, this causes a lot of problems with `Path`, so override empty prefixes.
        """
        val = object.__getattribute__(self, attr)
        if attr == "root_folder":
            return val if val and val != "/" else ""
        return val
