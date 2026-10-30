# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, get_datetime, now, validate_email_address

from suite.suite_core import suite_email

EXPIRY_DAYS = 1


class DriveUserInvitation(Document):
    def has_expired(self):
        return get_datetime(self.creation) < get_datetime(add_days(now(), -EXPIRY_DAYS))

    def before_insert(self):
        validate_email_address(self.email, True)

    def after_insert(self):
        if self.status == "Pending":
            try:
                self.invite_via_email()
            except BaseException as e:
                frappe.log_error(f"Failed to send invite email: {e}")
                pass
        elif self.status == "Proposed":
            admins = frappe.get_all(
                "Has Role", filters={"role": "Suite Admin", "parenttype": "User"}, pluck="parent"
            )
            for admin in admins:
                frappe.get_doc(
                    {
                        "doctype": "Drive Notification",
                        "to_user": admin,
                        "type": "Site",
                        "message": f"A person ({self.email}) from your domain has joined Frappe Drive",
                    }
                ).insert(ignore_permissions=True)
            frappe.db.commit()

    def invite_via_email(self):
        from suite.drive.api.notifications import drive_logo_inline_images

        link = frappe.utils.get_url(f"/api/method/suite.drive.api.product.accept_invite?key={self.name}")
        suite_email.send(
            "drive-invite",
            self.email,
            {"inviter": frappe.utils.get_fullname(frappe.session.user), "link": link},
            local={
                "subject": "Frappe Drive - Invitation",
                "template": "drive_invitation",
                "args": {"invite_link": link, "user": frappe.session.user},
                "inline_images": drive_logo_inline_images(),
            },
        )

    def accept(self, redirect=True):
        if self.status not in ["Pending", "Automatic"]:
            frappe.throw("This key has already been used")
        if self.status == "Expired" or self.has_expired():
            self.status = "Expired"
            self.save(ignore_permissions=True)
            frappe.db.commit()
            frappe.throw("Invalid or expired key")

        exists = frappe.db.exists(
            "Account Request",
            {
                "email": self.email,
                "signed_up": 1,
            },
        )

        if redirect:
            frappe.local.response["type"] = "redirect"

        if not exists:
            # If the user does not have an account, redirect to sign up
            req = frappe.get_doc(
                {
                    "doctype": "Account Request",
                    "email": self.email,
                    "invite": self.name,
                    "login_count": 1,
                }
            ).insert(ignore_permissions=True)
            frappe.db.commit()
            user_exists = frappe.db.exists("User", self.email)

            if not user_exists:
                url = f"/drive/signup?e={self.email}&r={req.name}"
                if isinstance(redirect, str):
                    url += f"&redirect-to={redirect}"
                frappe.local.response["location"] = url
                return

        self.status = "Accepted"
        self.accepted_at = frappe.utils.now()
        self.save(ignore_permissions=True)
        frappe.db.commit()

        if frappe.session.user == "Guest":
            frappe.local.login_manager.login_as(self.email)

        frappe.local.response["location"] = "/drive/"
        return "/drive/"
