"""The three refusals §14.10 names, plus the authorization check layered
on top of them.

All four read before they raise. None of them mutates anything, and none
of them trusts a persisted number: gate 1 recomputes reachability live,
against whatever `env.tree`/`env.drive` answer right now, never against
`suite.drive.patches.build.state.BuildState` (Build's own report is a
diary of one run; a stale or tampered copy of it must not be able to wave
Cleanup through). They raise instead of calling `frappe.throw`, matching
`suite.drive.patches.build.gate`: a migration failure needs the message
intact in the traceback.
"""

from __future__ import annotations

import frappe

from suite.drive.patches.cleanup.environment import CLEANUP_BATCH_SIZE
from suite.drive.patches.cleanup.ports import DRIVE_ROOT_ROW, REMOVED, USERS_ROW

# §3.17: the four Link columns naming `File Blob`, all `search_index: 1`.
DRIVE_BLOB_COLUMNS = frozenset(
    {
        ("Drive Node", "blob"),
        ("Drive Node Version", "blob"),
        ("Drive Node Preview", "blob"),
        ("Drive Node Preview", "source_blob"),
    }
)

SAMPLE_KEPT = 20


class ReachableNodesGateError(frappe.ValidationError):
    """Cleanup refused: some reachable Drive File still has no Drive Node."""


class GCDiscoveryGateError(frappe.ValidationError):
    """Cleanup refused: the framework GC cannot be trusted to keep Drive's blobs alive."""


class LegacyCallerGateError(frappe.ValidationError):
    """Cleanup refused: a legacy SPA forwarder is still classified as callable."""


class CleanupAuthorizationError(frappe.ValidationError):
    """Cleanup refused: no operator authorized this run, or named no backup."""


def check_gates(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> None:
    """§14.10: all three gates must hold before Cleanup mutates anything."""
    check_gate_reachable_nodes(env, batch_size=batch_size)
    check_gate_gc_discovery(env)
    check_gate_legacy_callers_removed(env)


def check_gate_reachable_nodes(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> None:
    count, samples = recompute_unmigrated_reachable(env, batch_size=batch_size)
    if count:
        shown = ", ".join(samples[:5]) or "none sampled"
        raise ReachableNodesGateError(
            f"{count} reachable Drive File row(s) still have no Drive Node (for example: "
            f"{shown}). Cleanup must not run until Build has migrated every one of them. "
            "Removed rows and unreachable Home attachments do not count against this gate."
        )


def check_gate_gc_discovery(env) -> None:
    try:
        columns = env.blob_columns()
    except Exception as e:
        raise GCDiscoveryGateError(
            f"frappe.storage.gc.blob_reference_columns() raised {type(e).__name__}: {e}. "
            "Deleting Drive's File rows would risk the framework GC treating every Drive "
            "blob as orphaned, so Cleanup fails closed."
        ) from e
    try:
        found = {(column["doctype"], column["fieldname"]) for column in columns}
    except (KeyError, TypeError) as e:
        raise GCDiscoveryGateError(
            f"blob_reference_columns() returned a malformed row: {e!r}. Cleanup fails closed."
        ) from e
    missing = DRIVE_BLOB_COLUMNS - found
    if missing:
        raise GCDiscoveryGateError(
            f"blob_reference_columns() is missing {sorted(missing)}. Deleting Drive's File "
            "rows would orphan every blob those columns protect."
        )


def check_gate_legacy_callers_removed(env) -> None:
    """§14.10, §11.7: "the SPA has moved off the old method names."

    Deliberately two separate reads, not one: `env.forwarders.classification()`
    only names the *candidates* — whichever entries a maintainer still spells
    "forwarder" in `suite.drive.http.shims.CLASSIFICATION` — and
    `env.callers.still_referenced(...)` is the actual evidence of whether the
    SPA still calls any of them. Gating on the classification label alone
    would be circular: `phase_legacy_api` reads that same label to decide
    what to remove, so a gate that only re-reads it would always find
    nothing left to refuse on by the time it had "passed." A caller can be
    gone from the SPA for months before anyone gets around to relabeling its
    entry in `shims.py`; this gate must not wait on that source edit, and
    phase 6 must still remove a still-"forwarder"-labeled name once this
    gate's own evidence clears it.
    """
    try:
        classification = env.forwarders.classification()
    except Exception as e:
        raise LegacyCallerGateError(
            f"could not read the legacy caller classification: {type(e).__name__}: {e}. Cleanup fails closed."
        ) from e
    forwarders = tuple(sorted(name for name, category in classification.items() if category == "forwarder"))
    if not forwarders:
        return
    try:
        still_called = env.callers.still_referenced(forwarders)
    except Exception as e:
        raise LegacyCallerGateError(
            f"could not attest legacy-caller absence: {type(e).__name__}: {e}. Cleanup fails closed."
        ) from e
    if still_called:
        shown = ", ".join(sorted(still_called)[:5])
        raise LegacyCallerGateError(
            f"{len(still_called)} FORWARDER-classified name(s) still show a caller in the SPA "
            f"source (for example: {shown}). Relabeling an entry in shims.py never clears this "
            "gate by itself; only real evidence that nothing calls it does. PERMANENT and "
            "RETAINED names are never candidates and do not block this gate."
        )


def require_authorization(env) -> None:
    """Not one of the three gates: a fourth refusal that holds even after they pass."""
    if not env.authorized:
        raise CleanupAuthorizationError(
            "Cleanup needs explicit authorization even after every gate passes (§14.11: "
            "the only rollback past this point is a database restore). Set "
            "CleanupEnvironment.authorized."
        )
    if not env.backup_ref:
        raise CleanupAuthorizationError(
            "Cleanup needs a recorded backup reference before it mutates anything (§14.11: "
            "recovery after Cleanup is a database restore, and nothing smaller). Set "
            "CleanupEnvironment.backup_ref."
        )


def recompute_unmigrated_reachable(
    env, *, batch_size: int = CLEANUP_BATCH_SIZE, sample_kept: int = SAMPLE_KEPT
) -> tuple[int, list[str]]:
    """Live gate-1 recomputation: reachable, not-Removed `File` rows with no node.

    Pages `env.tree.unreached()` (rows with no `Drive Node` at all), then
    climbs each one's `folder` chain to answer whether it is really Drive's
    (reachable from the `Drive`/`Users` roots) or frappe's own `Home`. Never
    reads Build's persisted state.
    """
    memo: dict[str, tuple[str, bool]] = {}
    after = ""
    previous = None
    count = 0
    samples: list[str] = []
    while True:
        rows = env.tree.unreached(after, batch_size)
        if not rows:
            return count, samples
        if rows[0].name == previous:
            raise RuntimeError(f"the reachability scan stalled at {rows[0].name!r}; refusing to loop")
        previous = rows[0].name
        classified = climb(rows, env.tree.chain, env.drive.nodes, memo)
        for name, (kind, removed) in classified.items():
            if name == USERS_ROW:
                continue
            if kind == "drive" and not removed:
                count += 1
                if len(samples) < sample_kept:
                    samples.append(name)
        after = rows[-1].name
        if len(rows) < batch_size:
            return count, samples


def climb(rows, chain_of, nodes_of, memo: dict[str, tuple[str, bool]]) -> dict[str, tuple[str, bool]]:
    """Classify each of `rows` as `("drive" | "outside" | "broken", removed)`.

    `nodes_of(ids)` short-circuits a chain the moment it reaches an id that
    already has a `Drive Node`: a migrated ancestor settles the question,
    and a migrated row is never Removed. `chain_of(ids)` climbs one level
    further when it does not. `memo` carries "Removed at or above me" across
    calls in the same scan, keyed by id, so a sibling that meets an already
    classified chain half way up inherits the answer without reclimbing it.
    """
    walking = {row.name: row for row in rows}
    trail: dict[str, list[tuple[str, bool]]] = {row.name: [(row.name, row.status == REMOVED)] for row in rows}
    answer: dict[str, tuple[str, bool]] = {}

    while walking:
        _settle(walking, trail, answer, memo)
        if not walking:
            break
        parents = tuple(sorted({row.folder for row in walking.values() if row.folder}))
        migrated = nodes_of(parents) if parents else {}
        unknown = tuple(name for name in parents if name not in migrated)
        found = chain_of(unknown) if unknown else {}
        _advance(walking, trail, answer, memo, migrated, found)
    return answer


def _settle(walking, trail, answer, memo) -> None:
    for name in list(walking):
        row = walking[name]
        if row.name in memo:
            kind, above = memo[row.name]
            _finish(name, trail, answer, memo, kind, above)
        elif not row.folder:
            kind = "drive" if row.name in (DRIVE_ROOT_ROW, USERS_ROW) else "outside"
            _finish(name, trail, answer, memo, kind, False)
        else:
            continue
        del walking[name]


def _advance(walking, trail, answer, memo, migrated, found) -> None:
    for name in list(walking):
        parent_id = walking[name].folder
        if parent_id in migrated:
            _finish(name, trail, answer, memo, "drive", False)
        elif parent_id not in found:
            _finish(name, trail, answer, memo, "broken", False)
        elif any(step == parent_id for step, _ in trail[name]):
            _finish(name, trail, answer, memo, "broken", False)
        else:
            parent = found[parent_id]
            walking[name] = parent
            trail[name].append((parent_id, parent.status == REMOVED))
            continue
        del walking[name]


def _finish(name, trail, answer, memo, kind, above) -> None:
    carry = above
    for step, step_removed in reversed(trail[name]):
        carry = carry or step_removed
        memo.setdefault(step, (kind, carry))
    answer[name] = (kind, carry)
