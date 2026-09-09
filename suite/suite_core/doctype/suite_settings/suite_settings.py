from frappe.model.document import Document


class SuiteSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        is_onboarded: DF.Check
        workspace_logo: DF.AttachImage | None
        workspace_name: DF.Data | None
    # end: auto-generated types

    def on_update(self) -> None:
        before = self.get_doc_before_save()
        if before and (before.workspace_name or "") != (self.workspace_name or ""):
            from suite.mail.directory import push_workspace_name

            push_workspace_name(self.workspace_name)
