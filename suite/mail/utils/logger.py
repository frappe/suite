from typing import Any

import frappe
from frappe.utils import cint

from suite.mail.utils import get_config, log_mail_error

# Used while the Mail Settings values are unset: the Single doc only picks up a new field's default
# once it is saved.
DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_LOG_FILE_COUNT = 10
DEFAULT_LOG_MAX_FILE_SIZE_MB = 5
MB = 1024 * 1024


class EventLogger:
    """Structured event logger for a mail subsystem.

    Binds a context dict (shared by reference, so callers can keep mutating it)
    and emits one structured record per event. Each log method takes the event
    name as its first argument and any event-specific fields as keyword
    arguments, keeping call sites free of repetitive `{**ctx, "event": ...}`
    boilerplate. Pick the method that matches the event:

    - `debug`   — flow tracing and routine/no-op outcomes (entry points, cache
                  invalidations, lock contention, unchanged state).
    - `info`    — meaningful work that happened (mail sent, messages synced,
                  notifications delivered).
    - `warning` — handled-but-unexpected situations (bad client input, frozen
                  user, unknown payload type).
    - `error`   — failures during our own processing.
    - `exception` — same as `error` but also records the active traceback; use
                  it inside an `except` block.

    Subclasses set `logger_name` (the frappe logger channel, e.g. "suite.mail.push"). Level,
    rotation size and file count come from the one set of logging settings in Mail Settings
    (`log_level`, `log_max_file_size_mb`, `log_file_count`), shared by every mail log.
    """

    logger_name: str

    def __init__(self, ctx: dict | None = None) -> None:
        config = get_config()

        max_size = (cint(config.get("log_max_file_size_mb")) or DEFAULT_LOG_MAX_FILE_SIZE_MB) * MB
        file_count = cint(config.get("log_file_count")) or DEFAULT_LOG_FILE_COUNT
        self.logger = frappe.logger(
            self.logger_name, allow_site=True, max_size=max_size, file_count=file_count
        )
        self.logger.setLevel((config.get("log_level") or DEFAULT_LOG_LEVEL).upper())

        self.ctx = ctx if ctx is not None else {}

    def _record(self, event: str, fields: dict) -> dict:
        return {**self.ctx, **fields, "event": event}

    def debug(self, event: str, **fields: Any) -> None:
        self.logger.debug(self._record(event, fields))

    def info(self, event: str, **fields: Any) -> None:
        self.logger.info(self._record(event, fields))

    def warning(self, event: str, **fields: Any) -> None:
        self.logger.warning(self._record(event, fields))

    def error(self, event: str, **fields: Any) -> None:
        self.logger.error(self._record(event, fields))

    def exception(self, event: str, **fields: Any) -> None:
        self.logger.exception(self._record(event, fields))


class PushLogger(EventLogger):
    """Structured event logger for mail push notifications ("suite.mail.push")."""

    logger_name = "suite.mail.push"


class OutboundLogger(EventLogger):
    """Structured event logger for outbound mail operations ("suite.mail.outbound")."""

    logger_name = "suite.mail.outbound"


class InboundLogger(EventLogger):
    """Structured event logger for inbound mail operations ("suite.mail.inbound")."""

    logger_name = "suite.mail.inbound"


class ExchangeLogger(EventLogger):
    """Structured event logger for mail import/export operations ("suite.mail.exchange")."""

    logger_name = "suite.mail.exchange"


class AdminLogger(EventLogger):
    """Structured event logger for mail administration ("suite.mail.admin")."""

    logger_name = "suite.mail.admin"


def get_push_logger(ctx: dict | None = None) -> PushLogger:
    """Returns a structured event logger for mail push notifications.

    The returned logger is bound to `ctx` (by reference); mutating that same
    dict between log calls is reflected in subsequent records.
    """

    return PushLogger(ctx)


def get_outbound_logger(ctx: dict | None = None) -> OutboundLogger:
    """Returns a structured event logger for outbound mail operations.

    The returned logger is bound to `ctx` (by reference); mutating that same
    dict between log calls is reflected in subsequent records.
    """

    return OutboundLogger(ctx)


def get_inbound_logger(ctx: dict | None = None) -> InboundLogger:
    """Returns a structured event logger for inbound mail operations.

    The returned logger is bound to `ctx` (by reference); mutating that same
    dict between log calls is reflected in subsequent records.
    """

    return InboundLogger(ctx)


def get_exchange_logger(ctx: dict | None = None) -> ExchangeLogger:
    """Returns a structured event logger for mail import/export operations.

    The returned logger is bound to `ctx` (by reference); mutating that same
    dict between log calls is reflected in subsequent records.
    """

    return ExchangeLogger(ctx)


def get_admin_logger(ctx: dict | None = None) -> AdminLogger:
    """Returns a structured event logger for mail administration.

    The returned logger is bound to `ctx` (by reference); mutating that same
    dict between log calls is reflected in subsequent records.
    """

    return AdminLogger(ctx)


# Keeps one audit line readable when an action targets a long list of objects.
MAX_LOGGED_TARGETS = 10


def log_admin_action(action: str, target: Any = None) -> None:
    """Records who performed an administrative action, and on what.

    Written for accountability, so it names the acting user and the object acted on — never the
    payload, which can hold passwords and message contents. The line is emitted when the action is
    authorized, so it records what was attempted; failures are in the Error Log alongside.
    """

    fields = {"user": frappe.session.user, "action": action}

    # Absent outside a request (scheduled jobs, bench console).
    if request_ip := getattr(frappe.local, "request_ip", None):
        fields["ip"] = request_ip

    if target := _format_target(target):
        fields["target"] = target

    try:
        get_admin_logger().info("admin-action", **fields)
    except Exception:
        # This runs in the permission gate of every administrative action, so a logging problem is
        # recorded and swallowed rather than allowed to fail the action itself.
        log_mail_error(title="Failed to write the admin log", message=frappe.get_traceback())


def _format_target(target: Any) -> str:
    """Renders an action's target as one short string, capping long collections."""

    if target is None:
        return ""

    if isinstance(target, str):
        return target

    if isinstance(target, list | tuple | set):
        targets = [str(t) for t in target]
        shown = ", ".join(targets[:MAX_LOGGED_TARGETS])
        if len(targets) > MAX_LOGGED_TARGETS:
            shown += f" and {len(targets) - MAX_LOGGED_TARGETS} more"
        return shown

    return str(target)
