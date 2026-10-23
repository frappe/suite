"""Identity values and link credentials consumed by the Drive engine."""

import hashlib
import hmac
import re
import time
from dataclasses import dataclass

import frappe
from frappe import _
from frappe.utils.password import get_encryption_key

LINK_HEADER_LIMIT = 20
LINK_TOKEN_LENGTH = 22
TICKET_CONTEXT = b"suite-drive-link-ticket"
TICKET_TTL = 30 * 24 * 60 * 60

_TOKEN_RE = re.compile(rf"[A-Za-z0-9]{{{LINK_TOKEN_LENGTH}}}")
_EXP_RE = re.compile(r"[0-9]{1,10}")
_MAC_RE = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class LinkCredential:
    """One syntactically valid link header item."""

    principal: str
    exp: str | None = None
    mac: str | None = None


@dataclass(frozen=True)
class Principals:
    """The identity principals and explicitly presented open principals of a caller."""

    user: str
    own: tuple[str, ...]
    open: tuple[str, ...]
    is_admin: bool = False
    link_tickets: tuple[tuple[str, str, str], ...] = ()

    def all(self) -> tuple[str, ...]:
        """Return principals in their structural own/open order."""
        return self.own + self.open

    def ticket_for(self, principal: str) -> tuple[str, str] | None:
        """Return the presented stateless proof for a link principal, if any."""
        for candidate, exp, mac in self.link_tickets:
            if candidate == principal:
                return exp, mac
        return None


def parse_link_header(header: str | None) -> tuple[LinkCredential, ...]:
    """Parse valid link items after enforcing the supplied-item limit."""
    if not header:
        return ()

    supplied = header.split(",")
    if len(supplied) > LINK_HEADER_LIMIT:
        frappe.throw(
            _("X-Drive-Links accepts at most {0} items").format(LINK_HEADER_LIMIT),
            frappe.ValidationError,
        )

    credentials: dict[str, LinkCredential] = {}
    for supplied_item in supplied:
        item = supplied_item.strip()
        parts = item.split(".", 2)
        if len(parts) == 1:
            token = parts[0]
            if not _TOKEN_RE.fullmatch(token):
                continue
            principal = f"$LINK:{token}"
            credentials.setdefault(principal, LinkCredential(principal))
            continue
        if len(parts) != 3:
            continue

        token, exp, mac = parts
        if not (_TOKEN_RE.fullmatch(token) and _EXP_RE.fullmatch(exp) and _MAC_RE.fullmatch(mac)):
            continue
        principal = f"$LINK:{token}"
        # A proof is more useful than a duplicate bare token, whatever their order.
        credentials[principal] = LinkCredential(principal, exp, mac)
    return tuple(credentials.values())


def valid_link_principals(header: str | None) -> tuple[str, ...]:
    """Return deduplicated link principals from a bounded request header."""
    return tuple(credential.principal for credential in parse_link_header(header))


def ticket_key() -> bytes:
    return hashlib.sha256(TICKET_CONTEXT + b":" + get_encryption_key().encode()).digest()


def make_ticket(token: str, password_hash: str, exp: int) -> str:
    payload = f"{token}|{password_hash}|{exp}"
    mac = hmac.new(ticket_key(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{mac}"


def ticket_ok(token: str, password_hash: str, exp: str, mac: str) -> bool:
    if not _EXP_RE.fullmatch(exp) or int(exp) < int(time.time()):
        return False
    return hmac.compare_digest(
        make_ticket(token, password_hash, int(exp)),
        f"{exp}.{mac}",
    )
