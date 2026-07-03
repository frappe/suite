import os
import re

import frappe
from croniter import CroniterBadCronError, croniter
from frappe import _
from frappe.utils import cint, validate_email_address
from frappe.utils.caching import request_cache

from suite.mail.utils import get_config

# A domain label is 1-63 chars of letters/digits/hyphens (no leading/trailing hyphen); a domain name is
# two or more such labels joined by dots, at most 253 chars overall (e.g. "frappe.io").
DOMAIN_NAME_PATTERN = re.compile(
	r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$"
)


def is_domain_entry(value: str) -> bool:
	"""Whether a screened value denotes a whole domain, i.e. is prefixed with '@' (e.g. '@frappe.io')."""

	return (value or "").startswith("@")


def normalize_screened_value(value: str) -> str:
	"""Normalise a screened value: trim it, and lowercase the domain of a '@domain' entry so that
	'@Frappe.io' and '@frappe.io' collapse to a single rule."""

	value = (value or "").strip()
	if is_domain_entry(value):
		return "@" + value[1:].strip().lower()

	return value


def validate_screened_value(value: str, raise_exception: bool = False) -> bool:
	"""Validate a Screened Email Address value.

	A value is valid when it is either a full email address (e.g. "john@example.com") or a domain
	prefixed with '@' (e.g. "@example.com"), which screens every sender from that domain.
	"""

	value = (value or "").strip()

	if is_domain_entry(value):
		is_valid = bool(DOMAIN_NAME_PATTERN.match(value[1:]))
	else:
		is_valid = bool(value) and bool(validate_email_address(value))

	if not is_valid and raise_exception:
		frappe.throw(
			_(
				"{0} is not a valid email address or domain. Enter an email address (e.g. john@example.com) "
				"or a domain prefixed with @ (e.g. @example.com)."
			).format(frappe.bold(value or "''"))
		)

	return is_valid


def is_subaddressed_email(email: str, raise_exception: bool = False) -> bool:
	"""Returns True if the email address contains subaddressing else False."""

	if re.search(r"[^@]+\+[^@]+@", email):
		if raise_exception:
			frappe.throw(_("Subaddressing is not allowed in the email address."))

		return True
	return False


def is_valid_email_for_domain(email: str, domain_name: str, raise_exception: bool = False) -> bool:
	"""Returns True if the email domain matches with the given domain else False."""

	email_domain = email.split("@")[1]

	if email_domain != domain_name:
		if raise_exception:
			frappe.throw(
				_("Email domain {0} does not match with domain {1}.").format(
					frappe.bold(email_domain), frappe.bold(domain_name)
				)
			)

		return False
	return True


def validate_jmap_structure(
	base_dir: str, required_files: list[str] | None = None, raise_exception: bool = False
) -> list[str]:
	"""Validates a JMAP import directory. Returns a list of missing files or folders."""

	required_files = required_files or {
		"emails.json",
		"identities.json",
		"mailboxes.json",
		"sieve.json",
		"vacation.json",
	}
	required_dirs = {"blobs"}

	missing = []
	base_folder = os.path.basename(base_dir)

	for file in required_files:
		if not os.path.isfile(os.path.join(base_dir, file)):
			missing.append(f"/{base_folder}/{file}")

	for dir in required_dirs:
		if not os.path.isdir(os.path.join(base_dir, dir)):
			missing.append(f"/{base_folder}/{dir}/")

	if missing and raise_exception:
		frappe.throw(
			_("Missing required files/directories for JMAP format: {0}").format(
				", ".join(f"{m}" for m in missing)
			),
			title=_("Invalid JMAP Structure"),
		)

	return missing


def is_valid_maildir(base_dir: str, raise_exception: bool = False) -> bool:
	"""
	Checks if the given base directory is a valid Maildir.

	Valid if at least one of `cur`, `new`, or `tmp` exists
	and contains at least one file (recursively).
	"""

	def has_file(dir_path: str) -> bool:
		for _root, _dirs, files in os.walk(dir_path):
			if files:
				return True
		return False

	maildir_dirs = ("cur", "new", "tmp")
	for d in maildir_dirs:
		dir_path = os.path.join(base_dir, d)
		if os.path.isdir(dir_path) and has_file(dir_path):
			return True

	if raise_exception:
		frappe.throw(
			_("Invalid Maildir format: at least one of {0} must exist and contain files.").format(
				", ".join(f"<code>{d}</code>" for d in maildir_dirs)
			),
			title=_("Invalid Maildir"),
		)

	return False


def validate_maildir_or_maildirpp(base_dir: str, raise_exception: bool = False) -> list[str]:
	"""Validates a base Maildir or Maildir++ structure. Returns a list of invalid subdirs (relative paths)."""

	invalid_dirs = []

	def to_rel(path) -> str:
		rel = os.path.relpath(path, base_dir)
		return "/" if rel == "." else f"/{rel}"

	if not is_valid_maildir(base_dir, raise_exception=False):
		invalid_dirs.append("/")

	for entry in os.listdir(base_dir):
		full_path = os.path.join(base_dir, entry)
		if entry.startswith(".") and os.path.isdir(full_path):
			if not is_valid_maildir(full_path, raise_exception=False):
				invalid_dirs.append(to_rel(full_path))

	if invalid_dirs and raise_exception:
		frappe.throw(
			_("Invalid Maildir format in the following directories: {0}").format(
				", ".join(f"<code>{d}</code>" for d in invalid_dirs)
			),
			title=_("Invalid Maildir"),
		)

	return invalid_dirs


def validate_nested_maildir_tree(base_dir: str, raise_exception: bool = False) -> list[str]:
	"""
	Recursively validates a nested Maildir++ tree.

	A mailbox is valid if it:
	- contains cur/ or new/
	- OR contains child mailboxes (.Child)
	"""

	invalid_dirs: list[str] = []
	base_dir = os.path.abspath(base_dir)

	def to_rel(path: str) -> str:
		rel = os.path.relpath(path, base_dir)
		return "/" if rel == "." else f"/{rel}"

	def is_valid_nested_mailbox(path: str) -> bool:
		try:
			entries = os.listdir(path)
		except OSError:
			return False

		has_maildir = any(
			name in ("cur", "new") and os.path.isdir(os.path.join(path, name)) for name in entries
		)
		has_children = any(
			name.startswith(".") and os.path.isdir(os.path.join(path, name)) for name in entries
		)

		return has_maildir or has_children

	def walk(path: str) -> None:
		for entry in os.listdir(path):
			if not entry.startswith("."):
				continue

			full_path = os.path.join(path, entry)
			if not os.path.isdir(full_path):
				continue

			if not is_valid_nested_mailbox(full_path):
				invalid_dirs.append(to_rel(full_path))

			walk(full_path)

	walk(base_dir)

	if invalid_dirs and raise_exception:
		frappe.throw(
			_("Invalid Maildir format in the following directories: {0}").format(
				", ".join(f"<code>{d}</code>" for d in invalid_dirs)
			),
			title=_("Invalid Maildir"),
		)

	return invalid_dirs
