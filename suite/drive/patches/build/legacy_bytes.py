"""§14.2 steps 1 to 3: make every legacy Drive byte reachable as a blob.

One call, `prepare_legacy_bytes`, does the gate, the framework local
backfill, and the legacy S3 copy, and leaves a durable record of what it
found. Tree conversion (tickets 27 to 29) starts from that record: a row
listed in `missing_bytes` becomes a node with no blob (§14.1).

What it never does: move or delete local bytes, delete a legacy S3 object,
or write any `File` column except `blob`.
"""

from suite.drive.patches.build.environment import BACKFILL_BATCH_SIZE, BUILD_BATCH_SIZE
from suite.drive.patches.build.gate import check_gate
from suite.drive.patches.build.s3_copy import copy_legacy_s3_objects
from suite.drive.patches.build.state import MissingBytes, StoragePreparation
from suite.drive.utils.files import S3_URL_PREFIX

NO_BLOB_REASON = "no blob after the framework backfill and the S3 copy step"

# What the framework backfill accepts. Anything else on an S3 site is a bare
# bucket key, which §14.2 step 3 does not cover: it names fetch URLs only.
LOCAL_PREFIXES = ("/files/", "/private/files/")
BARE_S3_KEY_REASON = (
    "file_url is neither a local files path nor a Drive S3 fetch URL, so no step "
    "claimed it; check the bucket for this key by hand"
)


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
    reasons = {row["name"]: row.get("reason", "") for row in stats.get("skipped") or []}
    env.state.put_storage(prep)

    if env.legacy_s3.enabled:
        copy_legacy_s3_objects(env, prep, batch_size=batch_size)

    reasons.update({row.file: row.reason for row in prep.missing_bytes})
    prep.missing_bytes = _blobless_rows(env, reasons, batch_size)
    prep.completed = True
    env.state.put_storage(prep)
    return prep


def _blobless_rows(env, reasons: dict, batch_size: int) -> list[MissingBytes]:
    """Every non-folder `File` row still without a blob, with why it failed.

    This is a fresh scan rather than the running tally, so bytes restored
    between two runs stop being reported and a row that only failed on an
    earlier run is not carried forward."""
    missing: list[MissingBytes] = []
    after = ""
    while True:
        rows = env.files.rows_without_blob(after, batch_size)
        if not rows:
            return missing
        for row in rows:
            missing.append(
                MissingBytes(
                    file=row.name,
                    file_url=row.file_url,
                    reason=reasons.get(row.name) or _default_reason(env, row.file_url),
                )
            )
        after = rows[-1].name
        if len(rows) < batch_size:
            return missing


def _default_reason(env, file_url: str) -> str:
    """Why a row has no blob when no step recorded a reason of its own."""
    if (
        env.legacy_s3.enabled
        and file_url
        and not file_url.startswith(S3_URL_PREFIX)
        and not file_url.startswith(LOCAL_PREFIXES)
    ):
        return BARE_S3_KEY_REASON
    return NO_BLOB_REASON
