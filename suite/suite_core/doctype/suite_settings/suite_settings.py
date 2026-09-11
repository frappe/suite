import frappe
from frappe.model.document import Document


class SuiteSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        contact_email: DF.Data | None
        is_onboarded: DF.Check
        workspace_logo: DF.AttachImage | None
        workspace_name: DF.Data | None
    # end: auto-generated types

    def on_update(self) -> None:
        """Suite Cloud shows the workspace name as the site's title and mails the contact address.

        The push runs after commit in the background: a slow or unreachable Suite Cloud must not
        hold up, or undo, an admin saving the settings.
        """

        changes = self._profile_changes()
        if changes:
            frappe.enqueue(
                "suite.mail.directory.push_site_profile",
                enqueue_after_commit=True,
                job_id="suite-site-profile",  # a burst of saves pushes the latest values once
                deduplicate=True,
                **changes,
            )

    def _profile_changes(self) -> dict[str, str]:
        before = self.get_doc_before_save()
        if not before:
            return {}
        changes = {}
        if (before.workspace_name or "") != (self.workspace_name or ""):
            changes["title"] = self.workspace_name or ""
        if (before.contact_email or "") != (self.contact_email or ""):
            changes["contact_email"] = self.contact_email or ""
        return changes
