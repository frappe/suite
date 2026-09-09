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

from copy import deepcopy
from dataclasses import replace

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.ports import (
    ACTIVE,
    PERSONAL,
    BlobConflict,
    BlobRow,
    ChainRow,
    ClaimedBlob,
    ContentRow,
    ContentShareRow,
    LegacyRow,
    MediaFileRow,
    RootUsageRow,
    SheetSnapshotRow,
    SlideRow,
    TreeRow,
    WriterTemplateRow,
    WriterVersionRow,
)
from suite.drive.patches.build.slide_journal import (
    JournalConflictError,
    SlideBody,
    UnknownBodyState,
)
from suite.drive.patches.build.state import BuildState
from suite.drive.utils.files import S3_URL_PREFIX, get_s3_url

# S3's own `CopyObject` source ceiling, an inclusive maximum
# (`s3transfer.utils.MAX_SINGLE_UPLOAD_SIZE`). Spelled out rather than
# imported from `layout`: a fake that took the production constant would
# move with a mutation of it, and this boundary is the one thing the fake
# exists to police. `test_layout` pins the two against each other.
S3_COPY_OBJECT_MAX_BYTES = 5_368_709_120

# The stamp a faked run writes on rows it authored. `creation` on a copied
# row comes from the source and must never be this.
BUILD_STAMP = "2026-01-01 00:00:00.000000"


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


class Counter:
    """Ids and tokens a test can predict: `<prefix>1`, `<prefix>2`, and on.

    A real run mints from `secrets`. Nothing Build decides depends on the
    value, so a counter is the same run with readable assertions, and a
    token that repeats across two nodes is a case a test can now write.
    """

    def __init__(self, prefix):
        self.prefix = prefix
        self.count = 0

    def __call__(self):
        self.count += 1
        return f"{self.prefix}{self.count}"


def build_environment(
    tmp_path,
    *,
    storage=None,
    files=None,
    bucket=None,
    legacy_s3=None,
    tree=None,
    drive=None,
    content=None,
    content_target=None,
    slide_journal=None,
    records=None,
    records_target=None,
    settings=None,
    settings_target=None,
    usage=None,
    content_ready=False,
    tree_ready=False,
    settings_ready=False,
    usage_ready=False,
    clock=None,
    make_id=None,
    make_token=None,
):
    """A `BuildEnvironment` wired to fakes, with its state file in `tmp_path`."""
    bucket = bucket if bucket is not None else FakeBucket()
    if legacy_s3 is None:
        legacy_s3 = LegacyS3Config(enabled=True, bucket=bucket.bucket)
    if drive is None:
        drive = FakeDrive()
    if tree is None:
        tree = FakeTree(drive=drive)
    elif tree.drive is None:
        tree.drive = drive
    if content is None:
        content = FakeContent()
    if content_target is None:
        content_target = FakeContentTarget(drive=drive, content=content)
    else:
        content_target.content = content
    if slide_journal is None:
        slide_journal = FakeSlideJournal()
    if records is None:
        records = FakeRecords()
    if records_target is None:
        records_target = FakeRecordsTarget(records=records, drive=drive)
    else:
        records_target.records = records
        records_target.drive = drive
    if settings is None:
        settings = FakeSettings()
    if settings_target is None:
        settings_target = FakeSettingsTarget(settings=settings, drive=drive)
    else:
        settings_target.settings = settings
        settings_target.drive = drive
    if usage is None:
        usage = FakeUsage(drive=drive)
    environment = BuildEnvironment(
        storage=storage if storage is not None else FakeStorage(),
        files=files if files is not None else FakeFiles(),
        state=BuildState(tmp_path / "drive-build-state.json"),
        legacy_s3=legacy_s3,
        open_bucket=lambda: bucket,
        tree=tree,
        drive=drive,
        content=content,
        content_target=content_target,
        slide_journal=slide_journal,
        records=records,
        records_target=records_target,
        settings=settings,
        settings_target=settings_target,
        usage=usage,
        clock=clock if clock is not None else (lambda: BUILD_STAMP),
        make_id=make_id if make_id is not None else Counter("id"),
        make_token=make_token if make_token is not None else Counter("tok"),
    )
    if content_ready or tree_ready or usage_ready:
        tree_state = environment.state.tree()
        tree_state.completed = True
        environment.state.put_tree(tree_state)
    if content_ready or usage_ready:
        grant_state = environment.state.grants()
        grant_state.completed = True
        environment.state.put_grants(grant_state)
    if usage_ready:
        content_state = environment.state.content()
        content_state.completed = True
        environment.state.put_content(content_state)
    if settings_ready or usage_ready:
        settings_state = environment.state.settings()
        settings_state.completed = True
        environment.state.put_settings(settings_state)
    return environment


class FakeTree:
    """`LegacyTree` over dictionaries of `File`, `Drive Permission`, `DocShare`.

    Reads only, like the protocol. `unreached` needs to know which rows
    already have a node, so it asks the `FakeDrive` it is paired with, the
    way `SiteTree.unreached` asks the database with a LEFT JOIN.

    The paging methods honour `after` and `limit` exactly. A fake that
    ignored them would hide the one bug the stall guards exist for.
    """

    def __init__(self, rows=(), *, drive=None, permissions=(), docshares=(), users=None, groups=()):
        self.rows = {row.name: row for row in rows}
        self.drive = drive
        self.permissions_rows = list(permissions)
        self.docshare_rows = list(docshares)
        # None for an address means no `User` row at all, which is the
        # answer that drops a grant. False is a disabled account, which
        # keeps it.
        self.users = dict(users or {})
        self.groups = set(groups)
        self.composite_decks = set()
        self.sheets = {}

    def add(self, name, **columns):
        self.rows[name] = TreeRow(name=name, **columns)
        return self

    def row(self, name):
        return self.rows.get(name)

    def children(self, parents, after, limit):
        folder, name = after
        found = [
            row
            for row in sorted(self.rows.values(), key=lambda row: (row.folder or "", row.name))
            if row.folder in parents and (row.folder or "", row.name) > (folder, name)
        ]
        return found[:limit]

    def unreached(self, after, limit):
        migrated = self.drive.node_ids() if self.drive else set()
        found = [
            ChainRow(row.name, row.folder, row.status)
            for row in sorted(self.rows.values(), key=lambda row: row.name)
            if row.name > after and row.name not in migrated
        ]
        return found[:limit]

    def chain(self, names):
        return {
            name: ChainRow(self.rows[name].name, self.rows[name].folder, self.rows[name].status)
            for name in names
            if name in self.rows
        }

    def permissions(self, after, limit):
        found = [
            row
            for row in sorted(self.permissions_rows, key=lambda row: (row.entity, row.user, row.name))
            if (row.entity, row.user, row.name) > after
        ]
        return found[:limit]

    def docshares(self, after, limit):
        found = [row for row in sorted(self.docshare_rows, key=lambda row: row.name) if row.name > after]
        return found[:limit]

    def user_enabled(self, email):
        return self.users.get(email)

    def group_exists(self, name):
        return name in self.groups

    def is_composite_deck(self, entity):
        return entity in self.composite_decks

    def sheet_entity(self, sheet):
        return self.sheets.get(sheet)


class FakeDrive:
    """`DriveTarget` over dictionaries, committed into a snapshot.

    Three real constraints are modelled, because each one changes what the
    code under test has to do:

    - `(node, principal)` is unique on `Drive Grant`, so a second insert
      for one pair raises instead of quietly making two rows;
    - `Drive Root` is `autoname: field:node` with `unique: 1` on `node`
      (§3.2), so a second metadata row for one name, or a second row
      claiming one node, raises the way the two indexes would;
    - `write_root_pair` is one unit. `fail_pair` makes it raise part way
      through, and the rows it had already written are rolled back.

    `rollback()` is what a killed run leaves behind: everything since the
    last `commit` is gone.
    """

    def __init__(self):
        self.node_rows = {}
        self.root_rows = {}
        self.grant_rows = {}
        self.committed = ({}, {}, {})
        self.commits = 0
        self.fail_pair = None
        self.locked_root_identities = []
        self.root_identity_events = []

    # -- reads

    def node_ids(self):
        return set(self.node_rows)

    def nodes(self, names):
        return {name: dict(self.node_rows[name]) for name in names if name in self.node_rows}

    def root_metadata(self, node):
        if node in self.root_rows:
            return dict(self.root_rows[node])
        for row in self.root_rows.values():
            if row["node"] == node:
                return dict(row)
        return None

    def lock_root_identity(self, kind, user):
        self.locked_root_identities.append((kind, user))
        self.root_identity_events.append(("lock", kind, user))

    def active_roots(self, kind, user):
        """§3.2's Active roots for one identity, read off the rows.

        A row with no `state` key counts as Active, the way the column's
        own default does. `user` narrows a Personal root only.
        """
        self.root_identity_events.append(("read", kind, user))
        found = []
        for row in self.root_rows.values():
            if row["kind"] != kind or (row.get("state") or ACTIVE) != ACTIVE:
                continue
            if kind == PERSONAL and (row.get("user") or None) != (user or None):
                continue
            found.append(row["node"])
        return tuple(sorted(found))

    def grant_roles(self, node, principals):
        return {
            row["principal"]: row["role"]
            for row in self.grant_rows.values()
            if row["node"] == node and row["principal"] in principals
        }

    def has_link_grant(self, node):
        return any(
            row["node"] == node and row["principal"].startswith("$LINK:") and row["role"] > 0
            for row in self.grant_rows.values()
        )

    # -- writes

    def write_root_pair(self, node, metadata, grants):
        """One unit. `fail_pair` kills the run between the two halves."""
        before = (dict(self.node_rows), dict(self.root_rows), dict(self.grant_rows))
        try:
            if node:
                self.insert_nodes([node])
            wrote = (node or {}).get("name") or (metadata or {}).get("node")
            if self.fail_pair is not None and self.fail_pair == wrote:
                raise InterruptedRun("killed between the node and its metadata")
            if metadata:
                self._insert_root(metadata)
            self.insert_grants(grants)
        except Exception:
            self._restore(before)
            raise

    def _insert_root(self, row):
        """The primary key and the unique `node` index, both of them."""
        if row["name"] in self.root_rows:
            raise ValueError(f"duplicate Drive Root {row['name']!r}")
        if any(other["node"] == row["node"] for other in self.root_rows.values()):
            raise ValueError(f"duplicate Drive Root node {row['node']!r}")
        self.root_rows[row["name"]] = dict(row)

    def insert_nodes(self, rows):
        for row in rows:
            if row["name"] in self.node_rows:
                raise ValueError(f"duplicate Drive Node {row['name']!r}")
            self.node_rows[row["name"]] = dict(row)

    def insert_grants(self, rows):
        for row in rows:
            key = (row["node"], row["principal"])
            if any((r["node"], r["principal"]) == key for r in self.grant_rows.values()):
                raise ValueError(f"duplicate Drive Grant for {key!r}")
            self.grant_rows[row["name"]] = dict(row)

    def raise_grant(self, node, principal, role):
        for row in self.grant_rows.values():
            if (row["node"], row["principal"]) == (node, principal):
                row["role"] = role
                return
        raise ValueError(f"no Drive Grant for {(node, principal)!r}")

    def commit(self):
        self.commits += 1
        self.committed = (dict(self.node_rows), dict(self.root_rows), dict(self.grant_rows))

    def rollback(self):
        self._restore(self.committed)

    def _restore(self, snapshot):
        """Put the rows back in place, without rebinding the dictionaries.

        `FakeContentTarget` and every other double share these three
        dictionaries by reference, the way they share one database. Rebinding
        them would roll back what one reader sees and leave the rest looking
        at the rows that were meant to be gone.
        """
        for destination, source in zip(
            (self.node_rows, self.root_rows, self.grant_rows), snapshot, strict=True
        ):
            destination.clear()
            destination.update(deepcopy(source))

    # -- assertions

    def principals(self, node):
        return {row["principal"]: row["role"] for row in self.grant_rows.values() if row["node"] == node}


class FakeContent:
    """`LegacyContent` over immutable source rows.

    Target link and Slide writes update only fields that production updates.
    Every other source field remains available for preservation assertions.
    """

    def __init__(
        self,
        *,
        documents=(),
        files=(),
        writer_versions=(),
        sheet_snapshots=(),
        writer_templates=(),
        slides=(),
        media=(),
        shares=(),
        users=None,
        timezone="UTC",
        host="site.example",
    ):
        self.document_rows = {(row.doctype, row.name): row for row in documents}
        self.file_rows = list(files)
        self.writer_version_rows = list(writer_versions)
        self.sheet_snapshot_rows = list(sheet_snapshots)
        self.writer_template_rows = list(writer_templates)
        self.slide_rows = {row.name: row for row in slides}
        self.media_rows = list(media)
        self.share_rows = list(shares)
        self.users = dict(users or {})
        self.timezone = timezone
        self.host = host
        self.op_stamps = {}
        self.residual_versions = []

    def documents(self, doctype, after, limit):
        rows = [
            row
            for (kind, name), row in sorted(self.document_rows.items())
            if kind == doctype and name > after
        ]
        return rows[:limit]

    def files_for_content(self, doctype, docname):
        return [
            row for row in self.file_rows if (row.content_doctype, row.content_docname) == (doctype, docname)
        ]

    def writer_versions(self, document, after, limit):
        rows = sorted(
            (row for row in self.writer_version_rows if row.doc == document),
            key=lambda row: (str(row.creation or ""), row.name),
        )
        return [row for row in rows if (str(row.creation or ""), row.name) > after][:limit]

    def sheet_snapshots(self, sheet, after, limit):
        # MariaDB sorts a NULL `seq` below every real one, so the fake does the
        # same and lets `history.py` refuse the row instead of raising here.
        rows = sorted(
            (row for row in self.sheet_snapshot_rows if row.sheet == sheet),
            key=lambda row: (int(row.seq or 0), row.name),
        )
        return [row for row in rows if (int(row.seq or 0), row.name) > after][:limit]

    def residual_writer_versions(self, limit):
        return sorted(self.residual_versions)[:limit]

    def sheet_op_stamp(self, sheet, seq):
        return self.op_stamps.get((sheet, seq))

    def writer_templates(self, after, limit):
        return [
            row for row in sorted(self.writer_template_rows, key=lambda row: row.name) if row.name > after
        ][:limit]

    def slides(self, deck, after, limit):
        rows = sorted(
            (row for row in self.slide_rows.values() if row.parent == deck),
            key=lambda row: (row.idx, row.name),
        )
        return [row for row in rows if (row.idx, row.name) > after][:limit]

    def media_files(self, deck, after, limit):
        rows = sorted(
            (row for row in self.media_rows if row.deck == deck),
            key=lambda row: (str(row.creation or ""), row.name),
        )
        return [row for row in rows if (str(row.creation or ""), row.name) > after][:limit]

    def media_files_by_urls(self, urls):
        wanted = set(urls)
        return [row for row in self.media_rows if row.file_url in wanted]

    def presentation_is_template(self, deck):
        row = self.document_rows.get(("Presentation", deck))
        return bool(row and row.is_template)

    def writer_document_is_template(self, name):
        return any(row.name == name for row in self.writer_template_rows)

    def content_shares(self, after, limit):
        return [row for row in sorted(self.share_rows, key=lambda row: row.name) if row.name > after][:limit]

    def user_enabled(self, user):
        return self.users.get(user)

    def site_timezone(self):
        return self.timezone

    def site_host(self):
        return self.host

    def link_document(self, doctype, docname, node):
        key = (doctype, docname)
        row = self.document_rows[key]
        self.document_rows[key] = replace(row, node=node)

    def add_content_document(self, row):
        """Register a content document another phase created on the site."""
        self.document_rows[(row.doctype, row.name)] = row

    def update_slides(self, rows):
        for row in rows:
            source = self.slide_rows[row["name"]]
            self.slide_rows[row["name"]] = replace(
                source,
                elements=row["elements"],
                background=row["background"],
            )


class FakeContentTarget:
    """`ContentTarget` over dictionaries shared with `FakeDrive`."""

    def __init__(self, *, drive=None, content=None):
        self.drive = drive if drive is not None else FakeDrive()
        self.content = content
        self.node_rows = self.drive.node_rows
        self.root_rows = self.drive.root_rows
        self.grant_rows = self.drive.grant_rows
        self.version_rows = {}
        self.thread_rows = {}
        self.comment_rows = {}
        self.writer_rows = {}
        self.preview_rows = {}
        self.blob_rows = {}
        self.blob_bytes = {}
        self.commits = 0
        self.thin_count = 0
        self.fail_unit = None
        self.locked_content_roots = []

    def nodes(self, names):
        return {name: dict(self.node_rows[name]) for name in names if name in self.node_rows}

    def content_nodes(self, doctype, docname):
        return [
            dict(row)
            for row in self.node_rows.values()
            if (row.get("content_doctype"), row.get("content_docname")) == (doctype, docname)
        ]

    def child_nodes(self, parent):
        return [dict(row) for row in self.node_rows.values() if row.get("parent") == parent]

    def root_metadata(self, node):
        return self.drive.root_metadata(node)

    def lock_root_identity(self, user):
        self.locked_content_roots.append(user)

    def active_roots(self, user):
        return tuple(
            sorted(
                row["node"]
                for row in self.root_rows.values()
                if row.get("kind") == PERSONAL
                and row.get("user") == user
                and (row.get("state") or ACTIVE) == ACTIVE
            )
        )

    def personal_roots(self, user):
        return tuple(
            sorted(
                row["node"]
                for row in self.root_rows.values()
                if row.get("kind") == PERSONAL and row.get("user") == user
            )
        )

    def version_seqs(self, node):
        return {int(row["seq"]): row["name"] for row in self.version_rows.values() if row["node"] == node}

    def version_names(self, names):
        return {name: dict(self.version_rows[name]) for name in names if name in self.version_rows}

    def thread_names(self, names):
        return {name: dict(self.thread_rows[name]) for name in names if name in self.thread_rows}

    def comment_names(self, names):
        return {name: dict(self.comment_rows[name]) for name in names if name in self.comment_rows}

    def legacy_comments(self, after, limit):
        rows = [
            dict(row)
            for name, row in sorted(self.comment_rows.items())
            if not row.get("thread") and name > after
        ]
        return rows[:limit]

    def writer_document(self, name):
        row = self.writer_rows.get(name)
        return dict(row) if row else None

    def preview(self, node):
        row = self.preview_rows.get(node)
        return dict(row) if row else None

    def blob(self, name):
        return self.blob_rows.get(name)

    def read_blob(self, name):
        return self.blob_bytes[name]

    def add_blob(
        self,
        name,
        data,
        *,
        mime_type="application/octet-stream",
        driver="local",
        is_private=1,
        status="Ready",
    ):
        self.blob_rows[name] = BlobRow(
            name=name,
            file_size=len(data),
            mime_type=mime_type,
            driver=driver,
            is_private=is_private,
            status=status,
            key=f"private/{name}",
        )
        self.blob_bytes[name] = data
        return self.blob_rows[name]

    def put_private_blob(self, data, filename):
        for name, body in self.blob_bytes.items():
            row = self.blob_rows[name]
            if body == data and row.is_private and row.status == "Ready":
                return row
        name = f"content-blob-{len(self.blob_rows) + 1}"
        suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        mime = {"html": "text/html", "json": "application/json", "webp": "image/webp"}.get(
            suffix, "application/octet-stream"
        )
        return self.add_blob(name, data, mime_type=mime)

    def write_root_pair(self, node, metadata, grants):
        self._unit(
            (node or metadata or {}).get("name"),
            lambda: self.drive.write_root_pair(node, metadata, grants),
        )

    def insert_nodes(self, rows):
        self.drive.insert_nodes(rows)

    def insert_grants(self, rows):
        self.drive.insert_grants(rows)

    def grant_roles(self, node, principals):
        return self.drive.grant_roles(node, principals)

    def grant_pairs(self, pairs):
        found = {}
        for node, principal in pairs:
            role = self.drive.grant_roles(node, (principal,)).get(principal)
            if role is not None:
                found[(node, principal)] = role
        return found

    def set_grant_role(self, node, principal, role):
        self.drive.raise_grant(node, principal, role)

    def insert_versions(self, rows):
        # `Drive Node Version` carries a real unique index on `(node, seq)`
        # (`drive_node_version.py:22`), so a fake that only checks the primary
        # key would let a duplicate sequence through here and fail with an
        # IntegrityError on a site.
        self._insert_unique(self.version_rows, rows, "Drive Node Version", unique=("node", "seq"))

    def insert_threads(self, rows):
        self._insert_unique(self.thread_rows, rows, "Drive Comment Thread")

    def insert_comments(self, rows):
        self._insert_unique(self.comment_rows, rows, "Drive Comment")

    def replace_comments(self, rows):
        for row in rows:
            if row["name"] not in self.comment_rows:
                raise ValueError(f"no Drive Comment {row['name']!r} to replace")
            # `update`, not a fresh dict: the legacy child columns stay on
            # the row exactly as the site's `UPDATE` leaves them.
            self.comment_rows[row["name"]].update(deepcopy(row))

    def write_thread(self, thread, comments):
        def write():
            self.insert_threads([thread])
            if self.fail_unit == thread["name"]:
                raise InterruptedRun("killed between thread and comments")
            self.insert_comments(comments)

        self._unit(thread["name"], write)

    def insert_previews(self, rows):
        for row in rows:
            if row["node"] in self.preview_rows:
                raise ValueError(f"duplicate Drive Node Preview for {row['node']!r}")
            self.preview_rows[row["node"]] = dict(row)

    def write_content_link(self, doctype, docname, node):
        self.content.link_document(doctype, docname, node)

    def write_orphan(self, node, doctype, docname):
        def write():
            self.insert_nodes([node])
            if self.fail_unit == node["name"]:
                raise InterruptedRun("killed between orphan node and content link")
            self.write_content_link(doctype, docname, node["name"])

        self._unit(node["name"], write)

    def _mirror_writer_document(self, name):
        """Publish a template's `Writer Document` on the source side too."""
        if self.content is None:
            return
        row = self.writer_rows[name]
        self.content.add_content_document(
            ContentRow(
                doctype="Writer Document",
                name=name,
                node=row.get("node"),
                owner=row.get("owner"),
                creation=row.get("creation"),
                modified=row.get("modified"),
                modified_by=row.get("modified_by"),
            )
        )

    def write_writer_template(self, document, node, grants, *, link=""):
        if document is None and node is None and not grants and not link:
            return
        name = (document or node)["name"] if (document or node) else link

        def write():
            if document:
                if name in self.writer_rows:
                    raise ValueError(f"duplicate Writer Document {name!r}")
                self.writer_rows[name] = dict(document)
                # A site has one `tabWriter Document`. The row step 8 mints is
                # read back by step 10 like any other, so the fake source has
                # to see it too or the phase order goes untested.
                self._mirror_writer_document(name)
            if self.fail_unit == name:
                raise InterruptedRun("killed while writing Writer template")
            if node:
                self.insert_nodes([node])
            self.insert_grants(grants)
            if link:
                self.writer_rows[link]["node"] = link
                self._mirror_writer_document(link)

        self._unit(name, write)

    def write_presentation_template(self, deck, node, grants):
        def write():
            if node:
                self.insert_nodes([node])
            if self.fail_unit == deck:
                raise InterruptedRun("killed while writing Presentation template")
            self.content.link_document("Presentation", deck, deck)
            self.insert_grants(grants)

        self._unit(deck, write)

    def update_media_node(self, name, blob, size, mime):
        self.node_rows[name].update({"blob": blob, "size": size, "mime": mime})

    def adopt_media_node(self, name, values):
        self.node_rows[name].update(values)

    def update_slides(self, rows):
        self.content.update_slides(rows)

    def versions_to_thin(self, report_at):
        return self.thin_count

    def commit(self):
        self.commits += 1
        self.drive.commit()

    def _insert_unique(self, destination, rows, label, *, unique=()):
        for row in rows:
            if row["name"] in destination:
                raise ValueError(f"duplicate {label} {row['name']!r}")
            if unique:
                key = tuple(row.get(field) for field in unique)
                taken = [
                    stored
                    for stored in destination.values()
                    if tuple(stored.get(field) for field in unique) == key
                ]
                if taken:
                    raise ValueError(f"duplicate {label} {'/'.join(unique)} {key!r}")
            destination[row["name"]] = dict(row)

    def _unit(self, name, write):
        before = (
            deepcopy(self.node_rows),
            deepcopy(self.root_rows),
            deepcopy(self.grant_rows),
            deepcopy(self.version_rows),
            deepcopy(self.thread_rows),
            deepcopy(self.comment_rows),
            deepcopy(self.writer_rows),
            deepcopy(self.preview_rows),
            deepcopy(self.content.document_rows) if self.content else {},
        )
        try:
            write()
        except Exception:
            (
                nodes,
                roots,
                grants,
                versions,
                threads,
                comments,
                writers,
                previews,
                documents,
            ) = before
            self.node_rows.clear()
            self.node_rows.update(nodes)
            self.root_rows.clear()
            self.root_rows.update(roots)
            self.grant_rows.clear()
            self.grant_rows.update(grants)
            self.version_rows = versions
            self.thread_rows = threads
            self.comment_rows = comments
            self.writer_rows = writers
            self.preview_rows = previews
            if self.content:
                self.content.document_rows = documents
            raise


class FakeSlideJournal:
    """A write-ahead Slide journal with exact in-memory body boundaries.

    It raises the real journal's exception family. `ValueError` would be caught
    by the slides phase and hide the fact that a site journal conflict is not.
    """

    def __init__(self):
        self.records = []

    def append(self, *, presentation, slide, before, after, changed_elements, created_at):
        same = [row for row in self.records if row[0] == presentation and row[1] == slide]
        if same and same[-1][3] != before:
            raise JournalConflictError(f"Slide {slide} journal chain is discontinuous")
        record = (presentation, slide, before, after, changed_elements, created_at)
        if record not in self.records:
            self.records.append(record)
        return record

    def recover_changed_elements(self, presentation, current_bodies):
        total = 0
        slides = {row[1] for row in self.records if row[0] == presentation}
        for slide in slides:
            chain = [row for row in self.records if row[0] == presentation and row[1] == slide]
            boundaries = [chain[0][2], *(row[3] for row in chain)]
            current = current_bodies.get(slide)
            matches = [index for index, body in enumerate(boundaries) if body == current]
            if len(matches) != 1:
                raise UnknownBodyState(f"Slide {slide} does not match one journal boundary")
            total += sum(row[4] for row in chain[: matches[0]])
        return total


def _page_by_name(rows, after, limit):
    """One keyset page, the way every `LegacyRecords` reader pages."""
    ordered = sorted(rows, key=lambda row: row.name)
    return [row for row in ordered if row.name > after][:limit]


class FakeRecords:
    """`LegacyRecords` over lists of frozen rows. Reads only."""

    def __init__(
        self,
        *,
        favourites=(),
        recents=(),
        activity=(),
        notifications=(0, 0),
        routes=(),
        locks=(),
        properties=(),
    ):
        self.favourite_rows = list(favourites)
        self.recent_rows = list(recents)
        self.activity_rows = list(activity)
        self.notification_counts = tuple(notifications)
        self.route_rows = list(routes)
        self.lock_rows = list(locks)
        self.property_rows = list(properties)

    def favourites(self, after, limit):
        return _page_by_name(self.favourite_rows, after, limit)

    def recents(self, after, limit):
        return _page_by_name(self.recent_rows, after, limit)

    def activity_log(self, after, limit):
        return _page_by_name(self.activity_rows, after, limit)

    def notifications(self):
        return self.notification_counts

    def legacy_routes(self, after, limit):
        return _page_by_name(self.route_rows, after, limit)

    def dav_locks(self, after, limit):
        return _page_by_name(self.lock_rows, after, limit)

    def dav_properties(self, after, limit):
        return _page_by_name(self.property_rows, after, limit)


class FakeRecordsTarget:
    """`RecordsTarget` over the same rows `FakeRecords` reads.

    On a site the source and the target of the favourite retarget are one
    table, so the fake shares the list rather than keeping a second copy: a
    rerun has to see the `node` the first run filled in.

    `Drive Activity.name` is the primary key and a second insert for one id
    raises, which is what makes the resume path a real test. `fail_insert`
    kills the run inside a batch the way a lost connection would, and
    `rollback()` returns the target to its last commit.
    """

    def __init__(self, *, records=None, drive=None, activity=()):
        self.records = records if records is not None else FakeRecords()
        self.drive = drive if drive is not None else FakeDrive()
        self.activity_rows = {row["name"]: dict(row) for row in activity}
        self.commits = 0
        self.fail_insert = None
        self.committed = self._snapshot()

    def _snapshot(self):
        return (list(self.records.favourite_rows), deepcopy(self.activity_rows))

    def nodes_present(self, names):
        return {name for name in names if name in self.drive.node_rows}

    def favourite_nodes(self, pairs):
        held = {(row.user, row.node) for row in self.records.favourite_rows if row.node}
        return {pair for pair in pairs if pair in held}

    def set_favourite_node(self, name, node):
        rows = self.records.favourite_rows
        for index, row in enumerate(rows):
            if row.name == name:
                rows[index] = replace(row, node=node)
                return
        raise ValueError(f"no Drive Favourite {name!r}")

    def activity_present(self, names):
        return {name for name in names if name in self.activity_rows}

    def insert_activity(self, rows):
        for row in rows:
            if self.fail_insert is not None and row["name"] == self.fail_insert:
                raise InterruptedRun(f"killed while inserting activity {row['name']!r}")
            if row["name"] in self.activity_rows:
                raise ValueError(f"duplicate Drive Activity {row['name']!r}")
            self.activity_rows[row["name"]] = dict(row)

    def commit(self):
        self.commits += 1
        self.committed = self._snapshot()

    def rollback(self):
        favourites, activity = self.committed
        self.records.favourite_rows = list(favourites)
        self.activity_rows = deepcopy(activity)


class FakeSettings:
    """`LegacySettings` over the three legacy sources. Reads only."""

    def __init__(self, *, quota_mb=0, user_quotas=(), reservations=()):
        self.quota_mb = quota_mb
        self.user_quota_rows = list(user_quotas)
        self.reservation_rows = list(reservations)

    def disk_quota_mb(self):
        return self.quota_mb

    def user_quotas(self, after, limit):
        return _page_by_name(self.user_quota_rows, after, limit)

    def reservations(self, after, limit):
        return _page_by_name(self.reservation_rows, after, limit)


class FakeSettingsTarget:
    """`SettingsTarget` over `Drive Settings`, `Drive Root`, and reservations.

    `bind_reservation` clears `storage_owner` because the doctype allows one
    of the two and not both. The legacy column on every other row stays
    exactly where Build found it: Cleanup drops it, not this step.

    `commit` also commits `drive`, because both are `frappe.db.commit()` on
    a site and the reservation step creates root pairs through the content
    target.
    """

    def __init__(self, *, settings=None, drive=None):
        self.settings = settings if settings is not None else FakeSettings()
        self.drive = drive if drive is not None else FakeDrive()
        self.default_personal_quota = 0
        self.shared_quota = 0
        self.root_quotas = {}
        self.commits = 0
        self.fail_bind = None
        self.committed = self._snapshot()

    def _snapshot(self):
        return (
            self.default_personal_quota,
            self.shared_quota,
            dict(self.root_quotas),
            list(self.settings.reservation_rows),
        )

    def site_quotas(self):
        return (self.default_personal_quota, self.shared_quota)

    def set_site_quotas(self, default_personal, shared):
        self.default_personal_quota = default_personal
        self.shared_quota = shared

    def root_quota(self, root):
        if root not in self.drive.root_rows:
            return None
        return self.root_quotas.get(root, 0)

    def set_root_quota(self, root, quota_bytes):
        if root not in self.drive.root_rows:
            raise ValueError(f"no Drive Root {root!r}")
        self.root_quotas[root] = quota_bytes

    def bind_reservation(self, name, root):
        if self.fail_bind is not None and self.fail_bind == name:
            raise InterruptedRun(f"killed while binding reservation {name!r}")
        rows = self.settings.reservation_rows
        for index, row in enumerate(rows):
            if row.name == name:
                rows[index] = replace(row, root=root, storage_owner=None)
                return
        raise ValueError(f"no Drive Storage Reservation {name!r}")

    def commit(self):
        self.commits += 1
        self.drive.commit()
        self.committed = self._snapshot()

    def rollback(self):
        (
            self.default_personal_quota,
            self.shared_quota,
            quotas,
            reservations,
        ) = self.committed
        self.root_quotas = dict(quotas)
        self.settings.reservation_rows = list(reservations)
        self.drive.rollback()


class FakeUsage:
    """`UsageLedger` with two independent answers a test can disagree.

    `totals` answers per root and `grouped_totals` answers for the site.
    They read the same dictionary unless a test supplies `grouped`, which is
    how the reconciliation is exercised: on a healthy site the two agree,
    and the test needs the case where they do not.

    Given a `drive`, the roots are the `Drive Root` rows Build actually
    wrote, and `used_bytes` is written back onto them. That is what makes a
    whole-patch run end with the counters the earlier steps' rows explain,
    rather than with a list a test wrote by hand.
    """

    def __init__(self, *, roots=(), totals=None, grouped=None, drive=None):
        self.drive = drive
        self.root_rows = list(roots)
        self.total_rows = deepcopy(dict(totals or {}))
        self.grouped_rows = deepcopy(dict(grouped)) if grouped is not None else None
        self.commits = 0
        self.writes = []
        self.totals_calls = []
        self.grouped_calls = 0
        self.fail_write = None

    def roots(self, after, limit):
        return _page_by_name(self._rows(), after, limit)

    def _rows(self):
        if self.drive is None:
            return self.root_rows
        return [
            RootUsageRow(
                name=row["name"],
                kind=row.get("kind"),
                state=row.get("state"),
                used_bytes=int(row.get("used_bytes") or 0),
            )
            for row in self.drive.root_rows.values()
        ]

    def totals(self, root):
        self.totals_calls.append(root)
        return dict(self.total_rows.get(root) or {})

    def grouped_totals(self):
        self.grouped_calls += 1
        source = self.grouped_rows if self.grouped_rows is not None else self.total_rows
        return deepcopy(source)

    def set_used_bytes(self, root, value):
        if self.fail_write is not None and self.fail_write == root:
            raise InterruptedRun(f"killed while writing used_bytes for {root!r}")
        if self.drive is not None:
            if root not in self.drive.root_rows:
                raise ValueError(f"no Drive Root {root!r}")
            self.drive.root_rows[root]["used_bytes"] = value
            self.writes.append((root, value))
            return
        for index, row in enumerate(self.root_rows):
            if row.name == root:
                self.root_rows[index] = replace(row, used_bytes=value)
                self.writes.append((root, value))
                return
        raise ValueError(f"no Drive Root {root!r}")

    def commit(self):
        self.commits += 1
