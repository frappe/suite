"""Seed/reset Mail and Calendar for the Northwind demo on a Stalwart server without Suite Cloud.

Run after suite.demo.drive.seed:
`pilot -b suite frappe --site suite.localhost execute suite.demo.mail.seed`.
The domain, accounts and mailing lists are made with Stalwart's management API as the admin in
the `mail` site config. Each account is linked like any self-managed one: User Settings holds
the address and a Stalwart app password. Mail is imported with JMAP Email/import so it keeps its
past dates; events go through Calendar's invite flow, so every participant holds a copy with the
same UID. Seeding again adds only what is missing. fresh=True empties the Northwind mailboxes and
calendars first; reset removes the accounts, lists and domain.
"""

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from email.utils import format_datetime, formataddr
from html import unescape
from zoneinfo import ZoneInfo

import frappe
import httpx
from frappe.utils import get_system_timezone

from suite.demo import agenda, inbox
from suite.demo.drive import PASSWORD, PEOPLE, URL

DOMAIN = "northwind.test"
LISTS = {
    "team": ("Northwind team", ("maya", "leo", "arjun", "nisha", "theo", "sofia")),
    "product": ("Northwind Product", ("maya", "leo")),
    "engineering": ("Northwind Engineering", ("arjun", "nisha")),
}
CORE = "urn:ietf:params:jmap:core"
MAIL = "urn:ietf:params:jmap:mail"
CALENDARS = "urn:ietf:params:jmap:calendars"
MANAGEMENT = "urn:stalwart:jmap"
ACCOUNT_DOCTYPES = (
    "Screened Email Address",
    "Mail Queue",
    "Mailbox Settings",
    "Mail Sync History",
    "Mail Exchange",
    "Contacts Exchange",
    "Calendar Exchange",
    "User Account",
)
PEOPLE_BY_KEY = {person.first.lower(): person for person in PEOPLE}


def seed(fresh: bool = False) -> None:
    """Create the Northwind mailboxes, mail and calendars; add only what is missing."""
    frappe.set_user("Administrator")
    missing = [person.email for person in PEOPLE if not frappe.db.exists("User", person.email)]
    if missing:
        frappe.throw(f"Run suite.demo.drive.seed first. Missing users: {', '.join(missing)}")
    stalwart = Stalwart()
    try:
        stalwart.provision()
        for person in PEOPLE:
            link(stalwart, person.email)
            frappe.db.commit()
        if fresh:
            for person in PEOPLE:
                stalwart.mailbox(person.email).empty()
            print("Emptied the Northwind mailboxes and calendars.")
        accept_colleagues()
        now = datetime.now(ZoneInfo(get_system_timezone()))
        delivered = deliver(stalwart, [*letters(now), *invitations(now)])
        name_calendars()
        scheduled = schedule(stalwart, now)
        frappe.db.commit()
        print(f"Imported {delivered} messages; {scheduled} calendar copies are in place.")
        print(f"Mail and Calendar are ready at {URL}/mail for {', '.join(p.email for p in PEOPLE)}.")
    finally:
        stalwart.http.close()
        frappe.set_user("Administrator")


def reset() -> None:
    """Unlink the Northwind users from Mail and delete their accounts, lists and domain."""
    frappe.set_user("Administrator")
    stalwart = Stalwart()
    try:
        for person in PEOPLE:
            unlink(person.email)
        frappe.db.commit()
        stalwart.remove()
        print("Removed the Northwind mail accounts, lists and domain.")
        print("If a reseed reuses a removed account id, restart the web process to drop its old cache.")
    finally:
        stalwart.http.close()


class Stalwart:
    """Stalwart's management API as the configured admin, and each account's JMAP through it."""

    def __init__(self) -> None:
        conf = frappe.conf.mail or {}
        if not (conf.get("server_url") and conf.get("username") and conf.get("password")):
            frappe.throw("The `mail` site config needs server_url, username and password for Stalwart.")
        self.url = conf["server_url"].rstrip("/")
        self.admin = conf["username"]
        self.password = conf["password"]
        self.http = httpx.Client(timeout=60, verify=bool(conf.get("verify_ssl")), follow_redirects=True)
        self.account = self.get_session(self.admin)["primaryAccounts"][MANAGEMENT]

    def get_session(self, login: str) -> dict:
        response = self.http.get(f"{self.url}/.well-known/jmap", auth=(login, self.password))
        response.raise_for_status()
        return response.json()

    def call(self, login: str, method: str, arguments: dict) -> dict:
        using = [CORE, MANAGEMENT] if method.startswith("x:") else [CORE, MAIL, CALENDARS]
        body = {"using": using, "methodCalls": [[method, arguments, "0"]]}
        response = self.http.post(f"{self.url}/jmap/", json=body, auth=(login, self.password))
        response.raise_for_status()
        name, result, _call = response.json()["methodResponses"][0]
        if name == "error":
            raise RuntimeError(f"{method} failed: {result}")
        failures = {
            key: result[key] for key in ("notCreated", "notUpdated", "notDestroyed") if result.get(key)
        }
        if failures:
            raise RuntimeError(f"{method} failed: {failures}")
        return result

    def manage(self, object_type: str, action: str, **arguments) -> dict:
        return self.call(self.admin, f"x:{object_type}/{action}", {"accountId": self.account, **arguments})

    def get_all(self, object_type: str) -> list[dict]:
        return self.manage(object_type, "get")["list"]

    def mailbox(self, email: str) -> Mailbox:
        return Mailbox(self, email)

    def provision(self) -> None:
        domain = self.get_domain_id() or self.create("Domain", {"name": DOMAIN})
        accounts = {row.get("emailAddress") for row in self.get_all("Account")}
        for person in PEOPLE:
            if person.email not in accounts:
                self.create("Account", account_payload(person, domain))
        lists = {row.get("emailAddress") for row in self.get_all("MailingList")}
        for name, (description, members) in LISTS.items():
            if f"{name}@{DOMAIN}" not in lists:
                recipients = {PEOPLE_BY_KEY[key].email: True for key in members}
                payload = {"name": name, "domainId": domain, "description": description}
                self.create("MailingList", {**payload, "recipients": recipients})

    def get_domain_id(self) -> str | None:
        return next((row["id"] for row in self.get_all("Domain") if row["name"] == DOMAIN), None)

    def create(self, object_type: str, payload: dict) -> str:
        return self.manage(object_type, "set", create={"new": payload})["created"]["new"]["id"]

    def create_app_password(self, email: str) -> str:
        login = self.as_account(email)
        account = self.get_session(login)["primaryAccounts"][MANAGEMENT]
        payload = {
            "description": f"Northwind demo on {frappe.local.site}",
            "permissions": {"@type": "Inherit"},
        }
        result = self.call(login, "x:AppPassword/set", {"accountId": account, "create": {"new": payload}})
        return result["created"]["new"]["secret"]

    def as_account(self, email: str) -> str:
        """The master-user login: the admin acting as `email`."""
        return f"{email}%{self.admin}"

    def remove(self) -> None:
        domain = self.get_domain_id()
        if not domain:
            return
        for object_type in ("MailingList", "Account"):
            ids = [row["id"] for row in self.get_all(object_type) if row.get("domainId") == domain]
            if ids:
                self.manage(object_type, "set", destroy=ids)
        signatures = [row["id"] for row in self.get_all("DkimSignature") if row.get("domainId") == domain]
        if signatures:
            self.manage("DkimSignature", "set", destroy=signatures)
        self.manage("Domain", "set", destroy=[domain])


class Mailbox:
    """One account's mail and calendar over JMAP, reached through the admin's master login."""

    def __init__(self, stalwart: Stalwart, email: str) -> None:
        self.stalwart = stalwart
        self.login = stalwart.as_account(email)
        self.account = stalwart.get_session(self.login)["primaryAccounts"][MAIL]

    def call(self, method: str, **arguments) -> dict:
        return self.stalwart.call(self.login, method, {"accountId": self.account, **arguments})

    def upload(self, content: bytes, content_type: str) -> str:
        url = f"{self.stalwart.url}/jmap/upload/{self.account}/"
        response = self.stalwart.http.post(
            url,
            content=content,
            headers={"Content-Type": content_type},
            auth=(self.login, self.stalwart.password),
        )
        response.raise_for_status()
        return response.json()["blobId"]

    def get_mailbox_ids(self) -> dict[str, str]:
        return {row["role"]: row["id"] for row in self.call("Mailbox/get")["list"] if row.get("role")}

    def get_message_ids(self) -> set[str]:
        ids = self.call("Email/query", limit=1000)["ids"]
        if not ids:
            return set()
        emails = self.call("Email/get", ids=ids, properties=["messageId"])["list"]
        return {message_id for email in emails for message_id in email.get("messageId") or ()}

    def import_emails(self, emails: dict[str, dict]) -> None:
        if emails:
            self.call("Email/import", emails=emails)

    def empty(self) -> None:
        for object_type in ("Email", "CalendarEvent"):
            ids = self.call(f"{object_type}/query", limit=1000)["ids"]
            if ids:
                self.call(f"{object_type}/set", destroy=ids)


def account_payload(person, domain: str) -> dict:
    return {
        "@type": "User",
        "name": person.first.lower(),
        "domainId": domain,
        "description": f"{person.first} {person.last}",
        "credentials": {"0": {"@type": "Password", "secret": PASSWORD}},
        "roles": {"@type": "User"},
        "locale": "en_US",
    }


def link(stalwart: Stalwart, email: str) -> None:
    """Point the user's User Settings at their account, minting an app password when needed."""
    name = frappe.db.get_value("User Settings", {"user": email})
    if not name:
        frappe.throw(f"{email} has no User Settings.")
    if frappe.get_doc("User Settings", name).client:
        return
    settings = frappe.get_doc("User Settings", name)
    settings.username = email
    settings.app_password = stalwart.create_app_password(email)
    settings.save(ignore_permissions=True)


def unlink(email: str) -> None:
    from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
    from suite.mail.jmap import clear_jmap_session
    from suite.mail.store import get_account_namespace
    from suite.store import destroy_namespace, get_blob_base_path, get_data_base_path, get_search_base_path

    accounts = [
        account
        for account in get_user_jmap_accounts(email)
        if frappe.db.get_value("JMAP Account", account, "_name") == email
    ]
    for doctype in ACCOUNT_DOCTYPES:
        frappe.db.delete(doctype, {"account": ["in", accounts or [""]]})
    frappe.db.delete("JMAP Account", {"name": ["in", accounts or [""]]})
    for account in accounts:
        for base_path in (get_data_base_path(), get_blob_base_path(), get_search_base_path()):
            destroy_namespace(base_path, get_account_namespace(account))
    if name := frappe.db.get_value("User Settings", {"user": email}):
        frappe.db.set_value("User Settings", name, "username", None)
        frappe.db.delete("__Auth", {"doctype": "User Settings", "name": name, "fieldname": "app_password"})
    clear_jmap_session(email)


def personal_account(email: str) -> str:
    """The user's personal JMAP account id; fails loudly when the user is not linked."""
    from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account

    account = get_user_personal_jmap_account(email, raise_exception=True)
    assert account
    return account


def accept_colleagues() -> None:
    """Let colleagues and the team lists past screening, so live mail between them lands in Inbox."""
    from suite.mail.api.mail import screen_email_addresses

    addresses = [person.email for person in PEOPLE] + [f"{name}@{DOMAIN}" for name in LISTS]
    for person in PEOPLE:
        frappe.set_user(person.email)
        account = personal_account(person.email)
        others = [address for address in addresses if address != person.email]
        screen_email_addresses(account, others, "Accepted", override=False)
        frappe.db.commit()
    frappe.set_user("Administrator")


@dataclass
class Letter:
    """One sent message and the state each internal participant's copy starts in."""

    message_id: str
    raw: bytes
    sent_at: datetime
    sender: str | None
    recipients: list[str]
    unread: set[str] = field(default_factory=set)
    flagged: set[str] = field(default_factory=set)
    answered: set[str] = field(default_factory=set)


def deliver(stalwart: Stalwart, all_letters: list[Letter]) -> int:
    """Import every participant's copy that their mailbox does not hold yet; return the count."""
    count = 0
    for person in PEOPLE:
        key = person.first.lower()
        mine = [letter for letter in all_letters if key == letter.sender or key in letter.recipients]
        mailbox = stalwart.mailbox(person.email)
        existing = mailbox.get_message_ids()
        roles = mailbox.get_mailbox_ids()
        emails = {}
        for letter in mine:
            if letter.message_id in existing:
                continue
            blob = mailbox.upload(letter.raw, "message/rfc822")
            emails[letter.message_id] = {
                "blobId": blob,
                "mailboxIds": {roles["sent" if key == letter.sender else "inbox"]: True},
                "keywords": keywords(letter, key),
                "receivedAt": letter.sent_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        mailbox.import_emails(emails)
        count += len(emails)
    return count


def keywords(letter: Letter, key: str) -> dict[str, bool]:
    result = {} if key in letter.unread and key != letter.sender else {"$seen": True}
    if key in letter.flagged:
        result["$flagged"] = True
    if key in letter.answered:
        result["$answered"] = True
    return result


def letters(now: datetime) -> list[Letter]:
    result = []
    for thread in inbox.THREADS:
        ids: list[str] = []
        last_received: dict[str, Letter] = {}
        for index, message in enumerate(thread.messages):
            sent_at = moment(now, message.days_ago, message.time, index)
            message_id = f"{thread.key}.{index}@{DOMAIN}"
            subject = thread.subject if index == 0 else f"Re: {thread.subject}"
            recipients = [key for target in (*message.to, *message.cc) for key in expand(target)]
            recipients = list(dict.fromkeys(key for key in recipients if key != message.sender))
            raw = compose(message, subject, message_id, ids, sent_at, thread.headers)
            letter = Letter(message_id, raw, sent_at, message.sender, recipients)
            if (now - sent_at).days < 2:
                letter.unread = set(recipients)
            if previous := last_received.get(message.sender):
                previous.answered.add(message.sender)
                previous.unread.discard(message.sender)
            last_received.update(dict.fromkeys(recipients, letter))
            ids.append(message_id)
            result.append(letter)
        for key in thread.starred_by:
            last_received[key].flagged.add(key)
    return result


def invitations(now: datetime) -> list[Letter]:
    """One invitation per one-off meeting, unread for whoever has not answered yet."""
    monday = (now - timedelta(days=now.weekday())).date()
    result = []
    for index, event in enumerate(agenda.EVENTS):
        if event.rule or not event.attendees:
            continue
        start = event.start(monday).replace(tzinfo=now.tzinfo)
        workday = (now - timedelta(days=1 + index % 4)).replace(hour=9 + index % 8, minute=index * 7 % 60)
        sent_at = min(start - timedelta(days=4), workday)
        recipients = list(event.attendees)
        message = inbox.Message(event.organizer, tuple(recipients), 0, "00:00", invitation_body(event, start))
        message_id = f"invite.{event.key}@{DOMAIN}"
        ics = calendar_file(event, monday, now, method="REQUEST")
        when = f"{start:%a %d %b %Y}" if event.all_day else f"{start:%a %d %b %Y %H:%M}"
        subject = f"Invitation: {event.title} @ {when}"
        raw = compose(message, subject, message_id, [], sent_at, {}, ics)
        pending = {key for key, status in event.attendees.items() if status == agenda.PENDING}
        result.append(Letter(message_id, raw, sent_at, event.organizer, recipients, unread=pending))
    return result


def invitation_body(event: agenda.Event, start: datetime) -> str:
    when = f"{start:%A %d %B}" if event.all_day else f"{start:%A %d %B, %H:%M}"
    names = ", ".join(PEOPLE_BY_KEY[key].first for key in event.participants)
    details = [f"<strong>{event.title}</strong>", when, f"Guests: {names}"]
    if event.location:
        details.append(event.location)
    return inbox.html("<br>".join(details), event.description) if event.description else inbox.html(*details)


def name_calendars() -> None:
    """Call each default calendar after its owner instead of the server's "Stalwart Calendar"."""
    from suite.calendar.api import edit_calendar
    from suite.mail.jmap import get_default_calendar_id

    for person in PEOPLE:
        frappe.set_user(person.email)
        account = personal_account(person.email)
        calendar = get_default_calendar_id(account, raise_exception=True)
        assert calendar
        edit_calendar(account, calendar, name=f"{person.first} {person.last}")
    frappe.set_user("Administrator")


def schedule(stalwart: Stalwart, now: datetime) -> int:
    """Put every event on each participant's default calendar through Calendar's invite flow."""
    from suite.calendar.api.invites import add_invite_to_calendar

    monday = (now - timedelta(days=now.weekday())).date()
    count = 0
    for event in agenda.EVENTS:
        ics = calendar_file(event, monday, now, method="REQUEST" if event.attendees else "PUBLISH")
        for key in event.participants:
            email = PEOPLE_BY_KEY[key].email
            blob = stalwart.mailbox(email).upload(ics, "text/calendar")
            frappe.set_user(email)
            add_invite_to_calendar(personal_account(email), blob)
            count += 1
    frappe.set_user("Administrator")
    return count


def moment(now: datetime, days_ago: int, time: str, index: int) -> datetime:
    hour, minute = (int(part) for part in time.split(":"))
    sent_at = (now - timedelta(days=days_ago)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    # A message the story places later today goes out shortly before the seed runs.
    return min(sent_at, now - timedelta(minutes=30 - index))


def expand(target: str) -> tuple[str, ...]:
    if target in LISTS:
        return LISTS[target][1]
    return (target,) if target in PEOPLE_BY_KEY else ()


def address(key: str) -> str:
    if person := PEOPLE_BY_KEY.get(key):
        return formataddr((f"{person.first} {person.last}", person.email))
    if key in LISTS:
        return formataddr((LISTS[key][0], f"{key}@{DOMAIN}"))
    return formataddr(inbox.OUTSIDE[key])


def compose(
    message: inbox.Message,
    subject: str,
    message_id: str,
    references: list[str],
    sent_at: datetime,
    headers: dict[str, str],
    calendar: bytes | None = None,
) -> bytes:
    mime = EmailMessage()
    mime["From"] = address(message.sender)
    mime["To"] = ", ".join(address(key) for key in message.to)
    if message.cc:
        mime["Cc"] = ", ".join(address(key) for key in message.cc)
    mime["Subject"] = subject
    mime["Date"] = format_datetime(sent_at)
    mime["Message-ID"] = f"<{message_id}>"
    if references:
        mime["In-Reply-To"] = f"<{references[-1]}>"
        mime["References"] = " ".join(f"<{reference}>" for reference in references)
    for name, value in headers.items():
        mime[name] = value
    text = unescape(re.sub(r"<[^>]+>", "", message.body.replace("</p>", "\n\n").replace("<br>", "\n")))
    mime.set_content(text.strip())
    mime.add_alternative(message.body, subtype="html")
    for attachment in message.attachments:
        maintype, subtype = attachment.content_type.split("/")
        data = pdf(attachment.lines) if subtype == "pdf" else "\n".join(attachment.lines).encode()
        mime.add_attachment(data, maintype=maintype, subtype=subtype, filename=attachment.name)
    if calendar:
        mime.add_attachment(
            calendar, maintype="text", subtype="calendar", params={"method": "REQUEST"}, filename="invite.ics"
        )
    return mime.as_bytes()


def calendar_file(event: agenda.Event, monday: date, now: datetime, method: str) -> bytes:
    start = event.start(monday)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Northwind Labs//Suite demo//EN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{event.uid}",
        f"DTSTAMP:{now.astimezone(UTC):%Y%m%dT%H%M%SZ}",
        f"DTSTART;VALUE=DATE:{start:%Y%m%d}"
        if event.all_day
        else f"DTSTART;TZID={now.tzinfo}:{start:%Y%m%dT%H%M%S}",
        f"DURATION:{event.duration}",
        f"SUMMARY:{ics_text(event.title)}",
    ]
    if event.rule:
        lines.append(f"RRULE:{event.rule}")
    if event.location:
        lines.append(f"LOCATION:{ics_text(event.location)}")
    if event.description:
        lines.append(f"DESCRIPTION:{ics_text(event.description)}")
    if event.attendees:
        organizer = PEOPLE_BY_KEY[event.organizer]
        lines.append(f"ORGANIZER;CN={organizer.first} {organizer.last}:mailto:{organizer.email}")
        lines.append(attendee(event.organizer, agenda.ACCEPTED, "CHAIR"))
        lines.extend(attendee(key, status, "REQ-PARTICIPANT") for key, status in event.attendees.items())
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "".join(fold(line) + "\r\n" for line in lines).encode()


def attendee(key: str, status: str, role: str) -> str:
    person = PEOPLE_BY_KEY[key]
    return f"ATTENDEE;CN={person.first} {person.last};ROLE={role};PARTSTAT={status};RSVP=TRUE:mailto:{person.email}"


def ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line: str) -> str:
    return "\r\n ".join(line[start : start + 73] for start in range(0, len(line), 73))


def pdf(lines: tuple[str, ...]) -> bytes:
    """A one-page PDF that shows `lines` in Helvetica."""
    escaped = (line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines)
    shown = " ".join(f"({line}) Tj T*" for line in escaped)
    stream = f"BT /F1 12 Tf 72 720 Td 18 TL {shown} ET"
    objects = (
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    )
    document = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(document))
        document += f"{number} 0 obj\n{body}\nendobj\n".encode()
    table = "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{len(document)}\n%%EOF\n"
    return document + f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n{table}{trailer}".encode()
