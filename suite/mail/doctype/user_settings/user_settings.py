# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
from datetime import UTC, datetime
from functools import cached_property
from urllib.parse import urljoin
from uuid import uuid7

import frappe
import httpx
from frappe import _
from frappe.model.document import Document
from jmap.auth import BasicAuth
from jmap.core.retry import RetryPolicy

from suite.mail.doctype.jmap_account.jmap_account import sync_jmap_accounts
from suite.mail.jmap import (
    DEFAULT_TIMEOUT,
    SuiteJMAPClient,
    clear_jmap_session,
    get_cached_session,
    store_cached_session,
    translated_errors,
)
from suite.mail.utils import get_config
from suite.mail.utils.dt import normalize_utc_z
from suite.utils.permissions import OwnerFromUser


class UserSettings(OwnerFromUser, Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        app_password: DF.Password | None
        backup_email: DF.Data | None
        color_scheme: DF.Literal["System Default", "Light Mode", "Dark Mode"]
        disable_push_subscriptions: DF.Check
        group_messages_by: DF.Literal["None", "Day", "Month"]
        show_reading_pane: DF.Check
        user: DF.Link
        username: DF.Data | None
    # end: auto-generated types

    @property
    def server_url(self) -> str | None:
        """Returns the server URL from the configuration."""

        config = get_config()
        return config.get("server_url")

    @cached_property
    def session(self) -> dict:
        """Returns the JMAP session for the user."""

        return get_cached_session(self.user) or {}

    @property
    def session_state(self) -> str | None:
        """Returns the state of the JMAP session for the user."""

        return self.session.get("state")

    @property
    def session_last_update(self) -> str | None:
        """Returns the last update timestamp of the JMAP session for the user, in UTC ``...Z``."""

        timestamp = self.session.get("timestamp")
        if timestamp:
            return normalize_utc_z(datetime.fromtimestamp(timestamp, tz=UTC))

    @property
    def jmap_session(self) -> str:
        """Returns the JMAP session for the user as a JSON string."""

        return json.dumps(self.session, indent=4)

    @cached_property
    def client(self) -> SuiteJMAPClient | None:
        """Returns an authenticated JMAP client for the user's credentials, or None when they
        don't work. Connecting fetches a fresh session, which is cached for later requests."""

        if not (self.username and self.get_password("app_password")):
            return None

        server_url, verify_ssl = get_config(("server_url", "verify_ssl"))
        auth = BasicAuth(self.username, self.get_password("app_password"))
        connect_timeout, read_timeout = DEFAULT_TIMEOUT
        http = httpx.Client(
            follow_redirects=True,
            auth=auth,
            verify=bool(verify_ssl),
            timeout=httpx.Timeout(
                connect=connect_timeout, read=read_timeout, write=read_timeout, pool=connect_timeout
            ),
        )

        try:
            with translated_errors():
                client = SuiteJMAPClient.connect(
                    urljoin(server_url, "/.well-known/jmap"),
                    auth=auth,
                    http=http,
                    experimental=True,
                    retry_policy=RetryPolicy(max_attempts=1),
                )
        except Exception:
            http.close()
            return None

        client.user = self.user
        store_cached_session(self.user, client.session)
        return client

    def autoname(self) -> None:
        self.name = str(uuid7())

    def validate(self) -> None:
        if not self.username or frappe.flags.in_migrate:
            return

        self.validate_jmap_settings()

    def on_update(self) -> None:
        if client := self.client:
            sync_jmap_accounts(self.user, client.session.raw.get("accounts") or {})

    def validate_jmap_settings(self) -> None:
        """Validate the JMAP settings by connecting to the JMAP server."""

        if not self.username or self.flags.skip_jmap_validation:
            return

        if not self.get_password("app_password"):
            frappe.throw(_("App Password is required to validate JMAP settings."))

        if not self.client:
            frappe.throw(
                _(
                    "Unable to connect to the JMAP server with the provided username and app password. Please check your settings."
                )
            )

    @frappe.whitelist()
    def clear_jmap_session(self) -> None:
        """Clears the JMAP session for the user."""

        clear_jmap_session(self.user)

    @frappe.whitelist()
    def show_app_password(self) -> str:
        """Returns the app password of the user."""

        frappe.only_for("Administrator")
        return self.get_password("app_password")

    def _db_set(
        self,
        update_modified: bool = True,
        commit: bool = False,
        notify: bool = False,
        **kwargs,
    ) -> None:
        """Updates the document with the given key-value pairs."""

        self.db_set(kwargs, update_modified=update_modified, notify=notify, commit=commit)
