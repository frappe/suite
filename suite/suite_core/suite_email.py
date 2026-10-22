"""Suite's own emails, such as invites and password resets.

A site connected to Suite Cloud names the email and its parameters, and Suite Cloud sends it from
its own template. Any other site renders it here with ``frappe.sendmail`` and sends it through its
own Email Account: ``local`` holds those arguments. Other mail of the site is not Suite's and
always goes through the site's Email Account.
"""

import frappe
from frappe import _

from suite.suite_core.utils import is_suite_cloud_configured


class EmailNotSentError(frappe.ValidationError):
    """Suite Cloud's mail server did not take the email."""


def send(email_type: str, recipient: str, params: dict, local: dict, request_key: str | None = None) -> None:
    """Sends now and raises when the email did not go, so the caller can tell whoever waits."""

    if not is_suite_cloud_configured():
        frappe.sendmail(recipients=[recipient], **{"now": True, **local})
        return

    from suite.mail import suite_cloud

    result = suite_cloud.get_client().call(
        "email.send_email",
        email_type=email_type,
        recipient=recipient,
        params=params,
        request_key=request_key or frappe.generate_hash(),
    )
    if result["status"] != "Sent":
        frappe.throw(
            _("The email to {0} was not sent: {1}").format(recipient, result.get("error")), EmailNotSentError
        )


def enqueue(email_type: str, recipient: str, params: dict, local: dict) -> None:
    """For a notice nobody waits on: sent once the request commits, and tried again when Suite
    Cloud or its mail server fails or throttles the site. One key for every try, so it is sent
    once."""

    if not is_suite_cloud_configured():
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
    from suite.mail.suite_cloud import SuiteCloudUnavailableError

    try:
        send(**kwargs)
    except (EmailNotSentError, SuiteCloudUnavailableError, frappe.TooManyRequestsError) as e:
        raise frappe.RetryBackgroundJobError(str(e)) from e
