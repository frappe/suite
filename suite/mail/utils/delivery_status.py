# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Parsing of `message/delivery-status` parts (RFC 3464) carried by bounce (DSN) messages."""


def parse_delivery_status(content: bytes | str) -> dict:
    """Parses a `message/delivery-status` part into per-message and per-recipient fields.

    The part body is groups of header-style fields separated by blank lines: the first group
    describes the report itself (Reporting-MTA, Arrival-Date, ...), each following group one
    recipient (Final-Recipient, Action, Status, Diagnostic-Code, ...). The content is expected
    transfer-decoded, which is how JMAP serves part blobs.
    """

    if isinstance(content, bytes):
        content = content.decode("utf-8", "replace")

    report_fields = {}
    recipients = []
    for group in _parse_field_groups(content):
        # Per RFC 3464 only recipient groups carry these fields; anything else extends the report group.
        if "final-recipient" in group or "original-recipient" in group or "action" in group:
            recipients.append(
                {
                    "email": _strip_address_type(
                        group.get("final-recipient") or group.get("original-recipient") or ""
                    ),
                    "action": (group.get("action") or "").lower(),
                    "status": group.get("status") or "",
                    "diagnostic_code": _strip_address_type(group.get("diagnostic-code") or ""),
                    "remote_mta": _strip_address_type(group.get("remote-mta") or ""),
                    "will_retry_until": group.get("will-retry-until") or "",
                }
            )
        else:
            report_fields.update(group)

    return {
        "reporting_mta": _strip_address_type(report_fields.get("reporting-mta") or ""),
        "arrival_date": report_fields.get("arrival-date") or "",
        "recipients": recipients,
    }


def _parse_field_groups(content: str) -> list[dict[str, str]]:
    """Splits header-style text into blank-line separated groups of lower-cased field → value,
    unfolding continuation lines."""

    groups = []
    fields: dict[str, str] = {}
    last_field = None
    for line in [*content.splitlines(), ""]:
        if not line.strip():
            if fields:
                groups.append(fields)
            fields, last_field = {}, None
        elif line[:1] in (" ", "\t") and last_field:
            fields[last_field] += " " + line.strip()
        elif ":" in line:
            field, _, value = line.partition(":")
            last_field = field.strip().lower()
            fields[last_field] = value.strip()

    return groups


def _strip_address_type(value: str) -> str:
    """Drops the leading type token from a typed DSN value — "rfc822;a@b.com" → "a@b.com",
    "smtp;550 ..." → "550 ..." — leaving untyped values untouched."""

    type_token, sep, rest = value.partition(";")
    if sep and " " not in type_token.strip():
        return rest.strip()
    return value.strip()
