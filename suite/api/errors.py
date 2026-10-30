"""Browser errors recorded in the site's Error Log."""

from typing import Literal, TypedDict

import frappe
from frappe.rate_limiter import rate_limit

from suite.composition.http import Route

Source = Literal["component", "script", "promise", "worker"]

# The Error Log title field holds 140 characters.
TITLE_LENGTH = 140
STACK_LENGTH = 20_000


class BrowserError(TypedDict):
    source: Source
    title: str
    stack: str
    route: str


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=10 * 60, ip_based=False, user_based=True)
def errors_post(source: Source, title: str, stack: str, route: str) -> None:
    """Record one uncaught browser error, with where it happened and in which browser.

    The browser reports at most a few errors per page load. The rate limit
    bounds a client that does not.
    """

    user_agent = frappe.get_request_header("User-Agent") or ""
    frappe.log_error(
        title=f"Browser: {title}"[:TITLE_LENGTH],
        message=f"Source: {source}\nRoute: {route}\nUser agent: {user_agent}\n\n{stack[:STACK_LENGTH]}",
    )


ROUTES = (
    Route(
        "POST",
        "errors",
        "errors_post",
        body=BrowserError,
        output=type(None),
        kind="mutation",
        public_name="errors.report",
    ),
)
