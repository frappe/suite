"""In-memory doubles for Build's three ports.

They are the fixtures the §14.2 step 1 to 3 tests run against: no site, no
bucket, no database, so every rule is exercised directly and an interrupted
run is reproduced by raising where a real one would be killed.

Where they copy a real constraint they copy it exactly: a body is read once
and cannot be rewound, `copy_object` refuses a source above 5 GB the way S3
does, and `FakeStorage` enforces `File Blob`'s unique index on
`(checksum, is_private, driver)`. Two limits they do not model:
`FakeStorage` has no transaction, so a rollback in `FakeFiles` leaves its
blobs behind; and `run_backfill` answers with a fixed dict rather than
reading the rows. Both are covered against the real thing in
`suite/drive/tests/test_build_storage.py`.
"""

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import BlobConflict, ClaimedBlob, LegacyRow
from suite.drive.patches.build.state import BuildState
from suite.drive.utils.files import S3_URL_PREFIX, get_s3_url

# S3's own `CopyObject` source ceiling, an inclusive maximum
# (`s3transfer.utils.MAX_SINGLE_UPLOAD_SIZE`). Spelled out rather than
# imported from `layout`: a fake that took the production constant would
# move with a mutation of it, and this boundary is the one thing the fake
# exists to police. `test_layout` pins the two against each other.
S3_COPY_OBJECT_MAX_BYTES = 5_368_709_120


class FakeStorage:
    """`StorageGateway` over dictionaries."""

    def __init__(self, *, enabled=True, driver="s3", config=None, backfill=None):
        self._enabled = enabled
        self._driver = driver
        self._config = config if config is not None else {"bucket": "drive-bucket"}
        self._backfill = backfill if backfill is not None else {"linked": 0, "blobs_created": 0}
        self.blobs = {}
        self.backfill_calls = []

    def enabled(self):
        return self._enabled

    def driver_name(self):
        return self._driver

    def driver_config(self):
        return dict(self._config)

    def run_backfill(self, batch_size):
        self.backfill_calls.append(batch_size)
        return self._backfill

    def add_blob(self, name, *, key, checksum, status="Ready", driver="s3", is_private=1):
        """A blob row that some other writer left behind."""
        self.blobs[name] = {
            "key": key,
            "checksum": checksum,
            "file_size": 0,
            "mime_type": "application/octet-stream",
            "driver": driver,
            "is_private": is_private,
            "status": status,
        }
        return self

    def _holder(self, checksum):
        """The row holding the unique triple, the way the index defines it."""
        for name, blob in self.blobs.items():
            if blob["checksum"] == checksum and blob["driver"] == "s3" and blob["is_private"] == 1:
                return name, blob
        return None, None

    def claim_blob(self, checksum):
        name, blob = self._holder(checksum)
        if blob and blob["status"] == "Ready":
            return ClaimedBlob(name, blob["key"])
        return None

    def blocked_by(self, checksum):
        _, blob = self._holder(checksum)
        return blob["status"] if blob else None

    def insert_blob(self, *, key, checksum, size, mime_type):
        # `File Blob` carries a unique index on (checksum, is_private, driver).
        if self._holder(checksum)[0]:
            raise BlobConflict(checksum)
        name = f"blob{len(self.blobs) + 1}"
        self.blobs[name] = {
            "key": key,
            "checksum": checksum,
            "file_size": size,
            "mime_type": mime_type,
            "driver": "s3",
            "is_private": 1,
            "status": "Ready",
        }
        return name


class FakeFiles:
    """`LegacyFiles` over a list of rows, committed into a snapshot."""

    def __init__(self, rows=()):
        self.rows = {row["name"]: {"file_type": None, **row} for row in rows}
        self.committed = {name: dict(row) for name, row in self.rows.items()}
        self.commits = 0

    @classmethod
    def with_s3_files(cls, *specs):
        """`(name, object_key, file_name)` triples as legacy S3 File rows."""
        return cls(
            [
                {"name": name, "file_url": get_s3_url(key), "file_name": file_name, "blob": None}
                for name, key, file_name in specs
            ]
        )

    def add(self, name, file_url, file_name=None, blob=None, file_type=None):
        self.rows[name] = {
            "name": name,
            "file_url": file_url,
            "file_name": file_name,
            "blob": blob,
            "file_type": file_type,
        }
        self.committed[name] = dict(self.rows[name])
        return self

    def s3_rows_without_blob(self, after, limit):
        return self._page(after, limit, lambda row: row["file_url"].startswith(S3_URL_PREFIX))

    def rows_outside(self, prefixes, after, limit):
        return self._page(after, limit, lambda row: not row["file_url"].startswith(tuple(prefixes)))

    def _page(self, after, limit, matches):
        found = [
            LegacyRow(row["name"], row["file_url"], row["file_name"], row.get("file_type"))
            for name, row in sorted(self.rows.items())
            if name > after and not row["blob"] and matches(row)
        ]
        return found[:limit]

    def link_blob(self, file_name, blob_name):
        self.rows[file_name]["blob"] = blob_name

    def commit(self):
        self.commits += 1
        self.committed = {name: dict(row) for name, row in self.rows.items()}

    def rollback(self):
        """What a killed run leaves behind: everything since the last commit is gone."""
        self.rows = {name: dict(row) for name, row in self.committed.items()}

    def blob_of(self, name):
        return self.rows[name]["blob"]


class InterruptedRun(Exception):
    """Stands in for the run being killed part way through."""


class SingleUseBody:
    """What `get_object` returns: a stream you may read once, forwards only.

    A `BytesIO` would let a second read pass succeed here and fail on a
    site, which is exactly what "read the object once" has to rule out.

    `read(size)` honours its argument the way botocore's `StreamingBody`
    does, including the part that matters for a multi-GB object: a negative
    or absent size hands back the whole remainder in one allocation. It
    still short-reads below that, because a real socket does.
    """

    def __init__(self, content, chunk_size):
        self.content = content
        self.position = 0
        self.chunk_size = chunk_size
        self.closed = False
        self.requested = []

    def read(self, size=-1):
        if self.closed:
            raise ValueError("read from a closed S3 body")
        self.requested.append(size)
        if size is None or size < 0:
            take = len(self.content) - self.position
        else:
            take = min(size, self.chunk_size)
        chunk = self.content[self.position : self.position + take]
        self.position += len(chunk)
        return chunk

    def close(self):
        self.closed = True


class FakeBucket:
    """`S3Bucket` over a dict of objects, recording every call."""

    def __init__(self, bucket="drive-bucket", objects=None):
        self.bucket = bucket
        self.objects = dict(objects or {})
        self.sizes = {key: len(body) for key, body in self.objects.items()}
        self.opened = []
        self.bodies = []
        self.copies = []
        self.fail_copy_at = None
        # Small enough that an ordinary fixture still crosses the read loop
        # more than once, so the chunk arithmetic is exercised.
        self.read_chunk = 64

    def declare(self, key, size):
        """An object with a size but no bytes, for the copy-choice tests."""
        self.sizes[key] = size
        return self

    def put(self, key, body):
        self.objects[key] = body
        self.sizes[key] = len(body)
        return self

    def open(self, key):
        if key not in self.objects:
            raise FileNotFoundError(key)
        self.opened.append(key)
        body = SingleUseBody(self.objects[key], self.read_chunk)
        self.bodies.append(body)
        return body

    def size(self, key):
        return self.sizes.get(key)

    def copy_object(self, source_key, destination_key):
        if self.sizes.get(source_key, 0) > S3_COPY_OBJECT_MAX_BYTES:
            # What S3 answers: CopyObject has a hard 5 GB source ceiling.
            raise ValueError(f"copy_object source {source_key} is above the 5 GB ceiling")
        self._copy("copy_object", source_key, destination_key)

    def managed_copy(self, source_key, destination_key):
        self._copy("managed_copy", source_key, destination_key)

    def _copy(self, kind, source_key, destination_key):
        self.copies.append((kind, source_key, destination_key))
        if self.fail_copy_at is not None and len(self.copies) >= self.fail_copy_at:
            raise InterruptedRun(f"killed while copying {source_key}")
        if source_key in self.objects:
            self.objects[destination_key] = self.objects[source_key]
        self.sizes[destination_key] = self.sizes[source_key]


def build_environment(tmp_path, *, storage=None, files=None, bucket=None, legacy_s3=None):
    """A `BuildEnvironment` wired to fakes, with its state file in `tmp_path`."""
    bucket = bucket if bucket is not None else FakeBucket()
    if legacy_s3 is None:
        legacy_s3 = LegacyS3Config(enabled=True, bucket=bucket.bucket)
    return BuildEnvironment(
        storage=storage if storage is not None else FakeStorage(),
        files=files if files is not None else FakeFiles(),
        state=BuildState(tmp_path / "drive-build-state.json"),
        legacy_s3=legacy_s3,
        open_bucket=lambda: bucket,
    )
