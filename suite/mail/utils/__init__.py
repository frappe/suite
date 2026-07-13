import base64
import gzip
import hashlib
import os
import random
import re
import secrets
import string
import tarfile
import unicodedata
import zipfile
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from io import BytesIO
from typing import Any, Literal

import bcrypt
import frappe
import wrapt
from bs4 import BeautifulSoup, Comment
from frappe import _
from frappe.types.filter import FilterTuple
from frappe.utils import cint, get_bench_path
from frappe.utils.caching import request_cache
from markdown_it import MarkdownIt
from MySQLdb import OperationalError
from passlib.hash import sha512_crypt

INVISIBLE_CHARS = (
	r"[\u0000-\u001F\u007F-\u009F"  # ASCII control chars
	r"\u200B-\u200F\u202A-\u202E"  # zero-width & directional
	r"\u2060-\u206F"  # word joiners etc
	r"\uFEFF"  # byte order mark
	r"\u00AD"  # soft hyphen
	r"\u034F]"  # combining grapheme joiner
)


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
	"fetch_lock_timeout",
	"lock_acquire_timeout",
	"lock_timeout",
]


def reconnect_on_failure(max_retries: int = 3) -> callable:
	"""Decorator to reconnect to the database if a connection error occurs."""

	@wrapt.decorator
	def wrapper(wrapped, instance, args, kwargs):
		retries = 0

		while True:
			try:
				return wrapped(*args, **kwargs)

			except Exception as e:
				is_db_error = frappe.db.is_interface_error(e) or isinstance(e, OperationalError)

				if not is_db_error or retries >= max_retries:
					raise type(e)(f"{e!s} | Retries attempted: {retries}/{max_retries}") from e

				retries += 1
				frappe.db.connect()

	return wrapper


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


def log_error(title: str | None = None, message: str | None = None, **kwargs) -> None:
	"""Logs an error, prefixing the title with "[Mail]" so Mail app errors can be filtered out.

	Wraps `frappe.log_error` and should be used in place of it throughout the Mail app.
	"""

	prefix = "[Mail] "
	if title and not title.startswith(prefix):
		title = f"{prefix}{title}"

	frappe.log_error(title=title, message=message, **kwargs)


def execute_with_logging(
	func: callable, title: str, user_message: str | None = None, with_context: bool = False, *args, **kwargs
) -> Any | None:
	"""Executes a function and logs any exceptions that occur, optionally throwing a user-friendly message."""

	try:
		return func(*args, **kwargs)
	except Exception:
		log_error(
			title,
			frappe.get_traceback(with_context=with_context),
		)
		if user_message:
			frappe.throw(title=title, msg=user_message)


@contextmanager
def user_context(user: str) -> Generator[None, None, None]:
	"""Context manager to temporarily switch the user context."""

	session_user = frappe.session.user
	session_sid = frappe.session.sid
	session_data = frappe.session.data.copy()

	if session_user == user:
		yield
		return

	try:
		frappe.set_user(user)
		yield
	finally:
		# frappe.set_user() overwrites session.sid with the username and wipes session.data,
		# so restore both alongside the user to avoid corrupting the original session.
		frappe.set_user(session_user)
		frappe.session.sid = session_sid
		frappe.session.data = session_data


def snake_to_camel(input) -> str:
	"""Convert snake_case string to camelCase."""

	parts = input.split("_")
	return parts[0] + "".join(word.capitalize() for word in parts[1:])


def generate_otp(length=5) -> int:
	"""Generates a random OTP."""

	lower_bound = 10 ** (length - 1)
	upper_bound = 10**length
	return int.from_bytes(os.urandom(length), byteorder="big") % (upper_bound - lower_bound) + lower_bound


def extract_compressed_file(file_path: str, destination: str) -> None:
	"""Extract a .zip, .tar.gz, or .tgz archive safely."""

	def is_within_directory(base_path, target_path) -> bool:
		"""Ensure target_path is inside base_path"""

		base_path = os.path.abspath(base_path)
		target_path = os.path.abspath(target_path)
		return os.path.commonpath([base_path]) == os.path.commonpath([base_path, target_path])

	def safe_extract_zip(archive, destination) -> None:
		"""Safely extract ZIP files, preventing path traversal."""

		for member in archive.namelist():
			member_path = os.path.join(destination, member)
			if not is_within_directory(destination, member_path):
				frappe.throw(_("Unsafe file path detected: {0}").format(member))
		archive.extractall(destination)

	def safe_extract_tar(archive, destination) -> None:
		"""Safely extract TAR files, preventing path traversal."""

		for member in archive.getmembers():
			member_path = os.path.join(destination, member.name)
			if not is_within_directory(destination, member_path):
				frappe.throw(_("Unsafe file path detected: {0}").format(member.name))
		archive.extractall(destination)

	if not os.path.exists(file_path):
		frappe.throw(_("File not found: {0}").format(file_path))

	if not os.path.exists(destination):
		os.makedirs(destination, exist_ok=True)

	if file_path.endswith(".zip"):
		with zipfile.ZipFile(file_path, "r") as archive:
			safe_extract_zip(archive, destination)

	elif file_path.endswith((".tar.gz", ".tgz")):
		with tarfile.open(file_path, "r:gz") as archive:
			safe_extract_tar(archive, destination)

	else:
		frappe.throw(_("Unsupported file format: {0}").format(file_path))


def get_mbox_files(base_dir: str) -> list[str]:
	"""Recursively find and return all .mbox files under the given directory."""

	mbox_files = [
		os.path.join(root, filename)
		for root, _, files in os.walk(base_dir)
		for filename in files
		if filename.endswith(".mbox")
	]
	return mbox_files


def compress_directory(source_dir: str, output_path: str) -> None:
	"""Compress a directory into .zip, .tgz, or .tar.gz format based on output file extension."""

	if output_path.endswith(".zip"):
		with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
			for root, _dirs, files in os.walk(source_dir):
				for file in files:
					file_path = os.path.join(root, file)
					relative_path = os.path.relpath(file_path, source_dir)
					zip_file.write(file_path, relative_path)

	elif output_path.endswith(".tgz") or output_path.endswith(".tar.gz"):
		with tarfile.open(output_path, "w:gz") as tar_file:
			tar_file.add(source_dir, arcname=".")

	else:
		frappe.throw(_("Unsupported output file format. Supported formats are .zip, .tgz, and .tar.gz."))


def enqueue_job(
	method: str | Callable, job_id: str | None = None, deduplicate: bool = False, **kwargs
) -> None:
	"""Enqueues a background job."""

	if deduplicate and not job_id:
		job_id = method.split(".")[-1] if isinstance(method, str) else method.__name__

	frappe.enqueue(method, job_id=job_id, deduplicate=deduplicate, **kwargs)


def clean_text(text: str) -> str:
	"""Collapse multiple spaces into a single space and trim leading/trailing spaces."""

	if not text:
		return ""

	text = unicodedata.normalize("NFKC", text)
	text = re.sub(INVISIBLE_CHARS, "", text)
	text = re.sub(r"([,.!?])(?=\w)", r"\1 ", text)

	return re.sub(r"\s+", " ", text).strip()


def convert_html_to_text(html: str) -> str:
	"""Returns plain text from HTML <body> content, excluding interactive elements but keeping anchor text."""

	if not html:
		return ""

	soup = BeautifulSoup(html, "html.parser")
	body = soup.body or soup

	for tag in body.find_all(["a", "button", "input"]):
		if tag.name == "a":
			tag.unwrap()
		elif tag.name == "input" and tag.get("type") not in ("button", "submit", "reset"):
			continue
		else:
			tag.decompose()

	text = body.get_text(separator=" ")
	return clean_text(text)


def parse_filters(filters: list | None) -> dict:
	"""Parses a list of filters into a dictionary of fieldname-value pairs for equality conditions."""

	if not filters:
		return {}

	result = {}
	for f in filters:
		if isinstance(f, list):
			f = FilterTuple(f)

		if f.operator == "=":
			result[f.fieldname] = f.value

	return result


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
