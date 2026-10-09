"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `admission.PLACES`
compactions run at once on a bench, because RQ's Redis is shared by every site
on it.
"""

import base64
import gzip
import hashlib
import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta

import frappe
from frappe.utils import now_datetime

from suite.suite_core.content import admission, compaction, ingest, live, quarantine, scheduling, suspect
from suite.suite_core.content.adapters import spec_of
from suite.suite_core.content.log import (
    ChainBroken,
    body_row,
    chain_next,
    chain_seed,
    fallback_rev,
    read,
    rows_after,
)
from suite.suite_core.content.tables import table

PACED_FROM = 512 * 2**10
ALERT_AT = 3


def run(
    adapter: str,
    doc_id: str,
    roots: Mapping[str, type],
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
    roots: Mapping[str, type]
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
        try:
            self.count_attempt()
            if not admission.enough_memory():
                raise compaction.CompactionFailed("insufficient_memory")

            admission.limit_memory()
            snapshot = self.fit_snapshot()
            nothing_new = snapshot is None or snapshot["head_rev"] == snapshot["base"]
            if nothing_new:
                frappe.db.rollback()
                self.settle()
                return

            rows = [payload for _rev, payload in snapshot["rows"]]
            result = compaction.compact(snapshot["checkpoint"], rows, self.roots)
            result.ms = int((time.monotonic() - started) * 1000)
            self.install(snapshot, result)
        except Exception as error:
            frappe.db.rollback()
            if isinstance(error, compaction.CompactionFailed | ChainBroken):
                reason = error.reason
            else:
                reason = type(error).__name__
            self.failed(reason, error)
            if reason in suspect.REASONS:
                suspect.mark(self.adapter, self.doc_id, reason, self.judge_method)

    def fit_snapshot(self) -> dict | None:
        """A snapshot after quarantining, one at a time, each row a compaction must not take."""
        while True:
            snapshot = read(self.adapter, self.doc_id, integrated=True)
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
            unfit_rev = snapshot["rows"][index][0]
            quarantined = quarantine.quarantine(self.adapter, self.doc_id, {unfit_rev}, reason, self.owner_of)
            if not quarantined:
                raise compaction.CompactionFailed(reason)

    def install(self, snapshot: dict, result: compaction.Compacted) -> None:
        """Write a checked body into the app's row, or keep a result it can't check as the fallback.

        Nothing changes if a newer compaction or another lineage got there first. A
        deadlock or lock wait retries this short step only.
        """
        keep = self.point_at if result.integrated else self.keep_fallback
        for attempt in range(3):
            try:
                installed = keep(snapshot, result)
                break
            except Exception as error:
                frappe.db.rollback()
                last_attempt = attempt == 2
                retryable = frappe.db.is_deadlocked(error) or frappe.db.is_timedout(error)
                if last_attempt or not retryable:
                    raise

        kept_fallback = installed and not result.integrated
        if kept_fallback and not suspect.fallback_judged_lately(self.adapter, self.doc_id):
            self.alert("fallback", "The compaction kept the merged rows as an open base only")
            suspect.mark(self.adapter, self.doc_id, "fallback", self.judge_method)

    def point_at(self, snapshot: dict, result: compaction.Compacted) -> bool:
        """One transaction: lock the control row, then the app's row; write the body, its stamp and
        the newest covered edit's time, and delete the fallbacks it covers. Pushes answer busy meanwhile."""
        through = snapshot["head_rev"]
        doc = self.lock()
        if doc is None or doc.mode == "purged":
            raise compaction.CompactionFailed("purged")

        row = body_row(self.adapter, doc.node, lock=True)
        if row is None:
            raise compaction.CompactionFailed("purged")

        other_lineage = doc.lineage != snapshot["lineage"]
        body_as_new = int(doc.body_rev) >= through
        if other_lineage or body_as_new:
            frappe.db.rollback()
            return False

        spec = spec_of(self.adapter)
        edited = frappe.db.sql(
            f"SELECT `created` FROM `{self.table('update')}` WHERE `doc_id` = %s AND `rev` = %s",
            (self.doc_id, through),
        )[0][0]
        body = base64.b64encode(result.state).decode("ascii")
        frappe.db.sql(
            f"""UPDATE `tab{spec.content_type}` SET `{spec.body_field}` = %s, `modified` = GREATEST(`modified`, %s)
            WHERE `name` = %s""",
            (body, edited, row.name),
        )
        frappe.db.sql(
            f"DELETE FROM `{self.table('checkpoint')}` WHERE `doc_id` = %s AND `through_rev` <= %s",
            (self.doc_id, through),
        )
        state_sha = hashlib.sha256(result.state).hexdigest()
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `body_rev` = %s, `body_chain` = UNHEX(%s), `body_sha` = UNHEX(%s)
            WHERE `id` = %s""",
            (through, snapshot["head_chain"].hex(), state_sha, self.doc_id),
        )
        tail_base = max(through, fallback_rev(self.adapter, self.doc_id))
        self.record(tail_base, result)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        frappe.clear_document_cache(spec.content_type, row.name)
        self.measured(doc)
        return True

    def keep_fallback(self, snapshot: dict, result: compaction.Compacted) -> bool:
        """Keep a result the compaction can't check as the document's one fallback, if it is newer than
        the body and any fallback; the app's row is not touched."""
        through = snapshot["head_rev"]
        doc = self.lock()
        if doc is None or doc.mode == "purged":
            raise compaction.CompactionFailed("purged")

        other_lineage = doc.lineage != snapshot["lineage"]
        body_as_new = int(doc.body_rev) >= through
        if other_lineage or body_as_new or fallback_rev(self.adapter, self.doc_id) >= through:
            frappe.db.rollback()
            return False

        frappe.db.sql(f"DELETE FROM `{self.table('checkpoint')}` WHERE `doc_id` = %s", self.doc_id)
        state_sha = hashlib.sha256(result.state).digest()
        report = {**result.report, "ms": result.ms}
        insert_checkpoint(
            self.adapter,
            self.doc_id,
            through,
            snapshot["head_chain"],
            state_sha,
            result.state,
            False,
            report,
        )
        self.record(through, result)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.measured(doc)
        return True

    def lock(self) -> frappe._dict | None:
        """The control row, locked as the first statement of a fresh transaction."""
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        found = frappe.db.sql(
            f"""SELECT `node`, `lineage`, `mode`, `body_rev`, `state_bytes` + `tail_bound` AS `room_used`
            FROM `{self.table("doc")}` WHERE `id` = %s FOR UPDATE""",
            self.doc_id,
            as_dict=True,
        )
        return found[0] if found else None

    def record(self, base: int, result: compaction.Compacted) -> None:
        """Count the state and the tail after `base`, and clear the failures."""
        paced = len(result.state) >= PACED_FROM
        pause = timedelta(seconds=max(60, 10 * result.ms / 1000))
        updates = self.table("update")
        values = {
            "doc": self.doc_id,
            "base": base,
            "kernel": compaction.KERNEL,
            "state_bytes": len(result.state),
            "ms": result.ms,
            "next": now_datetime() + pause if paced else None,
        }
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET
                `kernel_schema` = %(kernel)s,
                `state_bytes` = %(state_bytes)s,
                `tail_rows` = (SELECT COUNT(*) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `tail_bound` = (SELECT COALESCE(SUM(COALESCE(`bound`, LENGTH(`payload`))), 0) FROM `{updates}`
                    WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `compaction_failures` = 0,
                `suspect_judged_clean` = 0,
                `last_compaction_ms` = %(ms)s,
                `last_compaction_error` = NULL,
                `next_compaction_at` = %(next)s
            WHERE `id` = %(doc)s""",
            values,
        )

    def measured(self, doc: frappe._dict) -> None:
        """Tabs measured a full document from what it held before."""
        if doc.room_used >= scheduling.STATE_MAX:
            live.publish_change(self.adapter, self.doc_id, "room")

    def count_attempt(self) -> None:
        """Count the attempt as a failure, with its backoff, before pycrdt runs; an install resets it."""
        failures = self.failures()
        retry_at = backoff(failures + 1)
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `compaction_failures` = `compaction_failures` + 1,
            `next_compaction_at` = %s WHERE `id` = %s""",
            (retry_at, self.doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failed(self, reason: str, error: Exception) -> None:
        """The attempt was already counted; record why."""
        frappe.db.sql(
            f"UPDATE `{self.table('doc')}` SET `last_compaction_error` = %s WHERE `id` = %s",
            (reason[:140], self.doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        count = self.failures()
        repeated = count >= ALERT_AT
        alert_at_once = reason in ("kernel_version", "chain_break", "checkpoint_mismatch")
        if repeated or alert_at_once:
            self.alert(reason, f"Compaction failed {count} times in a row: {reason}", error)

    def settle(self) -> None:
        """Nothing to compact: clear the attempt this job counted."""
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `compaction_failures` = 0, `next_compaction_at` = NULL
            WHERE `id` = %s AND `body_rev` = `head_rev`""",
            self.doc_id,
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failures(self) -> int:
        found = frappe.db.sql(
            f"SELECT `compaction_failures` FROM `{self.table('doc')}` WHERE `id` = %s", self.doc_id
        )
        return int(found[0][0]) if found else 0

    def defer(self, seconds: int) -> None:
        retry_at = now_datetime() + timedelta(seconds=seconds)
        values = {
            "at": retry_at,
            "doc": self.doc_id,
        }
        frappe.db.sql(
            f"""UPDATE `{self.table("doc")}` SET `next_compaction_at` = %(at)s
            WHERE `id` = %(doc)s AND (`next_compaction_at` IS NULL OR `next_compaction_at` < %(at)s)""",
            values,
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def alert(self, reason: str, message: str, error: Exception | None = None) -> None:
        detail = f"{self.adapter} document {self.doc_id}"
        logged = f"{message}\n{detail}"
        if error:
            logged = f"{message}\n{detail}\n{error!r}"
        frappe.log_error(
            title=f"Collab compaction: {reason}",
            message=logged,
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
    max_packet = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0])
    part = max_packet // 4
    for start in range(0, len(gz), part):
        piece = gz[start : start + part]
        frappe.db.sql(
            f"""UPDATE `{checkpoint}` SET `gz` = CONCAT(`gz`, UNHEX(%s))
            WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)""",
            (piece.hex(), doc_id, through, sha.hex()),
        )

    # A server not in strict mode empties a CONCAT past max_allowed_packet with only a warning
    stored = frappe.db.sql(
        f"SELECT LENGTH(`gz`) FROM `{checkpoint}` WHERE `doc_id` = %s AND `through_rev` = %s",
        (doc_id, through),
    )[0][0]
    if stored != len(gz):
        raise compaction.CompactionFailed("too_large")


def replace_start(adapter: str, doc_id: str, state: bytes, schema: int) -> None:
    """Make `state` the body a fresh log starts from, at rev 1, in the app's row, in the caller's transaction.

    `schema` is at least the highest stamp of the rows `state` was built from.

    The caller has checked `state`. Once a tab has a session or a row exists, a tab may
    hold the old start, so the start can no longer change.
    """
    doc = frappe.db.sql(
        f"SELECT `node`, `lineage`, `head_rev` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )[0]
    row = body_row(adapter, doc.node, lock=True)
    if row is None:
        raise ValueError("this log's document has no row")

    sessions = frappe.db.sql(
        f"SELECT 1 FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s LIMIT 1", doc_id
    )
    if int(doc.head_rev) > 1 or sessions or rows_after(adapter, doc_id, 0):
        raise ValueError("this log's start is already in use")

    sha = hashlib.sha256(state).digest()
    seed = chain_seed(doc.lineage)
    chain = chain_next(seed, 1, sha)
    spec = spec_of(adapter)
    frappe.db.sql(f"DELETE FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s", doc_id)
    body = base64.b64encode(state).decode("ascii")
    frappe.db.sql(
        f"UPDATE `tab{spec.content_type}` SET `{spec.body_field}` = %s WHERE `name` = %s",
        (body, row.name),
    )
    values = {
        "chain": chain.hex(),
        "sha": sha.hex(),
        "kernel": compaction.KERNEL,
        "size": len(state),
        "clocks": json.dumps(ingest.next_clocks([state])),
        "steps": json.dumps([[1, schema]]),
        "doc": doc_id,
    }
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `head_rev` = 1, `head_chain` = UNHEX(%(chain)s),
        `body_rev` = 1, `body_chain` = UNHEX(%(chain)s), `body_sha` = UNHEX(%(sha)s),
        `kernel_schema` = %(kernel)s, `state_bytes` = %(size)s, `start_clocks` = %(clocks)s,
        `schema_steps` = %(steps)s WHERE `id` = %(doc)s""",
        values,
    )
    frappe.clear_document_cache(spec.content_type, row.name)


def backoff(count: int):
    delay = min(2**count * 60, 6 * 3600)
    return now_datetime() + timedelta(seconds=delay)
