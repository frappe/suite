"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `admission.PLACES`
compactions run at once on a bench, because RQ's Redis is shared by every site
on it.

An install changes nothing if a newer compaction, another lineage or a
quarantine got there first, and a deadlock or lock wait retries only that short
step.

A log's start is replaced only while no tab can hold it: before any session or
row after rev 1. Its `schema` is at least the highest stamp of the rows the
start was built from.
"""

import gzip
import hashlib
import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

import frappe
from frappe.query_builder import Table
from frappe.query_builder.functions import Concat, Length
from frappe.utils import now_datetime

from suite.content import (
    admission,
    capacity,
    compaction,
    db,
    ingest,
    live,
    quarantine,
    scheduling,
    suspect,
)
from suite.content.app_row import body_row, forget_cached, write_body
from suite.content.db import Unhex, insert_into
from suite.content.log import ChainBroken, chain_next, chain_seed, node_of
from suite.content.snapshot import Snapshot, fallback_rev, read, rows_after, tail_sums
from suite.content.tables import table

PACED_FROM = 512 * 2**10
ALERT_AT = 3
INSTALL_ATTEMPTS = 3
ALERT_AT_ONCE = {"kernel_version", "chain_break", "checkpoint_mismatch"}


def paced_until(result: compaction.Compacted) -> datetime | None:
    """Answer when a big state's next compaction may start, None when its state is small."""
    if len(result.state) < PACED_FROM:
        return None

    pause = timedelta(seconds=max(60, 10 * result.ms / 1000))
    return now_datetime() + pause


def run(app: str, doc_id: str, part_map: Mapping[str, type], judge_method: str) -> None:
    """Compact one document; `judge_method` judges it when the compaction can't take its rows."""
    Compaction(app, doc_id, part_map, judge_method).run()


@dataclass
class Compaction:
    """One document's compaction. `part_map` names every root type its product writes; `judge_method` judges
    the document when the compaction can't take its rows."""

    app: str
    doc_id: str
    part_map: Mapping[str, type]
    judge_method: str

    def table(self, kind: str) -> str:
        """Answer the name of the app's table of `kind`."""
        return table(self.app, kind)

    def run(self) -> None:
        """Compact the document unless it is suspect, deferring while every place is taken."""
        if suspect.suspect_of(self.app, self.doc_id):
            return

        place = admission.take_place(self.app, self.doc_id)
        if place is None:
            self.defer(admission.LEASE_SECONDS)
            return

        try:
            self.attempt()
        finally:
            admission.free_place(place)

    def attempt(self) -> None:
        """Make one counted attempt; a failure is recorded and may mark the document suspect."""
        started = time.monotonic()
        try:
            self.count_attempt()
            if not admission.enough_memory():
                raise compaction.CompactionFailed("insufficient_memory")

            admission.limit_memory()
            snapshot = self.fit_snapshot()
            if snapshot is None or snapshot.head_rev == snapshot.base:
                frappe.db.rollback()
                self.clear_attempt()
                return

            rows = snapshot.payloads()
            compacted = compaction.compact(snapshot.checkpoint, rows, self.part_map)
            compacted.ms = int((time.monotonic() - started) * 1000)
            self.install(snapshot, compacted)
        except Exception as error:
            frappe.db.rollback()
            if isinstance(error, compaction.CompactionFailed | ChainBroken):
                reason = error.reason
            else:
                reason = type(error).__name__

            self.record_failure(reason, error)
            if reason in suspect.REASONS:
                suspect.mark_suspect(self.app, self.doc_id, reason, self.judge_method)

    def fit_snapshot(self) -> Snapshot | None:
        """Read a snapshot, quarantining first, one at a time, each row a compaction must not take."""
        while True:
            snapshot = read(self.app, self.doc_id, integrated=True)
            if snapshot is None:
                return None

            rows = snapshot.payloads()
            unfit_row = quarantine.first_unfit(snapshot.checkpoint, rows, set(self.part_map))
            if not unfit_row:
                return snapshot

            index, reason = unfit_row
            if index < 0:
                raise compaction.CompactionFailed(reason)

            frappe.db.rollback()
            unfit_rev = snapshot.rows[index][0]
            quarantined = quarantine.quarantine(self.app, self.doc_id, {unfit_rev}, reason)
            if not quarantined:
                raise compaction.CompactionFailed(reason)

    def try_install(
        self,
        write_result: Callable[[Snapshot, compaction.Compacted], bool],
        snapshot: Snapshot,
        result: compaction.Compacted,
        is_last_attempt: bool,
    ) -> bool | None:
        """Run one install attempt; None when a deadlock or lock wait calls for another."""
        try:
            return write_result(snapshot, result)
        except Exception as error:
            frappe.db.rollback()
            retryable = frappe.db.is_deadlocked(error) or frappe.db.is_timedout(error)
            if is_last_attempt or not retryable:
                raise

            return None

    def install(self, snapshot: Snapshot, result: compaction.Compacted) -> None:
        """Write a checked body into the app's row, or keep a result it can't check as the fallback."""
        write_result = self.keep_fallback
        if result.integrated:
            write_result = self.install_body

        for attempt in range(INSTALL_ATTEMPTS):
            is_last_attempt = attempt == INSTALL_ATTEMPTS - 1
            installed = self.try_install(write_result, snapshot, result, is_last_attempt)
            if installed is not None:
                break

        kept_fallback = installed and not result.integrated
        if kept_fallback and not suspect.fallback_judged_lately(self.app, self.doc_id):
            self.alert("fallback", "The compaction kept the merged rows as an open base only")
            suspect.mark_suspect(self.app, self.doc_id, "fallback", self.judge_method)

    def write_checked_body(self, snapshot: Snapshot, result: compaction.Compacted, app_row_name: str) -> None:
        """Write the body, its newest edit's time and its stamp, and delete the fallbacks it covers."""
        through_rev = snapshot.head_rev
        checkpoint = Table(self.table("checkpoint"))
        doc = Table(self.table("doc"))
        write_body(self.app, app_row_name, result.state, edited_at=self.edited_at(through_rev))
        (
            frappe.qb.from_(checkpoint)
            .delete()
            .where(checkpoint.doc_id == self.doc_id)
            .where(checkpoint.through_rev <= through_rev)
            .run()
        )
        state_sha = hashlib.sha256(result.state).hexdigest()
        (
            frappe.qb.update(doc)
            .set(doc.body_rev, through_rev)
            .set(doc.body_chain, Unhex(snapshot.head_chain.hex()))
            .set(doc.body_sha, Unhex(state_sha))
            .where(doc.id == self.doc_id)
            .run()
        )

    def edited_at(self, rev: int) -> datetime:
        """Load when row `rev` was written."""
        update = Table(self.table("update"))
        edited_rows = (
            frappe.qb.from_(update)
            .select(update.created)
            .where(update.doc_id == self.doc_id)
            .where(update.rev == rev)
            .run()
        )
        return edited_rows[0][0]

    def install_body(self, snapshot: Snapshot, result: compaction.Compacted) -> bool:
        """Install the body in one transaction under the control and app rows' locks; pushes answer busy."""
        through_rev = snapshot.head_rev
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        node = node_of(self.app, self.doc_id)
        if node is None:
            raise compaction.CompactionFailed("purged")

        app_row = body_row(self.app, node, lock=True)
        control_row = self.lock_control_row()
        if app_row is None or control_row is None or control_row.mode == "purged":
            raise compaction.CompactionFailed("purged")

        other_lineage = control_row.lineage != snapshot.lineage
        quarantined_since = int(control_row.q_epoch) != snapshot.q_epoch
        body_up_to_date = int(control_row.body_rev) >= through_rev
        if other_lineage or quarantined_since or body_up_to_date:
            frappe.db.rollback()
            return False

        self.write_checked_body(snapshot, result, app_row.name)
        tail_base = max(through_rev, fallback_rev(self.app, self.doc_id))
        self.record_compaction(tail_base, result)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        forget_cached(self.app, app_row.name)
        self.announce_room(control_row)
        return True

    def replace_fallback(self, snapshot: Snapshot, result: compaction.Compacted) -> None:
        """Replace the document's fallback with the result, as a checkpoint through the snapshot's head."""
        checkpoint = Table(self.table("checkpoint"))
        frappe.qb.from_(checkpoint).delete().where(checkpoint.doc_id == self.doc_id).run()
        state_sha = hashlib.sha256(result.state).digest()
        report = {**result.report, "ms": result.ms}
        insert_checkpoint(
            self.app,
            self.doc_id,
            snapshot.head_rev,
            snapshot.head_chain,
            state_sha,
            result.state,
            False,
            report,
        )

    def keep_fallback(self, snapshot: Snapshot, result: compaction.Compacted) -> bool:
        """Keep an unchecked result as the one fallback if newer than the body and any fallback."""
        through_rev = snapshot.head_rev
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        control_row = self.lock_control_row()
        if control_row is None or control_row.mode == "purged":
            raise compaction.CompactionFailed("purged")

        other_lineage = control_row.lineage != snapshot.lineage
        quarantined_since = int(control_row.q_epoch) != snapshot.q_epoch
        body_up_to_date = int(control_row.body_rev) >= through_rev
        if (
            other_lineage
            or quarantined_since
            or body_up_to_date
            or fallback_rev(self.app, self.doc_id) >= through_rev
        ):
            frappe.db.rollback()
            return False

        self.replace_fallback(snapshot, result)
        self.record_compaction(through_rev, result)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.announce_room(control_row)
        return True

    def lock_control_row(self) -> frappe._dict | None:
        """Lock and load the control row in the caller's transaction."""
        doc = Table(self.table("doc"))
        control_rows = (
            frappe.qb.from_(doc)
            .select(
                doc.node,
                doc.lineage,
                doc.q_epoch,
                doc.mode,
                doc.body_rev,
                (doc.state_bytes + doc.tail_bound).as_("room_used"),
            )
            .where(doc.id == self.doc_id)
            .for_update()
            .run(as_dict=True)
        )
        if not control_rows:
            return None

        return control_rows[0]

    def record_compaction(self, base: int, result: compaction.Compacted) -> None:
        """Count the state and the tail after `base`, and clear the failures."""
        doc = Table(self.table("doc"))
        tail = tail_sums(self.app, self.doc_id, base)
        (
            frappe.qb.update(doc)
            .set(doc.crdt_version, compaction.CRDT_VERSION)
            .set(doc.state_bytes, len(result.state))
            .set(doc.tail_rows, tail.rows)
            .set(doc.tail_bytes, tail.nbytes)
            .set(doc.tail_bound, tail.bound)
            .set(doc.compaction_failures, 0)
            .set(doc.suspect_judged_clean, 0)
            .set(doc.last_compaction_ms, result.ms)
            .set(doc.last_compaction_error, None)
            .set(doc.next_compaction_at, paced_until(result))
            .where(doc.id == self.doc_id)
            .run()
        )

    def announce_room(self, control_row: frappe._dict) -> None:
        """Tabs measured a full document from what it held before."""
        if control_row.room_used >= capacity.STATE_MAX:
            live.publish_change(self.app, self.doc_id, "room")

    def count_attempt(self) -> None:
        """Count the attempt as a failure, with its backoff, before pycrdt runs; an install resets it."""
        failures = self.failure_count()
        retry_at = next_retry_at(failures + 1)
        doc = Table(self.table("doc"))
        (
            frappe.qb.update(doc)
            .set(doc.compaction_failures, doc.compaction_failures + 1)
            .set(doc.next_compaction_at, retry_at)
            .where(doc.id == self.doc_id)
            .run()
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def record_failure(self, reason: str, error: Exception) -> None:
        """Record why the attempt, already counted, failed, and alert when it repeats or can't wait."""
        doc = Table(self.table("doc"))
        frappe.qb.update(doc).set(doc.last_compaction_error, reason[:140]).where(doc.id == self.doc_id).run()
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        failures = self.failure_count()
        repeated = failures >= ALERT_AT
        alert_at_once = reason in ALERT_AT_ONCE
        if repeated or alert_at_once:
            self.alert(reason, f"Compaction failed {failures} times in a row: {reason}", error)

    def clear_attempt(self) -> None:
        """Nothing to compact: clear the attempt this job counted."""
        doc = Table(self.table("doc"))
        (
            frappe.qb.update(doc)
            .set(doc.compaction_failures, 0)
            .set(doc.next_compaction_at, None)
            .where(doc.id == self.doc_id)
            .where(doc.body_rev == doc.head_rev)
            .run()
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failure_count(self) -> int:
        """Load how many attempts in a row have failed, 0 when the control row is gone."""
        doc = Table(self.table("doc"))
        control_rows = frappe.qb.from_(doc).select(doc.compaction_failures).where(doc.id == self.doc_id).run()
        if not control_rows:
            return 0

        [[failures]] = control_rows
        return int(failures)

    def defer(self, seconds: int) -> None:
        """Hold the next compaction off for `seconds`, unless one is already held off longer."""
        retry_at = now_datetime() + timedelta(seconds=seconds)
        doc = Table(self.table("doc"))
        (
            frappe.qb.update(doc)
            .set(doc.next_compaction_at, retry_at)
            .where(doc.id == self.doc_id)
            .where(doc.next_compaction_at.isnull() | (doc.next_compaction_at < retry_at))
            .run()
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def alert(self, reason: str, message: str, error: Exception | None = None) -> None:
        """Log an alert for admins about this document's compaction."""
        detail = f"{self.app} document {self.doc_id}"
        log_message = f"{message}\n{detail}"
        if error:
            log_message = f"{message}\n{detail}\n{error!r}"

        db.alert(f"Collab compaction: {reason}", log_message)


def write_compressed(checkpoint_table: str, doc_id: str, through: int, sha: bytes, state: bytes) -> None:
    """Write `state` gzipped into the checkpoint row's blob, refused as too large when the server drops it."""
    # In parts of a quarter packet, since hex doubles each one; every part rewrites the whole blob
    compressed = gzip.compress(state)
    checkpoint = Table(checkpoint_table)
    chunk_size = int(db.load_system_variable("max_allowed_packet")) // 4
    for start in range(0, len(compressed), chunk_size):
        chunk = compressed[start : start + chunk_size]
        (
            frappe.qb.update(checkpoint)
            .set(checkpoint.gz, Concat(checkpoint.gz, Unhex(chunk.hex())))
            .where(checkpoint.doc_id == doc_id)
            .where(checkpoint.through_rev == through)
            .where(checkpoint.sha256 == Unhex(sha.hex()))
            .run()
        )

    # A server not in strict mode empties a CONCAT past max_allowed_packet with only a warning
    [[stored_length]] = (
        frappe.qb.from_(checkpoint)
        .select(Length(checkpoint.gz))
        .where(checkpoint.doc_id == doc_id)
        .where(checkpoint.through_rev == through)
        .run()
    )
    if stored_length != len(compressed):
        raise compaction.CompactionFailed("too_large")


def insert_checkpoint(
    app: str,
    doc_id: str,
    through: int,
    chain: bytes,
    sha: bytes,
    state: bytes,
    integrated: bool,
    report: dict,
) -> None:
    """Write a checkpoint row for `state`, unreferenced, in the caller's transaction."""
    checkpoint_table = table(app, "checkpoint")
    insert_into(
        checkpoint_table,
        {
            "doc_id": doc_id,
            "through_rev": through,
            "chain": Unhex(chain.hex()),
            "sha256": Unhex(sha.hex()),
            "nbytes": len(state),
            "gz": "",
            "integrated": int(integrated),
            "crdt_version": compaction.CRDT_VERSION,
            "report": json.dumps(report),
            "created": now_datetime(),
        },
    ).run()
    write_compressed(checkpoint_table, doc_id, through, sha, state)


def check_start_unused(app: str, doc_id: str, control_row: frappe._dict) -> None:
    """Refuse to replace a start a tab may hold: one with a session or a row after rev 1."""
    session = Table(table(app, "session"))
    any_session = frappe.qb.from_(session).select(1).where(session.doc_id == doc_id).limit(1).run()
    if int(control_row.head_rev) > 1 or any_session or rows_after(app, doc_id, 0):
        raise ValueError("this log's start is already in use")


def stamp_start(app: str, doc_id: str, state: bytes, chain: bytes, state_sha: bytes, schema: int) -> None:
    """Point the control row's head and body at the new start as rev 1."""
    doc = Table(table(app, "doc"))
    (
        frappe.qb.update(doc)
        .set(doc.head_rev, 1)
        .set(doc.head_chain, Unhex(chain.hex()))
        .set(doc.body_rev, 1)
        .set(doc.body_chain, Unhex(chain.hex()))
        .set(doc.body_sha, Unhex(state_sha.hex()))
        .set(doc.crdt_version, compaction.CRDT_VERSION)
        .set(doc.state_bytes, len(state))
        .set(doc.start_clocks, json.dumps(ingest.next_clocks([state])))
        .set(doc.schema_steps, json.dumps([[1, schema]]))
        .where(doc.id == doc_id)
        .run()
    )


def replace_start(app: str, doc_id: str, state: bytes, schema: int) -> None:
    """Make the checked `state` the body a fresh log starts from at rev 1, in the caller's transaction."""
    doc = Table(table(app, "doc"))
    checkpoint = Table(table(app, "checkpoint"))
    node = node_of(app, doc_id)
    if node is None:
        raise ValueError("this log's document has no row")

    app_row = body_row(app, node, lock=True)
    if app_row is None:
        raise ValueError("this log's document has no row")

    control_rows = (
        frappe.qb.from_(doc)
        .select(doc.lineage, doc.head_rev)
        .where(doc.id == doc_id)
        .for_update()
        .run(as_dict=True)
    )
    control_row = control_rows[0]

    check_start_unused(app, doc_id, control_row)
    state_sha = hashlib.sha256(state).digest()
    seed = chain_seed(control_row.lineage)
    chain = chain_next(seed, 1, state_sha)
    frappe.qb.from_(checkpoint).delete().where(checkpoint.doc_id == doc_id).run()
    write_body(app, app_row.name, state)
    stamp_start(app, doc_id, state, chain, state_sha, schema)
    forget_cached(app, app_row.name)


def next_retry_at(failures: int) -> datetime:
    """Answer when a document whose last `failures` attempts failed may try again."""
    delay_seconds = min(2**failures * 60, 6 * 3600)
    return now_datetime() + timedelta(seconds=delay_seconds)
