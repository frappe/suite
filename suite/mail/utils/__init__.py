import hashlib
import os
from typing import Any

import frappe
from frappe import _
from frappe.utils import get_bench_path
from frappe.utils.caching import request_cache

from suite.utils import log_error

CONFIG_KEYS = [
	# JMAP
	"server_url",
	"username",
	"password",
	"verify_ssl",
	# SpamAssassin
	"spamd_host",
	"spamd_port",
	"spamd_scanning_mode",
	"spamd_hybrid_scanning_threshold",
	# Defaults
	"default_dns_ttl",
	"default_disk_quota_gb",
	"disabled_account_role",
	"enable_gravatar",
	"default_gravatar",
	"stalwart_version",
	"stalwart_cli_version",
	# Logs
	"push_log_file_count",
	"push_log_level",
	"push_log_max_file_size",
	"storage_log_file_count",
	"storage_log_level",
	"storage_log_max_file_size",
	"inbound_log_file_count",
	"inbound_log_level",
	"inbound_log_max_file_size",
	"outbound_log_file_count",
	"outbound_log_level",
	"outbound_log_max_file_size",
	"exchange_log_file_count",
	"exchange_log_level",
	"exchange_log_max_file_size",
	# Limits
	"exchange_max_export",
	"exchange_max_import",
	"exchange_export_batch_size",
	"max_email_sync",
	"max_message_payload_size_mb",
	"max_push_notifications",
	"process_pending_emails_batch_size",
	"process_pending_emails_max_batch_size",
	# Timeouts
	"ansible_play_timeout",
	"server_job_timeout",
	"server_deployment_timeout",
	"scan_message_timeout",
	"process_pending_emails_timeout",
	"stalwart_cli_command_timeout",
	"exchange_export_timeout",
	"exchange_import_timeout",
]


@request_cache
def get_config(key: str | tuple[str, ...] | None = None) -> dict[str, Any] | tuple | Any:
	"""Fetches configuration values, prioritizing Mail Settings over global config.

	Cached per request: the returned dict is shared, so callers must treat it as read-only.
	"""

	mail_conf = frappe.conf.mail or {}
	settings = frappe.get_cached_doc("Mail Settings")

	config = {}
	for field in CONFIG_KEYS:
		if field == "password":
			config[field] = password_or_none(settings, field) or mail_conf.get(field)
		else:
			config[field] = settings.get(field) or mail_conf.get(field)

	if key:
		if isinstance(key, str):
			key = [key]

		for k in key:
			if k not in config:
				frappe.throw(_("Mail config key '{0}' not found").format(k))

		return tuple(config[k] for k in key) if len(key) > 1 else config[key[0]]

	return config


def is_stalwart_configured(raise_exception: bool = False) -> bool:
	"""Checks if the Stalwart server is properly configured."""

	config = get_config()

	server_url = config.get("server_url")
	username = config.get("username")
	password = config.get("password")

	if server_url and (username and password):
		return True

	if raise_exception:
		frappe.throw(_("Stalwart server is not properly configured. Please check your Mail Settings."))

	return False


def log_mail_error(title: str | None = None, message: str | None = None, **kwargs) -> None:
	"""Logs an error, prefixing the title with "[Mail]" so mail errors can be filtered out."""

	log_error("Mail", title=title, message=message, **kwargs)


def get_mbox_files(base_dir: str) -> list[str]:
	"""Recursively find and return all .mbox files under the given directory."""

	mbox_files = [
		os.path.join(root, filename)
		for root, _, files in os.walk(base_dir)
		for filename in files
		if filename.endswith(".mbox")
	]
	return mbox_files


def flatten_dict(d, parent_key="", sep=".") -> dict:
	"""Recursively flattens a nested dictionary into dot notation."""

	items = {}
	for k, v in d.items():
		new_key = f"{parent_key}{sep}{k}" if parent_key else k
		if isinstance(v, dict):
			items.update(flatten_dict(v, new_key, sep))
		else:
			items[new_key] = v
	return items


def password_or_none(doc, field: str) -> str | None:
	"""Returns the password if the field is set, otherwise returns None."""

	return doc.get_password(field) if doc.get(field) else None


def generate_uuid_style_hash(input_str: str) -> str:
	"""Generates a UUID-style hash from the input string."""

	hash = hashlib.md5(input_str.encode()).hexdigest()
	return f"{hash[:8]}-{hash[8:12]}-{hash[12:16]}-{hash[16:20]}-{hash[20:]}"


def get_mail_app_path() -> str:
	"""Returns the path to the Suite app directory."""

	return os.path.join(get_bench_path(), "apps/suite")


def get_messages_directory() -> str:
	"""Returns the path to the messages directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "raw_messages")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_mail_import_directory() -> str:
	"""Returns the path to the mail import directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "mail-exchange", "import")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_mail_export_directory() -> str:
	"""Returns the path to the mail export directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "mail-exchange", "export")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_calendar_import_directory() -> str:
	"""Returns the path to the calendar import directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "calendar-exchange", "import")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_calendar_export_directory() -> str:
	"""Returns the path to the calendar export directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "calendar-exchange", "export")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_contacts_import_directory() -> str:
	"""Returns the path to the contacts import directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "contacts-exchange", "import")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_contacts_export_directory() -> str:
	"""Returns the path to the contacts export directory for the current site."""

	directory = os.path.join(get_bench_path(), "sites", frappe.local.site, "contacts-exchange", "export")
	os.makedirs(directory, exist_ok=True)
	return directory


def get_stalwart_cli_path(raise_exception: bool = False) -> str:
	"""Returns the path to the Stalwart CLI tool, raising an error if not found."""

	cli_path = os.path.join(get_mail_app_path(), "stalwart-cli")
	if not os.path.exists(cli_path) and raise_exception:
		relpath = os.path.relpath(cli_path, get_bench_path())
		frappe.throw(_("Stalwart CLI not found at {0}.").format(relpath))

	return cli_path


def get_stalwart_version() -> str:
	"""Returns the Stalwart version from configuration or default."""

	return get_config("stalwart_version")


def get_stalwart_cli_version() -> str:
	"""Returns the Stalwart CLI version from configuration or default."""

	return get_config("stalwart_cli_version")
