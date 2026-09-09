"""§14.10: Cleanup's ordered phases, run as one entrypoint.

There is no `execute()` here, on purpose: `suite/patches.txt` names no
function in this package (`suite.drive.patches.build.tests.test_dormancy`
and this package's own `tests.test_dormancy` both prove it), so `bench
migrate` never calls `run_cleanup`. It exists so a later, separately
authorized release (Ticket 36) has one function to wire in, once the
Build release, migrated clients, and every runtime gate are real.
"""

from __future__ import annotations

from suite.drive.patches.cleanup.environment import CLEANUP_BATCH_SIZE
from suite.drive.patches.cleanup.gate import check_gates, require_authorization
from suite.drive.patches.cleanup.readiness import run_preflight
from suite.drive.patches.cleanup.removal import (
    phase_content_fields,
    phase_content_history,
    phase_custom_fields,
    phase_file_rows,
    phase_legacy_api,
    phase_legacy_doctypes,
    phase_s3_prefix,
    phase_thumbnails,
)

# §14.10's order. Each entry is `(name, callable)`, where the callable takes
# `(env, batch_size)`: uniform shape for the loop below, even though most
# phases ignore the batch size.
PHASES = (
    ("file_rows", lambda env, size: phase_file_rows(env, batch_size=size)),
    ("custom_fields", lambda env, size: phase_custom_fields(env)),
    ("legacy_doctypes", lambda env, size: phase_legacy_doctypes(env)),
    ("content_history", lambda env, size: phase_content_history(env, batch_size=size)),
    ("content_fields", lambda env, size: phase_content_fields(env)),
    ("legacy_api", lambda env, size: phase_legacy_api(env)),
    ("thumbnails", lambda env, size: phase_thumbnails(env, batch_size=size)),
    ("s3_prefix", lambda env, size: phase_s3_prefix(env, batch_size=size)),
)


def run_cleanup(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> dict:
    """Run every §14.10 phase against `env`, in order, resumably.

    Five refusals, all before phase 1, none of them repeated inside the
    loop below: `env.state.refuse_if_corrupt()` (an unreadable existing
    state record is quarantined for forensics and refused outright, never
    silently treated as a fresh site with no prior run — see
    `CorruptCleanupStateError`); `run_preflight` (can every port a pending
    phase needs actually do its job — the honestly-`NotImplementedError`
    ports fail here, not partway through a phase that already deleted
    rows); the three §14.10 gates; then explicit authorization and a
    recorded backup reference. Checked once per call, not once per phase:
    Cleanup runs single-actor and serial by its own execution rules (no
    concurrent writer this run could regress against between two phases of
    the same call), so re-scanning the whole `File` table before every one
    of eight phases bought no real safety for the cost of up to ten full
    scans a run. A genuine resume — a fresh process, after a kill — still
    gets a fully fresh check: it is a new call to this function, and every
    refusal above runs again from scratch before any phase does.

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
    run_preflight(env)
    check_gates(env, batch_size=batch_size)
    require_authorization(env)

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
