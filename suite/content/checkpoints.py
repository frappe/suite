"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `admission.PLACES`
compactions run at once on a bench, because RQ's Redis is shared by every site
on it.

An install changes nothing if a newer compaction or another lineage got there
first, and a deadlock or lock wait retries only that short step.

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
from suite.content.log import ChainBroken, chain_next, chain_seed, node_of
from suite.content.snapshot import Snapshot, fallback_rev, read, rows_after
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
        update_table = self.table("update")
        checkpoint_table = self.table("checkpoint")
        doc_table = self.table("doc")
        edited_rows = frappe.db.sql(
            f"SELECT `created` FROM `{update_table}` WHERE `doc_id` = %s AND `rev` = %s",
            (self.doc_id, through_rev),
        )
        last_edited = edited_rows[0][0]
        write_body(self.app, app_row_name, result.state, edited_at=last_edited)
        frappe.db.sql(
            f"DELETE FROM `{checkpoint_table}` WHERE `doc_id` = %s AND `through_rev` <= %s",
            (self.doc_id, through_rev),
        )
        state_sha = hashlib.sha256(result.state).hexdigest()
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET `body_rev` = %s, `body_chain` = UNHEX(%s), `body_sha` = UNHEX(%s)
            WHERE `id` = %s""",
            (through_rev, snapshot.head_chain.hex(), state_sha, self.doc_id),
        )

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
        body_up_to_date = int(control_row.body_rev) >= through_rev
        if other_lineage or body_up_to_date:
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
        checkpoint_table = self.table("checkpoint")
        frappe.db.sql(f"DELETE FROM `{checkpoint_table}` WHERE `doc_id` = %s", self.doc_id)
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
        body_up_to_date = int(control_row.body_rev) >= through_rev
        if other_lineage or body_up_to_date or fallback_rev(self.app, self.doc_id) >= through_rev:
            frappe.db.rollback()
            return False

        self.replace_fallback(snapshot, result)
        self.record_compaction(through_rev, result)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        self.announce_room(control_row)
        return True

    def lock_control_row(self) -> frappe._dict | None:
        """Lock and load the control row in the caller's transaction."""
        doc_table = self.table("doc")
        control_rows = frappe.db.sql(
            f"""SELECT `node`, `lineage`, `mode`, `body_rev`, `state_bytes` + `tail_bound` AS `room_used`
            FROM `{doc_table}` WHERE `id` = %s FOR UPDATE""",
            self.doc_id,
            as_dict=True,
        )
        if not control_rows:
            return None

        return control_rows[0]

    def compaction_values(self, base: int, result: compaction.Compacted) -> dict:
        """Answer the values `record_compaction` writes for a result whose tail starts after `base`."""
        return {
            "doc": self.doc_id,
            "base": base,
            "crdt_version": compaction.CRDT_VERSION,
            "state_bytes": len(result.state),
            "ms": result.ms,
            "next": paced_until(result),
        }

    def record_compaction(self, base: int, result: compaction.Compacted) -> None:
        """Count the state and the tail after `base`, and clear the failures."""
        update_table = self.table("update")
        doc_table = self.table("doc")
        values = self.compaction_values(base, result)
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET
                `crdt_version` = %(crdt_version)s,
                `state_bytes` = %(state_bytes)s,
                `tail_rows` = (SELECT COUNT(*) FROM `{update_table}` WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{update_table}` WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `tail_bound` = (SELECT COALESCE(SUM(COALESCE(`bound`, LENGTH(`payload`))), 0) FROM `{update_table}`
                    WHERE `doc_id` = %(doc)s AND `rev` > %(base)s),
                `compaction_failures` = 0,
                `suspect_judged_clean` = 0,
                `last_compaction_ms` = %(ms)s,
                `last_compaction_error` = NULL,
                `next_compaction_at` = %(next)s
            WHERE `id` = %(doc)s""",
            values,
        )

    def announce_room(self, control_row: frappe._dict) -> None:
        """Tabs measured a full document from what it held before."""
        if control_row.room_used >= capacity.STATE_MAX:
            live.publish_change(self.app, self.doc_id, "room")

    def count_attempt(self) -> None:
        """Count the attempt as a failure, with its backoff, before pycrdt runs; an install resets it."""
        failures = self.failure_count()
        retry_at = next_retry_at(failures + 1)
        doc_table = self.table("doc")
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET `compaction_failures` = `compaction_failures` + 1,
            `next_compaction_at` = %s WHERE `id` = %s""",
            (retry_at, self.doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def record_failure(self, reason: str, error: Exception) -> None:
        """Record why the attempt, already counted, failed, and alert when it repeats or can't wait."""
        doc_table = self.table("doc")
        frappe.db.sql(
            f"UPDATE `{doc_table}` SET `last_compaction_error` = %s WHERE `id` = %s",
            (reason[:140], self.doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        failures = self.failure_count()
        repeated = failures >= ALERT_AT
        alert_at_once = reason in ALERT_AT_ONCE
        if repeated or alert_at_once:
            self.alert(reason, f"Compaction failed {failures} times in a row: {reason}", error)

    def clear_attempt(self) -> None:
        """Nothing to compact: clear the attempt this job counted."""
        doc_table = self.table("doc")
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET `compaction_failures` = 0, `next_compaction_at` = NULL
            WHERE `id` = %s AND `body_rev` = `head_rev`""",
            self.doc_id,
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit

    def failure_count(self) -> int:
        """Load how many attempts in a row have failed, 0 when the control row is gone."""
        doc_table = self.table("doc")
        control_rows = frappe.db.sql(
            f"SELECT `compaction_failures` FROM `{doc_table}` WHERE `id` = %s", self.doc_id
        )
        if not control_rows:
            return 0

        [[failures]] = control_rows
        return int(failures)

    def defer(self, seconds: int) -> None:
        """Hold the next compaction off for `seconds`, unless one is already held off longer."""
        retry_at = now_datetime() + timedelta(seconds=seconds)
        values = {
            "at": retry_at,
            "doc": self.doc_id,
        }
        doc_table = self.table("doc")
        frappe.db.sql(
            f"""UPDATE `{doc_table}` SET `next_compaction_at` = %(at)s
            WHERE `id` = %(doc)s AND (`next_compaction_at` IS NULL OR `next_compaction_at` < %(at)s)""",
            values,
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
    [[raw_max_packet]] = frappe.db.sql("SELECT @@max_allowed_packet")
    chunk_size = int(raw_max_packet) // 4
    for start in range(0, len(compressed), chunk_size):
        chunk = compressed[start : start + chunk_size]
        frappe.db.sql(
            f"""UPDATE `{checkpoint_table}` SET `gz` = CONCAT(`gz`, UNHEX(%s))
            WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)""",
            (chunk.hex(), doc_id, through, sha.hex()),
        )

    # A server not in strict mode empties a CONCAT past max_allowed_packet with only a warning
    [[stored_length]] = frappe.db.sql(
        f"SELECT LENGTH(`gz`) FROM `{checkpoint_table}` WHERE `doc_id` = %s AND `through_rev` = %s",
        (doc_id, through),
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
    frappe.db.sql(
        f"""INSERT INTO `{checkpoint_table}`
        (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `crdt_version`, `report`, `created`)
        VALUES (%s, %s, UNHEX(%s), UNHEX(%s), %s, '', %s, %s, %s, %s)""",
        (
            doc_id,
            through,
            chain.hex(),
            sha.hex(),
            len(state),
            int(integrated),
            compaction.CRDT_VERSION,
            json.dumps(report),
            now_datetime(),
        ),
    )
    write_compressed(checkpoint_table, doc_id, through, sha, state)


def check_start_unused(app: str, doc_id: str, control_row: frappe._dict) -> None:
    """Refuse to replace a start a tab may hold: one with a session or a row after rev 1."""
    session_table = table(app, "session")
    any_session = frappe.db.sql(f"SELECT 1 FROM `{session_table}` WHERE `doc_id` = %s LIMIT 1", doc_id)
    if int(control_row.head_rev) > 1 or any_session or rows_after(app, doc_id, 0):
        raise ValueError("this log's start is already in use")


def stamp_start(app: str, doc_id: str, state: bytes, chain: bytes, state_sha: bytes, schema: int) -> None:
    """Point the control row's head and body at the new start as rev 1."""
    doc_table = table(app, "doc")
    values = {
        "chain": chain.hex(),
        "sha": state_sha.hex(),
        "crdt_version": compaction.CRDT_VERSION,
        "size": len(state),
        "clocks": json.dumps(ingest.next_clocks([state])),
        "steps": json.dumps([[1, schema]]),
        "doc": doc_id,
    }
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `head_rev` = 1, `head_chain` = UNHEX(%(chain)s),
        `body_rev` = 1, `body_chain` = UNHEX(%(chain)s), `body_sha` = UNHEX(%(sha)s),
        `crdt_version` = %(crdt_version)s, `state_bytes` = %(size)s, `start_clocks` = %(clocks)s,
        `schema_steps` = %(steps)s WHERE `id` = %(doc)s""",
        values,
    )


def replace_start(app: str, doc_id: str, state: bytes, schema: int) -> None:
    """Make the checked `state` the body a fresh log starts from at rev 1, in the caller's transaction."""
    doc_table = table(app, "doc")
    checkpoint_table = table(app, "checkpoint")
    node = node_of(app, doc_id)
    if node is None:
        raise ValueError("this log's document has no row")

    app_row = body_row(app, node, lock=True)
    if app_row is None:
        raise ValueError("this log's document has no row")

    control_rows = frappe.db.sql(
        f"SELECT `lineage`, `head_rev` FROM `{doc_table}` WHERE `id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )
    control_row = control_rows[0]

    check_start_unused(app, doc_id, control_row)
    state_sha = hashlib.sha256(state).digest()
    seed = chain_seed(control_row.lineage)
    chain = chain_next(seed, 1, state_sha)
    frappe.db.sql(f"DELETE FROM `{checkpoint_table}` WHERE `doc_id` = %s", doc_id)
    write_body(app, app_row.name, state)
    stamp_start(app, doc_id, state, chain, state_sha, schema)
    forget_cached(app, app_row.name)


def next_retry_at(failures: int) -> datetime:
    """Answer when a document whose last `failures` attempts failed may try again."""
    delay_seconds = min(2**failures * 60, 6 * 3600)
    return now_datetime() + timedelta(seconds=delay_seconds)
