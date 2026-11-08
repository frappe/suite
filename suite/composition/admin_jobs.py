"""Refresh provider accounting without placing network requests in Drive write transactions."""

from suite import mail
from suite.suite_core.utils import is_suite_cloud_configured


def refresh_storage() -> None:
    if not is_suite_cloud_configured():
        return
    mail.provider_health(refresh=True)
    mail.refresh_storage()
