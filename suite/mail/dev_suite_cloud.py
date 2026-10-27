"""A local Suite Cloud for development: the test fake, kept in a file between requests.

Turn it on with ``"suite_cloud_fake": 1`` in a developer-mode site's config. Every Suite Cloud call
then runs against ``FakeSuiteCloud`` instead of the network, so the admin pages work without a
real Suite Cloud or mail cluster. Delete the state file to start again.
"""

import os
import pickle
from typing import Any

import frappe

from suite.mail.tests.fake_suite_cloud import FakeSuiteCloud

STATE_FILE = "suite_cloud_fake.pickle"
SEED_DOMAIN = "example.com"


def is_enabled() -> bool:
    return bool(frappe.conf.get("suite_cloud_fake")) and bool(frappe.conf.get("developer_mode"))


class DevSuiteCloud:
    """Same ``call`` as the real client; loads the fake, runs the call, saves the fake."""

    def call(self, method: str, **params: Any) -> Any:
        fake = _load()
        try:
            return fake.call(method, **params)
        finally:
            _save(fake)


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
