"""§14.2 step 12: recompute `used_bytes`, and reconcile it independently.

§14.8 is explicit that the mapping does not write `Drive Root.used_bytes`
and that the recompute fills it as Build's last step, so this runs after
every node, version, and reservation exists. §7.7 fixes the sum:
`nodes + versions + reserved`, per Active and Archived root.

§14.9 asks for the totals to be reconciled independently. Calling §7.7's
statement twice would only prove the database is deterministic, so the
second opinion is computed a different way: three grouped passes over the
whole site, one per charged table, rather than three correlated subqueries
per root. The two answers are compared root by root, and a root the grouped
pass charges that no `Drive Root` row explains is reported as well - those
bytes are charged to nobody and no later recompute would find them.
"""

import frappe

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import ACTIVE
from suite.drive.patches.build.root_pairs import ARCHIVED
from suite.drive.patches.build.state import UsageConversion, UsageMismatch

# §7.7 recomputes "every Active and Archived root". There is no third state.
CHARGED_STATES = (ACTIVE, ARCHIVED)

CHARGED_TABLES = ("nodes", "versions", "reserved")


class BuildUsageError(frappe.ValidationError):
    """Step 12 cannot run, or read a root it must not recompute."""


def recompute_usage(env, *, batch_size: int = BUILD_BATCH_SIZE) -> UsageConversion:
    """Recompute and reconcile every charged root (§14.2 step 12)."""
    _require_finished_steps(env)
    ledger = _ledger(env)
    result = env.state.usage()
    result.begin_run()
    env.state.put_usage(result)

    # Taken once, before the first write. Nothing this step writes appears in
    # these sums - `used_bytes` is not one of the charged tables - so one
    # pass is both cheaper and a fair comparison for every root.
    grouped = ledger.grouped_totals()
    charged = set(grouped)

    after = ""
    written = 0
    while True:
        rows = ledger.roots(after, batch_size)
        if not rows:
            break
        for row in rows:
            result.roots_seen += 1
            charged.discard(row.name)
            if row.state not in CHARGED_STATES:
                result.roots_skipped += 1
                continue
            totals = ledger.totals(row.name)
            recomputed = sum(int(totals.get(table) or 0) for table in CHARGED_TABLES)
            for table in CHARGED_TABLES:
                setattr(
                    result,
                    _BYTES_FIELD[table],
                    getattr(result, _BYTES_FIELD[table]) + int(totals.get(table) or 0),
                )
            result.used_bytes += recomputed
            result.roots_recomputed += 1
            if row.used_bytes != recomputed:
                ledger.set_used_bytes(row.name, recomputed)
                result.roots_corrected += 1
                written += 1
            _reconcile(result, row.name, recomputed, grouped.get(row.name))
            if written >= batch_size:
                ledger.commit()
                env.state.put_usage(result)
                written = 0
        after = rows[-1].name
        if len(rows) < batch_size:
            break

    for orphan in sorted(charged):
        totals = grouped[orphan]
        result.unattributed_roots += 1
        result.unattributed_bytes += sum(int(totals.get(table) or 0) for table in CHARGED_TABLES)

    ledger.commit()
    result.completed = True
    env.state.put_usage(result)
    return result


_BYTES_FIELD = {"nodes": "node_bytes", "versions": "version_bytes", "reserved": "reserved_bytes"}


def _reconcile(result, root: str, recomputed: int, grouped) -> None:
    """Compare §7.7's per-root answer with the grouped pass's answer."""
    reconciled = sum(int((grouped or {}).get(table) or 0) for table in CHARGED_TABLES)
    result.reconciled_roots += 1
    if reconciled != recomputed:
        result.record_mismatch(UsageMismatch(root=root, recomputed=recomputed, reconciled=reconciled))


def _require_finished_steps(env) -> None:
    """§14.8: the recompute runs last, so every charged row must exist first."""
    if not env.state.tree().completed:
        raise BuildUsageError("ticket 27 tree conversion must complete before step 12")
    if not env.state.content().completed:
        raise BuildUsageError("the content steps must complete before step 12")
    if not env.state.settings().completed:
        raise BuildUsageError("step 11 must complete before step 12; reservations are charged bytes")


def _ledger(env):
    if env.usage is None:
        raise BuildUsageError("Build usage ports are not configured")
    return env.usage
