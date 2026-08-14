# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import mailbox
import os
import shutil
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from email import message_from_binary_file
from email.message import Message
from email.parser import BytesHeaderParser
from email.utils import parsedate_to_datetime
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
from suite.mail.jmap import (
    EXCHANGE_TIMEOUT,
    SuiteJMAPClient,
    account_view,
    chunked_get,
    chunked_set,
    download_blobs,
    format_set_error,
    get_cached_mailboxes,
    get_jmap_client,
    omit_none,
    upload_blobs,
)
from suite.mail.utils import (
    get_config,
    get_mail_export_directory,
    get_mail_import_directory,
    get_mbox_files,
)
from suite.mail.utils.dt import normalize_utc_z
from suite.mail.utils.logger import ExchangeLogger, get_exchange_logger
from suite.mail.utils.user import clear_sync_state, get_user_email_address, is_jmap_configured
from suite.mail.utils.validation import (
    validate_jmap_structure,
    validate_maildir_or_maildirpp,
    validate_nested_maildir_tree,
)
from suite.utils import log_error, reconnect_on_failure
from suite.utils.dt import parse_iso_datetime
from suite.utils.file import compress_directory, extract_compressed_file
from suite.utils.permissions import OwnerFromUser
from suite.utils.user import is_administrator

MAILDIR_FLAG_MAP: dict[str, str] = {
    "$seen": "S",
    "$flagged": "F",
    "$answered": "R",
    "$draft": "D",
}


@dataclass(slots=True)
class ImportEmailMeta:
    blob_path: str
    mailbox_ids: set[str]
    keywords: set[str]
    received_at: datetime


def _safe_blob_id(blob_id: str) -> str:
    """Returns ``blob_id`` if it names a file directly inside ``blobs/``, else throws.

    The id comes from the ``emails.json`` inside the uploaded archive, and the importer joins it onto
    the extraction directory before opening it. A value like ``../../../../etc/passwd`` would
    otherwise escape that directory and be imported as an email, so only bare filenames are allowed.
    """

    if (
        not blob_id
        or blob_id in (".", "..")
        or os.path.isabs(blob_id)
        or os.path.basename(blob_id) != blob_id
    ):
        frappe.throw(_("Invalid blobId {0} in the import metadata.").format(frappe.bold(str(blob_id))))

    return blob_id


@dataclass(slots=True)
class ExportEmail:
    id: str
    sender: dict[str, str]
    blob_id: str
    keywords: set[str]
    mailbox_ids: set[str]
    message_id: str
    received_at: datetime
    raw: bytes


class ImportMetadataLoader:
    @classmethod
    def load(
        cls,
        format: Literal["eml", "jmap", "mbox", "maildir", "maildir-nested"],
        base_dir: str,
        mailbox_map: dict[str, str],
        metadata: dict,
    ) -> list[ImportEmailMeta]:
        """Loads import metadata based on the specified format."""

        loaders = {
            "eml": cls._from_eml,
            "jmap": cls._from_jmap,
            "mbox": cls._from_mbox,
            "maildir": cls._from_maildir,
            "maildir-nested": cls._from_nested_maildir,
        }

        if format not in loaders:
            frappe.throw(_("Unsupported import format: {0}").format(format))

        return loaders[format](base_dir, mailbox_map, metadata)

    @staticmethod
    def _load_json_metadata(base_dir: str) -> list[str]:
        """Loads email metadata from emails.json file."""

        path = os.path.join(base_dir, "emails.json")
        if not os.path.exists(path):
            frappe.throw(_("emails.json not found in the import directory."))

        with open(path) as f:
            return json.load(f)

    @staticmethod
    def _from_eml(base_dir: str, mailbox_map: dict[str, str], metadata: dict) -> list[ImportEmailMeta]:
        """Loads import metadata for EML format."""

        mailbox_ids = set(metadata.get("mailboxIds", {}).keys())
        if not mailbox_ids:
            frappe.throw(_("mailboxIds are required in Metadata for EML format."))

        keywords = set(metadata.get("keywords", {}).keys() or [])

        if metadata_received_at := metadata.get("receivedAt"):
            metadata_received_at = parse_iso_datetime(metadata_received_at, as_str=False)

        files = [f for f in os.listdir(base_dir) if f.lower().endswith(".eml")]
        if not files:
            frappe.throw(_("No .eml files found"))

        result: list[ImportEmailMeta] = []
        parser = BytesHeaderParser()

        for fname in files:
            received_at = metadata_received_at

            if not received_at:
                with open(os.path.join(base_dir, fname), "rb") as f:
                    msg: Message = parser.parse(f)

                received_at = extract_received_or_sent(msg)

            result.append(
                ImportEmailMeta(
                    fname,
                    mailbox_ids,
                    keywords,
                    received_at,
                )
            )

        return result

    @classmethod
    def _from_jmap(cls, base_dir: str, *args, **kwargs) -> list[ImportEmailMeta]:
        """Loads import metadata for JMAP format."""

        validate_jmap_structure(base_dir, ["emails.json"], raise_exception=True)

        result: list[ImportEmailMeta] = []
        for meta in cls._load_json_metadata(base_dir):
            result.append(
                ImportEmailMeta(
                    blob_path=os.path.join("blobs", _safe_blob_id(meta["blobId"])),
                    mailbox_ids=set(meta["mailboxIds"].keys()),
                    keywords=set(meta.get("keywords", {}).keys() or []),
                    received_at=parse_iso_datetime(meta["receivedAt"], as_str=False),
                )
            )

        return result

    @staticmethod
    def _from_mbox(base_dir: str, mailbox_map: dict[str, str], metadata: dict) -> list[ImportEmailMeta]:
        """Loads import metadata for MBOX format."""

        mbox_files = get_mbox_files(base_dir)
        if not mbox_files:
            frappe.throw(_("No .mbox files found"))

        mailbox_ids = set(metadata.get("mailboxIds", {}).keys())
        if not mailbox_ids:
            frappe.throw(_("mailboxIds are required in Metadata for MBOX format."))

        keywords = set(metadata.get("keywords", {}).keys() or [])

        if metadata_received_at := metadata.get("receivedAt"):
            metadata_received_at = parse_iso_datetime(metadata_received_at, as_str=False)

        by_message_id: dict[str, ImportEmailMeta] = {}

        for mbox_path in mbox_files:
            with closing(mailbox.mbox(mbox_path, factory=None)) as mbox:
                for key, msg in mbox.items():
                    msg_id = (msg.get("Message-ID") or key).strip().lower()

                    if msg_id in by_message_id:
                        continue

                    received_at = metadata_received_at or extract_received_or_sent(msg)

                    blob = f"{uuid7()}.eml"
                    with open(os.path.join(base_dir, blob), "wb") as f:
                        f.write(msg.as_bytes(unixfrom=True))

                    by_message_id[msg_id] = ImportEmailMeta(
                        blob_path=blob,
                        mailbox_ids=mailbox_ids,
                        keywords=keywords,
                        received_at=received_at,
                    )

        return list(by_message_id.values())

    @staticmethod
    def _parse_maildir_flags(filename: str, seen_by_default: bool) -> set[str]:
        """Parses Maildir flags from the filename and returns the corresponding keywords."""

        reverse_map = {v: k for k, v in MAILDIR_FLAG_MAP.items()}
        keywords: set[str] = set()

        if seen_by_default:
            keywords.add("$seen")

        if ":2," not in filename:
            return keywords

        flags = filename.split(":2,", 1)[1]
        for f in flags:
            if kw := reverse_map.get(f):
                keywords.add(kw)

        if "S" not in flags:
            keywords.discard("$seen")

        return keywords

    @classmethod
    def _from_maildir(
        cls, base_dir: str, mailbox_map: dict[str, str], metadata: dict
    ) -> list[ImportEmailMeta]:
        """Loads import metadata for Maildir format."""

        validate_maildir_or_maildirpp(base_dir, raise_exception=True)

        mailbox_ids = set(metadata.get("mailboxIds", {}).keys())
        if not mailbox_ids:
            frappe.throw(_("mailboxIds are required in Metadata for Maildir format."))

        if metadata_received_at := metadata.get("receivedAt"):
            metadata_received_at = parse_iso_datetime(metadata_received_at, as_str=False)

        result: list[ImportEmailMeta] = []

        for subdir in ("cur", "new"):
            path = os.path.join(base_dir, subdir)
            if not os.path.isdir(path):
                continue

            for fname in os.listdir(path):
                keywords = cls._parse_maildir_flags(fname, subdir == "cur")

                received_at = metadata_received_at
                if not received_at:
                    with open(os.path.join(path, fname), "rb") as f:
                        msg: Message = message_from_binary_file(f)

                    received_at = extract_received_or_sent(msg)

                result.append(
                    ImportEmailMeta(
                        blob_path=os.path.join(subdir, fname),
                        mailbox_ids=mailbox_ids,
                        keywords=keywords,
                        received_at=received_at,
                    )
                )

        return result

    @classmethod
    def _from_nested_maildir(
        cls, base_dir: str, mailbox_map: dict[str, str], metadata: dict
    ) -> list[ImportEmailMeta]:
        """Loads import metadata for Nested Maildir format."""

        validate_nested_maildir_tree(base_dir, raise_exception=True)

        if metadata_received_at := metadata.get("receivedAt"):
            metadata_received_at = parse_iso_datetime(metadata_received_at, as_str=False)

        result: list[ImportEmailMeta] = []

        path_to_id = {v: k for k, v in mailbox_map.items()}

        def resolve_mailbox_path(dir_path: str) -> str:
            """Resolves the mailbox path from the directory path."""

            rel = os.path.relpath(dir_path, base_dir)
            if rel == ".":
                return ""

            parts = []
            for part in rel.split(os.sep):
                if not part.startswith("."):
                    continue
                parts.append(part[1:].replace("_", " "))

            return "/".join(parts)

        for root, dirs, _files in os.walk(base_dir):
            if not {"cur", "new"} & set(dirs):
                continue

            mailbox_path = resolve_mailbox_path(root)
            if not mailbox_path:
                continue

            mailbox_id = path_to_id.get(mailbox_path)
            if not mailbox_id:
                frappe.throw(_("Mailbox not found for folder {0}").format(mailbox_path))

            for subdir in ("cur", "new"):
                path = os.path.join(root, subdir)
                if not os.path.isdir(path):
                    continue

                for fname in os.listdir(path):
                    if fname.startswith("."):
                        continue

                    file_path = os.path.join(path, fname)

                    received_at = metadata_received_at
                    if not received_at:
                        with open(file_path, "rb") as f:
                            msg: Message = message_from_binary_file(f)

                        received_at = extract_received_or_sent(msg)

                    keywords = cls._parse_maildir_flags(fname, subdir == "cur")
                    rel_blob = os.path.relpath(file_path, base_dir)
                    result.append(ImportEmailMeta(rel_blob, {mailbox_id}, keywords, received_at))

        return result


class ExportWriter:
    @classmethod
    def write(
        cls,
        format: Literal["jmap", "mbox", "maildir", "maildir-nested"],
        emails: list[ExportEmail],
        out_dir: str,
        mailbox_map: dict[str, str],
    ) -> None:
        """Writes the exported emails in the specified format."""

        writers = {
            "jmap": cls._jmap,
            "mbox": cls._mbox,
            "maildir": cls._maildir,
            "maildir-nested": cls._maildir_nested,
        }

        if format not in writers:
            frappe.throw(_("Unsupported export format: {0}").format(format))

        writers[format](emails, out_dir, mailbox_map)

    @staticmethod
    def write_meta(metadata: list[dict], out_dir: str) -> None:
        """Writes the exported email metadata in emails.json file."""

        _metadata: list[dict] = []
        for meta in metadata:
            _metadata.append(
                {
                    "id": meta["id"],
                    "blobId": meta["blobId"],
                    "keywords": meta["keywords"],
                    "mailboxIds": meta["mailboxIds"],
                    "messageId": meta["messageId"],
                    "receivedAt": meta["receivedAt"],
                }
            )

        with open(os.path.join(out_dir, "emails.json"), "w") as f:
            json.dump(_metadata, f, indent=4)

    @staticmethod
    def _jmap(emails: list[ExportEmail], out_dir: str, *args, **kwargs) -> None:
        """Writes the exported emails in JMAP format."""

        blobs = os.path.join(out_dir, "blobs")
        os.makedirs(blobs, exist_ok=True)
        for e in emails:
            with open(os.path.join(blobs, e.blob_id), "wb") as f:
                f.write(e.raw)

    @staticmethod
    def _mbox(emails: list[ExportEmail], out_dir: str, mailbox_map: dict[str, str]) -> None:
        """Writes the exported emails in MBOX format."""

        def from_line(sender: dict[str, str], received_at: datetime) -> bytes:
            """Generates the From line for MBOX format."""

            addr = sender.get("email", "unknown")
            # mbox convention stamps From_ lines in UTC; Stalwart's offset form would
            # otherwise leak through ctime() and vary within one export.
            return f"From {addr} {received_at.astimezone(UTC).ctime()}\n".encode()

        for e in emails:
            line = from_line(e.sender, e.received_at)
            for m_id in e.mailbox_ids:
                path = os.path.join(out_dir, f"{mailbox_map[m_id]}.mbox")
                with open(path, "ab") as f:
                    f.write(line)
                    f.write(e.raw)
                    if not e.raw.endswith(b"\n"):
                        f.write(b"\n")

    @staticmethod
    def _maildir(emails: list[ExportEmail], out_dir: str, *args, **kwargs) -> None:
        """Writes the exported emails in Maildir format."""

        for dir in ("tmp", "new", "cur"):
            os.makedirs(os.path.join(out_dir, dir), exist_ok=True)

        for e in emails:
            flags = "".join(sorted(MAILDIR_FLAG_MAP[k] for k in e.keywords if k in MAILDIR_FLAG_MAP))
            target = "cur" if "$seen" in e.keywords else "new"
            name = f"{uuid7()}:2,{flags}" if target == "cur" else str(uuid7())
            with open(os.path.join(out_dir, target, name), "wb") as f:
                f.write(e.raw)

    @staticmethod
    def _maildir_nested(emails: list[ExportEmail], out_dir: str, mailbox_map: dict[str, str]) -> None:
        """Writes the exported emails in Nested Maildir format."""

        def mailbox_to_root(mailbox_name: str) -> str:
            """Converts mailbox name to nested Maildir root path."""

            parts = mailbox_name.split("/")
            path = out_dir

            for part in parts:
                safe = part.replace(" ", "_")
                path = os.path.join(path, f".{safe}")

            return path

        for e in emails:
            flags = "".join(sorted(MAILDIR_FLAG_MAP[k] for k in e.keywords if k in MAILDIR_FLAG_MAP))
            target = "cur" if "$seen" in e.keywords else "new"

            for m_id in e.mailbox_ids:
                mailbox_name = mailbox_map[m_id]
                maildir_root = mailbox_to_root(mailbox_name)

                for d in ("new", "cur"):
                    os.makedirs(os.path.join(maildir_root, d), exist_ok=True)

                filename = f"{uuid7()}:2,{flags}" if target == "cur" else str(uuid7())
                with open(os.path.join(maildir_root, target, filename), "wb") as f:
                    f.write(e.raw)


class MailExchange(OwnerFromUser, Document):
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
        export_format: DF.Literal["jmap", "mbox", "maildir", "maildir-nested"]
        export_limit: DF.Int
        export_sort: DF.Literal["", "Received At (ASC)", "Received At (DESC)"]
        import_file: DF.Attach | None
        import_format: DF.Literal["eml", "jmap", "mbox", "maildir", "maildir-nested"]
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
        """Returns the maximum number of emails allowed for import."""

        return cint(get_config("exchange_max_import"))

    @property
    def max_export(self) -> int:
        """Returns the maximum number of emails allowed for export."""

        return cint(get_config("exchange_max_export"))

    @property
    def export_filter_dict(self) -> dict:
        """Returns the export filter as a dictionary."""

        if self.operation == "Export" and self.export_filter:
            return json.loads(self.export_filter)
        return {}

    @property
    def export_sort_clause(self) -> list[dict]:
        """Returns the export sort as a list of dictionaries."""

        if self.operation != "Export":
            return []
        if self.export_sort == "Received At (DESC)":
            return [{"property": "receivedAt", "isAscending": False}]
        return [{"property": "receivedAt", "isAscending": True}]

    @property
    def import_metadata_dict(self) -> dict:
        """Return the import metadata as a filtered dictionary."""

        if self.operation != "Import" or not self.import_metadata:
            return {}

        def filter_truthy_items(key: str) -> dict:
            return {k: True for k, v in metadata.get(key, {}).items() if v}

        metadata = json.loads(self.import_metadata)
        return {
            "mailboxIds": filter_truthy_items("mailboxIds"),
            "keywords": filter_truthy_items("keywords"),
            "receivedAt": metadata.get("receivedAt"),
        }

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

        allowed_extensions = (".eml", ".zip", ".tgz", ".tar.gz")
        if not self.import_file.endswith(allowed_extensions):
            frappe.throw(
                _("Only {0} files are supported for import.").format(
                    ", ".join(f"<code>{ext}</code>" for ext in allowed_extensions)
                )
            )

        self._resolve_import_file()

        if self.import_format in ("eml", "mbox", "maildir"):
            meta = self.import_metadata_dict
            if not meta.get("mailboxIds"):
                frappe.throw(_("mailboxIds are required in Metadata for EML, MBOX, and Maildir formats."))
        else:
            self.import_metadata = json.dumps({})

    def _resolve_import_file(self) -> str:
        """Resolves ``import_file`` to an absolute path, refusing anything outside the site's files
        directories.

        ``import_file`` is an ``Attach`` URL (e.g. ``/private/files/mail.zip``) that the worker joins
        onto the site path before copying/extracting it. Without this guard a crafted value such as
        ``/private/files/../../../etc/passwd`` would let the job read a file anywhere on the
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

        if not self.export_sort:
            self.export_sort = "Received At (ASC)"

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
                "key": "mail",
                "operation": self.operation,
                "user": self.user,
                "account": self.account,
            }
        )

    def process(self) -> None:
        """Enqueue the import or export based on the operation type."""

        logger = self._get_logger()

        if self.operation == "Import":
            job_id = f"{self.name}:mail:import"
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
            job_id = f"{self.name}:mail:export"
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
            frappe.throw(_("Only submitted mail exchange can be retried."))
        elif self.status not in ["Queued", "In Progress", "Failed"]:
            frappe.throw(
                _("Only mail exchange with status 'Queued', 'In Progress', or 'Failed' can be retried.")
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
        """Imports the mail data."""

        if self.operation != "Import":
            return

        logger = self._get_logger()
        logger.info("import-started", format=self.import_format, import_file=self.import_file)

        freeze_jmap_push_notifications(self.user)
        self._mark_started()
        self._log_output(_("Starting import from the uploaded {0} file.").format(self.import_format.upper()))

        import_file = self._resolve_import_file()
        base_dir = os.path.join(get_mail_import_directory(), self.name)
        os.makedirs(base_dir, exist_ok=True)

        kwargs = {}
        client = None
        staging_mailbox_id = None
        try:
            if self.import_format == "eml" and self.import_file.endswith(".eml"):
                shutil.copy(import_file, os.path.join(base_dir, os.path.basename(import_file)))
            else:
                extract_compressed_file(import_file, base_dir)
            logger.debug("import-source-prepared", base_dir=base_dir)
            self._log_output(_("Prepared the source files for import."))

            client = get_exchange_client(self.user, self.account)

            mailbox_map = {}
            if self.import_format == "maildir-nested":
                mailbox_map = self._build_mailbox_map(get_cached_mailboxes(self.account))

            meta = ImportMetadataLoader.load(
                self.import_format, base_dir, mailbox_map, self.import_metadata_dict
            )
            logger.info("import-metadata-loaded", emails=len(meta), max_import=self.max_import)
            self._log_output(_("Found {0} email(s) to import.").format(len(meta)))

            if not meta:
                frappe.throw(_("No emails found for import."))
            if len(meta) > self.max_import:
                frappe.throw(_("Import limit exceeded."))

            self._validate_destination_mailboxes(client, meta)

            # Stage everything into one throwaway mailbox first, then move it to the destination
            # mailbox(es). A failure before the move leaves nothing scattered across the account: the
            # staging mailbox and every email in it are deleted on rollback.
            staging_mailbox_id = self._create_staging_mailbox(client, logger)
            imported = self._import_batches(client, base_dir, meta, staging_mailbox_id, logger)
            self._move_to_target_mailboxes(client, imported, logger)
            self._discard_staging_mailbox(client, staging_mailbox_id, logger)
            staging_mailbox_id = None

            clear_sync_state(self.account, type="email")

            logger.info("import-completed", emails=len(imported))
            self._log_output(_("Import completed successfully. {0} email(s) imported.").format(len(imported)))
            kwargs.update({"status": "Completed"})
        except Exception:
            logger.exception("import-failed")
            self._log_output(_("Import failed. See the error details below."))
            if staging_mailbox_id and client:
                self._rollback_staging_mailbox(client, staging_mailbox_id, logger)
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
        """Exports the mail data."""

        if self.operation != "Export":
            return

        logger = self._get_logger()
        logger.info("export-started", format=self.export_format, archive_type=self.export_archive_type)

        self._mark_started()
        self._log_output(_("Starting export to {0} format.").format(self.export_format.upper()))
        out_dir = os.path.join(get_mail_export_directory(), self.name)
        os.makedirs(out_dir, exist_ok=True)

        kwargs = {}
        try:
            client = get_exchange_client(self.user, self.account)
            total = query_email_ids(client, self.export_filter_dict, limit=1)["total"]
            limit = min(total, cint(self.export_limit or total))
            logger.info("export-query-resolved", total=total, limit=limit, max_export=self.max_export)
            self._log_output(
                _("Found {0} email(s) matching the filter; exporting up to {1}.").format(total, limit)
            )

            if limit > self.max_export:
                frappe.throw(_("Export limit exceeded."))

            ids = query_email_ids(client, self.export_filter_dict, sort=self.export_sort_clause, limit=limit)[
                "ids"
            ]
            if not ids:
                frappe.throw(_("No emails found for export."))

            properties = ["id", "from", "blobId", "keywords", "mailboxIds", "messageId", "receivedAt"]
            emails = [
                e.to_wire()
                for e in chunked_get(
                    client, lambda b, chunk: b.mail.email.get(ids=chunk, properties=properties), ids
                )
            ]

            if self.deduplicate_export:
                fetched = len(emails)
                unique_emails = {}
                for e in emails:
                    # messageId is String[]|null - mail with no Message-ID header comes back null.
                    # Fall back to the email id so those are not all collapsed into one bucket.
                    key = (e.get("messageId") or [e["id"]])[0]
                    if key not in unique_emails:
                        unique_emails[key] = e
                emails = list(unique_emails.values())
                logger.debug("export-deduplicated", fetched=fetched, unique=len(emails))
                self._log_output(
                    _("Removed {0} duplicate(s); {1} unique email(s) remain.").format(
                        fetched - len(emails), len(emails)
                    )
                )

            mailbox_map = {}
            if self.export_format == "mbox":
                mailbox_map = {m["id"]: m["name"] for m in get_cached_mailboxes(self.account)}
            elif self.export_format == "maildir-nested":
                mailbox_map = self._build_mailbox_map(get_cached_mailboxes(self.account))

            self._export_batches(client, emails, out_dir, mailbox_map, logger)

            self._log_output(
                _("Packaging exported emails into a {0} archive.").format(self.export_archive_type)
            )
            self._attach_export(out_dir)

            logger.info("export-completed", emails=len(emails))
            self._log_output(_("Export completed successfully. {0} email(s) exported.").format(len(emails)))
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

    def _mark_started(self) -> None:
        """Marks the mail exchange as started and updates the started_at and started_after fields."""

        started_at = now()
        self._db_set(
            status="In Progress",
            started_at=started_at,
            started_after=time_diff_in_seconds(started_at, self.queued_at),
            output="",
        )

    def _mark_completed(self, **kwargs) -> None:
        """Marks the mail exchange as completed and updates the completed_at and duration fields."""

        kwargs["completed_at"] = now()
        kwargs["duration"] = time_diff_in_seconds(kwargs["completed_at"], self.started_at)

        if kwargs["status"] == "Failed":
            kwargs["retries"] = cint(self.retries) + 1

        self._db_set(**kwargs)

    def _create_staging_mailbox(self, client: SuiteJMAPClient, logger: ExchangeLogger) -> str:
        """Creates a temporary mailbox (named after this exchange) to stage the import into."""

        self._log_output(_("Creating a temporary folder to stage the import."))
        creation_id = str(uuid7())
        with client.batch() as b:
            handle = b.mail.mailbox.set(create={creation_id: {"name": self.name, "isSubscribed": False}})

        response = handle.result
        staging_mailbox_id = response.created_id(creation_id)
        if not staging_mailbox_id:
            frappe.throw(_("Failed to create the staging folder: {0}").format(response.not_created))

        logger.info("import-staging-mailbox-created", mailbox=staging_mailbox_id)
        return staging_mailbox_id

    def _import_batches(
        self,
        client: SuiteJMAPClient,
        base_dir: str,
        metadata: list[ImportEmailMeta],
        staging_mailbox_id: str,
        logger: ExchangeLogger,
    ) -> dict[str, dict[str, bool]]:
        """Imports emails into the staging mailbox in batches, returning a map of each created email's
        ID to the destination mailboxIds it should ultimately land in."""

        total = len(metadata)
        imported: dict[str, dict[str, bool]] = {}
        batch_size = client.capabilities.limits.max_objects_in_set
        for batch in create_batch(metadata, batch_size):
            blobs: list[tuple[bytes, str]] = []
            for meta in batch:
                with open(os.path.join(base_dir, meta.blob_path), "rb") as f:
                    blobs.append((f.read(), "message/rfc822"))

            uploads = upload_blobs(client, blobs)
            emails = {}
            targets: dict[str, dict[str, bool]] = {}
            for i, upload in enumerate(uploads):
                meta = batch[i]
                emails[f"e{i}"] = {
                    "blobId": upload.blob_id,
                    "mailboxIds": {staging_mailbox_id: True},
                    "keywords": {k: True for k in meta.keywords or []},
                    "receivedAt": normalize_utc_z(meta.received_at),
                }
                targets[f"e{i}"] = {mid: True for mid in meta.mailbox_ids}

            # Email/import has no typed builder; the handle resolves to the raw wire dict.
            with client.batch() as b:
                handle = b.add("Email/import", {"emails": emails})
            result = handle.result

            for creation_id, info in (result.get("created") or {}).items():
                imported[info["id"]] = targets.get(creation_id, {})
            for creation_id, error in (result.get("notCreated") or {}).items():
                logger.warning("import-email-not-created", creation_id=creation_id, reason=str(error))

            logger.debug("import-batch-processed", batch=len(batch), imported=len(imported), total=total)
            self._log_output(_("Staged {0} of {1} email(s).").format(len(imported), total))

        # `metadata` is non-empty here (an empty import is rejected upstream), so an empty `imported`
        # means the server rejected every email — a failure that must roll back. Guarding on `total`
        # keeps this from ever misreporting an empty input as "rejected all 0". Unlike calendar/contacts
        # there is no idempotency-skip, so `not imported` already means "all rejected".
        if total and not imported:
            frappe.throw(_("Import failed: the server rejected all {0} email(s).").format(total))

        return imported

    def _move_to_target_mailboxes(
        self, client: SuiteJMAPClient, imported: dict[str, dict[str, bool]], logger: ExchangeLogger
    ) -> None:
        """Moves the staged emails into their destination mailboxes, replacing the staging mailbox.

        This is the commit step: until it runs, every email lives only in the staging mailbox, so a
        failure up to this point rolls back cleanly."""

        self._log_output(_("Moving {0} email(s) into the destination folder(s).").format(len(imported)))
        updates = {email_id: {"mailboxIds": mailbox_ids} for email_id, mailbox_ids in imported.items()}
        result = chunked_set(client, lambda b, chunk: b.mail.email.set(update=chunk), updates)

        if result.not_updated:
            # 13k bare "failed to move" rows are undebuggable — log the server's reasons,
            # aggregated by message, and surface the first one to the user.
            reasons: dict[str, int] = {}
            for error in result.not_updated.values():
                key = error.get("description") or error.get("type") or "unknown"
                reasons[key] = reasons.get(key, 0) + 1
            logger.warning("import-email-not-moved", count=len(result.not_updated), reasons=reasons)
            frappe.throw(
                _("Failed to move {0} email(s) into the destination folder(s): {1}").format(
                    len(result.not_updated),
                    format_set_error(next(iter(result.not_updated.values()))),
                )
            )

        logger.info("import-emails-moved", emails=len(result.updated))

    def _validate_destination_mailboxes(self, client: SuiteJMAPClient, meta: list[ImportEmailMeta]) -> None:
        """Fails fast when the metadata names destination mailboxes that don't exist.

        JMAP mailbox ids are account-local: an archive exported from another account (or from
        this account before its folders were recreated) names ids the server rejects one by one
        at the move step — after everything has already been staged — and any id that happens to
        collide with a real mailbox would silently land mail in the wrong folder. Checked against
        a fresh mailbox read so a stale cache can't produce false failures.
        """

        wanted: set[str] = set()
        for row in meta:
            if not row.mailbox_ids:
                frappe.throw(_("Import metadata contains an email with no destination mailbox."))
            wanted.update(row.mailbox_ids)

        with client.batch() as b:
            h = b.mail.mailbox.get(properties=["id"])
        existing = {m.to_wire()["id"] for m in h.result.items}

        if unknown := sorted(wanted - existing):
            shown = ", ".join(unknown[:5]) + ("…" if len(unknown) > 5 else "")
            frappe.throw(
                _(
                    "The import references {0} destination mailbox id(s) that do not exist in "
                    "this account (e.g. {1}). Mailbox ids are account-specific — a JMAP archive "
                    "can only be restored into the account it was exported from."
                ).format(len(unknown), shown)
            )

    def _discard_staging_mailbox(
        self, client: SuiteJMAPClient, staging_mailbox_id: str, logger: ExchangeLogger
    ) -> None:
        """Deletes the now-empty staging mailbox after a successful import. A failure here is logged
        but not fatal: the emails are already safely in their destination folders."""

        try:
            with client.batch() as b:
                b.mail.mailbox.set(destroy=[staging_mailbox_id])
            logger.info("import-staging-mailbox-removed", mailbox=staging_mailbox_id)
        except Exception:
            logger.warning("import-staging-mailbox-remove-failed", mailbox=staging_mailbox_id)

    def _rollback_staging_mailbox(
        self, client: SuiteJMAPClient, staging_mailbox_id: str, logger: ExchangeLogger
    ) -> None:
        """Deletes the staging mailbox and every email still staged in it, undoing a failed import."""

        self._log_output(_("Rolling back: removing the staging folder and any staged emails."))
        try:
            with client.batch() as b:
                b.mail.mailbox.set(destroy=[staging_mailbox_id], onDestroyRemoveEmails=True)
            logger.info("import-rolled-back", mailbox=staging_mailbox_id)
        except Exception:
            logger.exception("import-rollback-failed", mailbox=staging_mailbox_id)

    def _export_batches(
        self,
        client: SuiteJMAPClient,
        emails: list[dict],
        out_dir: str,
        mailbox_map: dict[str, str],
        logger: ExchangeLogger,
    ) -> None:
        """Exports emails in batches, downloading each batch's blobs concurrently."""

        if self.export_format == "jmap":
            ExportWriter.write_meta(emails, out_dir)

        total = len(emails)
        exported = 0
        batch_size = cint(get_config("exchange_export_batch_size"))
        for batch in create_batch(emails, batch_size):
            blobs = [(e["blobId"], None) for e in batch if e.get("blobId")]
            data = download_blobs(client, blobs)

            export_emails = []
            for e in batch:
                if e.get("blobId") not in data:
                    logger.warning("export-blob-missing", id=e.get("id"), blob_id=e.get("blobId"))
                    continue

                export_emails.append(
                    ExportEmail(
                        id=e["id"],
                        sender=(e.get("from") or [{}])[0],
                        blob_id=e["blobId"],
                        keywords=set(e["keywords"].keys()),
                        mailbox_ids=set(e["mailboxIds"].keys()),
                        message_id=(e.get("messageId") or [""])[0],
                        received_at=datetime.fromisoformat(e["receivedAt"]),
                        raw=data[e["blobId"]],
                    )
                )

            ExportWriter.write(self.export_format, export_emails, out_dir, mailbox_map)

            exported += len(export_emails)
            logger.debug("export-batch-written", batch=len(export_emails), exported=exported, total=total)
            self._log_output(_("Exported {0} of {1} email(s).").format(exported, total))

    def _build_mailbox_map(self, mailboxes: list[dict]) -> dict[str, str]:
        """Builds a mapping of mailbox IDs to their full paths."""

        by_id = {m["id"]: m for m in mailboxes}
        result: dict[str, str] = {}

        def resolve_path(mailbox_id: str) -> str:
            if mailbox_id in result:
                return result[mailbox_id]

            mailbox = by_id[mailbox_id]
            name = mailbox["name"]
            parent_id = mailbox.get("parentId")

            if parent_id:
                parent_path = resolve_path(parent_id)
                path = f"{parent_path}/{name}"
            else:
                path = name

            result[mailbox_id] = path
            return path

        for mailbox_id in by_id:
            resolve_path(mailbox_id)

        return result

    def _attach_export(self, out_dir: str) -> None:
        """Attaches the exported file to the mail exchange."""

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
        """Sends notification email to the owner of the mail exchange."""

        if is_administrator(self.owner):
            return
        if not (email := get_user_email_address(self.owner)):
            return

        subject = _("Mail Data {0} {1}").format(action, "Completed" if success else "Failed")
        frappe.publish_realtime(
            "mail_exchange_completed",
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
                "link": get_url(f"/mail/mail-exchanges/{self.name}"),
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


def get_exchange_client(
    user: str,
    account: str,
    ignore_permissions: bool = False,
) -> SuiteJMAPClient:
    """Returns an account-scoped JMAP client configured with the longer exchange timeouts."""

    return account_view(
        get_jmap_client(user, ignore_permissions=ignore_permissions, timeout=EXCHANGE_TIMEOUT), account
    )


def query_email_ids(
    client: SuiteJMAPClient, filter: dict | None, limit: int, sort: list[dict] | None = None
) -> dict:
    """Paginates Email/query until `limit` ids are collected, returning `{"ids", "total"}`."""

    ids: list[str] = []
    total = None
    position = 0
    batch_size = min(limit, client.capabilities.limits.max_objects_in_get)
    sort = sort or [{"property": "receivedAt", "isAscending": False}]

    while len(ids) < limit:
        current_batch_size = min(batch_size, limit - len(ids))

        with client.batch() as b:
            handle = b.mail.email.query(
                position=position,
                limit=current_batch_size,
                sort=sort,
                calculate_total=total is None,
                **omit_none(filter=filter),
            )

        response = handle.result
        ids.extend(response.ids)

        if total is None:
            total = response.total

        if len(response.ids) < current_batch_size or (total is not None and len(ids) >= total):
            break

        position += len(response.ids)

    return {"ids": ids[:limit], "total": total}


def extract_received_or_sent(msg: Message) -> datetime:
    """
    Extracts the received date from the email headers.
    If the Received header is not available or invalid, it falls back to the Date header.
    Ensures the resulting datetime is not in the future.
    Raises an exception if neither header is valid.
    """

    now = datetime.now(UTC)

    if received_headers := msg.get_all("Received", []):
        last_received = received_headers[-1]

        if ";" in last_received:
            date_part = last_received.rsplit(";", 1)[-1].strip()
            try:
                dt = parsedate_to_datetime(date_part)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)

                if dt <= now:
                    return dt
            except Exception:
                pass

    if sent_date := msg.get("Date"):
        try:
            dt = parsedate_to_datetime(sent_date)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)

            if dt <= now:
                return dt
        except Exception:
            pass

    frappe.throw(_("Email must have a valid non-future Received or Date header."))


def retry_stuck_mail_exchanges() -> None:
    """Called by the scheduler to retry stuck mail exchanges."""

    ME = frappe.qb.DocType("Mail Exchange")
    exchanges = (
        frappe.qb.from_(ME)
        .select(ME.name)
        .where(
            (ME.status.isin(["Queued", "In Progress"]))
            & (ME.queued_at <= get_datetime(add_to_date(now(), days=-1)))
        )
        .orderby(ME.queued_at, order=Order.asc)
    ).run(pluck="name")

    # retry() throws for a document that no longer qualifies, and a scheduler job has no
    # caller to surface that to - so isolate each one, or the first bad document silently
    # strands every exchange queued behind it, run after run.
    for exchange in exchanges:
        try:
            frappe.get_doc("Mail Exchange", exchange).retry()
        except Exception:
            frappe.db.rollback()
            log_error(
                module="Mail",
                title=f"Failed to retry stuck Mail Exchange {exchange}",
                message=frappe.get_traceback(),
            )


def clean_import_export_directories() -> None:
    """Called by the scheduler to clean up import and export directories."""

    for base in (get_mail_import_directory(), get_mail_export_directory()):
        if not os.path.exists(base):
            continue

        for item in os.listdir(base):
            path = os.path.join(base, item)
            if os.path.isdir(path):
                if frappe.db.exists("Mail Exchange", {"name": item, "status": "In Progress"}):
                    continue
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
