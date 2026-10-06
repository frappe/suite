"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `admission.PLACES`
compactions run at once on a bench, because RQ's Redis is shared by every site
on it.
"""

import gzip
import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

import frappe
from frappe.utils import now_datetime

from suite.suite_core.collab import admission, compaction, ingest, quarantine, suspect
from suite.suite_core.collab.log import ChainBroken, chain_next, chain_seed, read, rows_after
from suite.suite_core.collab.tables import table

PACED_FROM = 512 * 2**10
ALERT_AT = 3


def run(
    adapter: str,
    doc_id: str,
    roots: dict[str, type],
    judge_method: str,
    owner_of: Callable[[str], str | None],
) -> None:
    Compaction(adapter, doc_id, roots, judge_method, owner_of).run()


@dataclass
class Compaction:
    """One document's compaction. `roots` names every root type its product writes; `judge_method` judges
    the document when the compaction can't take its rows; `owner_of` names a document's owner from its node."""

    adapter: str
    doc_id: str
    roots: dict[str, type]
    judge_method: str
    owner_of: Callable[[str], str | None]

    def table(self, kind: str) -> str:
        return table(self.adapter, kind)

    def run(self) -> None:
        if suspect.suspect_of(self.adapter, self.doc_id):
            return
        held = admission.take_place(self.adapter, self.doc_id)
        if held is None:
            self.defer(admission.LEASE)
            return
        try:
            self.attempt()
        finally:
            admission.free_place(held)

    def attempt(self) -> None:
        started = time.monotonic()
        snapshot = None
        try:
            self.count_attempt()
            if not admission.enough_memory():
                raise compaction.CompactionFailed("insufficient_memory")
            admission.limit_memory()
            snapshot = self.fit_snapshot()
            if snapshot is None or snapshot["head_rev"] == snapshot["base"]:
                frappe.db.rollback()
                self.settle()
                return
            rows = [payload for _rev, payload in snapshot["rows"]]
            result = compaction.compact(snapshot["checkpoint"], rows, self.roots)
            result.ms = int((time.monotonic() - started) * 1000)
            sha = self.store(snapshot, result)
            self.install(snapshot, sha, result)
        except Exception as error:
            frappe.db.rollback()
            reason = (
                error.reason
                if isinstance(error, compaction.CompactionFailed | ChainBroken)
                else type(error).__name__
            )
            self.failed(snapshot and snapshot["head_rev"], reason, error)
            if reason in suspect.REASONS:
                suspect.mark(self.adapter, self.doc_id, reason, self.judge_method)

    def fit_snapshot(self) -> dict | None:
        """A snapshot after quarantining, one at a time, each row a compaction must not take."""
        while True:
            snapshot = read(self.adapter, self.doc_id)
            if snapshot is None:
                return None
            rows = [payload for _rev, payload in snapshot["rows"]]
            found = quarantine.first_unfit(snapshot["checkpoint"], rows, set(self.roots))
            if not found:
                return snapshot
            index, reason = found
            if index < 0:
                raise compaction.CompactionFailed(reason)
            frappe.db.rollback()
            if not quarantine.quarantine(
                self.adapter, self.doc_id, {snapshot["rows"][index][0]}, reason, self.owner_of
            ):
                raise compaction.CompactionFailed(reason)

    def store(self, snapshot: dict, result: compaction.Compacted) -> bytes:
        """T2: the checkpoint row, unreferenced until the install; answers its sha, which names it to the install.

        A row already at this rev was left by an attempt that never installed. It is
        kept only if it holds the same document on the same chain and is as
        integrated as this result; otherwise this result replaces it.
        """
        doc_id, through, chain = self.doc_id, snapshot["head_rev"], snapshot["head_chain"]
        checkpoint = self.table("checkpoint")
        existing = frappe.db.sql(
            f"""SELECT `gz`, `sha256`, `chain`, `integrated` FROM `{checkpoint}`
            WHERE `doc_id` = %s AND `through_rev` = %s""",
            (doc_id, through),
        )
        if existing:
            gz, sha, stored_chain, integrated = existing[0]
            if (
                bytes(stored_chain) == chain
                and int(integrated) == int(result.integrated)
                and compaction.same(gzip.decompress(bytes(gz)), result.state, self.roots)
            ):
                return bytes(sha)
            frappe.db.sql(
                f"DELETE FROM `{checkpoint}` WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)",
                (doc_id, through, bytes(sha).hex()),
            )
        sha = hashlib.sha256(result.state).digest()
        insert_checkpoint(
            self.adapter,
            doc_id,
            through,
            chain,
            sha,
            result.state,
            result.integrated,
            {**result.report, "ms": result.ms},
        )
        # Locked only until the commit below, so a purge either waits for this row or is seen here
        mode = frappe.db.sql(
            f"SELECT `mode` FROM `{self.table('doc')}` WHERE `id` = %s LOCK IN SHARE MODE", doc_id
        )
        if not mode or mode[0][0] == "purged":
            raise compaction.CompactionFailed("purged")
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return sha

    def install(self, snapshot: dict, sha: bytes, result: compaction.Compacted) -> None:
        """T3b: point the control row at the checkpoint row `sha` names.

        Nothing changes if a newer compaction or another lineage got there first, or
        if that row is gone. A deadlock or lock wait retries this short step only.
        """
        for attempt in range(3):
            try:
                installed = self.point_at(snapshot, sha, result)
                break
            except Exception as error:
                frappe.db.rollback()
                if attempt == 2 or not (frappe.db.is_deadlocked(error) or frappe.db.is_timedout(error)):
                    raise
        if (
            installed
            and not result.integrated
            and not suspect.fallback_judged_lately(self.adapter, self.doc_id)
        ):
            self.alert("fallback", "The compaction kept the merged rows as an open base only")
            suspect.mark(self.adapter, self.doc_id, "fallback", self.judge_method)

    def point_at(self, snapshot: dict, sha: bytes, result: compaction.Compacted) -> bool:
        doc, through = self.doc_id, snapshot["head_rev"]
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        frappe.db.sql(f"SELECT `id` FROM `{self.table('doc')}` WHERE `id` = %s FOR UPDATE", doc)
        paced = len(result.state) >= PACED_FROM
        pause = timedelta(seconds=max(60, 10 * result.ms / 1000))
        updates = self.table("update")
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET
                `checkpoint_rev` = %(through)s,
                `checkpoint_chain` = UNHEX(%(chain)s),
                `integrated_rev` = IF(%(integrated)s, %(through)s, `integrated_rev`),
                `kernel_schema` = %(kernel)s,
                `state_bytes` = %(state_bytes)s,
                `tail_rows` = (SELECT COUNT(*) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(through)s),
                `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(through)s),
                `compaction_failures` = 0,
                `suspect_judged_clean` = 0,
                `last_compaction_ms` = %(ms)s,
                `last_compaction_error` = NULL,
                `next_compaction_at` = %(next)s
            WHERE `id` = %(doc)s AND `lineage` = %(lineage)s AND `checkpoint_rev` < %(through)s
            AND EXISTS (SELECT 1 FROM `{self.table("checkpoint")}` WHERE `doc_id` = %(doc)s
                AND `through_rev` = %(through)s AND `sha256` = UNHEX(%(sha)s))""",
            {
                "doc": doc,
                "sha": sha.hex(),
                "lineage": snapshot["lineage"],
                "through": through,
                "chain": snapshot["head_chain"].hex(),
                "integrated": int(result.integrated),
                "kernel": compaction.KERNEL,
                "state_bytes": len(result.state),
                "ms": result.ms,
                "next": now_datetime() + pause if paced else None,
            },
        )
        installed = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
        # Superseded checkpoints go, except the newest integrated one
        frappe.db.sql(
            f"""DELETE `c` FROM `{self.table("checkpoint")}` `c` JOIN `{self.table("doc")}` `d` ON `d`.`id` = `c`.`doc_id`
            WHERE `c`.`doc_id` = %s AND `c`.`through_rev` < `d`.`checkpoint_rev` AND `c`.`through_rev` != `d`.`integrated_rev`""",
            doc,
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return bool(installed)

    def count_attempt(self) -> None:
        """Count the attempt as a failure, with its backoff, before pycrdt runs; an install resets it."""
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `compaction_failures` = `compaction_failures` + 1,
            `next_compaction_at` = %s WHERE `id` = %s""",
            (backoff(self.failures() + 1), self.doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failed(self, through: int | None, reason: str, error: Exception) -> None:
        """The attempt was already counted; record why, and drop its checkpoint row if it was never installed."""
        frappe.db.sql(
            f"UPDATE `{self.table('doc')}` SET `last_compaction_error` = %s WHERE `id` = %s",
            (reason[:140], self.doc_id),
        )
        if through is not None:
            frappe.db.sql(
                f"""DELETE `c` FROM `{self.table("checkpoint")}` `c` JOIN `{self.table("doc")}` `d` ON `d`.`id` = `c`.`doc_id`
                WHERE `c`.`doc_id` = %s AND `c`.`through_rev` = %s AND `c`.`through_rev` > `d`.`checkpoint_rev`""",
                (self.doc_id, through),
            )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        count = self.failures()
        if count >= ALERT_AT or reason in ("kernel_version", "chain_break", "checkpoint_mismatch"):
            self.alert(reason, f"Compaction failed {count} times in a row: {reason}", error)

    def settle(self) -> None:
        """Nothing to compact: clear the attempt this job counted."""
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `compaction_failures` = 0, `next_compaction_at` = NULL
            WHERE `id` = %s AND `checkpoint_rev` = `head_rev`""",
            self.doc_id,
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failures(self) -> int:
        found = frappe.db.sql(
            f"SELECT `compaction_failures` FROM `{self.table('doc')}` WHERE `id` = %s", self.doc_id
        )
        return int(found[0][0]) if found else 0

    def defer(self, seconds: int) -> None:
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `next_compaction_at` = %(at)s
            WHERE `id` = %(doc)s AND (`next_compaction_at` IS NULL OR `next_compaction_at` < %(at)s)""",
            {"at": now_datetime() + timedelta(seconds=seconds), "doc": self.doc_id},
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def alert(self, reason: str, message: str, error: Exception | None = None) -> None:
        detail = f"{self.adapter} document {self.doc_id}"
        frappe.log_error(
            title=f"Collab compaction: {reason}",
            message=f"{message}\n{detail}\n{error!r}" if error else f"{message}\n{detail}",
            reference_doctype="Suite Collab Settings",
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit


def insert_checkpoint(
    adapter: str,
    doc_id: str,
    through: int,
    chain: bytes,
    sha: bytes,
    state: bytes,
    integrated: bool,
    report: dict,
) -> None:
    """Write a checkpoint row for `state`, unreferenced, in the caller's transaction."""
    checkpoint = table(adapter, "checkpoint")
    frappe.db.sql(
        f"""INSERT INTO `{checkpoint}`
        (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
        VALUES (%s, %s, UNHEX(%s), UNHEX(%s), %s, '', %s, %s, %s, %s)""",
        (
            doc_id,
            through,
            chain.hex(),
            sha.hex(),
            len(state),
            int(integrated),
            compaction.KERNEL,
            json.dumps(report),
            now_datetime(),
        ),
    )
    # In parts of a quarter packet, since hex doubles each one; every part rewrites the whole blob
    gz = gzip.compress(state)
    part = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0]) // 4
    for start in range(0, len(gz), part):
        frappe.db.sql(
            f"""UPDATE `{checkpoint}` SET `gz` = CONCAT(`gz`, UNHEX(%s))
            WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)""",
            (gz[start : start + part].hex(), doc_id, through, sha.hex()),
        )
    # A server not in strict mode empties a CONCAT past max_allowed_packet with only a warning
    stored = frappe.db.sql(
        f"SELECT LENGTH(`gz`) FROM `{checkpoint}` WHERE `doc_id` = %s AND `through_rev` = %s",
        (doc_id, through),
    )[0][0]
    if stored != len(gz):
        raise compaction.CompactionFailed("too_large")


def replace_start(adapter: str, doc_id: str, state: bytes, schema: int) -> None:
    """Make `state` the integrated checkpoint a fresh log starts from, at rev 1, in the caller's transaction.

    `schema` is at least the highest stamp of the rows `state` was built from.

    The caller has checked `state`. Once a tab has a session or a row exists, a tab may
    hold the old start, so the start can no longer change.
    """
    doc = frappe.db.sql(
        f"SELECT `lineage`, `head_rev` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )[0]
    sessions = frappe.db.sql(
        f"SELECT 1 FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s LIMIT 1", doc_id
    )
    if int(doc.head_rev) > 1 or sessions or rows_after(adapter, doc_id, 0):
        raise ValueError("this log's start is already in use")
    sha = hashlib.sha256(state).digest()
    chain = chain_next(chain_seed(doc.lineage), 1, sha)
    frappe.db.sql(f"DELETE FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s", doc_id)
    insert_checkpoint(adapter, doc_id, 1, chain, sha, state, True, {"start": True})
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `head_rev` = 1, `head_chain` = UNHEX(%(chain)s),
        `checkpoint_rev` = 1, `checkpoint_chain` = UNHEX(%(chain)s), `integrated_rev` = 1,
        `kernel_schema` = %(kernel)s, `state_bytes` = %(size)s, `start_clocks` = %(clocks)s,
        `schema_steps` = %(steps)s WHERE `id` = %(doc)s""",
        {
            "chain": chain.hex(),
            "kernel": compaction.KERNEL,
            "size": len(state),
            "clocks": json.dumps(ingest.next_clocks([state])),
            "steps": json.dumps([[1, schema]]),
            "doc": doc_id,
        },
    )


def backoff(count: int):
    return now_datetime() + timedelta(seconds=min(2**count * 60, 6 * 3600))
