"""Name the stage at which a new person's account setup failed.

Accepting an invitation sets up a Drive, a mailbox and the account itself in
one request, and the setup page shows one row for each (spec §4.1: action
progress, then Active or Setup failed). A failure is re-raised as the error
class of its stage, keeping the original message, so the page marks the row
that really failed. Callers that only report the reason (direct creation in
Admin) read the same message as before.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Literal

import frappe

type SetupStage = Literal["drive", "mailbox", "account"]


class InvitationClosed(frappe.ValidationError):
    """The invitation was replaced, accepted already, or has expired."""

    http_status_code = 410


class WeakPassword(frappe.ValidationError):
    """The chosen password fails the site's policy; nothing was set up."""

    http_status_code = 422


class AccountSetupFailed(frappe.ValidationError):
    """Account setup stopped; the subclass names the stage."""

    http_status_code = 400


class DriveSetupFailed(AccountSetupFailed):
    """The User or their Personal Drive root could not be created."""


class MailboxSetupFailed(AccountSetupFailed):
    """The business mailbox could not be provisioned."""


class AccountActivationFailed(AccountSetupFailed):
    """The mailbox exists, but the account could not be activated."""


_ERRORS: dict[SetupStage, type[AccountSetupFailed]] = {
    "drive": DriveSetupFailed,
    "mailbox": MailboxSetupFailed,
    "account": AccountActivationFailed,
}


@contextmanager
def setup_stage(stage: SetupStage) -> Iterator[None]:
    """Re-raise a failure inside the block as `stage`'s error, with the same message."""
    try:
        yield
    except (AccountSetupFailed, frappe.QueryDeadlockError):
        # An inner stage already named itself; a deadlock is retried by the caller as it is.
        raise
    except Exception as error:
        raise _ERRORS[stage](frappe.utils.strip_html(str(error)).strip()) from error
