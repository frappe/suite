"""Refresh provider accounting without placing network requests in Drive write transactions."""

import json

from suite import mail
from suite.suite_core.storage import state
from suite.suite_core.utils import is_suite_cloud_configured


def refresh_storage() -> None:
    if not is_suite_cloud_configured():
        return
    mail.provider_health(refresh=True)
    doc, _policy, previous = state(lock=True)
    updated = mail.storage_measurements(previous)
    if updated != previous:
        doc.measurements = json.dumps(updated)
        doc.save(ignore_permissions=True)
