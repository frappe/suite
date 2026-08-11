from dataclasses import dataclass

import frappe
from frappe import _

from suite.mail.stalwart.service import ManagementService


@dataclass
class MailingList:
    name: str
    domain_id: str
    recipients: list[str] | None = None
    description: str | None = None

    def to_dict(self) -> dict:
        """Serializes the mailing list to the JMAP wire format.

        ``recipients`` is a set-valued map keyed by recipient email address — internal or
        external (omitted when empty).
        """

        payload = {"name": self.name, "domainId": self.domain_id, "description": self.description}
        if self.recipients:
            payload["recipients"] = {email: True for email in self.recipients}

        return payload


class MailingListService(ManagementService):
    type = "MailingList"
    default_properties = ["id", "name", "emailAddress", "domainId", "recipients", "description"]

    def get_by_name(
        self, name: str, properties: list[str] | None = None, raise_exception: bool = True
    ) -> dict | None:
        """Returns the mailing list with the given name, or ``None`` (throws if ``raise_exception``)."""

        mailing_list = self.find({"name": name}, properties=properties or ["id"])
        if not mailing_list and raise_exception:
            frappe.throw(_("Mailing list {0} not found on the Stalwart server.").format(name))

        return mailing_list

    def get_address_index(self) -> dict[str, list[str]]:
        """Returns ``{list address: [recipient addresses]}`` for every list with recipients.

        A list is reachable at its primary address and at each of its enabled aliases, so all of
        them are indexed; the server resolves any of them to the same recipients.
        """

        from suite.mail.stalwart import get_domains

        domain_names = {d["id"]: d["name"] for d in get_domains()}
        index = {}
        for mailing_list in self.get_all(properties=["id", "emailAddress", "aliases", "recipients"]):
            recipients = sorted({r.lower() for r in (mailing_list.get("recipients") or {})})
            if not recipients:
                continue

            for address in get_mailing_list_addresses(mailing_list, domain_names):
                index[address] = recipients

        return index


def get_mailing_list_addresses(mailing_list: dict, domain_names: dict[str, str]) -> list[str]:
    """Returns the list's primary address plus its enabled aliases, lowercased.

    Disabled aliases are skipped: the server stops routing mail to them, so an invitation sent to
    one would never reach the members either.
    """

    addresses = []
    if primary := (mailing_list.get("emailAddress") or "").lower():
        addresses.append(primary)

    for alias in (mailing_list.get("aliases") or {}).values():
        if not alias.get("enabled", True):
            continue

        name = alias.get("name")
        if name and (domain := domain_names.get(alias.get("domainId"))):
            addresses.append(f"{name}@{domain}".lower())

    return addresses
