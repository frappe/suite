"""Send Suite-owned notifications through the configured email provider.

The optional suite_email_provider Frappe hook is the composition seam for provider-specific
delivery. With no configured provider, Core renders and sends through the site's Email Account.
The provider owns its transport; this module owns first-party notification routing and retries.
"""

from collections.abc import Mapping
from importlib import import_module
from typing import Any, Protocol

import frappe


class EmailProvider(Protocol):
    """The provider contract wired by suite_email_provider."""

    def is_configured(self) -> bool: ...

    def send_email(
        self, email_type: str, recipient: str, params: Mapping[str, Any], request_key: str
    ) -> None: ...


class EmailDeliveryUnavailableError(frappe.ValidationError):
    """A configured email provider is temporarily unavailable."""


class EmailNotSentError(frappe.ValidationError):
    """The configured provider did not take the email."""


def send(email_type: str, recipient: str, params: dict, local: dict, request_key: str | None = None) -> None:
    """Sends now and raises when the email did not go, so the caller can tell whoever waits."""

    provider = _email_provider()
    if provider and provider.is_configured():
        provider.send_email(email_type, recipient, params, request_key or frappe.generate_hash())
    else:
        frappe.sendmail(recipients=[recipient], **{"now": True, **local})


def enqueue(email_type: str, recipient: str, params: dict, local: dict) -> None:
    """For a notice nobody waits on: sent once the request commits, and tried again when the provider
    or its mail server fails or throttles the site. One key for every try, so it is sent once."""

    provider = _email_provider()
    if not provider or not provider.is_configured():
        frappe.sendmail(recipients=[recipient], **local)  # Email Queue sends and retries it
        return
    frappe.enqueue(
        "suite.suite_core.suite_email.send_in_background",
        enqueue_after_commit=True,
        email_type=email_type,
        recipient=recipient,
        params=params,
        local=local,
        request_key=frappe.generate_hash(),
    )


def send_in_background(**kwargs) -> None:
    try:
        send(**kwargs)
    except (EmailNotSentError, EmailDeliveryUnavailableError, frappe.TooManyRequestsError) as e:
        raise frappe.RetryBackgroundJobError(str(e)) from e


def _email_provider() -> EmailProvider | None:
    """Resolve the single provider that Suite composition declares."""

    providers = frappe.get_hooks("suite_email_provider", app_name="suite")
    if len(providers) > 1:
        raise RuntimeError("Suite email supports at most one provider hook")
    return import_module(providers[0]) if providers else None
