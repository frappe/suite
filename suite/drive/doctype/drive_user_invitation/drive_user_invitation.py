# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, get_datetime, now, validate_email_address

from suite.suite_core.flips import flip_is_on

EXPIRY_DAYS = 1
# Where an accepted Suite invitation lands (`suite.api.account.invite_users`).
# The composition redirect table sends it on to `/home`.
SUITE_LANDING = "/suite"


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

        frappe.sendmail(
            recipients=self.email,
            subject="Frappe Drive - Invitation",
            template="drive_invitation",
            args={
                "invite_link": frappe.utils.get_url(
                    f"/api/method/suite.drive.api.product.accept_invite?key={self.name}"
                ),
                "user": frappe.session.user,
            },
            inline_images=drive_logo_inline_images(),
            now=True,
        )

    def accept(self, redirect=True):
        if self.status not in ["Pending", "Automatic"]:
            frappe.throw("This key has already been used")
        if self.status == "Expired" or self.has_expired():
            self.status = "Expired"
            self.save(ignore_permissions=True)
            frappe.db.commit()
            frappe.throw("Invalid or expired key")

        if flip_is_on("suite_flip_files"):
            return self._accept_as_suite_invitation(redirect)

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

    def _accept_as_suite_invitation(self, redirect=True) -> str:
        """Accept the way a Suite invitation is accepted (unified frontend §14.6).

        With `suite_flip_files` on, the new Drive area has no `/drive/signup`,
        so a legacy invitation takes the framework's `User Invitation` accept
        path instead: a System User with the roles a Suite invitation grants,
        a password set through `/update-password`, and a landing on `/suite`.
        A `redirect` target from an old share email is not honoured; the
        landing is the Suite one.
        """
        user = self._upsert_suite_user()
        self.status = "Accepted"
        self.accepted_at = frappe.utils.now()
        self.save(ignore_permissions=True)

        should_update_password = not user.last_password_reset_date and not bool(
            frappe.get_system_settings("disable_user_pass_login")
        )
        location = frappe.utils.get_url(SUITE_LANDING)
        if should_update_password:
            location = f"{user._reset_password()}&redirect_to={SUITE_LANDING}"
        # GET requests do not commit on their own
        frappe.db.commit()
        if not should_update_password:
            frappe.local.login_manager.login_as(self.email)

        if redirect:
            frappe.local.response["type"] = "redirect"
            frappe.local.response["location"] = location
        return location

    def _upsert_suite_user(self):
        """The invitee as `User Invitation._upsert_user` leaves them."""
        if frappe.db.exists("User", self.email):
            user = frappe.get_doc("User", self.email)
        else:
            user = frappe.new_doc("User")
            user.user_type = "System User"
            user.email = self.email
            user.first_name = self.email.split("@")[0].title()
            user.send_welcome_email = False
            user.insert(ignore_permissions=True)
        user.append_roles(*suite_invitation_roles())
        user.save(ignore_permissions=True)
        return user


def suite_invitation_roles() -> list[str]:
    """Every role the `user_invitation` hook lets a Suite invitation grant."""
    hook = frappe.get_hooks("user_invitation", app_name="suite")
    allowed = (hook if isinstance(hook, dict) else {}).get("allowed_roles") or {}
    return sorted({role for granted in allowed.values() for role in granted})
