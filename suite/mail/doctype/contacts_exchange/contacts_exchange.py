# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import os
import shutil
from typing import Literal
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import Order
from frappe.utils import (
	add_to_date,
	cint,
	create_batch,
	get_bench_path,
	get_datetime,
	get_files_path,
	get_url,
	now,
	random_string,
	time_diff_in_seconds,
)

from suite.mail.doctype.push_subscription.push_subscription import (
	freeze_jmap_push_notifications,
	unfreeze_jmap_push_notifications,
)
from suite.mail.doctype.user_account.user_account import is_jmap_account_belongs_to_user
from suite.mail.jmap import get_jmap_connection
from suite.mail.jmap.services.contacts.address_book import AddressBookService
from suite.mail.jmap.services.contacts.contact_card import ContactCardService
from suite.mail.utils import (
	get_config,
	get_contacts_export_directory,
	get_contacts_import_directory,
)
from suite.mail.utils.logger import ExchangeLogger, get_exchange_logger
from suite.mail.utils.user import (
	get_user_email_address,
	is_jmap_configured,
	is_mail_admin,
)
from suite.utils import reconnect_on_failure
from suite.utils.file import compress_directory, extract_compressed_file
from suite.utils.user import is_administrator, is_system_manager

# JSContact (RFC 9553) Name component kind -> its position in the vCard 4.0 "N" property
# (Family;Given;Additional;Prefixes;Suffixes), plus the two surname/given halves JSContact splits out.
N_COMPONENT_ORDER = ("surname", "given", "given2", "title", "generation")

# Server-managed / computed properties that must be dropped before re-creating a card,
# otherwise the JMAP server rejects the "set" call with invalidProperties. "vCard" is the raw
# source echoed back by ContactCard/parse, not a settable Card property.
SERVER_MANAGED_KEYS = (
	"id",
	"blobId",
	"vCard",
)


class ContactsExchange(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		account: DF.Link
		amended_from: DF.Link | None
		completed_at: DF.Datetime | None
		deduplicate_export: DF.Check
		duration: DF.Float
		export_archive_type: DF.Literal[".zip", ".tgz", ".tar.gz"]
		export_filter: DF.JSON | None
		export_format: DF.Literal["jmap", "vcf"]
		export_limit: DF.Int
		import_file: DF.Attach | None
		import_format: DF.Literal["vcf", "jmap"]
		import_metadata: DF.JSON | None
		operation: DF.Literal["", "Import", "Export"]
		output: DF.Code | None
		queued_at: DF.Datetime | None
		retries: DF.Int
		started_after: DF.Float
		started_at: DF.Datetime | None
		status: DF.Literal["Draft", "Queued", "In Progress", "Completed", "Failed", "Cancelled"]
		user: DF.Link
	# end: auto-generated types

	@property
	def max_import(self) -> int:
		"""Returns the maximum number of contacts allowed for import."""

		return cint(get_config("exchange_max_import"))

	@property
	def max_export(self) -> int:
		"""Returns the maximum number of contacts allowed for export."""

		return cint(get_config("exchange_max_export"))

	@property
	def export_filter_dict(self) -> dict:
		"""Returns the export filter as a dictionary."""

		if self.operation == "Export" and self.export_filter:
			return json.loads(self.export_filter)
		return {}

	@property
	def import_metadata_dict(self) -> dict:
		"""Return the import metadata as a dictionary."""

		if self.operation != "Import" or not self.import_metadata:
			return {}

		return json.loads(self.import_metadata)

	@property
	def target_address_book_ids(self) -> dict[str, bool] | None:
		"""Returns the target address book IDs for import, if specified."""

		return self.import_metadata_dict.get("addressBookIds")

	def autoname(self) -> None:
		self.name = str(uuid7())

	def validate(self) -> None:
		if self.is_new():
			self.validate_account()

		if self.operation == "Import":
			self.validate_import()
		elif self.operation == "Export":
			self.validate_export()

	def before_submit(self) -> None:
		self.status = "Queued"
		self.queued_at = now()

	def on_submit(self) -> None:
		self.process()

	def before_cancel(self) -> None:
		self.status = "Cancelled"

	def validate_account(self) -> None:
		"""Validate that the selected user can authenticate and has access to the account."""

		if not is_jmap_configured(self.user):
			frappe.throw(
				_("User {0} does not have JMAP settings configured.").format(frappe.bold(self.user)),
				frappe.PermissionError,
			)

		is_jmap_account_belongs_to_user(self.account, self.user, raise_exception=True)

	def validate_import(self) -> None:
		"""Validate the import parameters."""

		if not self.import_format:
			frappe.throw(_("Import Format is required."))
		if not self.import_file:
			frappe.throw(_("Import File is required."))

		allowed_extensions = (".vcf", ".zip", ".tgz", ".tar.gz")
		if not self.import_file.endswith(allowed_extensions):
			frappe.throw(
				_("Only {0} files are supported for import.").format(
					", ".join(f"<code>{ext}</code>" for ext in allowed_extensions)
				)
			)

		# Reject early any import_file that resolves outside the site's uploads (path traversal).
		self._resolve_import_file()

		if self.import_metadata:
			try:
				self.import_metadata = json.dumps(json.loads(self.import_metadata), indent=4)
			except json.JSONDecodeError:
				frappe.throw(_("Metadata must be valid JSON."))

	def _resolve_import_file(self) -> str:
		"""Resolves ``import_file`` to an absolute path, refusing anything outside the site's files
		directories.

		``import_file`` is an ``Attach`` URL (e.g. ``/private/files/contacts.vcf``) that the worker
		joins onto the site path before copying/extracting it. Without this guard a crafted value
		such as ``/private/files/../../../etc/passwd`` would let the job read a file anywhere on the
		filesystem, so we canonicalize the path and confirm it stays within the uploads area."""

		path = os.path.realpath(
			os.path.join(get_bench_path(), f"sites/{frappe.local.site}{self.import_file}")
		)
		allowed_roots = (
			os.path.realpath(get_files_path(is_private=1)),
			os.path.realpath(get_files_path(is_private=0)),
		)
		if not any(path == root or path.startswith(root + os.sep) for root in allowed_roots):
			frappe.throw(_("Invalid import file path."))

		return path

	def validate_export(self) -> None:
		"""Validate the export parameters."""

		if self.export_filter:
			try:
				self.export_filter = json.dumps(json.loads(self.export_filter), indent=4)
			except json.JSONDecodeError:
				frappe.throw(_("Export filter must be valid JSON."))

		if not self.export_archive_type:
			frappe.throw(_("Archive Type is required."))

		if self.export_limit:
			export_limit = cint(self.export_limit)
			if export_limit <= 0:
				frappe.throw(_("Export Limit must be greater than zero."))
			if export_limit > self.max_export:
				frappe.throw(_("Export Limit cannot exceed {0}.").format(self.max_export))
			self.export_limit = export_limit
		else:
			self.export_limit = self.max_export

	def _get_logger(self) -> ExchangeLogger:
		"""Returns a structured event logger bound to this exchange's context."""

		return get_exchange_logger(
			{
				"req_id": random_string(10),
				"exchange": self.name,
				"kind": "contacts",
				"operation": self.operation,
				"user": self.user,
				"account": self.account,
			}
		)

	def process(self) -> None:
		"""Enqueue the import or export based on the operation type."""

		logger = self._get_logger()

		if self.operation == "Import":
			job_id = f"{self.name}:contacts:import"
			frappe.enqueue_doc(
				self.doctype,
				self.name,
				"_import",
				queue="long",
				timeout=cint(get_config("exchange_import_timeout")),
				job_id=job_id,
				deduplicate=True,
				enqueue_after_commit=True,
			)
			logger.debug("import-enqueued", job_id=job_id, format=self.import_format)
		elif self.operation == "Export":
			job_id = f"{self.name}:contacts:export"
			frappe.enqueue_doc(
				self.doctype,
				self.name,
				"_export",
				queue="long",
				timeout=cint(get_config("exchange_export_timeout")),
				job_id=job_id,
				deduplicate=True,
				enqueue_after_commit=True,
			)
			logger.debug("export-enqueued", job_id=job_id, format=self.export_format)

	@frappe.whitelist()
	def retry(self) -> None:
		"""Retry the import or export."""

		frappe.only_for("System Manager")

		self._get_logger().info("retry-requested", status=self.status, retries=cint(self.retries))

		if self.docstatus != 1:
			frappe.throw(_("Only submitted contacts exchange can be retried."))
		elif self.status not in ["Queued", "In Progress", "Failed"]:
			frappe.throw(
				_("Only contacts exchange with status 'Queued', 'In Progress', or 'Failed' can be retried.")
			)

		if self.operation == "Export":
			if files := frappe.db.get_all(
				"File",
				{
					"attached_to_doctype": self.doctype,
					"attached_to_name": self.name,
					"attached_to_field": "file",
				},
				pluck="name",
			):
				for file in files:
					frappe.delete_doc("File", file)

		self._db_set(status="Queued", queued_at=now())
		self.process()

	@reconnect_on_failure()
	def _import(self) -> None:
		"""Imports the contact cards."""

		if self.operation != "Import":
			return

		logger = self._get_logger()
		logger.info("import-started", format=self.import_format, import_file=self.import_file)

		freeze_jmap_push_notifications(self.user)
		self._mark_started()
		self._log_output(_("Starting import from the uploaded {0} file.").format(self.import_format.upper()))

		import_file = self._resolve_import_file()
		base_dir = os.path.join(get_contacts_import_directory(), self.name)
		os.makedirs(base_dir, exist_ok=True)

		kwargs = {}
		try:
			if self.import_format == "vcf" and self.import_file.endswith(".vcf"):
				shutil.copy(import_file, os.path.join(base_dir, os.path.basename(import_file)))
			else:
				extract_compressed_file(import_file, base_dir)
			logger.debug("import-source-prepared", base_dir=base_dir)
			self._log_output(_("Prepared the source files for import."))

			service = get_contact_card_service(self.user, self.account)
			self._validate_target_address_books(service)

			if self.import_format == "vcf":
				cards = self._load_vcf_cards(service, base_dir, logger)
			else:
				cards = self._load_jmap_cards(base_dir)

			logger.info("import-cards-loaded", cards=len(cards), max_import=self.max_import)
			self._log_output(_("Found {0} contact(s) to import.").format(len(cards)))

			if not cards:
				frappe.throw(_("No contacts found for import."))
			if len(cards) > self.max_import:
				frappe.throw(_("Import limit exceeded."))

			created, skipped, failed = self._create_cards(service, cards, logger)

			logger.info("import-completed", created=created, skipped=skipped, failed=failed)
			self._log_output(
				_("Import completed. {0} created, {1} skipped (already present), {2} failed.").format(
					created, skipped, failed
				)
			)

			# The server rejecting every card (e.g. an invalid target address book) is a failure,
			# not a successful zero-import.
			if created == 0 and failed > 0:
				frappe.throw(_("Import failed: the server rejected all {0} contact(s).").format(failed))

			kwargs.update({"status": "Completed"})
		except Exception:
			logger.exception("import-failed")
			self._log_output(_("Import failed. See the error details below."))
			kwargs.update(
				{"status": "Failed", "output": f"{self.output}\n\n{frappe.get_traceback(with_context=False)}"}
			)
		finally:
			shutil.rmtree(base_dir, ignore_errors=True)
			unfreeze_jmap_push_notifications(self.user)

		self._mark_completed(**kwargs)
		self._notify_user(success=kwargs.get("status") == "Completed", action="Import")

	@reconnect_on_failure()
	def _export(self) -> None:
		"""Exports the contact cards."""

		if self.operation != "Export":
			return

		logger = self._get_logger()
		logger.info("export-started", format=self.export_format, archive_type=self.export_archive_type)

		self._mark_started()
		self._log_output(_("Starting export to {0} format.").format(self.export_format.upper()))
		out_dir = os.path.join(get_contacts_export_directory(), self.name)
		os.makedirs(out_dir, exist_ok=True)

		kwargs = {}
		try:
			service = get_contact_card_service(self.user, self.account)

			limit = min(self.max_export, cint(self.export_limit or self.max_export))
			data = service.query(self.export_filter_dict, limit=limit)
			ids = data.get("ids", [])
			total = data.get("total")
			logger.info("export-query-resolved", total=total, fetched=len(ids), max_export=self.max_export)
			self._log_output(
				_("Found {0} contact(s) matching the filter; exporting up to {1}.").format(
					total if total is not None else len(ids), len(ids)
				)
			)

			if not ids:
				frappe.throw(_("No contacts found for export."))

			cards = service.get(ids)

			if self.deduplicate_export:
				fetched = len(cards)
				unique: dict[str, dict] = {}
				for c in cards:
					key = c.get("uid") or c.get("id")
					if key not in unique:
						unique[key] = c
				cards = list(unique.values())
				logger.debug("export-deduplicated", fetched=fetched, unique=len(cards))
				self._log_output(
					_("Removed {0} duplicate(s); {1} unique contact(s) remain.").format(
						fetched - len(cards), len(cards)
					)
				)

			# Only include address books actually referenced by the exported cards, so a filtered
			# export doesn't leak the account's other address books into addressbooks.json.
			referenced_ids = {book_id for card in cards for book_id in (card.get("addressBookIds") or {})}
			address_book_map = {
				b["id"]: b["name"] for b in service.address_books if b["id"] in referenced_ids
			}
			ContactsExportWriter.write(self.export_format, cards, out_dir, address_book_map)
			self._log_output(_("Wrote {0} contact(s) to the export directory.").format(len(cards)))

			self._log_output(
				_("Packaging exported contacts into a {0} archive.").format(self.export_archive_type)
			)
			self._attach_export(out_dir)

			logger.info("export-completed", cards=len(cards))
			self._log_output(_("Export completed successfully. {0} contact(s) exported.").format(len(cards)))
			kwargs.update({"status": "Completed"})
		except Exception:
			logger.exception("export-failed")
			self._log_output(_("Export failed. See the error details below."))
			kwargs.update(
				{"status": "Failed", "output": f"{self.output}\n\n{frappe.get_traceback(with_context=False)}"}
			)
		finally:
			shutil.rmtree(out_dir, ignore_errors=True)

		self._mark_completed(**kwargs)
		self._notify_user(success=kwargs.get("status") == "Completed", action="Export")

	def _load_vcf_cards(
		self, service: ContactCardService, base_dir: str, logger: ExchangeLogger
	) -> list[dict]:
		"""Splits the uploaded .vcf file(s) into individual vCards and converts them to JSContact.

		``ContactCard/parse`` returns a single Card per blob (the first vCard it finds), so a file
		holding many contacts must be split into one blob per vCard for all of them to be imported.
		Falls back to a local parser for any vCard the server can't parse, or for the whole set if
		the server does not implement ``ContactCard/parse``."""

		vcf_files = [
			os.path.join(root, f)
			for root, _dirs, files in os.walk(base_dir)
			for f in files
			if f.lower().endswith(".vcf")
		]
		if not vcf_files:
			frappe.throw(_("No .vcf files found."))

		vcards: list[str] = []
		for path in vcf_files:
			vcards.extend(_split_vcards(_read_text(path)))
		if not vcards:
			frappe.throw(_("No vCards found in the uploaded file(s)."))
		# Reject early, before uploading a blob per vCard, if the file already exceeds the limit.
		if len(vcards) > self.max_import:
			frappe.throw(_("Import limit exceeded."))

		cards: list[dict] = []
		try:
			# One blob per vCard so the server parses (and returns) every contact, not just the first.
			uploads = service.upload_blobs_concurrently(
				[(vcard.encode("utf-8"), "text/vcard; charset=utf-8") for vcard in vcards]
			)
			blob_to_vcard: dict[str, str] = {}
			for vcard, upload in zip(vcards, uploads, strict=False):
				if blob_id := (upload or {}).get("blobId"):
					blob_to_vcard[blob_id] = vcard

			response = service.parse(list(blob_to_vcard.keys()))

			for value in (response.get("parsed") or {}).values():
				if isinstance(value, list):
					cards.extend(card for card in value if card)
				elif value:
					cards.append(value)

			# Anything the server couldn't parse gets a second chance through the local parser.
			unparsed = list((response.get("notParsable") or {}).keys()) + list(
				(response.get("notFound") or {}).keys()
			)
			for blob_id in unparsed:
				if vcard := blob_to_vcard.get(blob_id):
					cards.extend(parse_vcards(vcard))
			if unparsed:
				logger.warning("import-vcf-not-parsable", count=len(unparsed))
				self._log_output(_("{0} vCard(s) were parsed locally as a fallback.").format(len(unparsed)))
		except Exception:
			# The JMAP server does not support ContactCard/parse; parse every vCard locally instead.
			logger.warning("import-vcf-parse-unsupported")
			self._log_output(_("Server-side parsing is unavailable; parsing vCards locally."))
			cards = []
			for vcard in vcards:
				cards.extend(parse_vcards(vcard))

		return cards

	def _validate_target_address_books(self, service: ContactCardService) -> None:
		"""Validates that the client-supplied target address book(s) exist in this account.

		``target_address_book_ids`` comes from the import metadata and is passed straight to
		``ContactCard/set``. A deleted or foreign book would make the server reject every card, so
		fail fast with a clear error instead of silently completing with zero imports."""

		target = self.target_address_book_ids
		if not target:
			return

		known = {book["id"] for book in service.address_books}
		if invalid := [book_id for book_id in target if book_id not in known]:
			frappe.throw(
				_("Target address book(s) not found in this account: {0}").format(", ".join(invalid))
			)

	def _load_jmap_cards(self, base_dir: str) -> list[dict]:
		"""Loads JSContact cards from the cards.json file in the import directory."""

		path = os.path.join(base_dir, "cards.json")
		if not os.path.exists(path):
			frappe.throw(_("cards.json not found in the import directory."))

		with open(path) as f:
			cards = json.load(f)

		if not isinstance(cards, list):
			frappe.throw(_("cards.json must contain a list of contact cards."))

		return cards

	def _create_cards(
		self, service: ContactCardService, cards: list[dict], logger: ExchangeLogger
	) -> tuple[int, int, int]:
		"""Creates the given JSContact cards, skipping any whose UID already exists (idempotency).

		Returns a ``(created, skipped, failed)`` tuple. Failures within a batch are recorded and the
		remaining batches continue, so a few malformed cards do not abort the whole import."""

		# Idempotency: skip cards whose UID is already present in the account.
		uids = [c["uid"] for c in cards if c.get("uid")]
		existing_uids: set[str] = set()
		if uids:
			if existing_ids := service.get_master_ids(uids):
				existing_uids = {c["uid"] for c in service.get(existing_ids) if c.get("uid")}

		default_address_book_id: str | None = None

		def resolve_address_book_ids(card: dict) -> dict:
			nonlocal default_address_book_id

			if self.target_address_book_ids:
				return self.target_address_book_ids
			if card.get("addressBookIds"):
				return card["addressBookIds"]
			if default_address_book_id is None:
				default_address_book_id = AddressBookService(service.account, service.connection).get_default(
					raise_exception=True
				)
			return {default_address_book_id: True}

		pending: list[dict] = []
		skipped = 0
		for card in cards:
			if card.get("uid") and card["uid"] in existing_uids:
				skipped += 1
				continue
			pending.append(card)

		created = 0
		failed = 0
		total = len(pending)
		for batch in create_batch(pending, service.max_objects_in_set):
			payload: dict[str, dict] = {}
			creation_to_uid: dict[str, str] = {}
			for card in batch:
				card = {k: v for k, v in card.items() if k not in SERVER_MANAGED_KEYS}
				card["@type"] = "Card"
				card.setdefault("version", "1.0")
				card["addressBookIds"] = resolve_address_book_ids(card)

				creation_id = str(uuid7())
				payload[creation_id] = card
				creation_to_uid[creation_id] = card.get("uid", creation_id)

			response = service._create(payload)
			method_responses = response.get("methodResponses") or []
			result = method_responses[0][1] if method_responses else {}

			batch_created = result.get("created") or {}
			batch_failed = result.get("notCreated") or {}
			created += len(batch_created)
			failed += len(batch_failed)

			for creation_id, error in batch_failed.items():
				logger.warning(
					"import-card-not-created",
					uid=creation_to_uid.get(creation_id),
					reason=str(error),
				)

			self._log_output(_("Imported {0} of {1} contact(s).").format(created, total))

		return created, skipped, failed

	def _mark_started(self) -> None:
		"""Marks the contacts exchange as started and updates the started_at and started_after fields."""

		started_at = now()
		self._db_set(
			status="In Progress",
			started_at=started_at,
			started_after=time_diff_in_seconds(started_at, self.queued_at),
			output="",
		)

	def _mark_completed(self, **kwargs) -> None:
		"""Marks the contacts exchange as completed and updates the completed_at and duration fields."""

		kwargs["completed_at"] = now()
		kwargs["duration"] = time_diff_in_seconds(kwargs["completed_at"], self.started_at)

		if kwargs["status"] == "Failed":
			kwargs["retries"] = cint(self.retries) + 1

		self._db_set(**kwargs)

	def _attach_export(self, out_dir: str) -> None:
		"""Attaches the exported file to the contacts exchange."""

		archive = f"{self.name}{self.export_archive_type}"
		url = f"/private/files/{archive}"
		path = os.path.join(get_bench_path(), f"sites/{frappe.local.site}{url}")
		compress_directory(out_dir, path)

		file = frappe.new_doc("File")
		file.is_private = 1
		file.file_url = url
		file.file_name = archive
		file.attached_to_doctype = self.doctype
		file.attached_to_name = self.name
		file.attached_to_field = "file"
		file.insert()

		# https://github.com/frappe/frappe/issues/26615
		frappe.db.set_value("File", file.name, {"file_url": url, "file_name": archive})

	def _notify_user(self, success: bool, action: Literal["Import", "Export"]) -> None:
		"""Sends notification email to the owner of the contacts exchange."""

		if is_administrator(self.owner):
			return
		if not (email := get_user_email_address(self.owner)):
			return

		subject = _("Contacts Data {0} {1}").format(action, "Completed" if success else "Failed")
		frappe.publish_realtime(
			"contacts_exchange_completed",
			{"action": action, "success": success, "message": subject},
			user=self.user,
		)
		frappe.sendmail(
			recipients=email,
			subject=subject,
			template="generic",
			args={
				"title": subject,
				"description": _("View details for this exchange."),
				"button": _("View {0}").format(action),
				"link": get_url(f"/mail/contacts-exchanges/{self.name}"),
			},
			now=True,
		)

	def _log_output(self, message: str) -> None:
		"""Appends a timestamped, user-friendly line to the `output` field and persists it.

		These messages are surfaced in the UI so the user can follow the progress of the
		background import/export as it happens."""

		line = f"[{now()}] {message}"
		self.output = f"{self.output}\n{line}" if self.output else line
		self._db_set(output=self.output)

	def _db_set(self, **kwargs) -> None:
		"""Updates the document with the given key-value pairs."""

		self.db_set(kwargs, notify=True, commit=True)


class ContactsExportWriter:
	@classmethod
	def write(
		cls,
		format: Literal["jmap", "vcf"],
		cards: list[dict],
		out_dir: str,
		address_book_map: dict[str, str],
	) -> None:
		"""Writes the exported cards in the specified format."""

		writers = {
			"jmap": cls._jmap,
			"vcf": cls._vcf,
		}

		if format not in writers:
			frappe.throw(_("Unsupported export format: {0}").format(format))

		writers[format](cards, out_dir, address_book_map)

	@staticmethod
	def _jmap(cards: list[dict], out_dir: str, address_book_map: dict[str, str]) -> None:
		"""Writes the raw JSContact cards and the address book map (fully round-trippable)."""

		with open(os.path.join(out_dir, "cards.json"), "w") as f:
			json.dump(cards, f, indent=4)

		with open(os.path.join(out_dir, "addressbooks.json"), "w") as f:
			json.dump(address_book_map, f, indent=4)

	@staticmethod
	def _vcf(cards: list[dict], out_dir: str, address_book_map: dict[str, str]) -> None:
		"""Writes one .vcf file per address book, mirroring mbox's one-file-per-mailbox layout."""

		def safe_name(name: str) -> str:
			return (
				"".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in name).strip()
				or "addressbook"
			)

		# Group cards by the address books they belong to (a card can live in several).
		by_book: dict[str, list[dict]] = {}
		for card in cards:
			book_ids = list((card.get("addressBookIds") or {}).keys()) or ["__default__"]
			for book_id in book_ids:
				by_book.setdefault(book_id, []).append(card)

		used_names: set[str] = set()
		for book_id, book_cards in by_book.items():
			book_name = address_book_map.get(book_id, "Contacts")
			categories = [book_name] if book_id in address_book_map else None

			vcards = [card_to_vcard(card, categories) for card in book_cards]

			file_name = safe_name(book_name)
			candidate = file_name
			suffix = 1
			while candidate in used_names:
				suffix += 1
				candidate = f"{file_name}_{suffix}"
			used_names.add(candidate)

			with open(os.path.join(out_dir, f"{candidate}.vcf"), "w", encoding="utf-8") as f:
				f.write("\r\n".join(vcards))
				f.write("\r\n")


def get_contact_card_service(
	user: str,
	account: str,
	ignore_permissions: bool = False,
) -> ContactCardService:
	"""Returns a ContactCardService configured with the longer exchange timeouts."""

	connection = get_jmap_connection(user, ignore_permissions=ignore_permissions, timeout=(60.0, 180.0))
	return ContactCardService(account, connection)


# ---------------------------------------------------------------------------
# JSContact (RFC 9553) <-> vCard 4.0 (RFC 6350) conversion
# ---------------------------------------------------------------------------

# JSContact context -> vCard TYPE parameter value.
_CONTEXT_TYPE_MAP = {
	"work": "work",
	"private": "home",
	"home": "home",
}


def _vcard_escape(value: str) -> str:
	"""Escapes a value for use in a vCard property, per RFC 6350."""

	if value is None:
		return ""
	return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _fold_line(line: str) -> str:
	"""Folds a vCard content line at 75 octets, continuing with a leading space (RFC 6350)."""

	encoded = line.encode("utf-8")
	if len(encoded) <= 75:
		return line

	chunks = []
	start = 0
	limit = 75
	while start < len(encoded):
		end = min(start + limit, len(encoded))
		# Do not split in the middle of a multi-byte UTF-8 sequence.
		while end < len(encoded) and (encoded[end] & 0xC0) == 0x80:
			end -= 1
		chunks.append(encoded[start:end].decode("utf-8"))
		start = end
		limit = 74  # continuation lines carry a leading space, so one less octet of content

	return "\r\n ".join(chunks)


def _contexts_to_types(contexts: dict | None) -> list[str]:
	"""Maps a JSContact ``contexts`` map to vCard TYPE parameter values."""

	types = []
	for context in contexts or {}:
		if mapped := _CONTEXT_TYPE_MAP.get(context.lower()):
			if mapped not in types:
				types.append(mapped)
	return types


def _name_components(name: dict | None) -> dict[str, list[str]]:
	"""Groups a JSContact Name's components by kind."""

	grouped: dict[str, list[str]] = {}
	for component in (name or {}).get("components") or []:
		kind = component.get("kind")
		value = component.get("value")
		if kind and value:
			grouped.setdefault(kind, []).append(value)
	return grouped


def card_to_vcard(card: dict, categories: list[str] | None = None) -> str:
	"""Converts a single JSContact Card into a vCard 4.0 string."""

	lines = ["BEGIN:VCARD", "VERSION:4.0"]

	def add(prop: str, value: str, params: str = "") -> None:
		if value in (None, ""):
			return
		lines.append(_fold_line(f"{prop}{params}:{value}"))

	if uid := card.get("uid"):
		add("UID", _vcard_escape(uid))

	kind = card.get("kind")
	if kind and kind != "individual":
		add("KIND", _vcard_escape(kind))

	name = card.get("name") or {}
	if full := name.get("full"):
		add("FN", _vcard_escape(full))

	grouped = _name_components(name)
	if grouped:
		n_value = ";".join(
			",".join(_vcard_escape(v) for v in grouped.get(kind, [])) for kind in N_COMPONENT_ORDER
		)
		add("N", n_value)
	elif full:
		add("N", f"{_vcard_escape(full)};;;;")

	for nick in (card.get("nickNames") or {}).values():
		add("NICKNAME", _vcard_escape(nick.get("name")))

	for org in (card.get("organizations") or {}).values():
		parts = [org.get("name") or ""]
		parts.extend(unit.get("name") or "" for unit in org.get("units") or [])
		add("ORG", ";".join(_vcard_escape(p) for p in parts))

	for title in (card.get("titles") or {}).values():
		prop = "ROLE" if title.get("kind") == "role" else "TITLE"
		add(prop, _vcard_escape(title.get("name")))

	for email in (card.get("emails") or {}).values():
		types = _contexts_to_types(email.get("contexts"))
		params = f";TYPE={','.join(types)}" if types else ""
		add("EMAIL", _vcard_escape(email.get("address")), params)

	for phone in (card.get("phones") or {}).values():
		types = _contexts_to_types(phone.get("contexts"))
		types.extend(f for f in (phone.get("features") or {}) if f not in types)
		params = f";TYPE={','.join(types)}" if types else ""
		add("TEL", _vcard_escape(phone.get("number")), params)

	for address in (card.get("addresses") or {}).values():
		types = _contexts_to_types(address.get("contexts"))
		params = f";TYPE={','.join(types)}" if types else ""
		add("ADR", _address_to_vcard(address), params)

	for note in (card.get("notes") or {}).values():
		add("NOTE", _vcard_escape(note.get("note")))

	for url in (card.get("urls") or card.get("links") or {}).values():
		add("URL", _vcard_escape(url.get("uri") or url.get("url") or url.get("href")))

	for anniversary in (card.get("anniversaries") or {}).values():
		if date := _anniversary_date(anniversary.get("date")):
			prop = "BDAY" if anniversary.get("kind") == "birth" else "ANNIVERSARY"
			add(prop, date)

	for photo in (card.get("photos") or card.get("media") or {}).values():
		if photo.get("kind") in (None, "photo") and (uri := photo.get("uri")):
			add("PHOTO", uri)

	keywords = list((card.get("categories") or card.get("keywords") or {}).keys())
	if categories:
		keywords = list(dict.fromkeys(keywords + categories))
	if keywords:
		add("CATEGORIES", ",".join(_vcard_escape(k) for k in keywords))

	for member in card.get("members") or {}:
		add("MEMBER", member if member.startswith("urn:") else f"urn:uuid:{member}")

	lines.append("END:VCARD")
	return "\r\n".join(lines)


def _address_to_vcard(address: dict) -> str:
	"""Builds a vCard ADR value (POBox;Ext;Street;Locality;Region;Postcode;Country) from a JSContact address."""

	grouped: dict[str, list[str]] = {}
	for component in address.get("components") or []:
		kind = component.get("kind")
		value = component.get("value")
		if kind and value:
			grouped.setdefault(kind, []).append(value)

	def get(*kinds: str) -> str:
		for kind in kinds:
			if kind in grouped:
				return ",".join(_vcard_escape(v) for v in grouped[kind])
		return ""

	return ";".join(
		[
			get("postOfficeBox"),
			get("apartment", "floor", "room"),
			get("name", "street"),
			get("locality"),
			get("region"),
			get("postcode"),
			get("country"),
		]
	)


def _anniversary_date(date: dict | str | None) -> str | None:
	"""Renders a JSContact anniversary date as a vCard date string."""

	if not date:
		return None
	if isinstance(date, str):
		return date
	if utc := date.get("utc"):
		return utc
	year = date.get("year")
	month = date.get("month")
	day = date.get("day")
	if year and month and day:
		return f"{int(year):04d}{int(month):02d}{int(day):02d}"
	return None


def _read_text(path: str) -> str:
	"""Reads a text file, tolerating a UTF-8 BOM and falling back to latin-1 on decode errors."""

	with open(path, "rb") as f:
		data = f.read()
	try:
		return data.decode("utf-8-sig")
	except UnicodeDecodeError:
		return data.decode("latin-1")


def _vcard_unescape(value: str) -> str:
	"""Reverses vCard value escaping."""

	out = []
	i = 0
	while i < len(value):
		char = value[i]
		if char == "\\" and i + 1 < len(value):
			nxt = value[i + 1]
			out.append({"n": "\n", "N": "\n"}.get(nxt, nxt))
			i += 2
			continue
		out.append(char)
		i += 1
	return "".join(out)


def _split_escaped(value: str, sep: str) -> list[str]:
	"""Splits a vCard value on ``sep`` while honouring backslash escaping."""

	parts = []
	current = []
	i = 0
	while i < len(value):
		char = value[i]
		if char == "\\" and i + 1 < len(value):
			current.append(value[i : i + 2])
			i += 2
			continue
		if char == sep:
			parts.append("".join(current))
			current = []
			i += 1
			continue
		current.append(char)
		i += 1
	parts.append("".join(current))
	return parts


def _split_vcards(text: str) -> list[str]:
	"""Splits a vCard document into its individual ``BEGIN:VCARD``…``END:VCARD`` blocks.

	Line folding within each card is preserved so the blocks can be re-uploaded verbatim."""

	blocks: list[str] = []
	current: list[str] = []
	in_card = False
	for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
		marker = line.strip().upper()
		if marker == "BEGIN:VCARD":
			in_card = True
			current = [line]
		elif marker == "END:VCARD":
			if in_card:
				current.append(line)
				blocks.append("\r\n".join(current))
			in_card = False
			current = []
		elif in_card:
			current.append(line)

	return blocks


def parse_vcards(text: str) -> list[dict]:
	"""Parses a vCard document (one or more cards) into JSContact Card dicts.

	This is the local fallback used when the JMAP server does not implement ``ContactCard/parse``.
	It covers the common properties (FN, N, NICKNAME, ORG, TITLE, EMAIL, TEL, ADR, NOTE, URL, BDAY,
	ANNIVERSARY, CATEGORIES, KIND, MEMBER, UID); anything else is ignored."""

	# Unfold continuation lines (a line beginning with a space/tab continues the previous one).
	unfolded: list[str] = []
	for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
		if raw_line[:1] in (" ", "\t") and unfolded:
			unfolded[-1] += raw_line[1:]
		else:
			unfolded.append(raw_line)

	cards: list[dict] = []
	card: dict | None = None
	for line in unfolded:
		if not line.strip():
			continue

		upper = line.strip().upper()
		if upper == "BEGIN:VCARD":
			card = {"@type": "Card", "version": "1.0"}
			continue
		if upper == "END:VCARD":
			if card is not None:
				_finalize_card(card)
				cards.append(card)
			card = None
			continue
		if card is None:
			continue

		if ":" not in line:
			continue

		name_part, value = line.split(":", 1)
		segments = _split_escaped(name_part, ";")
		prop = segments[0].split(".")[-1].upper()  # strip any group prefix (e.g. "item1.EMAIL")
		params = _parse_params(segments[1:])

		_apply_vcard_property(card, prop, value, params)

	return cards


def _parse_params(segments: list[str]) -> dict[str, list[str]]:
	"""Parses vCard property parameters into a ``{name: [values]}`` map."""

	params: dict[str, list[str]] = {}
	for segment in segments:
		if "=" in segment:
			key, raw = segment.split("=", 1)
			values = [v.strip().strip('"') for v in raw.split(",") if v.strip()]
		else:
			key, values = "TYPE", [segment.strip().strip('"')]
		params.setdefault(key.upper(), []).extend(values)
	return params


def _types_to_contexts(params: dict[str, list[str]]) -> dict[str, bool]:
	"""Maps vCard TYPE parameter values to a JSContact ``contexts`` map."""

	reverse = {"work": "work", "home": "private"}
	contexts = {}
	for value in params.get("TYPE", []):
		if context := reverse.get(value.lower()):
			contexts[context] = True
	return contexts


def _apply_vcard_property(card: dict, prop: str, value: str, params: dict[str, list[str]]) -> None:
	"""Applies a single parsed vCard property to the JSContact card being built."""

	if prop == "UID":
		card["uid"] = _vcard_unescape(value).replace("urn:uuid:", "")
	elif prop == "KIND":
		card["kind"] = _vcard_unescape(value).lower()
	elif prop == "FN":
		card.setdefault("name", {})["full"] = _vcard_unescape(value)
	elif prop == "N":
		components = []
		fields = _split_escaped(value, ";")
		for kind, raw in zip(N_COMPONENT_ORDER, fields, strict=False):
			for item in _split_escaped(raw, ","):
				if item:
					components.append({"kind": kind, "value": _vcard_unescape(item)})
		if components:
			card.setdefault("name", {})["components"] = components
	elif prop == "NICKNAME":
		for item in _split_escaped(value, ","):
			if item:
				card.setdefault("nickNames", {})[str(uuid7())] = {"name": _vcard_unescape(item)}
	elif prop == "ORG":
		parts = [_vcard_unescape(p) for p in _split_escaped(value, ";")]
		org = {"name": parts[0]} if parts else {}
		if len(parts) > 1:
			org["units"] = [{"name": unit} for unit in parts[1:] if unit]
		if org:
			card.setdefault("organizations", {})[str(uuid7())] = org
	elif prop in ("TITLE", "ROLE"):
		card.setdefault("titles", {})[str(uuid7())] = {
			"name": _vcard_unescape(value),
			"kind": "role" if prop == "ROLE" else "title",
		}
	elif prop == "EMAIL":
		entry = {"address": _vcard_unescape(value)}
		if contexts := _types_to_contexts(params):
			entry["contexts"] = contexts
		card.setdefault("emails", {})[str(uuid7())] = entry
	elif prop == "TEL":
		entry = {"number": _vcard_unescape(value)}
		if contexts := _types_to_contexts(params):
			entry["contexts"] = contexts
		card.setdefault("phones", {})[str(uuid7())] = entry
	elif prop == "ADR":
		if address := _vcard_to_address(value, params):
			card.setdefault("addresses", {})[str(uuid7())] = address
	elif prop == "NOTE":
		card.setdefault("notes", {})[str(uuid7())] = {"note": _vcard_unescape(value)}
	elif prop == "URL":
		card.setdefault("links", {})[str(uuid7())] = {"uri": _vcard_unescape(value)}
	elif prop in ("BDAY", "ANNIVERSARY"):
		card.setdefault("anniversaries", {})[str(uuid7())] = {
			"kind": "birth" if prop == "BDAY" else "wedding",
			"date": _vcard_unescape(value),
		}
	elif prop == "CATEGORIES":
		for item in _split_escaped(value, ","):
			if item:
				card.setdefault("categories", {})[_vcard_unescape(item)] = True
	elif prop == "MEMBER":
		card.setdefault("members", {})[_vcard_unescape(value).replace("urn:uuid:", "")] = True


def _vcard_to_address(value: str, params: dict[str, list[str]]) -> dict | None:
	"""Builds a JSContact address from a vCard ADR value."""

	fields = _split_escaped(value, ";")
	# ADR structure: POBox;Ext;Street;Locality;Region;Postcode;Country
	kinds = ["postOfficeBox", "apartment", "name", "locality", "region", "postcode", "country"]
	components = []
	for kind, raw in zip(kinds, fields, strict=False):
		for item in _split_escaped(raw, ","):
			if item:
				components.append({"kind": kind, "value": _vcard_unescape(item)})

	if not components:
		return None

	address = {"components": components}
	reverse = {"work": "work", "home": "private"}
	contexts = {reverse[v.lower()]: True for v in params.get("TYPE", []) if v.lower() in reverse}
	if contexts:
		address["contexts"] = contexts
	return address


def _finalize_card(card: dict) -> None:
	"""Ensures a parsed card has a UID and a display name so it round-trips cleanly."""

	if not card.get("uid"):
		card["uid"] = str(uuid7())
	name = card.get("name") or {}
	if not name.get("full") and name.get("components"):
		full = " ".join(
			c["value"] for c in name["components"] if c.get("kind") in ("given", "surname") and c.get("value")
		)
		if full:
			card.setdefault("name", {})["full"] = full


def get_permission_query_condition(user: str | None = None) -> str:
	user = user or frappe.session.user

	if is_mail_admin(user) or is_system_manager(user):
		return ""

	return f"(`tabContacts Exchange`.user = '{user}')"


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
	if doc.doctype != "Contacts Exchange":
		return False

	user = user or frappe.session.user
	return doc.user == user or is_mail_admin(user) or is_system_manager(user)


def retry_stuck_contacts_exchanges() -> None:
	"""Called by the scheduler to retry stuck contacts exchanges."""

	CE = frappe.qb.DocType("Contacts Exchange")
	exchanges = (
		frappe.qb.from_(CE)
		.select(CE.name)
		.where(
			(CE.status.isin(["Queued", "In Progress"]))
			& (CE.queued_at <= get_datetime(add_to_date(now(), days=-1)))
		)
		.orderby(CE.queued_at, order=Order.asc)
	).run(pluck="name")

	for exchange in exchanges:
		frappe.get_doc("Contacts Exchange", exchange).retry()


def clean_contacts_import_export_directories() -> None:
	"""Called by the scheduler to clean up contacts import and export directories."""

	for base in (get_contacts_import_directory(), get_contacts_export_directory()):
		if not os.path.exists(base):
			continue

		for item in os.listdir(base):
			path = os.path.join(base, item)
			if os.path.isdir(path):
				if frappe.db.exists("Contacts Exchange", {"name": item, "status": "In Progress"}):
					continue
				shutil.rmtree(path, ignore_errors=True)
			else:
				os.remove(path)
