"""In-memory doubles for Build's three ports.

They are the fixtures the §14.2 step 1 to 3 tests run against: no site, no
bucket, no database, so every rule is exercised directly and an interrupted
run is reproduced by raising where a real one would be killed.
"""

import io

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import LegacyRow
from suite.drive.patches.build.state import BuildState
from suite.drive.utils.files import S3_URL_PREFIX, get_s3_url


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

    def claim_blob(self, checksum):
        for name, blob in self.blobs.items():
            if blob["checksum"] == checksum:
                return name
        return None

    def insert_blob(self, *, key, checksum, size, mime_type):
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
        self.rows = {row["name"]: dict(row) for row in rows}
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

    def add(self, name, file_url, file_name=None, blob=None):
        self.rows[name] = {"name": name, "file_url": file_url, "file_name": file_name, "blob": blob}
        self.committed[name] = dict(self.rows[name])
        return self

    def s3_rows_without_blob(self, after, limit):
        return self._page(after, limit, lambda row: row["file_url"].startswith(S3_URL_PREFIX))

    def rows_without_blob(self, after, limit):
        return self._page(after, limit, lambda row: True)

    def _page(self, after, limit, matches):
        found = [
            LegacyRow(row["name"], row["file_url"], row["file_name"])
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


class FakeBucket:
    """`S3Bucket` over a dict of objects, recording every call."""

    def __init__(self, bucket="drive-bucket", objects=None):
        self.bucket = bucket
        self.objects = dict(objects or {})
        self.sizes = {key: len(body) for key, body in self.objects.items()}
        self.opened = []
        self.copies = []
        self.fail_copy_at = None

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
        return io.BytesIO(self.objects[key])

    def size(self, key):
        return self.sizes.get(key)

    def copy_object(self, source_key, destination_key):
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
