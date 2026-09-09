"""Client for the Suite Cloud site API.

The site never talks to Stalwart's management API itself: every directory change (domains,
accounts, groups, mailing lists) is proxied through Suite Cloud, which checks ownership and
pushes to the cluster. Authentication is the site's API key and secret, handed out by Frappe
Cloud when the site was registered, sent as a Frappe token with the ``Suite Site``
authorization source.
"""

import json
from typing import Any

import frappe
import requests
from frappe import _
from frappe.utils import cint
from frappe.utils.caching import request_cache

from suite.mail.utils import get_config, log_mail_error

API_PREFIX = "/api/method/suite_cloud.api."
DEFAULT_TIMEOUT = (5, 60)


class SuiteCloudUnavailableError(frappe.ValidationError):
    http_status_code = 503


class SuiteCloudClient:
    def __init__(
        self, base_url: str, api_key: str, api_secret: str, verify_ssl: bool = True, timeout=DEFAULT_TIMEOUT
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.verify = verify_ssl
        self.session.headers.update(
            {
                "Authorization": f"token {api_key}:{api_secret}",
                "Frappe-Authorization-Source": "Suite Site",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def call(self, method: str, **params: Any) -> Any:
        """Calls ``suite_cloud.api.<method>`` and returns its result.

        ``method`` names the API and the call: ``site.ping`` for what any hosted product has, and
        ``mail.domains.list_domains`` and friends for the mail directory.

        Refusals come back as the Frappe exception they correspond to: not found (another site's
        object, or none), validation (limits, duplicates, a Stalwart refusal) and permission
        (bad credentials or a suspended site). Anything else is logged and reported as unavailable.
        """

        url = f"{self.base_url}{API_PREFIX}{method}"
        body = {k: v for k, v in params.items() if v is not None}
        try:
            response = self.session.post(url, data=json.dumps(body, default=str), timeout=self.timeout)
        except requests.RequestException as e:
            log_mail_error(f"Suite Cloud unreachable ({method})", str(e))
            frappe.throw(_("Suite Cloud is unreachable; try again shortly."), SuiteCloudUnavailableError)

        if response.ok:
            payload = response.json() if response.content else {}
            return payload.get("message") if isinstance(payload, dict) else payload

        message = _error_message(response) or _("Suite Cloud refused the request.")
        if response.status_code == 404:
            frappe.throw(message, frappe.DoesNotExistError)
        if response.status_code in (401, 403):
            log_mail_error(f"Suite Cloud rejected the site credentials ({method})", response.text[:2000])
            frappe.throw(
                _("Suite Cloud rejected this site's credentials; check Mail Settings."),
                frappe.PermissionError,
            )
        if response.status_code in (417, 422) or 400 <= response.status_code < 500:
            frappe.throw(message, frappe.ValidationError)

        log_mail_error(f"Suite Cloud error {response.status_code} ({method})", response.text[:4000])
        frappe.throw(
            _("Suite Cloud is temporarily unavailable; try again shortly."), SuiteCloudUnavailableError
        )


def _error_message(response: requests.Response) -> str | None:
    """Frappe wraps thrown messages in ``_server_messages``; other errors carry ``exception``."""

    try:
        payload = response.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    messages = payload.get("_server_messages")
    if messages:
        try:
            first = json.loads(messages)[0]
            first = json.loads(first) if isinstance(first, str) else first
            return frappe.utils.strip_html(str(first.get("message") or ""))
        except (ValueError, IndexError, AttributeError, TypeError):
            pass
    exception = payload.get("exception")
    if exception:
        return str(exception).split(":", 1)[-1].strip()
    return None


def is_suite_cloud_configured(raise_exception: bool = False) -> bool:
    """Whether the site knows where its Suite Cloud is and how to authenticate to it."""

    url, key, secret = get_config(("suite_cloud_url", "site_api_key", "site_api_secret"))
    if url and key and secret:
        return True
    if raise_exception:
        frappe.throw(_("Suite Cloud is not configured. Please check your Mail Settings."))
    return False


@request_cache
def get_client() -> SuiteCloudClient:
    is_suite_cloud_configured(raise_exception=True)
    url, key, secret, verify_ssl = get_config(("suite_cloud_url", "site_api_key", "site_api_secret", "verify_ssl"))
    # The same Verify SSL as the JMAP URL: Suite Cloud and the cluster share a deployment.
    return SuiteCloudClient(url, key, secret, verify_ssl=bool(cint(verify_ssl)))
