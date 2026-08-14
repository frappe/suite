# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import itertools
import secrets
import time
import unittest
from contextlib import contextmanager
from urllib.parse import urljoin

import frappe
import requests
from frappe.tests import IntegrationTestCase

from suite.mail.jmap import SuiteJMAPClient
from suite.mail.stalwart.connection import MANAGEMENT_SESSION_CACHE_KEY
from suite.mail.utils import get_config, is_stalwart_configured

# Names embed a fresh per-run token: Stalwart state never rolls back with the test database, and
# deleted accounts reuse ids on recreation (see stalwart/connection.py), so nothing created by a
# test may ever collide with earlier runs against the same server. Cleanup stays best-effort.
_RUN_ID = secrets.token_hex(3)
_counter = itertools.count(1)

_stalwart_probe: bool | None = None


def unique_name(prefix: str = "user") -> str:
    """Returns a name that is unique across runs, e.g. ``t1a2b3c-user-1``."""

    return f"t{_RUN_ID}-{prefix}-{next(_counter)}"


def clear_mail_caches() -> None:
    """Drops every cache through which a test could see a stale Stalwart config or session."""

    frappe.local.request_cache.clear()  # get_config, get_management_connection, get_jmap_client
    frappe.cache.delete_value(MANAGEMENT_SESSION_CACHE_KEY)
    frappe.cache.delete_value("jmap:sessions")

    from suite.mail import stalwart

    stalwart.get_domains.clear_cache()
    stalwart.get_roles.clear_cache()


def _stalwart_available() -> bool:
    """Whether a Stalwart server is configured and reachable (probed once per run).

    Not configured means skip: developers without Stalwart still get a green run. Configured but
    unreachable raises instead - config declares intent, and silent skips would let CI pass while
    testing nothing.
    """

    global _stalwart_probe
    if _stalwart_probe is None:
        if not is_stalwart_configured():
            _stalwart_probe = False
        else:
            server_url, verify_ssl = get_config(("server_url", "verify_ssl"))
            try:
                requests.get(urljoin(server_url, "/.well-known/jmap"), timeout=5, verify=bool(verify_ssl))
            except requests.RequestException as e:
                raise RuntimeError(f"Stalwart is configured at {server_url} but not reachable: {e}") from e
            _stalwart_probe = True

    return _stalwart_probe


class StalwartIntegrationTestCase(IntegrationTestCase):
    """Base class for tests that run against a live Stalwart server.

    Provides factories that provision domains, members, groups, mailing lists, and roles through
    the same admin APIs the dashboard uses, with unique-per-run names and best-effort Stalwart
    cleanup at class teardown. Skips the whole class when Stalwart is not configured.
    """

    @classmethod
    def setUpClass(cls) -> None:
        if not _stalwart_available():
            raise unittest.SkipTest("Stalwart is not configured for this site.")

        super().setUpClass()
        clear_mail_caches()

        cls._stalwart_cleanups = []
        # Registered after super(), so this runs before the class-level DB rollback and the
        # created Frappe documents are still around while Stalwart objects are torn down.
        cls.addClassCleanup(cls._run_stalwart_cleanups)

        cls.domain = cls.create_domain()

    @classmethod
    def _run_stalwart_cleanups(cls) -> None:
        for cleanup in reversed(cls._stalwart_cleanups):
            try:
                cleanup()
            except Exception:
                pass
        clear_mail_caches()

    # --- assertions/helpers -------------------------------------------------

    @staticmethod
    def wait_until(condition, timeout: float = 30, interval: float = 0.5, message: str | None = None):
        """Polls ``condition`` until it returns a truthy value (Stalwart indexes asynchronously)."""

        deadline = time.monotonic() + timeout
        while True:
            result = condition()
            if result:
                return result
            if time.monotonic() >= deadline:
                raise AssertionError(message or "Condition was not met within the timeout.")
            time.sleep(interval)

    @classmethod
    @contextmanager
    def mail_settings(cls, **overrides):
        """Temporarily changes Mail Settings, keeping get_config's request cache honest."""

        with cls.change_settings("Mail Settings", **overrides):
            frappe.local.request_cache.clear()
            try:
                yield
            finally:
                frappe.local.request_cache.clear()

    @classmethod
    def get_user_jmap_client(cls, user: str) -> SuiteJMAPClient:
        """Returns a per-user JMAP client (username + app password from User Settings)."""

        from suite.mail.jmap import get_jmap_client

        return get_jmap_client(user, ignore_permissions=True)

    @staticmethod
    def get_app_password(user: str) -> str:
        """Returns the user's decrypted Stalwart app password."""

        return frappe.get_doc("User Settings", {"user": user}).get_password("app_password")

    @staticmethod
    def stalwart_auth_ok(username: str, password: str) -> bool:
        """Whether ``username``/``password`` can open a JMAP session directly on Stalwart."""

        server_url, verify_ssl = get_config(("server_url", "verify_ssl"))
        response = requests.get(
            urljoin(server_url, "/.well-known/jmap"),
            auth=(username, password),
            timeout=10,
            verify=bool(verify_ssl),
        )
        return response.status_code == 200

    @staticmethod
    def personal_account(member: frappe._dict) -> str:
        """Returns the member's personal JMAP account id."""

        from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

        return get_user_personal_jmap_account(member.email, raise_exception=True)

    @classmethod
    def deliver_mail(cls, sender: frappe._dict, recipient: frappe._dict, subject: str | None = None) -> dict:
        """Sends a mail and waits until it lands in the recipient's inbox, returning the thread row."""

        subject = subject or f"Delivered {unique_name('subject')}"
        result = cls.send_mail(sender, recipient.email, subject=subject)
        assert result["status"] == "Submitted", result.get("error")

        def find_thread():
            return next((t for t in cls.get_inbox_threads(recipient) if t["subject"] == subject), None)

        return cls.wait_until(
            find_thread, timeout=60, message=f"Mail '{subject}' did not reach {recipient.email}."
        )

    @classmethod
    def disable_screening(cls, member: frappe._dict) -> None:
        """Turns off screening on the member's personal account so inbound mail hits the inbox.

        Personal accounts enable screening by default, which diverts mail from unknown senders
        into the Screening folder - tests asserting inbox delivery must opt out first.
        """

        from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

        with cls.set_user(member.email):
            account = get_user_personal_jmap_account(member.email, raise_exception=True)
            doc = frappe.get_doc("JMAP Account", account)
            if doc.enable_screening:
                doc.enable_screening = 0
                doc.save(ignore_permissions=True)

    @classmethod
    def get_inbox_threads(cls, member: frappe._dict) -> list[dict]:
        """Returns the member's inbox threads, acting as the member."""

        from suite.mail.api.mail import get_threads
        from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account
        from suite.mail.jmap import get_mailbox_id_by_role

        with cls.set_user(member.email):
            account = get_user_personal_jmap_account(member.email, raise_exception=True)
            inbox = get_mailbox_id_by_role(account, "inbox", raise_exception=True)
            threads, _mailbox = get_threads(account, inbox, limit=20)
            return threads

    @classmethod
    def send_mail(
        cls,
        sender: frappe._dict,
        to: str | list[str],
        subject: str | None = None,
        html_body: str = "<p>Integration test mail.</p>",
        **kwargs,
    ) -> dict:
        """Sends a mail from ``sender`` (a create_member result) and returns create_mail's result."""

        from suite.mail.api.mail import create_mail
        from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

        recipients = [to] if isinstance(to, str) else list(to)
        with cls.set_user(sender.email):
            account = get_user_personal_jmap_account(sender.email, raise_exception=True)
            return create_mail(
                account=account,
                from_email=sender.email,
                to=[{"email": email} for email in recipients],
                cc=kwargs.pop("cc", []),
                bcc=kwargs.pop("bcc", []),
                subject=subject or f"Test mail {unique_name('subject')}",
                html_body=html_body,
                **kwargs,
            )

    # --- factories ----------------------------------------------------------

    @classmethod
    def create_domain(cls, name: str | None = None) -> str:
        """Creates a domain on Stalwart and returns its name."""

        from suite.mail.api.admin import add_domain

        name = name or f"{unique_name('dom')}.example.test"
        with cls.set_user("Administrator"):
            domain_id = add_domain(name, description="Integration test domain")

        def cleanup(domain_id=domain_id):
            from suite.mail.stalwart import get_domain_service

            get_domain_service().delete(domain_id)

        cls._stalwart_cleanups.append(cleanup)
        return name

    @classmethod
    def create_member(
        cls,
        *,
        domain: str | None = None,
        is_admin: bool = False,
        send_invite: bool = False,
        first_name: str = "Test",
        last_name: str | None = "Member",
        password: str | None = None,
        **kwargs,
    ) -> frappe._dict:
        """Provisions a member end-to-end through the admin API and returns its details.

        With ``send_invite`` the account is completed the way an invited user would - via the
        request key as Guest - otherwise it is force-created like the dashboard's non-invite path.
        """

        from suite.mail.api.account import create_account as complete_signup
        from suite.mail.api.admin import add_member

        domain = domain or cls.domain
        username = unique_name("admin" if is_admin else "user")
        email = f"{username}@{domain}"
        password = password or f"Tst@{secrets.token_hex(8)}"
        backup_email = kwargs.pop("backup_email", f"{username}@backup.example.test")

        with cls.set_user("Administrator"):
            add_member(
                username=username,
                domain=domain,
                is_admin=is_admin,
                send_invite=send_invite,
                backup_email=backup_email,
                first_name=first_name,
                last_name=last_name,
                password=None if send_invite else password,
                **kwargs,
            )

        cls._stalwart_cleanups.append(lambda email=email: _delete_stalwart_account(email))

        request = frappe.get_last_doc("Mail Account Request", {"account": email})
        if send_invite:
            with cls.set_user("Guest"):
                complete_signup(request.request_key, first_name, last_name, password)

        return frappe._dict(
            user=email,
            email=email,
            username=username,
            domain=domain,
            password=password,
            backup_email=backup_email,
            account_request=request.name,
            request_key=request.request_key,
        )

    @classmethod
    def create_group(cls, domain: str | None = None, description: str | None = None) -> str:
        """Creates a group on Stalwart and returns its id."""

        from suite.mail.api.admin import add_group

        name = unique_name("group")
        with cls.set_user("Administrator"):
            group_id = add_group(
                name=name,
                domain=domain or cls.domain,
                description=description or f"Test group {name}",
            )

        cls._stalwart_cleanups.append(lambda group_id=group_id: _delete_stalwart("group", group_id))
        return group_id

    @classmethod
    def create_mailing_list(cls, domain: str | None = None, description: str | None = None) -> str:
        """Creates a mailing list on Stalwart and returns its id."""

        from suite.mail.api.admin import add_mailing_list

        name = unique_name("list")
        with cls.set_user("Administrator"):
            list_id = add_mailing_list(
                name=name,
                domain=domain or cls.domain,
                description=description or f"Test list {name}",
            )

        cls._stalwart_cleanups.append(lambda list_id=list_id: _delete_stalwart("mailing_list", list_id))
        return list_id

    @classmethod
    def create_role(
        cls,
        description: str | None = None,
        enabled_permissions: list | None = None,
        disabled_permissions: list | None = None,
        role_ids: list | None = None,
    ) -> str:
        """Creates a role on Stalwart and returns its id."""

        from suite.mail.api.admin import add_role

        description = description or f"Test role {unique_name('role')}"
        with cls.set_user("Administrator"):
            role_id = add_role(
                description=description,
                enabled_permissions=enabled_permissions or [],
                disabled_permissions=disabled_permissions or [],
                role_ids=role_ids or [],
            )

        cls._stalwart_cleanups.append(lambda role_id=role_id: _delete_stalwart("role", role_id))
        return role_id


def _delete_stalwart_account(email: str) -> None:
    from suite.mail.stalwart import delete_account

    delete_account(email)


def _delete_stalwart(kind: str, resource_id: str) -> None:
    from suite.mail import stalwart

    service = getattr(stalwart, f"get_{kind}_service")()
    service.delete(resource_id)
