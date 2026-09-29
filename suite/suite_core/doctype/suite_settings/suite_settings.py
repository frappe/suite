import frappe
from frappe import _
from frappe.model.document import Document

from suite.mail import suite_cloud
from suite.mail.utils import get_config
from suite.suite_core.utils import is_suite_cloud_configured


class SuiteSettings(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        contact_email: DF.Data | None
        is_onboarded: DF.Check
        site_api_key: DF.Data | None
        site_api_secret: DF.Password | None
        suite_cloud_url: DF.Data | None
        workspace_logo: DF.AttachImage | None
        workspace_name: DF.Data | None
    # end: auto-generated types

    def validate(self) -> None:
        if not frappe.flags.in_migrate:
            self.warn_about_plain_http()

    def warn_about_plain_http(self) -> None:
        """The site key travels with every request; over http it is readable on the way."""

        url = (self.suite_cloud_url or "").strip().lower()
        if url and not url.startswith("https://") and not frappe.conf.developer_mode:
            frappe.msgprint(
                _("Suite Cloud URL is not https: the site's API key would travel in the clear."),
                indicator="orange",
                alert=True,
            )

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

    @frappe.whitelist()
    def validate_suite_cloud_credentials(self) -> dict:
        """Pings Suite Cloud with the configured URL, key and secret and reports what it answered.

        Reads the effective configuration, so credentials written to the site config by Frappe
        Cloud are checked too; unsaved edits on the form are not.
        """

        frappe.only_for("System Manager")
        is_suite_cloud_configured(raise_exception=True)
        site = suite_cloud.get_client().call("site.ping")

        message = _("Connected to Suite Cloud as site {0} on cluster {1}.").format(
            frappe.bold(site.get("site")), frappe.bold(site.get("cluster") or site.get("jmap_url"))
        )
        indicator = "green"
        jmap_url = (site.get("jmap_url") or "").rstrip("/")
        server_url = (get_config("server_url") or "").rstrip("/")
        if jmap_url and jmap_url != server_url:
            message += "<br>" + _("Suite Cloud expects the JMAP URL {0}, but this site uses {1}.").format(
                frappe.bold(jmap_url), frappe.bold(server_url or _("none"))
            )
            indicator = "orange"
        frappe.msgprint(message, title=_("Suite Cloud"), indicator=indicator)
        return site
