"""A local Suite Cloud for development: the test fake, kept in a file between requests.

Turn it on with ``"suite_cloud_fake": 1`` in a developer-mode site's config. Every Suite Cloud call
then runs against ``FakeSuiteCloud`` instead of the network, so the admin pages work without a
real Suite Cloud. Delete the state file to start again.

Mailboxes are real: creating, deleting or rotating the app password of a mail account does the same
on the Stalwart in the site's `mail` config (suite.mail.dev_stalwart), as Suite Cloud does on its
mail cluster. So Mail and Calendar work for every account the fake makes. Groups and mailing lists
stay in the fake only.
"""

import os
import pickle
from typing import Any

import frappe

from suite.mail.dev_stalwart import Stalwart
from suite.mail.tests.fake_suite_cloud import FakeSuiteCloud

STATE_FILE = "suite_cloud_fake.pickle"
SEED_DOMAIN = "example.com"


def is_enabled() -> bool:
    return bool(frappe.conf.get("suite_cloud_fake")) and bool(frappe.conf.get("developer_mode"))


class DevSuiteCloud:
    """Same ``call`` as the real client; loads the fake, runs the call, saves the fake."""

    def call(self, method: str, **params: Any) -> Any:
        if method == "mail.accounts.create_account":
            # The mailbox comes first, so a failure leaves the fake without an account it never got.
            app_password = _create_mailbox(params["email"], params["password"], params.get("display_name"))
            return {**self._call_fake(method, params), "app_password": app_password}
        result = self._call_fake(method, params)
        if method == "mail.accounts.rotate_app_password":
            with Stalwart() as stalwart:
                return {**result, "app_password": _new_app_password(stalwart, params["email"])}
        if method == "mail.accounts.delete_account":
            with Stalwart() as stalwart:
                if account := stalwart.get_account_id(params["email"]):
                    stalwart.manage("Account", "set", destroy=[account])
        return result

    def _call_fake(self, method: str, params: dict[str, Any]) -> Any:
        fake = _load()
        try:
            return fake.call(method, **params)
        finally:
            _save(fake)


def _create_mailbox(email: str, password: str, display_name: str | None) -> str:
    """Make the account on Stalwart, unless an earlier attempt did, and return a new app password."""

    name, domain = email.split("@", 1)
    with Stalwart() as stalwart:
        if not stalwart.get_account_id(email):
            domain_id = stalwart.get_domain_id(domain) or stalwart.create("Domain", {"name": domain})
            account = {
                "@type": "User",
                "name": name,
                "domainId": domain_id,
                "description": display_name or email,
                "credentials": {"0": {"@type": "Password", "secret": password}},
                "roles": {"@type": "User"},
                "locale": "en_US",
            }
            stalwart.create("Account", account)
        return _new_app_password(stalwart, email)


def _new_app_password(stalwart: Stalwart, email: str) -> str:
    return stalwart.create_app_password(email, f"Suite on {frappe.local.site}")


def _path() -> str:
    return frappe.get_site_path("private", STATE_FILE)


def _load() -> FakeSuiteCloud:
    try:
        with open(_path(), "rb") as file:
            return pickle.load(file)
    except FileNotFoundError:
        return _seed()


def _save(fake: FakeSuiteCloud) -> None:
    path = _path()
    temporary = f"{path}.tmp"
    with open(temporary, "wb") as file:
        pickle.dump(fake, file)
    os.replace(temporary, path)


def _seed() -> FakeSuiteCloud:
    fake = FakeSuiteCloud()
    fake.site_title = frappe.db.get_single_value("Suite Settings", "workspace_name") or "Suite"
    fake.domains__create_domain(SEED_DOMAIN, description="Local development domain")
    fake.domains__verify_dns_records(SEED_DOMAIN)
    fake.add_dmarc_report(SEED_DOMAIN)
    fake.add_dmarc_report(SEED_DOMAIN, reporter="outlook.com")
    fake.add_tls_report(SEED_DOMAIN)
    return fake
