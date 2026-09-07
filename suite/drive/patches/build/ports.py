"""The three seams Build reaches the outside world through.

Every rule in `gate`, `legacy_bytes`, and `s3_copy` runs against these
protocols, so the whole step is exercised with no site, no bucket, and no
database. `tests/fakes.py` holds the doubles; the classes below are the
only code in the package that touches `frappe.db`, `frappe.conf`, or boto3.
"""

from dataclasses import dataclass
from typing import IO, Protocol

import frappe
from frappe.utils import cint


@dataclass(frozen=True)
class LegacyRow:
    """One legacy Drive `File` row that still has no blob."""

    name: str
    file_url: str
    file_name: str | None = None


class StorageGateway(Protocol):
    """Framework storage v2: its switch, its driver config, its blob rows."""

    def enabled(self) -> bool:
        """`frappe.storage.enabled()`."""

    def driver_name(self) -> str:
        """The site's `storage_driver`, or an empty string when unset."""

    def driver_config(self) -> dict:
        """The site's `storage_driver_config`, or an empty dict when unset."""

    def run_backfill(self, batch_size: int) -> dict:
        """`frappe.storage.backfill.run()`. Idempotent; links local bytes in place."""

    def claim_blob(self, checksum: str) -> str | None:
        """Name of a ready private S3 blob for this content, held against GC.

        None when no such row exists, so the caller must copy the object."""

    def insert_blob(self, *, key: str, checksum: str, size: int, mime_type: str) -> str:
        """Insert one private S3 `File Blob` and return its name."""


class LegacyFiles(Protocol):
    """The legacy `File` table, read by keyset page and written one column."""

    def s3_rows_without_blob(self, after: str, limit: int) -> list[LegacyRow]:
        """Blobless rows whose `file_url` is a Drive S3 fetch URL, `name` ascending."""

    def link_blob(self, file_name: str, blob_name: str) -> None:
        """Set `File.blob` without doc events or a `modified` bump."""

    def commit(self) -> None:
        """End the current batch."""


class S3Bucket(Protocol):
    """Raw bucket access. Legacy Drive keys sit outside the driver's namespace."""

    bucket: str

    def open(self, key: str) -> IO[bytes]:
        """Readable body of the object. Raises `FileNotFoundError` when it is gone."""

    def size(self, key: str) -> int | None:
        """Object size in bytes, or None when the object is not there."""

    def copy_object(self, source_key: str, destination_key: str) -> None:
        """Single-part server-side copy. Refuses a source above 5 GB."""

    def managed_copy(self, source_key: str, destination_key: str) -> None:
        """boto3 managed copy: multipart, server-side, no size ceiling."""


class SiteStorage:
    """`StorageGateway` over the real framework storage module."""

    def enabled(self) -> bool:
        import frappe.storage

        return frappe.storage.enabled()

    def driver_name(self) -> str:
        return frappe.conf.storage_driver or ""

    def driver_config(self) -> dict:
        return frappe.conf.storage_driver_config or {}

    def run_backfill(self, batch_size: int) -> dict:
        from frappe.storage import backfill

        return backfill.run(batch_size=batch_size)

    def claim_blob(self, checksum: str) -> str | None:
        from frappe.storage.blob import revive_blob

        existing = frappe.db.get_value(
            "File Blob",
            # `status` matters: a Pending row is an upload still in flight, so
            # its object may not be there. Linking to one would leave the File
            # pointing at nothing once Cleanup deletes Drive's legacy prefix.
            {"checksum": checksum, "is_private": 1, "driver": "s3", "status": "Ready"},
        )
        # revive_blob locks the row and pushes it out of the GC orphan window.
        # It answers False when a concurrent GC pass already deleted it, and
        # then the object has to be copied again.
        if existing and revive_blob(existing):
            return existing
        return None

    def insert_blob(self, *, key: str, checksum: str, size: int, mime_type: str) -> str:
        blob = frappe.new_doc("File Blob")
        blob.update(
            {
                "key": key,
                "checksum": checksum,
                "file_size": size,
                "mime_type": mime_type,
                "driver": "s3",
                "is_private": cint(True),
                "status": "Ready",
            }
        )
        blob.insert(ignore_permissions=True)
        return blob.name


class SiteFiles:
    """`LegacyFiles` over the real `File` table."""

    def __init__(self, s3_url_prefix: str):
        self.s3_url_prefix = s3_url_prefix

    def s3_rows_without_blob(self, after: str, limit: int) -> list[LegacyRow]:
        rows = frappe.get_all(
            "File",
            filters={
                "blob": ("is", "not set"),
                "is_folder": 0,
                "name": (">", after),
                # The prefix carries no LIKE wildcard of its own; `test_ports`
                # fails if that stops being true and the pattern over-matches.
                "file_url": ("like", self.s3_url_prefix + "%"),
            },
            fields=["name", "file_url", "file_name"],
            order_by="name asc",
            limit=limit,
        )
        return [LegacyRow(r.name, r.file_url or "", r.file_name) for r in rows]

    def link_blob(self, file_name: str, blob_name: str) -> None:
        frappe.db.set_value("File", file_name, "blob", blob_name, update_modified=False)

    def commit(self) -> None:
        if not frappe.flags.in_test:
            frappe.db.commit()  # batched migration: a stopped run resumes here  # nosemgrep


class BotoBucket:
    """`S3Bucket` over the framework S3 driver's own client and bucket.

    Build reads legacy objects and writes canonical ones through one client,
    which is what "the same bucket" in §14.2 step 3 buys: a server-side copy
    needs both keys reachable from one set of credentials.
    """

    def __init__(self, driver):
        self.driver = driver
        self.bucket = driver.bucket
        self.client = driver.client

    @classmethod
    def from_site(cls) -> BotoBucket:
        from frappe.storage.driver import get_driver

        return cls(get_driver("s3"))

    def open(self, key: str) -> IO[bytes]:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        except self.driver._client_error as e:
            if self._is_missing(e):
                raise FileNotFoundError(key) from e
            raise

    def size(self, key: str) -> int | None:
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        except self.driver._client_error as e:
            if self._is_missing(e):
                return None
            raise

    def copy_object(self, source_key: str, destination_key: str) -> None:
        self.client.copy_object(
            Bucket=self.bucket,
            Key=destination_key,
            CopySource={"Bucket": self.bucket, "Key": source_key},
        )

    def managed_copy(self, source_key: str, destination_key: str) -> None:
        self.client.copy({"Bucket": self.bucket, "Key": source_key}, self.bucket, destination_key)

    def _is_missing(self, error) -> bool:
        from frappe.storage.s3_driver import MISSING_KEY_CODES

        return error.response.get("Error", {}).get("Code") in MISSING_KEY_CODES
