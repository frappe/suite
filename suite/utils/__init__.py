import os
import re
import unicodedata
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

import frappe
import wrapt
from bs4 import BeautifulSoup
from frappe import _
from frappe.types.filter import FilterTuple
from MySQLdb import OperationalError

INVISIBLE_CHARS = (
	r"[\u0000-\u001F\u007F-\u009F"  # ASCII control chars
	r"\u200B-\u200F\u202A-\u202E"  # zero-width & directional
	r"\u2060-\u206F"  # word joiners etc
	r"\uFEFF"  # byte order mark
	r"\u00AD"  # soft hyphen
	r"\u034F]"  # combining grapheme joiner
)


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


def log_error(module: str, title: str | None = None, message: str | None = None, **kwargs) -> None:
	"""Logs an error, prefixing the title with "[module]" so module errors can be filtered out.

	Wraps `frappe.log_error` and should be used in place of it throughout the app.
	"""

	prefix = f"[{module}] "
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
		module = func.__module__.split(".")[0].title() if hasattr(func, "__module__") else "Unknown"

		log_error(
			module=module,
			title=title,
			message=frappe.get_traceback(with_context=with_context),
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


def generate_otp(length: int = 5) -> int:
	"""Generates a random OTP."""

	lower_bound = 10 ** (length - 1)
	upper_bound = 10**length
	return int.from_bytes(os.urandom(length), byteorder="big") % (upper_bound - lower_bound) + lower_bound


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
