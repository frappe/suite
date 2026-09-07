"""§14.2 step 3: put legacy Drive S3 objects into the canonical layout.

For each Drive `File` row whose `file_url` is a
`suite.drive.api.s3.fetch?path=` URL and which has no blob:

1. Stream the object **once** to get its sha256, its size, and enough head
   bytes to sniff a MIME type.
2. Reuse an existing private S3 blob for that content if there is one, so
   two Drive files with the same bytes end as one object and one blob row.
3. Otherwise server-side copy it to `private/<ab>/<cd>/<sha256>[.ext]` in
   the same bucket, single-part below 5 GB and boto3's managed multipart
   copy above it.
4. Insert one `File Blob` with `driver = "s3"` and set `File.blob`.

Nothing is deleted. The legacy object stays where it is until Cleanup
(§14.10) removes Drive's prefix, so a rollback is still "truncate the new
tables and ship the old code".

Resumability has three layers, cheapest first: a linked `File.blob` keeps
the row out of the query; a matching blob row skips the copy; an object
already complete at the destination key skips the copy too, which is what
saves an interrupted run from sending the same 5 GB twice.
"""

import hashlib
import io
from contextlib import closing

from frappe.storage.blob import sniff_mime

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.layout import blob_key, needs_multipart_copy, object_key
from suite.drive.patches.build.state import MissingBytes, StoragePreparation
from suite.drive.utils.files import S3_URL_PREFIX, storage_key

# Read size while hashing a legacy object. Big enough that a multi-GB object
# is not a million round trips through botocore's stream.
READ_CHUNK = 1024 * 1024

# What `sniff_mime` looks at. Held aside from the hashing loop so the object
# is still read exactly once.
SNIFF_BYTES = 8192


def copy_legacy_s3_objects(env, prep: StoragePreparation, *, batch_size: int = BUILD_BATCH_SIZE) -> None:
    """Copy every unlinked legacy S3 object, committing per batch.

    Updates `prep` in place and flushes it after each committed batch, so a
    killed run loses at most the counts of one batch, never a copied object.
    """
    bucket = env.bucket()
    after = ""
    while True:
        rows = env.files.s3_rows_without_blob(after, batch_size)
        if not rows:
            return
        for row in rows:
            _copy_one(env, bucket, prep, row)
        after = rows[-1].name
        env.files.commit()
        env.state.put_storage(prep)
        if len(rows) < batch_size:
            return


def _copy_one(env, bucket, prep: StoragePreparation, row) -> None:
    prep.s3_rows_seen += 1

    if not row.file_url.startswith(S3_URL_PREFIX):
        return _missing(prep, row, "file_url is not a Drive S3 fetch URL")
    legacy_key = storage_key(row.file_url)
    if not legacy_key:
        return _missing(prep, row, "the S3 fetch URL carries no object path")

    try:
        digest = _read_once(bucket, legacy_key)
    except FileNotFoundError:
        return _missing(prep, row, f"no object at {legacy_key} in {bucket.bucket}")

    existing = env.storage.claim_blob(digest.checksum)
    if existing:
        env.files.link_blob(row.name, existing)
        prep.s3_objects_reused += 1
        return

    destination = object_key(digest.checksum, row.file_name)
    # An interrupted run can leave the object copied and the blob row
    # uninserted. A complete object at the destination is that object.
    if bucket.size(destination) != digest.size:
        copy_in_bucket(bucket, legacy_key, destination, digest.size)
        # Verify by size, the way `remove_teams._copy` does. A Ready blob over
        # a truncated object is worse than a stopped Build: nothing downstream
        # would ever look at those bytes again.
        if bucket.size(destination) != digest.size:
            raise OSError(f"copy of {legacy_key} to {destination} did not verify")

    blob = env.storage.insert_blob(
        key=blob_key(digest.checksum, row.file_name),
        checksum=digest.checksum,
        size=digest.size,
        mime_type=digest.mime_type,
    )
    env.files.link_blob(row.name, blob)
    prep.s3_objects_copied += 1
    prep.s3_bytes_copied += digest.size


def copy_in_bucket(bucket, source_key: str, destination_key: str, size: int) -> None:
    """Server-side copy inside one bucket, multipart above 5 GB (§14.2 step 3).

    `copy_object` is one call and refuses a source larger than the S3
    ceiling; boto3's managed `copy` splits the same server-side copy into
    parts and has no ceiling."""
    if needs_multipart_copy(size):
        bucket.managed_copy(source_key, destination_key)
    else:
        bucket.copy_object(source_key, destination_key)


class _Digest:
    __slots__ = ("checksum", "mime_type", "size")

    def __init__(self, checksum: str, size: int, mime_type: str):
        self.checksum = checksum
        self.size = size
        self.mime_type = mime_type


def _read_once(bucket, key: str) -> _Digest:
    """One GET: sha256, byte count, and the sniffed MIME type."""
    sha256 = hashlib.sha256()
    size = 0
    head = b""
    with closing(bucket.open(key)) as body:
        while chunk := body.read(READ_CHUNK):
            if len(head) < SNIFF_BYTES:
                head += chunk[: SNIFF_BYTES - len(head)]
            sha256.update(chunk)
            size += len(chunk)
    return _Digest(sha256.hexdigest(), size, sniff_mime(io.BytesIO(head)))


def _missing(prep: StoragePreparation, row, reason: str) -> None:
    prep.s3_objects_missing += 1
    prep.missing_bytes.append(MissingBytes(file=row.name, file_url=row.file_url, reason=reason))
