"""§14.2 steps 1 to 3: make every legacy Drive byte reachable as a blob.

One call, `prepare_legacy_bytes`, does the gate, the framework local
backfill, and the legacy S3 copy, and leaves a durable record of what it
found. Tree conversion (tickets 27 to 29) starts from that record: a
`missing_bytes` row that ticket 27 finds reachable becomes a node with no
blob (§14.1). The list holds every blobless row on the site, Drive's and
the framework's alike, so 27 must intersect it with its own walk.

A third pass follows the two the spec names. It copies nothing: it reads
the blobless rows neither step could reach and puts them in the record.
Without it the report is silent about them, and §14.10 Cleanup deletes
Drive's legacy prefix from the bucket with nothing having said their bytes
were never carried across.

What it never does: move or delete local bytes, delete a legacy S3 object,
or write any `File` column except `blob`.
"""

from frappe.storage.backfill import PRIVATE_PREFIX, PUBLIC_PREFIX

from suite.drive.patches.build.environment import BACKFILL_BATCH_SIZE, BUILD_BATCH_SIZE
from suite.drive.patches.build.gate import check_gate
from suite.drive.patches.build.s3_copy import copy_legacy_s3_objects
from suite.drive.patches.build.state import MissingBytes, StoragePreparation
from suite.drive.utils.files import S3_URL_PREFIX

LOCAL_PREFIXES = (PUBLIC_PREFIX, PRIVATE_PREFIX)


def prepare_legacy_bytes(env, *, batch_size: int = BUILD_BATCH_SIZE) -> StoragePreparation:
    """Gate, backfill, copy, and record. Safe to run again after a stop."""
    check_gate(env)

    prep = env.state.storage()
    prep.begin_run()

    # The framework backfill is idempotent and links local bytes in place:
    # it never rewrites `file_url` and never moves a file. It runs over the
    # whole `File` table, so framework attachments outside the Drive trees
    # get a blob too, and every one of them keeps working from the same
    # path it was already served from.
    stats = env.storage.run_backfill(BACKFILL_BATCH_SIZE) or {}
    # Cumulative: the backfill skips rows that already have a blob, so a
    # second run links nothing and would otherwise report zero.
    prep.backfill_linked += stats.get("linked", 0)
    prep.backfill_blobs_created += stats.get("blobs_created", 0)
    for entry in unreadable_local_rows(stats):
        prep.record_missing(entry)
    env.state.put_storage(prep)

    if env.legacy_s3.enabled:
        copy_legacy_s3_objects(env, prep, batch_size=batch_size)

    record_unreachable_rows(env, prep, batch_size=batch_size)

    prep.completed = True
    env.state.put_storage(prep)
    return prep


def handled_prefixes(env) -> tuple[str, ...]:
    """The `file_url` shapes Build knows how to read on this site.

    The fetch prefix belongs here only when the legacy S3 settings are on.
    With them off, step 3 never runs, and a row still carrying a fetch URL
    keeps bytes Build cannot reach."""
    if env.legacy_s3.enabled:
        return (*LOCAL_PREFIXES, S3_URL_PREFIX)
    return LOCAL_PREFIXES


def record_unreachable_rows(env, prep: StoragePreparation, *, batch_size: int = BUILD_BATCH_SIZE) -> None:
    """List the blobless rows neither step reached. Reads only.

    A Link node's `file_url` is an external address and never named bytes
    (§14.4), and a row with no `file_url` never named any either. Everything
    else here had bytes somewhere Build could not follow: a bare bucket key
    from a half-finished upload, a fetch URL left by a prefix rename that
    never ran, a fetch URL on a site whose S3 settings were turned off.
    """
    prefixes = handled_prefixes(env)
    after = ""
    previous_page = None
    while True:
        rows = env.files.rows_outside(prefixes, after, batch_size)
        if not rows:
            return
        # Nothing here links a row, so every row stays in the query and the
        # keyset cursor is the only thing that ends the loop. A migration
        # that hangs is worse than one that stops.
        if rows[0].name == previous_page:
            raise RuntimeError(f"the File cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = rows[0].name
        for row in rows:
            if names_no_bytes(row):
                continue
            prep.record_missing(
                MissingBytes(
                    file=row.name,
                    file_url=row.file_url,
                    reason="file_url names bytes Build cannot reach",
                )
            )
        after = rows[-1].name
        env.state.put_storage(prep)
        if len(rows) < batch_size:
            return


# A File row pointing into the app bundle names a shipped asset, not stored
# bytes, so there is nothing for Build to carry across.
ASSET_PREFIX = "/assets/"


def names_no_bytes(row) -> bool:
    """Whether this row never had bytes of its own to carry across."""
    return (
        not row.file_url
        or row.file_type == "Link"
        or "://" in row.file_url
        or row.file_url.startswith(ASSET_PREFIX)
    )


def unreadable_local_rows(backfill_stats: dict) -> list[MissingBytes]:
    """The local rows the backfill looked at and could not read.

    §14.1 lists "a local row still without a blob after that (bytes missing
    on disk)". The backfill only ever queries rows under the two local
    prefixes (`frappe/storage/backfill.py`), so the filter below is a guard
    against that narrowing changing, not a live exclusion.

    The list is every such row on the site, not only Drive's: the backfill
    runs unfiltered, so a broken framework attachment under `Home` is in it
    too. Those rows never become nodes (§14.4). Ticket 27 owns the walk that
    says which of them is reachable, and §14.9's `blobless_nodes` must be
    counted after that walk, not from this list.
    """
    return [
        MissingBytes(
            file=row["name"],
            file_url=row.get("file_url") or "",
            reason=row.get("reason") or "",
        )
        for row in backfill_stats.get("skipped") or []
        if (row.get("file_url") or "").startswith(LOCAL_PREFIXES)
    ]
