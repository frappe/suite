"""§14.2 steps 1 to 3: make every legacy Drive byte reachable as a blob.

One call, `prepare_legacy_bytes`, does the gate, the framework local
backfill, and the legacy S3 copy, and leaves a durable record of what it
found. Tree conversion (tickets 27 to 29) starts from that record: a row
listed in `missing_bytes` becomes a node with no blob (§14.1).

What it never does: move or delete local bytes, delete a legacy S3 object,
or write any `File` column except `blob`.
"""

from frappe.storage.backfill import PRIVATE_PREFIX, PUBLIC_PREFIX

from suite.drive.patches.build.environment import BACKFILL_BATCH_SIZE, BUILD_BATCH_SIZE
from suite.drive.patches.build.gate import check_gate
from suite.drive.patches.build.s3_copy import copy_legacy_s3_objects
from suite.drive.patches.build.state import MissingBytes, StoragePreparation

LOCAL_PREFIXES = (PUBLIC_PREFIX, PRIVATE_PREFIX)


def prepare_legacy_bytes(env, *, batch_size: int = BUILD_BATCH_SIZE) -> StoragePreparation:
    """Gate, backfill, copy, and record. Safe to run again after a stop."""
    check_gate(env)

    prep = env.state.storage()
    prep.begin_run()

    # The framework backfill is idempotent and links local bytes in place:
    # it never rewrites `file_url` and never moves a file, so framework
    # attachments outside the Drive trees keep working untouched.
    stats = env.storage.run_backfill(BACKFILL_BATCH_SIZE) or {}
    prep.backfill_linked = stats.get("linked", 0)
    prep.backfill_blobs_created = stats.get("blobs_created", 0)
    prep.missing_bytes = unreadable_local_rows(stats)
    env.state.put_storage(prep)

    if env.legacy_s3.enabled:
        copy_legacy_s3_objects(env, prep, batch_size=batch_size)

    prep.completed = True
    env.state.put_storage(prep)
    return prep


def unreadable_local_rows(backfill_stats: dict) -> list[MissingBytes]:
    """The local rows the backfill looked at and could not read.

    §14.1 lists "a local row still without a blob after that (bytes missing
    on disk)". The backfill also skips rows whose `file_url` is not a local
    path at all: on an S3 site that is every fetch URL, which step 3 then
    handles, and on any site it is every Link node, whose `file_url` is an
    external URL and never named bytes (§14.4). Neither is a missing byte,
    so only rows under the framework's own local prefixes are listed here.
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
