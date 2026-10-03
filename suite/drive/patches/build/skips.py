"""What Build read and did not convert, written where an operator will read it.

§14.9's report prints counts. A count is not enough to act on: the operator
needs the row ids and the reason for each, and needs the migration to stop
until somebody has looked. So after the report, Build:

1. collects every skip counter and every kept sample out of the durable
   record into one document;
2. writes it beside the Build record as `drive-build-skipped.json` (the
   state file's directory, which is the site's private directory on a real
   site), rewriting it on every run so it describes the current state;
3. prints the totals to the migration log;
4. refuses to call Build finished while any *refusing* skip is present and
   site config does not carry `drive_build_accept_skips`.

Two kinds of skip. A refusing skip is a reachable, not Removed row that
ended with no node: a subtree past the depth or path cap, a row under a
file, a link node the engine would refuse to save, a root pair Build could
not reconcile, or anything the walk left behind. Those rows are data people
can still see in the legacy UI, and the only way they leave the migration
is an operator saying so. Everything else is reported but does not refuse:
Removed rows are skipped by rule, a broken chain was already unreachable,
missing bytes are a node with no blob rather than a lost node (§14.1), and
dropped grants and shares have their own §14.9 keys.
"""

import json
import os

import frappe

from suite.drive.patches.build.environment import ACCEPT_SKIPS_CONFIG_KEY

SKIPPED_FILENAME = "drive-build-skipped.json"

# `TreeConversion` counters whose rows are reachable data Build did not
# convert. Every one of them blocks the migration until accepted.
REFUSING_COUNTERS = (
    "over_capacity_skipped",
    "invalid_parent_skipped",
    "unsaveable_skipped",
    "roots_skipped",
    "unmigrated_reachable",
)

# Counters that are evidence, not a refusal. Each has a rule that explains it.
REPORTED_COUNTERS = (
    "removed_rows_skipped",
    "broken_chains_skipped",
)


class UnacceptedSkipsError(frappe.ValidationError):
    """Build converted everything it could, and what it could not needs a decision."""


def collect_skips(env) -> dict:
    """One document describing every row Build left out, from the record."""
    tree = env.state.tree()
    storage = env.state.storage()
    grants = env.state.grants()
    content = env.state.content()
    refusing = {name: getattr(tree, name) for name in REFUSING_COUNTERS}
    reported = {name: getattr(tree, name) for name in REPORTED_COUNTERS}
    return {
        "refusing": refusing,
        "refusing_total": sum(refusing.values()),
        "reported": {
            **reported,
            "missing_bytes_total": storage.missing_bytes_total,
            "grant_rows_dropped": dict(grants.grant_rows_dropped),
            "docshare_rows_dropped": grants.docshare_rows_dropped + content.docshare_rows_dropped,
        },
        # The bounded samples. Each counter above stays exact; past
        # `SAMPLE_KEPT` entries only the counts rise.
        "skipped_rows": [{"file": row.file, "reason": row.reason} for row in tree.skipped],
        "skipped_rows_total": tree.skipped_total,
        "missing_bytes": [
            {"file": row.file, "file_url": row.file_url, "reason": row.reason}
            for row in storage.missing_bytes
        ],
        "missing_bytes_total": storage.missing_bytes_total,
        "accepted": bool(env.accept_skips),
    }


def write_skips(env, skips: dict) -> str:
    """Rewrite the operator's file atomically. Answers its path."""
    path = env.state.path.parent / SKIPPED_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(skips, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    return str(path)


def report_skips(env) -> dict:
    """Collect, write, print, and refuse if a refusing skip is unaccepted."""
    skips = collect_skips(env)
    path = write_skips(env, skips)
    print(
        f"Drive Build skipped {skips['refusing_total']} reachable rows "
        f"({', '.join(f'{k}={v}' for k, v in skips['refusing'].items())}); "
        f"removed_rows_skipped={skips['reported']['removed_rows_skipped']}, "
        f"broken_chains_skipped={skips['reported']['broken_chains_skipped']}, "
        f"missing_bytes_total={skips['missing_bytes_total']}. Details: {path}"
    )
    if skips["refusing_total"] and not env.accept_skips:
        raise UnacceptedSkipsError(
            f"Drive Build left {skips['refusing_total']} reachable rows without a node. Each row and "
            f"its reason is listed in {path}. Fix the rows and migrate again, or accept the loss "
            f"with `bench --site <site> set-config {ACCEPT_SKIPS_CONFIG_KEY} 1` and migrate again."
        )
    return skips
