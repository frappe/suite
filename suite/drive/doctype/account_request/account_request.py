# Copyright (c) 2019, Frappe and contributors
# For license information, please see license.txt

from __future__ import annotations

import json

import frappe
from frappe.model.document import Document
from frappe.utils import random_string

from suite.drive.utils.users import get_country_info
from suite.suite_core import suite_email
from suite.utils import generate_otp


class AccountRequest(Document):
    def before_insert(self):
        self.request_key = random_string(32)

        self.ip_address = frappe.local.request_ip
        geo_location = get_country_info() or {}
        self.geo_location = json.dumps(geo_location, indent=1, sort_keys=True)
        self.state = geo_location.get("regionName")

    def validate(self):
        self.email = self.email.strip()

    def set_otp(self):
        self.otp = generate_otp(length=6)
        self.otp_generated_at = frappe.utils.now_datetime()
        self.save(ignore_permissions=True)

    def send_otp(self):
        suite_email.send(
            "drive-signup-code",
            self.email,
            {"code": self.otp},
            local={"subject": "Frappe Drive - OTP", "template": "otp", "args": {"otp": self.otp}},
        )

    @property
    def full_name(self):
        return " ".join(filter(None, [self.first_name, self.last_name]))
