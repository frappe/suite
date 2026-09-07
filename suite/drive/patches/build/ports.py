"""The seams Build reaches the outside world through.

Every rule in `gate`, `legacy_bytes`, `s3_copy`, `root_pairs`, `tree`, and
`grants` runs against these protocols, so the whole patch is exercised with
no site, no bucket, and no database. `tests/fakes.py` holds the doubles; the
classes below are the only code in the package that touches `frappe.db`,
`frappe.conf`, or boto3.

Five seams: `StorageGateway`, `LegacyFiles`, and `S3Bucket` for §14.2 steps 1
to 3, then `LegacyTree` for everything Build reads out of the legacy tables
and `DriveTarget` for everything it writes into Drive's own.
"""

from dataclasses import dataclass
from typing import IO, Protocol

import frappe
from frappe.utils import cint

from suite.drive._core.roles import NONE


@dataclass(frozen=True)
class LegacyRow:
    """One legacy Drive `File` row that still has no blob."""

    name: str
    file_url: str
    file_name: str | None = None
    file_type: str | None = None


@dataclass(frozen=True)
class ClaimedBlob:
    """An existing blob Build may link to, and the key its object sits at."""

    name: str
    key: str


class BlobConflict(Exception):
    """Another `File Blob` already holds this content's unique triple.

    `File Blob` carries a unique index on `(checksum, is_private, driver)`
    (`frappe/core/doctype/file_blob/file_blob.py`). A row that `claim_blob`
    would not take — one still `Pending` — therefore blocks the insert.
    Build reports that row and carries on; it must not abort a migration
    and then fail the same way on every rerun. `SiteStorage.insert_blob`
    takes a savepoint so "carries on" holds on Postgres too."""


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

    def claim_blob(self, checksum: str) -> ClaimedBlob | None:
        """A ready private S3 blob for this content, held against GC.

        None when no such row exists, so the caller must copy the object.
        The key comes back with it: a row is not proof that its object
        survives, and only the caller can head it."""

    def blocked_by(self, checksum: str) -> str | None:
        """Status of the row that holds this content's unique triple, if any."""

    def insert_blob(self, *, key: str, checksum: str, size: int, mime_type: str) -> str:
        """Insert one private S3 `File Blob` and return its name.

        Raises `BlobConflict` when the unique triple is already taken."""


class LegacyFiles(Protocol):
    """The legacy `File` table, read by keyset page and written one column."""

    def s3_rows_without_blob(self, after: str, limit: int) -> list[LegacyRow]:
        """Blobless rows whose `file_url` is a Drive S3 fetch URL, `name` ascending."""

    def rows_outside(self, prefixes: tuple[str, ...], after: str, limit: int) -> list[LegacyRow]:
        """Blobless rows whose `file_url` starts with none of these, `name` ascending."""

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

    def claim_blob(self, checksum: str) -> ClaimedBlob | None:
        from frappe.storage.blob import revive_blob

        existing = frappe.db.get_value(
            "File Blob",
            # `status` matters: a Pending row is an upload still in flight, so
            # its object may not be there. Linking to one would leave the File
            # pointing at nothing once Cleanup deletes Drive's legacy prefix.
            {"checksum": checksum, "is_private": 1, "driver": "s3", "status": "Ready"},
            ["name", "key"],
            as_dict=True,
        )
        # revive_blob locks the row and pushes it out of the GC orphan window.
        # It answers False when a concurrent GC pass already deleted it, and
        # then the object has to be copied again.
        if existing and revive_blob(existing.name):
            return ClaimedBlob(existing.name, existing.key)
        return None

    def blocked_by(self, checksum: str) -> str | None:
        return frappe.db.get_value(
            "File Blob", {"checksum": checksum, "is_private": 1, "driver": "s3"}, "status"
        )

    def insert_blob(self, *, key: str, checksum: str, size: int, mime_type: str) -> str:
        blob = frappe.new_doc("File Blob")
        blob.update(
            {
                # Legacy Drive objects were only ever served through Drive's
                # own authenticated fetch API, so every one of them is private
                # whatever the legacy `File.is_private` says.
                "key": key,
                "checksum": checksum,
                "file_size": size,
                "mime_type": mime_type,
                "driver": "s3",
                "is_private": cint(True),
                "status": "Ready",
            }
        )
        # The insert runs inside a savepoint so the caller can really carry
        # on after a conflict. Postgres aborts the whole transaction on a
        # unique violation, so without the rollback the next statement in the
        # batch raises `InFailedSqlTransaction` and the migration dies anyway
        # — the outcome `BlobConflict` exists to avoid. MariaDB does not need
        # it. Two extra statements against a row that already paid for an S3
        # copy is not a cost worth branching on.
        savepoint = "drive_build_insert_blob"
        frappe.db.savepoint(savepoint)
        try:
            blob.insert(ignore_permissions=True)
        except frappe.UniqueValidationError as e:
            frappe.db.rollback(save_point=savepoint)
            raise BlobConflict(checksum) from e
        frappe.db.release_savepoint(savepoint)
        return blob.name


class SiteFiles:
    """`LegacyFiles` over the real `File` table.

    `filters` narrows both queries, the way `frappe.storage.backfill.run`
    takes one: a site-backed test uses it to stay off rows it did not
    create. Production passes none and reads the whole table.
    """

    def __init__(self, s3_url_prefix: str, filters: list | None = None):
        self.s3_url_prefix = s3_url_prefix
        self.filters = list(filters or [])

    def _page(self, filters: list, after: str, limit: int) -> list[LegacyRow]:
        rows = frappe.get_all(
            "File",
            filters=[
                ["blob", "is", "not set"],
                ["is_folder", "=", 0],
                ["name", ">", after],
                *filters,
                *self.filters,
            ],
            fields=["name", "file_url", "file_name", "file_type"],
            order_by="name asc",
            limit=limit,
        )
        return [LegacyRow(r.name, r.file_url or "", r.file_name, r.file_type) for r in rows]

    def s3_rows_without_blob(self, after: str, limit: int) -> list[LegacyRow]:
        # The prefix carries no LIKE wildcard of its own; `test_ports` fails
        # if that stops being true and the pattern over-matches.
        return self._page([["file_url", "like", self.s3_url_prefix + "%"]], after, limit)

    def rows_outside(self, prefixes: tuple[str, ...], after: str, limit: int) -> list[LegacyRow]:
        """Blobless rows neither step reached, so the report can name them.

        Everything Build knows how to read starts with one of `prefixes`.
        Anything else keeps no reachable bytes: a fetch URL on a site whose
        S3 settings are off, a bare bucket key left by a half-finished
        upload, a URL from a prefix rename that never ran. None of them can
        be copied here, and all of them must reach the record, or §14.9
        would report a clean run over rows whose bytes Cleanup then deletes.
        """
        return self._page([["file_url", "not like", prefix + "%"] for prefix in prefixes], after, limit)

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


# --- §14.2 steps 4 to 6: the legacy tree, and Drive's own tables -----------

# `File.status`, from the Drive custom field (`suite/fixtures/custom_field.json`).
ACTIVE = "Active"
TRASHED = "Trashed"
REMOVED = "Removed"

# The two pinned roots. They are `File` rows whose `name` is literally these
# strings and whose `folder` is NULL (`suite/drive/utils/__init__.py:200-232`).
DRIVE_ROOT_ROW = "Drive"
USERS_ROW = "Users"

# `Drive Root.kind` (§3.2). `root_pairs` names it too, but the Active-root
# read below needs it here, and a port may not import the module that calls
# it. `Drive Root.state` reuses ACTIVE above: both columns spell one word.
PERSONAL = "Personal"

# What Build reads off one legacy row. `frappe.get_all` returns `_dict`, so
# the frozen shape below is what pins the column list in one place.
TREE_COLUMNS = (
    "name",
    "file_name",
    "folder",
    "is_folder",
    "file_url",
    "file_size",
    "file_type",
    "mime_type",
    "status",
    "file_modified",
    "content_doctype",
    "content_docname",
    "blob",
    "owner",
    "creation",
    "modified",
    "modified_by",
)


@dataclass(frozen=True)
class TreeRow:
    """One legacy Drive `File` row, as §14.4's column map reads it."""

    name: str
    file_name: str | None = None
    folder: str | None = None
    is_folder: int = 0
    file_url: str | None = None
    file_size: int = 0
    file_type: str | None = None
    mime_type: str | None = None
    status: str = ACTIVE
    file_modified: str | None = None
    content_doctype: str | None = None
    content_docname: str | None = None
    blob: str | None = None
    owner: str | None = None
    creation: str | None = None
    modified: str | None = None
    modified_by: str | None = None

    @classmethod
    def of(cls, row) -> TreeRow:
        return cls(**{column: row.get(column) for column in TREE_COLUMNS if row.get(column) is not None})


@dataclass(frozen=True)
class ChainRow:
    """The two columns the upward reachability walk needs, and nothing else."""

    name: str
    folder: str | None
    status: str


@dataclass(frozen=True)
class PermissionRow:
    """One `Drive Permission` row, before duplicates are collapsed."""

    name: str
    entity: str
    user: str
    read: int = 0
    comment: int = 0
    share: int = 0
    write: int = 0
    upload: int = 0
    deny: int = 0
    creation: str | None = None

    def flags(self) -> dict:
        return {
            "read": self.read,
            "comment": self.comment,
            "share": self.share,
            "write": self.write,
            "upload": self.upload,
            "deny": self.deny,
            "name": self.name,
            "creation": self.creation,
        }


@dataclass(frozen=True)
class DocShareRow:
    """One Sheet `DocShare` row (§14.5)."""

    name: str
    share_name: str
    user: str | None = None
    read: int = 0
    write: int = 0
    everyone: int = 0
    creation: str | None = None


class LegacyTree(Protocol):
    """Everything Build reads out of the legacy tables. Reads only.

    Nothing on this protocol writes, so "Preserve migration source tables"
    is a property of the seam rather than a rule somebody has to remember:
    there is no method here that could delete a `File`, a
    `Drive Permission`, or a `DocShare` row.
    """

    def row(self, name: str) -> TreeRow | None:
        """One `File` row by id, or None when it is gone."""

    def children(self, parents: tuple[str, ...], after: tuple[str, str], limit: int) -> list[TreeRow]:
        """Rows whose `folder` is one of `parents`, ordered by `(folder, name)`.

        `after` is the last `(folder, name)` of the previous page, so a whole
        sibling group arrives together and in one order on every run."""

    def unreached(self, after: str, limit: int) -> list[ChainRow]:
        """`File` rows that have no `Drive Node`, `name` ascending."""

    def chain(self, names: tuple[str, ...]) -> dict[str, ChainRow]:
        """`folder` and `status` for these ids; ids that are gone are absent."""

    def permissions(self, after: tuple[str, str, str], limit: int) -> list[PermissionRow]:
        """`Drive Permission` rows ordered by `(entity, user, name)`."""

    def docshares(self, after: str, limit: int) -> list[DocShareRow]:
        """Sheet `DocShare` rows, `name` ascending."""

    def user_enabled(self, email: str) -> bool | None:
        """True, False, or None when no `User` row holds that address."""

    def group_exists(self, name: str) -> bool:
        """Whether a `User Group` by that name still exists."""

    def is_composite_deck(self, entity: str) -> bool:
        """Whether this `File` backs a composite `Presentation` (§14.5)."""

    def sheet_entity(self, sheet: str) -> str | None:
        """The `File` id backing one `Sheet`, which is also its node id."""


class DriveTarget(Protocol):
    """Everything Build writes into Drive's own tables.

    Rows go in through bulk SQL, not the ORM (§14.2): `set_new_name` throws
    a caller-supplied name away for any `autoname: hash` doctype
    (`frappe/model/naming.py:160-162`), and §14.3 needs `Drive Node.name` to
    be the `File` name it came from. Every controller `validate` is
    therefore bypassed, and the rules Build must reproduce by hand are
    written out in `tree` and `root_pairs`.
    """

    def nodes(self, names: tuple[str, ...]) -> dict[str, dict]:
        """Existing `Drive Node` rows by id, for the resume check."""

    def root_metadata(self, node: str) -> dict | None:
        """The `Drive Root` row named this id, or the one whose `node` is it."""

    def active_root(self, kind: str, user: str | None) -> str | None:
        """The node id of the Active root for this identity, or None.

        `user` is None or "" for the Shared root, which names no user
        (§3.2). Build needs this because it is not the only writer: a
        `User` insert already provisions a Personal root at a fresh node
        id (`suite/hooks.py` -> `suite.drive.install.after_user_insert`).
        Writing a second Active one at the legacy `File` id would leave
        both rows unsaveable, and `bulk_insert` bypasses the controller
        check that would have refused it."""

    def write_root_pair(self, node: dict | None, metadata: dict | None, grants: list[dict]) -> None:
        """Insert a node, its metadata, and its anchors as one unit.

        Either half may be None when a rerun is repairing a pair whose other
        half already exists. Nothing is published unless all of it lands."""

    def insert_nodes(self, rows: list[dict]) -> None:
        """Bulk-insert node rows that do not exist yet."""

    def insert_grants(self, rows: list[dict]) -> None:
        """Bulk-insert grant rows for pairs that do not exist yet."""

    def grant_roles(self, node: str, principals: tuple[str, ...]) -> dict[str, int]:
        """The roles already stored for these principals on this node."""

    def raise_grant(self, node: str, principal: str, role: int) -> None:
        """Move one existing grant to the merged role.

        Usually upward, to finish a row a killed run wrote low. A deny
        arriving from a second source moves it to NONE instead, because
        §14.5 makes a deny win over whatever else names the pair."""

    def has_link_grant(self, node: str) -> bool:
        """Whether any `$LINK:` grant already names this node.

        This is how link minting resumes. Before Build no link grant exists
        on the site, so one on the node means a previous run minted it and
        a second token must not be handed out for the same row."""

    def commit(self) -> None:
        """End the current batch."""


# The columns a bulk insert has to fill by hand. `docstatus` and `idx` carry
# database defaults; the other five do not, and `Document.insert` is what
# normally supplies them.
NODE_COLUMNS = (
    "name",
    "title",
    "parent",
    "root",
    "path",
    "kind",
    "blob",
    "size",
    "mime",
    "url",
    "content_doctype",
    "content_docname",
    "state",
    "trashed_at",
    "trash_root",
    "content_modified",
    "is_template",
    "owner",
    "creation",
    "modified",
    "modified_by",
    "docstatus",
    "idx",
)

ROOT_COLUMNS = (
    "name",
    "node",
    "user",
    "kind",
    "state",
    "quota_bytes",
    "used_bytes",
    "acl_generation",
    "owner",
    "creation",
    "modified",
    "modified_by",
    "docstatus",
    "idx",
)

GRANT_COLUMNS = (
    "name",
    "node",
    "principal",
    "role",
    "expires_on",
    "password_hash",
    "owner",
    "creation",
    "modified",
    "modified_by",
    "docstatus",
    "idx",
)

# What a bulk-inserted row reads back as. `owner`/`modified_by` are Drive's
# own bookkeeping, not access: §3.1 says `owner` "Grants no access".
NODE_READ_COLUMNS = (
    "name",
    "title",
    "parent",
    "root",
    "path",
    "kind",
    "blob",
    "size",
    "mime",
    "url",
    "content_doctype",
    "content_docname",
    "state",
    "trashed_at",
    "trash_root",
    "is_template",
    "owner",
)
ROOT_READ_COLUMNS = ("name", "node", "user", "kind", "state")


class SiteTree:
    """`LegacyTree` over the real `File`, `Drive Permission`, and `DocShare`.

    `name_prefix` narrows every `File` read to ids that start with it, and
    every `Drive Permission` read to rows whose `entity` starts with it, so
    a site-backed test can stay off rows it did not create. One value
    rather than a filter list, because half these reads are raw SQL and
    cannot take a `frappe.get_all` clause.

    `docshares` is the one read the prefix does not narrow: a `DocShare`
    names a `Sheet`, and a `Sheet` id carries no `File` id. Nothing is
    written from one until `sheet_entity` maps it back to a `File`, and
    that read is narrowed, so an unrelated row is read and then dropped.

    Production passes no prefix and reads the whole table, so none of the
    narrowing changes what a migration does.
    """

    def __init__(self, name_prefix: str | None = None):
        self.name_prefix = name_prefix or ""

    def row(self, name: str) -> TreeRow | None:
        rows = frappe.get_all(
            "File", filters=[["name", "=", name], *self._clauses()], fields=list(TREE_COLUMNS), limit=1
        )
        return TreeRow.of(rows[0]) if rows else None

    def children(self, parents: tuple[str, ...], after: tuple[str, str], limit: int) -> list[TreeRow]:
        if not parents:
            return []
        folder, name = after
        # One placeholder per parent, not a tuple bound to `IN %(parents)s`.
        # frappe's SQLite backend does not bind a named parameter at all: it
        # quotes each value and string-formats the query
        # (`frappe/database/sqlite/database.py:execute_query`), so a tuple
        # renders as `IN '('a', 'b')'` and the statement will not parse.
        # MariaDB and Postgres see the same `IN (?, ?)` either way.
        parent_values = {f"parent{index}": parent for index, parent in enumerate(parents)}
        placeholders = ", ".join(f"%({key})s" for key in parent_values)
        # Keyset over the compound order. `frappe.get_all` cannot express
        # "(folder, name) > (?, ?)", and OFFSET on a table this size is what
        # turns a migration into an afternoon.
        rows = frappe.db.sql(
            f"""SELECT {", ".join(f"`{c}`" for c in TREE_COLUMNS)} FROM `tabFile`
                WHERE `folder` IN ({placeholders})
                  AND (`folder` > %(folder)s OR (`folder` = %(folder)s AND `name` > %(name)s))
                {self._extra_sql()}
                ORDER BY `folder`, `name` LIMIT %(limit)s""",
            {
                "folder": folder,
                "name": name,
                "limit": limit,
                **parent_values,
                **self._extra_values(),
            },
            as_dict=True,
        )
        return [TreeRow.of(row) for row in rows]

    def unreached(self, after: str, limit: int) -> list[ChainRow]:
        rows = frappe.db.sql(
            f"""SELECT f.`name`, f.`folder`, f.`status` FROM `tabFile` f
                LEFT JOIN `tabDrive Node` n ON n.`name` = f.`name`
                WHERE n.`name` IS NULL AND f.`name` > %(after)s
                {self._extra_sql("f")}
                ORDER BY f.`name` LIMIT %(limit)s""",
            {"after": after, "limit": limit, **self._extra_values()},
            as_dict=True,
        )
        return [ChainRow(row.name, row.folder, row.status or ACTIVE) for row in rows]

    def chain(self, names: tuple[str, ...]) -> dict[str, ChainRow]:
        if not names:
            return {}
        rows = frappe.get_all(
            "File",
            filters=[["name", "in", list(names)], *self._clauses()],
            fields=["name", "folder", "status"],
        )
        return {row.name: ChainRow(row.name, row.folder, row.status or ACTIVE) for row in rows}

    def permissions(self, after: tuple[str, str, str], limit: int) -> list[PermissionRow]:
        entity, user, name = after
        # `entity` links `File.name`, so the same prefix narrows this table.
        rows = frappe.db.sql(
            f"""SELECT `name`, `entity`, `user`, `read`, `comment`, `share`, `write`,
                      `upload`, `deny`, `creation`
               FROM `tabDrive Permission`
               WHERE (`entity`, `user`, `name`) > (%(entity)s, %(user)s, %(name)s)
               {self._extra_sql(column="entity")}
               ORDER BY `entity`, `user`, `name` LIMIT %(limit)s""",
            {"entity": entity, "user": user, "name": name, "limit": limit, **self._extra_values()},
            as_dict=True,
        )
        return [
            PermissionRow(
                name=row.name,
                entity=row.entity,
                user=row.user or "",
                read=cint(row.read),
                comment=cint(row.comment),
                share=cint(row.share),
                write=cint(row.write),
                upload=cint(row.upload),
                deny=cint(row.deny),
                creation=str(row.creation or ""),
            )
            for row in rows
        ]

    def docshares(self, after: str, limit: int) -> list[DocShareRow]:
        # Not narrowed, and it cannot be: `share_name` is a `Sheet` id, and
        # a `Sheet` id says nothing about the `File` behind it. `sheet_entity`
        # is where a row turns into a node id, and that read is narrowed, so
        # a row from outside the prefix is read and then dropped.
        rows = frappe.get_all(
            "DocShare",
            filters=[["share_doctype", "=", "Sheet"], ["name", ">", after]],
            fields=["name", "share_name", "user", "read", "write", "everyone", "creation"],
            order_by="name asc",
            limit=limit,
        )
        return [
            DocShareRow(
                name=row.name,
                share_name=row.share_name,
                user=row.user or "",
                read=cint(row.read),
                write=cint(row.write),
                everyone=cint(row.everyone),
                creation=str(row.creation or ""),
            )
            for row in rows
        ]

    def user_enabled(self, email: str) -> bool | None:
        found = frappe.db.get_value("User", email, ["name", "enabled"], as_dict=True)
        return bool(found.enabled) if found else None

    def group_exists(self, name: str) -> bool:
        return bool(frappe.db.exists("User Group", name))

    def is_composite_deck(self, entity: str) -> bool:
        content = frappe.db.get_value(
            "File",
            [["name", "=", entity], *self._clauses()],
            ["content_doctype", "content_docname"],
            as_dict=True,
        )
        if not content or content.content_doctype != "Presentation" or not content.content_docname:
            return False
        # `Presentation` is not a `File`, so the prefix has nothing to say here.
        return bool(frappe.db.get_value("Presentation", content.content_docname, "is_composite"))

    def sheet_entity(self, sheet: str) -> str | None:
        return frappe.db.get_value(
            "File",
            [["content_doctype", "=", "Sheet"], ["content_docname", "=", sheet], *self._clauses()],
            "name",
        )

    def _clauses(self) -> list:
        """The narrowing filter as `frappe.get_all` takes it."""
        return [["name", "like", self.name_prefix + "%"]] if self.name_prefix else []

    def _extra_sql(self, alias: str = "", column: str = "name") -> str:
        """The same narrowing filter, for the reads that are raw SQL.

        `column` is the one that links `File.name`: `name` on `tabFile`
        itself, `entity` on `tabDrive Permission`."""
        if not self.name_prefix:
            return ""
        target = f"{alias}.`{column}`" if alias else f"`{column}`"
        return f" AND {target} LIKE %(build_name_prefix)s"

    def _extra_values(self) -> dict:
        if not self.name_prefix:
            return {}
        return {"build_name_prefix": self.name_prefix + "%"}


class SiteDrive:
    """`DriveTarget` over the real `Drive Node`, `Drive Root`, and `Drive Grant`."""

    def nodes(self, names: tuple[str, ...]) -> dict[str, dict]:
        if not names:
            return {}
        rows = frappe.get_all(
            "Drive Node", filters=[["name", "in", list(names)]], fields=list(NODE_READ_COLUMNS)
        )
        return {row.name: dict(row) for row in rows}

    def root_metadata(self, node: str) -> dict | None:
        # The primary key first. §3.2 gives `Drive Root` `autoname:
        # field:node`, so `name` equals `node` on every row Build writes,
        # and a row named this id whose `node` column points elsewhere is a
        # row the `{"node": ...}` read cannot see. Missing it makes Build
        # call the pair absent and die on a duplicate primary key, on this
        # run and on every rerun after it.
        row = frappe.db.get_value("Drive Root", node, list(ROOT_READ_COLUMNS), as_dict=True)
        if not row:
            row = frappe.db.get_value("Drive Root", {"node": node}, list(ROOT_READ_COLUMNS), as_dict=True)
        return dict(row) if row else None

    def active_root(self, kind: str, user: str | None) -> str | None:
        # The same filter `_core/roots.py active_root_for` uses, down to
        # leaving `user` out for the Shared root, which names none (§3.2).
        # It answers with `name`; Build needs the `node` column, because the
        # two disagree on exactly the row this read exists to find.
        filters = {"kind": kind, "state": ACTIVE}
        if kind == PERSONAL:
            filters["user"] = user
        return frappe.db.get_value("Drive Root", filters, "node")

    def write_root_pair(self, node: dict | None, metadata: dict | None, grants: list[dict]) -> None:
        # §3.2: "Create the root node first, then its metadata and anchor
        # grants in one transaction. Publish no partial pair." A savepoint
        # is what makes that true inside a batch that has already inserted
        # other rows, and it behaves the same on both backends.
        savepoint = "drive_build_root_pair"
        frappe.db.savepoint(savepoint)
        try:
            if node:
                self.insert_nodes([node])
            if metadata:
                frappe.db.bulk_insert(
                    "Drive Root", fields=list(ROOT_COLUMNS), values=[_values(ROOT_COLUMNS, metadata)]
                )
            self.insert_grants(grants)
        except Exception:
            frappe.db.rollback(save_point=savepoint)
            raise
        frappe.db.release_savepoint(savepoint)

    def insert_nodes(self, rows: list[dict]) -> None:
        if not rows:
            return
        frappe.db.bulk_insert(
            "Drive Node", fields=list(NODE_COLUMNS), values=[_values(NODE_COLUMNS, row) for row in rows]
        )

    def insert_grants(self, rows: list[dict]) -> None:
        if not rows:
            return
        frappe.db.bulk_insert(
            "Drive Grant", fields=list(GRANT_COLUMNS), values=[_values(GRANT_COLUMNS, row) for row in rows]
        )

    def grant_roles(self, node: str, principals: tuple[str, ...]) -> dict[str, int]:
        if not principals:
            return {}
        rows = frappe.get_all(
            "Drive Grant",
            filters=[["node", "=", node], ["principal", "in", list(principals)]],
            fields=["principal", "role"],
        )
        return {row.principal: cint(row.role) for row in rows}

    def raise_grant(self, node: str, principal: str, role: int) -> None:
        name = frappe.db.get_value("Drive Grant", {"node": node, "principal": principal}, "name")
        if name:
            frappe.db.set_value("Drive Grant", name, "role", role, update_modified=False)

    def has_link_grant(self, node: str) -> bool:
        return bool(
            frappe.db.exists(
                "Drive Grant", {"node": node, "principal": ["like", "$LINK:%"], "role": [">", NONE]}
            )
        )

    def commit(self) -> None:
        if not frappe.flags.in_test:
            frappe.db.commit()  # batched migration: a stopped run resumes here  # nosemgrep


def _values(columns: tuple[str, ...], row: dict) -> tuple:
    """Order one row's values to match the column list, defaulting the rest."""
    return tuple(row.get(column) for column in columns)
