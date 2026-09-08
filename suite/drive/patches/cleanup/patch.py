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
    ("content_history", lambda env, size: phase_content_history(env)),
    ("content_fields", lambda env, size: phase_content_fields(env)),
    ("legacy_api", lambda env, size: phase_legacy_api(env)),
    ("thumbnails", lambda env, size: phase_thumbnails(env, batch_size=size)),
    ("s3_prefix", lambda env, size: phase_s3_prefix(env, batch_size=size)),
)


def run_cleanup(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> dict:
    """Run every §14.10 phase against `env`, in order, resumably.

    Refuses before any mutation unless all three gates hold and the caller
    has set `authorized` and `backup_ref`. Reruns the gates before every
    phase, not only once at the start: a phase earlier in this same call
    can change what a later gate would answer (deleting File rows changes
    what gate 1 sees), and a resumed, half-finished run must face the same
    refusal a fresh run would if something regressed in between.
    """
    check_gates(env, batch_size=batch_size)
    require_authorization(env)

    results: dict[str, dict] = {}
    for name, phase in PHASES:
        check_gates(env, batch_size=batch_size)
        existing = env.state.get(name)
        if existing.completed:
            results[name] = existing.as_dict()
            continue
        result = phase(env, batch_size)
        env.state.put(name, result)
        results[name] = result.as_dict()
    return results
