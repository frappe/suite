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
        """Suite Cloud shows the workspace name as the site's title and mails the contact address."""

        before = self.get_doc_before_save()
        if not before:
            return
        changes = {}
        if (before.workspace_name or "") != (self.workspace_name or ""):
            changes["title"] = self.workspace_name or ""
        if (before.contact_email or "") != (self.contact_email or ""):
            changes["contact_email"] = self.contact_email or ""
        if changes:
            from suite.mail.directory import push_site_profile

            push_site_profile(**changes)
