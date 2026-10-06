"""Details for Mail's administration workflows."""

from typing import NotRequired, TypedDict

from suite.mail.http.admin import DomainRow, GroupRow, MailingListRow, RecipientRow


class DnsRecord(TypedDict):
    type: str | None
    host: str
    fqdn: str | None
    value: str
    priority: int | None
    weight: int | None
    port: int | None
    ttl: int | None
    category: str | None
    group: str | None
    is_mandatory: bool
    is_verified: bool
    last_checked_at: str | None


class DnsGroup(TypedDict):
    key: str
    label: str
    description: str
    is_mandatory: bool


class Domain(DomainRow):
    dns_record_groups: list[DnsGroup]
    dns_records: list[DnsRecord]


class OwnershipRecord(TypedDict):
    type: str
    host: str
    fqdn: str
    value: str


class Ownership(TypedDict):
    domain: str
    ownership_record: OwnershipRecord


class Verification(TypedDict):
    is_verified: bool


class Address(TypedDict):
    email: str
    description: str | None
    is_primary: bool
    enabled: bool


class AddressRef(TypedDict):
    id: str
    name: str
    email: str


class Quota(TypedDict):
    total: int
    used: int
    available: int
    used_percentage: float
    available_percentage: float
    unlimited: bool


class Member(TypedDict):
    name: str
    full_name: str
    user_image: str
    description: str
    last_active: str | None
    joined_on: str | None
    enabled: bool
    is_admin: bool
    account: str | None
    email_addresses: list[Address]
    groups: list[AddressRef]
    mailing_lists: list[AddressRef]
    quota: Quota
    locale: str | None
    time_zone: str | None


class Group(GroupRow):
    email_addresses: list[Address]
    members: list[AddressRef]
    quota: Quota


class MailingList(MailingListRow):
    email_addresses: list[Address]
    recipients: list[str]
    recipient_rows: list[RecipientRow]
    recipient_total: int
