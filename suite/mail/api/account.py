import json
from typing import Literal

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, get_url, now_datetime
from frappe.utils.data import sha256_hash

from suite.mail.api.admin import add_member
from suite.mail.api.mail import normalize_filter
from suite.mail.api.utils import get_avatar_url
from suite.mail.doctype.identity.identity import fetch_identities
from suite.mail.doctype.mail_settings.mail_settings import get_signup_domains
from suite.mail.stalwart import get_domains
from suite.mail.utils import convert_html_to_text, is_stalwart_configured, log_error, user_context
from suite.mail.utils.dns import parse_dns_zone_file
from suite.mail.utils.rate_limiter import dynamic_rate_limit
from suite.mail.utils.user import (
	has_user_settings,
	is_jmap_configured,
	is_mail_admin,
	is_system_manager,
)

# SRV service label -> (protocol, connection security). See RFC 6186.
_SRV_SERVICE_MAP = {
	"_submissions": ("SMTP", "SSL/TLS"),
	"_submission": ("SMTP", "STARTTLS"),
	"_imaps": ("IMAP", "SSL/TLS"),
	"_imap": ("IMAP", "STARTTLS"),
	"_pop3s": ("POP3", "SSL/TLS"),
	"_pop3": ("POP3", "STARTTLS"),
}


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def validate_email_assigned(email: str) -> None:
	"""Checks if email is already assigned"""

	if frappe.db.exists("User", {"email": email}):
		frappe.throw(_("Username already taken."))


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def signup(
	username: str,
	domain: str,
	email: str,
	password: str,
	first_name: str,
	last_name: str | None = None,
) -> None:
	"""Create a new Mail Account for signup"""

	if not frappe.db.get_single_value("Mail Settings", "allow_signup"):
		frappe.throw(_("Signup is disabled."))

	if domain not in get_signup_domains():
		frappe.throw(_("Domain {0} is not allowed for signup.").format(domain))

	with user_context("Administrator"):
		add_member(username, domain, ["User"], False, email, first_name, last_name, password)


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def resend_otp(account_request: str) -> None:
	"""Resend OTP to the user"""

	account_request = frappe.get_doc("Mail Account Request", account_request)
	account_request.set_otp()
	account_request.save(ignore_permissions=True)
	account_request.send_verification_email()


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def verify_otp(account_request: str, otp: str) -> str:
	"""Verify the OTP and return the request key"""

	otp_hash = frappe.cache.get_value(f"account_request_otp_hash:{account_request}", expires=True)
	if not otp_hash or otp_hash != frappe.utils.sha256_hash(otp):
		frappe.throw(_("Invalid OTP. Please try again."))

	frappe.cache.delete_value(f"account_request_otp_hash:{account_request}")
	return frappe.db.get_value("Mail Account Request", account_request, "request_key")


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def get_account_request(request_key: str) -> dict | None:
	"""Return the account request details"""

	if account_request := frappe.db.get_value(
		"Mail Account Request",
		{"request_key": request_key},
		["backup_email", "is_verified", "expires_at", "account"],
		as_dict=True,
	):
		is_expired = 0
		if expires_at := account_request["expires_at"]:
			is_expired = cint(get_datetime(expires_at) < now_datetime())
		account_request.pop("expires_at")
		account_request["is_expired"] = is_expired
		return account_request


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def create_account(request_key: str, first_name: str, last_name: str, password: str) -> None:
	"""Create a new mail account"""

	account_request = frappe.get_last_doc("Mail Account Request", {"request_key": request_key})
	account_request.validate_expired()
	account_request.is_verified = 1
	account_request.save(ignore_permissions=True)

	if account_request.account:
		account_request.create_account(first_name, last_name, password)


@frappe.whitelist(allow_guest=True)
def get_user_info() -> dict | None:
	"""Returns user information."""

	user = frappe.session.user
	if user == "Guest":
		return None

	if not has_user_settings(user):
		user_settings = frappe.new_doc("User Settings")
		user_settings.user = user
		user_settings.insert(ignore_permissions=True)

	USER = frappe.qb.DocType("User")
	USER_SETTINGS = frappe.qb.DocType("User Settings")

	result = (
		frappe.qb.from_(USER)
		.join(USER_SETTINGS)
		.on(USER.name == USER_SETTINGS.user)
		.select(
			USER.name,
			USER.email,
			USER.enabled,
			USER.user_image,
			USER.full_name,
			USER.first_name,
			USER.last_name,
			USER.user_type,
			USER.username,
			USER.api_key,
			USER_SETTINGS.color_scheme,
			USER_SETTINGS.group_messages_by,
			USER_SETTINGS.show_reading_pane,
			USER_SETTINGS.name.as_("user_settings"),
		)
		.where(USER.name == user)
	).run(as_dict=True)

	if not result:
		return None

	data = result[0]

	data.is_mail_admin = is_mail_admin(user)
	data.is_system_manager = is_system_manager(user)
	data.is_jmap_configured = is_jmap_configured(user)
	data.accounts = frappe.db.get_all("User Account", {"user": user}, ["account"])

	settings_by_account = {
		s["name"]: s
		for s in frappe.get_all(
			"JMAP Account",
			filters={"name": ["in", [account["account"] for account in data.accounts]]},
			fields=[
				"name",
				"_name",
				"is_personal",
				"default_outgoing_email",
				"on_mark_as_junk",
				"enable_screening",
				"block_remote_images",
			],
		)
	}
	for account in data.accounts:
		settings = settings_by_account.get(account["account"])
		account["id"] = account["account"]
		account["_name"] = settings["_name"] if settings else None
		account["is_personal"] = bool(settings["is_personal"]) if settings else False
		account["jmap_account"] = settings["name"] if settings else None
		account["default_outgoing_email"] = settings["default_outgoing_email"] if settings else None
		account["on_mark_as_junk"] = settings["on_mark_as_junk"] if settings else "Junk Sender's Mail"
		account["enable_screening"] = bool(settings["enable_screening"]) if settings else False
		account["block_remote_images"] = bool(settings["block_remote_images"]) if settings else True

	data.user_image = data.user_image or get_avatar_url(user)

	return data


@frappe.whitelist()
def get_mail_client_config() -> list[dict]:
	"""Returns the SMTP/IMAP/POP endpoints for connecting third-party mail clients.

	Resolution order:
	1. Master switch off -> nothing.
	2. Endpoints entered by the admin in Mail Settings.
	3. Fallback: parse the user's domain DNS SRV records (if Stalwart is configured).
	"""

	settings = frappe.get_cached_doc("Mail Settings")
	if not settings.show_mail_client_config:
		return []

	if settings.mail_client_configurations:
		return [
			{
				"protocol": row.protocol,
				"hostname": row.hostname,
				"port": row.port,
				"connection_security": row.connection_security,
			}
			for row in settings.mail_client_configurations
		]

	if is_stalwart_configured():
		return _get_client_config_from_dns()

	return []


def _get_client_config_from_dns() -> list[dict]:
	"""Derives mail-client endpoints from the domain DNS SRV records.

	Best-effort: on any failure (Stalwart unreachable, malformed zone file) the error is
	logged and an empty list is returned so the Advanced tab degrades gracefully.
	"""

	try:
		domains = get_domains()
		if not domains:
			return []

		config = []

		# Every domain on the cluster points at the same mail server, so their SRV records
		# resolve to identical client endpoints. Any one domain's zone is enough.
		domain = domains[0]

		for record in parse_dns_zone_file(domain["dnsZoneFile"]):
			if record["type"] != "SRV":
				continue

			mapping = _SRV_SERVICE_MAP.get(record["name"].split(".")[0])
			if not mapping:
				continue

			# SRV rdata: <priority> <weight> <port> <target>. "." target means not offered.
			parts = record["value"].split()
			if len(parts) < 4 or parts[3] == ".":
				continue

			protocol, connection_security = mapping
			config.append(
				{
					"protocol": protocol,
					"hostname": parts[3].rstrip("."),
					"port": cint(parts[2]),
					"connection_security": connection_security,
				}
			)

		return config
	except Exception:
		log_error(title=_("Failed to derive mail client config from DNS"), message=frappe.get_traceback())
		return []


def get_backup_email(user: str) -> str:
	"""Return backup email for a user or the user's email if backup doesn't exist"""

	if backup_email := frappe.db.get_value("User Settings", {"user": user}, "backup_email"):
		return backup_email

	if frappe.db.exists("User", user):
		return frappe.db.get_value("User", user, "email")

	frappe.throw(_("User {0} does not exist.").format(frappe.bold(user)))


def set_reset_password_key(email: str) -> str:
	"""Generate and store a reset password key for a user"""

	key = frappe.generate_hash()
	hashed_key = sha256_hash(key)
	frappe.db.set_value(
		"User",
		email,
		{"reset_password_key": hashed_key, "last_reset_password_key_generated_on": now_datetime()},
	)
	return key


def censor_email(email: str) -> str:
	"""Censor the email address to protect privacy"""

	username, domain = email.split("@")
	censored_username = username[0] + "*" * (len(username) - 1)
	return f"{censored_username}@{domain}"


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def send_reset_password_link(user: str) -> str:
	"""Send reset password link to the user"""

	email = get_backup_email(user)
	key = set_reset_password_key(user)

	frappe.sendmail(
		recipients=email,
		subject=_("Reset Password"),
		template="reset_password",
		args={"link": get_url("/mail/reset-password/" + key)},
		now=True,
	)

	if email == user:
		return email

	return censor_email(email)


@frappe.whitelist(allow_guest=True)
def get_user_for_reset_password_key(key: str) -> str:
	"""Return the user for a reset password key"""

	hashed_key = sha256_hash(key)
	return frappe.db.get_value("User", {"reset_password_key": hashed_key}, "name")


@frappe.whitelist()
def create_mail_import(
	account: str,
	format: Literal["eml", "jmap", "mbox", "maildir", "maildir-nested"],
	file: str,
	mailbox: str | None = None,
	seen: bool = False,
) -> None:
	"""Creates mail exchange of operation import"""

	doc = frappe.new_doc("Mail Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Import"
	doc.import_format = format
	doc.import_file = file
	if format in ["eml", "maildir", "mbox"] and mailbox:
		doc.import_metadata = json.dumps({"mailboxIds": {mailbox: True}, "keywords": {"$seen": seen}})
	doc.insert()
	doc.submit()


@frappe.whitelist()
def create_mail_export(
	account: str,
	format: Literal["jmap", "mbox", "maildir", "maildir-nested"],
	archive_type: Literal[".zip", ".tgz", ".tar.gz"],
	sort: Literal["Received At (ASC)", "Received At (DESC)"],
	limit: int | None = None,
	filter: dict | None = None,
) -> None:
	"""Creates mail exchange of operation export"""

	doc = frappe.new_doc("Mail Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Export"
	doc.export_format = format
	doc.export_archive_type = archive_type
	doc.export_sort = sort
	doc.export_limit = limit
	if filter:
		filter = {k: v for k, v in filter.items() if v}
		if filter:
			doc.export_filter = json.dumps(normalize_filter(filter))
	doc.insert()
	doc.submit()


@frappe.whitelist()
def create_calendar_import(
	account: str,
	format: Literal["ics", "jmap"],
	file: str,
	calendar: str | None = None,
) -> None:
	"""Creates calendar exchange of operation import"""

	doc = frappe.new_doc("Calendar Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Import"
	doc.import_format = format
	doc.import_file = file
	if calendar:
		doc.import_metadata = json.dumps({"calendarIds": {calendar: True}})
	doc.insert()
	doc.submit()


@frappe.whitelist()
def create_calendar_export(
	account: str,
	format: Literal["ics", "jmap"],
	archive_type: Literal[".zip", ".tgz", ".tar.gz"],
	sort: Literal["Start (ASC)", "Start (DESC)"],
	limit: int | None = None,
	filter: dict | None = None,
) -> None:
	"""Creates calendar exchange of operation export"""

	doc = frappe.new_doc("Calendar Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Export"
	doc.export_format = format
	doc.export_archive_type = archive_type
	doc.export_sort = sort
	doc.export_limit = limit
	if filter:
		filter = {k: v for k, v in filter.items() if v}
		if normalized := normalize_calendar_filter(filter):
			doc.export_filter = json.dumps(normalized)
	doc.insert()
	doc.submit()


def normalize_calendar_filter(filter: dict) -> dict:
	"""Normalize a calendar export filter into a JMAP CalendarEvent/query FilterCondition."""

	from suite.mail.utils.dt import convert_to_utc

	normalized = {}
	if title := filter.get("title"):
		normalized["title"] = title
	if in_calendar := filter.get("inCalendar"):
		normalized["inCalendar"] = in_calendar
	for key in ("after", "before"):
		if value := filter.get(key):
			normalized[key] = convert_to_utc(value, naive=True).strftime("%Y-%m-%dT%H:%M:%SZ")

	return normalized


@frappe.whitelist()
def create_contacts_import(
	account: str,
	format: Literal["vcf", "jmap"],
	file: str,
	address_book: str | None = None,
) -> None:
	"""Creates contacts exchange of operation import"""

	doc = frappe.new_doc("Contacts Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Import"
	doc.import_format = format
	doc.import_file = file
	if address_book:
		doc.import_metadata = json.dumps({"addressBookIds": {address_book: True}})
	doc.insert()
	doc.submit()


@frappe.whitelist()
def create_contacts_export(
	account: str,
	format: Literal["jmap", "vcf"],
	archive_type: Literal[".zip", ".tgz", ".tar.gz"],
	limit: int | None = None,
	filter: dict | None = None,
) -> None:
	"""Creates contacts exchange of operation export"""

	doc = frappe.new_doc("Contacts Exchange")
	doc.user = frappe.session.user
	doc.account = account
	doc.operation = "Export"
	doc.export_format = format
	doc.export_archive_type = archive_type
	doc.export_limit = limit
	if filter:
		filter = {k: v for k, v in filter.items() if v}
		if normalized := normalize_contacts_filter(filter):
			doc.export_filter = json.dumps(normalized)
	doc.insert()
	doc.submit()


def normalize_contacts_filter(filter: dict) -> dict:
	"""Normalize a contacts export filter into a JMAP ContactCard/query FilterCondition."""

	normalized = {}
	if text := filter.get("text"):
		normalized["text"] = text
	if name := filter.get("name"):
		normalized["name"] = name
	if email := filter.get("email"):
		normalized["email"] = email
	if in_address_book := filter.get("inAddressBook"):
		normalized["inAddressBook"] = in_address_book

	return normalized


@frappe.whitelist()
def is_push_notification_relay_enabled() -> bool:
	return frappe.db.get_single_value("Push Notification Settings", "enable_push_notification_relay")


@frappe.whitelist()
def get_quota(account: str) -> dict:
	"""Return quota usage for the user"""

	result = {
		"disk_quota": 0,
		"used_quota": 0,
		"used_percentage": 0,
	}

	for quota in frappe.db.get_all("Quota", {"account": account}):
		if scope := quota["scope"]:
			if scope == "account":
				result["disk_quota"] = quota["hard_limit"]
				result["used_quota"] = quota["used"]

				if result["disk_quota"] > 0:
					result["used_percentage"] = (result["used_quota"] / result["disk_quota"]) * 100

				break

	return result


@frappe.whitelist()
def get_identities(account: str) -> list[dict]:
	"""Return the email identities for the user"""

	return fetch_identities(account, page=1, limit=100)


@frappe.whitelist()
def set_signature(identity: str, signature: str) -> None:
	"""Set the email signature for an identity"""

	doc = frappe.get_doc("Identity", identity)
	doc.html_signature = signature
	doc.text_signature = convert_html_to_text(signature)
	doc.db_update()
