"""§14.10: Cleanup's ordered phases, run as one entrypoint.

`execute` is what `suite/patches.txt` names, right after
`suite.drive.patches.build`: one `bench migrate` builds the new tables and
then removes the legacy ones. Everything else goes through `run_cleanup`,
which takes the environment as a value so the fixture tests can run the
same contract with no site.
"""

from __future__ import annotations

from suite.drive.patches.cleanup.environment import CLEANUP_BATCH_SIZE, CleanupEnvironment
from suite.drive.patches.cleanup.gate import check_gates, require_backup
from suite.drive.patches.cleanup.removal import (
    phase_content_fields,
    phase_content_history,
    phase_custom_fields,
    phase_file_rows,
    phase_legacy_doctypes,
    phase_slides_media_rows,
    phase_thumbnails,
)

# §14.10's order. Each entry is `(name, callable)`, where the callable takes
# `(env, batch_size)`: uniform shape for the loop below, even though most
# phases ignore the batch size. Step 6, the legacy API forwarders, has no
# phase: the forwarders left with the legacy source, not at runtime. Step 8,
# the legacy bucket objects, has no phase either: Cleanup deletes no bucket
# object, so the backup restore stays a complete rollback (§14.11); the
# manual `delete_legacy_objects` command removes them later.
PHASES = (
    ("file_rows", lambda env, size: phase_file_rows(env, batch_size=size)),
    ("slides_media_rows", lambda env, size: phase_slides_media_rows(env, batch_size=size)),
    ("custom_fields", lambda env, size: phase_custom_fields(env)),
    ("legacy_doctypes", lambda env, size: phase_legacy_doctypes(env)),
    ("content_history", lambda env, size: phase_content_history(env, batch_size=size)),
    ("content_fields", lambda env, size: phase_content_fields(env)),
    ("thumbnails", lambda env, size: phase_thumbnails(env, batch_size=size)),
)


def execute() -> None:
    """The patch entry point: Cleanup against the current site.

    A completed Cleanup then queues the preview backfill (§9.2): Build
    gives migrated files no preview rows, and the daily sweep's 500 a day
    would take weeks on a large site. The job runs after the patch commits,
    on the long queue, so `bench migrate` does not wait for it. A Cleanup
    that refuses or fails raises first and queues nothing.
    """
    from suite.drive._core.previews import enqueue_backfill

    run_cleanup(CleanupEnvironment.for_site())
    enqueue_backfill()


def run_cleanup(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> dict:
    """Run every §14.10 phase against `env`, in order, resumably.

    Three refusals, all before phase 1, none of them repeated inside the
    loop below: `env.state.refuse_if_corrupt()` (an unreadable existing
    state record is quarantined for forensics and refused outright, never
    silently treated as a fresh site with no prior run — see
    `CorruptCleanupStateError`); the two §14.10 gates; then the operator's
    recorded backup. Checked once per call, not once per phase: Cleanup runs
    single-actor and serial by its own execution rules, so re-scanning the
    whole `File` table before every phase bought no real safety for the
    cost of several full scans a run. A genuine resume — a fresh process,
    after a kill — is a new call to this function, and every refusal above
    runs again from scratch before any phase does.

    Each phase commits its own writes (`env.transaction.commit()`) before
    its checkpoint is written (`env.state.put`), never after: a crash
    between the two leaves the mutation durable and the checkpoint absent,
    so a resumed run replays that one phase against data that already
    reflects it — safe, because every phase's writes are idempotent (a
    second `DELETE` of an already-gone row, a second no-op `drop column`
    check) — rather than the reverse order, where a crash could make a
    checkpoint claim durability the database never actually committed.
    """
    env.state.refuse_if_corrupt()
    check_gates(env, batch_size=batch_size)
    require_backup(env)
    env.state.put_backup(env.backup)

    results: dict[str, dict] = {}
    for name, phase in PHASES:
        existing = env.state.get(name)
        if existing.completed:
            results[name] = existing.as_dict()
            continue
        result = phase(env, batch_size)
        env.transaction.commit()
        env.state.put(name, result)
        results[name] = result.as_dict()
    return results
