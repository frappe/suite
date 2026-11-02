"""§14.2 step 3: put legacy Drive S3 objects into the blob layout.

For each Drive `File` row whose `file_url` is a
`suite.drive.api.s3.fetch?path=` URL and which has no blob:

1. Stream the object **once** to get its sha256, its size, and enough head
   bytes to sniff a MIME type.
2. Reuse an existing `Ready` private S3 blob for that content if there is
   one, so two Drive files with the same bytes end as one object and one
   blob row. A `Ready` row is not proof that its object is still there, so
   the object is headed first and re-copied when it is gone. A `Pending`
   row is an upload in flight and is not reused; `File Blob` allows
   duplicate content, so Build stores its own blob beside it.
3. Otherwise server-side copy it into its blob folder,
   `private/<site prefix>/<blob>/<filename>`, in the same bucket,
   single-part below 5 GB and boto3's managed multipart copy above it.
4. Record the legacy key, destination, size and checksum in the copy
   ledger (`copy_ledger.py`), then insert one `File Blob` with
   `driver = "s3"` and set `File.blob`.

Nothing is deleted. The legacy object stays where it is through Build and
Cleanup; only the manual `cleanup.delete_legacy_objects` command removes it,
reading this ledger, so restoring the pre-migration backup stays a complete
rollback until an operator runs that command.

Legacy keys are used exactly as `storage_key` decodes them. The production
bucket holds keys with a leading slash, bare keys at the root and keys in
per-user folders, and none of them is normalised here or in `BotoBucket`.

Resumability has three layers, cheapest first: a linked `File.blob` keeps
the row out of the query; a matching blob row skips the copy; an object an
interrupted run already copied skips the copy too, which is what saves a
resumed run from sending the same 5 GB twice. For that last layer the blob
name comes from the checksum (`layout.blob_name`), so the content's folder
is known before anything is copied. The filename is not: the rerun may
reach the content through another row first, or the first row may have been
renamed. So the copy step lists the folder and keeps whatever object is
there, under whatever filename it was copied with, and overwrites an
incomplete one in place. A folder therefore holds at most one object, and a
rerun leaves no orphan behind.

Each page is worked in four stages. The workers read every object of the
page at once; this thread claims existing blobs, which reads the database;
the workers place each distinct content at once; and this thread, in row
order, writes the ledger, the blob rows and the links. So
nothing that records progress happens before the copy it records has been
verified, and every database call stays on the thread that owns
`frappe.db`. A failure in any worker stops the page before any of it is
recorded; the resumed run finds the objects that did land and does not
copy them again.

The loop ends on an empty or short page. Rows that cannot be linked stay in
the query, so the keyset cursor is what carries the loop past them; the
stall guard below is a belt on those braces, for a `LegacyFiles` that
ignores `after`.
"""

import hashlib
import io
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import dataclass

from frappe.storage.blob import sniff_mime

from suite.drive.patches.build.copy_ledger import CopiedObject
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.layout import (
    PRIVATE_NAMESPACE,
    blob_folder,
    blob_key,
    blob_name,
    needs_multipart_copy,
    private_key,
)
from suite.drive.patches.build.legacy import S3_URL_PREFIX, storage_key
from suite.drive.patches.build.ports import ClaimedBlob, LegacyRow
from suite.drive.patches.build.state import MissingBytes, StoragePreparation

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
    pool = ThreadPoolExecutor(max_workers=env.copy_workers, thread_name_prefix="drive-build-copy")
    try:
        after = ""
        previous_page = None
        while True:
            rows = env.files.s3_rows_without_blob(after, batch_size)
            if not rows:
                return
            # Two identical pages mean the cursor stopped moving, and a
            # migration that hangs is worse than one that stops.
            if rows[0].name == previous_page:
                raise RuntimeError(f"the File cursor stalled at {rows[0].name!r}; refusing to loop")
            previous_page = rows[0].name
            _copy_page(env, bucket, pool, prep, rows)
            after = rows[-1].name
            env.files.commit()
            env.state.put_storage(prep)
            if len(rows) < batch_size:
                return
    finally:
        # A failed page must not wait for the rest of its queued reads.
        pool.shutdown(wait=True, cancel_futures=True)


class _Digest:
    __slots__ = ("checksum", "mime_type", "size")

    def __init__(self, checksum: str, size: int, mime_type: str):
        self.checksum = checksum
        self.size = size
        self.mime_type = mime_type


@dataclass
class _Found:
    """A row whose legacy object was read."""

    row: LegacyRow
    legacy_key: str
    digest: _Digest


@dataclass
class _Placement:
    """One distinct content in a page, and where its object ends up.

    The first row that reaches the content supplies the legacy key and the
    filename, as it would have copied alone. `blob` is the claimed blob, or
    for new content the one its first row inserts; every other row reuses it.
    """

    first: _Found
    claimed: ClaimedBlob | None
    destination: str = ""
    blob: str | None = None

    def __post_init__(self):
        if self.claimed:
            self.blob = self.claimed.name

    def place(self, bucket, key_prefix: str) -> str:
        """Make the object whole at its key and verify it. Runs on a worker."""
        found = self.first
        size = found.digest.size
        if self.claimed:
            # The row survives the object: GC deletes the bytes first and the
            # row second (`frappe/storage/gc.py`), and a failed row delete
            # leaves a Ready blob with nothing behind it. Linking to that
            # would hand Cleanup a File pointing at no bytes at all.
            destination = private_key(self.claimed.key)
            _place_object(bucket, found.legacy_key, destination, size)
            return destination
        name = blob_name(found.digest.checksum)
        key = _place_new_object(bucket, found.legacy_key, key_prefix, name, found.row.file_name, size)
        return private_key(key)


def _copy_page(env, bucket, pool: ThreadPoolExecutor, prep: StoragePreparation, rows) -> None:
    wanted = [(row, key) for row in rows if (key := _legacy_key(prep, row))]
    digests = list(pool.map(lambda pair: _read_if_present(bucket, pair[1]), wanted))
    found: list[_Found] = []
    for (row, legacy_key), digest in zip(wanted, digests, strict=True):
        if digest is None:
            _missing(prep, row, f"no object at {legacy_key} in {bucket.bucket}")
        else:
            found.append(_Found(row, legacy_key, digest))

    placements: dict[str, _Placement] = {}
    for item in found:
        checksum = item.digest.checksum
        if checksum not in placements:
            placements[checksum] = _Placement(item, env.storage.claim_blob(checksum))
    key_prefix = env.storage.key_prefix()
    destinations = pool.map(lambda placement: placement.place(bucket, key_prefix), placements.values())
    for placement, destination in zip(placements.values(), destinations, strict=True):
        placement.destination = destination

    for item in found:
        _link(env, bucket, prep, item, placements[item.digest.checksum])


def _legacy_key(prep: StoragePreparation, row) -> str | None:
    """The bucket key this row names, or `None` when there is nothing to read."""
    prep.s3_rows_seen += 1
    if not row.file_url.startswith(S3_URL_PREFIX):
        _missing(prep, row, "file_url is not a Drive S3 fetch URL")
        return None
    legacy_key = storage_key(row.file_url)
    if not legacy_key:
        _missing(prep, row, "the S3 fetch URL carries no object path")
        return None
    return legacy_key


def _link(env, bucket, prep: StoragePreparation, item: _Found, placement: _Placement) -> None:
    """Record and link one row whose object is verified at `placement.destination`."""
    digest = item.digest
    _record_copy(env, bucket, item.row, item.legacy_key, placement.destination, digest)
    if placement.blob:
        env.files.link_blob(item.row.name, placement.blob)
        prep.s3_objects_reused += 1
        return

    placement.blob = env.storage.insert_blob(
        name=blob_name(digest.checksum),
        key=placement.destination.removeprefix(PRIVATE_NAMESPACE),
        checksum=digest.checksum,
        size=digest.size,
        mime_type=digest.mime_type,
    )
    env.files.link_blob(item.row.name, placement.blob)
    prep.s3_objects_copied += 1
    prep.s3_bytes_copied += digest.size


def _record_copy(env, bucket, row, legacy_key: str, destination: str, digest) -> None:
    """Ledger first, link second: a kill between the two leaves a recorded
    legacy key whose object is still in place, which the delete command
    re-verifies against the destination before it acts."""
    env.ledger().record(
        CopiedObject(
            file=row.name,
            legacy_key=legacy_key,
            destination=destination,
            size=digest.size,
            checksum=digest.checksum,
            bucket=bucket.bucket,
        )
    )


def _place_object(bucket, legacy_key: str, destination: str, size: int) -> None:
    """Make sure an existing blob's key holds the whole object, copying if not."""
    if bucket.size(destination) != size:
        _copy_verified(bucket, legacy_key, destination, size)


def _place_new_object(
    bucket, legacy_key: str, key_prefix: str, name: str, filename: str | None, size: int
) -> str:
    """Put new content in its blob folder and return the blob key.

    The folder belongs to this content alone, so whatever an interrupted run
    left there is reused: a complete object as it is, an incomplete one by
    copying over it. Only an empty folder takes this row's filename."""
    found = bucket.sizes_under(private_key(blob_folder(key_prefix, name)))
    complete = sorted(key for key, found_size in found.items() if found_size == size)
    if complete:
        destination = complete[0]
    else:
        destination = min(found, default=private_key(blob_key(key_prefix, name, filename)))
        _copy_verified(bucket, legacy_key, destination, size)
    return destination.removeprefix(PRIVATE_NAMESPACE)


def _copy_verified(bucket, legacy_key: str, destination: str, size: int) -> None:
    copy_in_bucket(bucket, legacy_key, destination, size)
    # Verify by size, as the legacy backend's own copies did. A Ready blob over a
    # truncated object is worse than a stopped Build: nothing downstream
    # would ever look at those bytes again.
    if bucket.size(destination) != size:
        raise OSError(f"copy of {legacy_key} to {destination} did not verify")


def copy_in_bucket(bucket, source_key: str, destination_key: str, size: int) -> None:
    """Server-side copy inside one bucket, multipart above 5 GB (§14.2 step 3).

    `copy_object` is one call and refuses a source larger than the S3
    ceiling; boto3's managed `copy` splits the same server-side copy into
    parts and has no ceiling."""
    if needs_multipart_copy(size):
        bucket.managed_copy(source_key, destination_key)
    else:
        bucket.copy_object(source_key, destination_key)


def _read_if_present(bucket, key: str) -> _Digest | None:
    """`_read_once`, or `None` when the object is not there. Runs on a worker."""
    try:
        return _read_once(bucket, key)
    except FileNotFoundError:
        return None


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
    prep.record_missing(MissingBytes(file=row.name, file_url=row.file_url, reason=reason))
