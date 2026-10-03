"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `PLACES` compactions
run at once on a bench, because RQ's Redis is shared by every site on it.
"""

import contextlib
import gzip
import hashlib
import json
import os
import resource
import time
from datetime import timedelta

import frappe
from frappe.utils import now_datetime, sbool
from frappe.utils.background_jobs import get_redis_conn

from suite.suite_core.collab import compaction
from suite.suite_core.collab.log import chain_next, chain_seed
from suite.suite_core.collab.tables import table

TIMEOUT = 120
PLACES = 2
PER_COMPACTION = 240 * 2**20
LEASE = TIMEOUT + 90
PACED_FROM = 512 * 2**10
ALERT_AT = 3


class Skipped(Exception):
    """A compaction that did not run and needs no failure counted."""


def run(adapter: str, doc_id: str, roots: dict[str, type]) -> None:
    held = take_place(adapter, doc_id)
    if held is None:
        defer(adapter, doc_id, LEASE)
        return
    try:
        attempt(adapter, doc_id, roots)
    finally:
        free_place(held)


def attempt(adapter: str, doc_id: str, roots: dict[str, type]) -> None:
    started = time.monotonic()
    through = None
    try:
        count_attempt(adapter, doc_id)
        if not enough_memory():
            raise compaction.CompactionFailed("insufficient_memory")
        limit_memory()
        snapshot = read(adapter, doc_id)
        through = snapshot["head_rev"]
        result = compaction.compact(snapshot["checkpoint"], snapshot["rows"], roots)
        report = {**result.report, "ms": int((time.monotonic() - started) * 1000)}
        store(adapter, doc_id, through, snapshot["head_chain"], result, report, roots)
        install(adapter, doc_id, snapshot["lineage"], through, snapshot["head_chain"], result, report)
    except Skipped:
        frappe.db.rollback()
        settle(adapter, doc_id)
    except Exception as error:
        frappe.db.rollback()
        reason = error.reason if isinstance(error, compaction.CompactionFailed) else type(error).__name__
        failed(adapter, doc_id, through, reason, error)


def request(adapter: str, doc_id: str, method: str) -> None:
    """Enqueue `method(doc_id)` once per document; it runs `run` with the product's roots."""
    queue = "collab" if "collab" in frappe.conf.get("workers", {}) else "default"
    frappe.enqueue(
        method,
        queue=queue,
        timeout=TIMEOUT,
        job_id=f"suite-collab-compact-{adapter}-{doc_id}",
        deduplicate=True,
        doc_id=doc_id,
    )


def read(adapter: str, doc_id: str) -> dict:
    """Checkpoint plus the rows after it through the head, in one snapshot, chain checked."""
    for _try in range(2):
        with repeatable_read():
            doc = frappe.db.sql(
                f"""SELECT `lineage`, `head_rev`, `head_chain`, `checkpoint_rev`, `checkpoint_chain`
                FROM `{table(adapter, "doc")}` WHERE `id` = %s""",
                doc_id,
                as_dict=True,
            )
            if not doc:
                raise Skipped
            doc = doc[0]
            base = int(doc.checkpoint_rev)
            if int(doc.head_rev) == base:
                raise Skipped
            checkpoint = None
            chain = chain_seed(doc.lineage)
            if base:
                stored = frappe.db.sql(
                    f"SELECT `gz`, `chain` FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s",
                    (doc_id, base),
                )
                checkpoint, chain = gzip.decompress(bytes(stored[0][0])), bytes(stored[0][1])
            rows = frappe.db.sql(
                f"""SELECT `rev`, `payload` FROM `{table(adapter, "update")}`
                WHERE `doc_id` = %s AND `rev` > %s AND `rev` <= %s ORDER BY `rev`""",
                (doc_id, base, doc.head_rev),
            )
        expected = base + 1
        for rev, payload in rows:
            if int(rev) != expected:
                break
            chain = chain_next(chain, int(rev), hashlib.sha256(bytes(payload)).digest())
            expected += 1
        if expected == int(doc.head_rev) + 1 and chain == bytes(doc.head_chain):
            return {
                "lineage": doc.lineage,
                "head_rev": int(doc.head_rev),
                "head_chain": chain,
                "checkpoint": checkpoint,
                "rows": [bytes(payload) for _rev, payload in rows],
            }
    raise compaction.CompactionFailed("chain_break")


@contextlib.contextmanager
def repeatable_read():
    """Run the reads in one REPEATABLE READ snapshot. The level applies from the next transaction."""
    previous = isolation()
    frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    try:
        yield
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    finally:
        if previous and previous != "REPEATABLE-READ":
            frappe.db.sql(f"SET SESSION TRANSACTION ISOLATION LEVEL {previous.replace('-', ' ')}")


def isolation() -> str | None:
    for variable in ("@@transaction_isolation", "@@tx_isolation"):
        try:
            return frappe.db.sql(f"SELECT {variable}")[0][0]
        except Exception:
            continue
    return None


def store(adapter: str, doc_id: str, through: int, chain: bytes, result, report: dict, roots) -> None:
    """T2: the checkpoint row, unreferenced until the install. A row already there must hold the same document."""
    existing = frappe.db.sql(
        f"SELECT `gz` FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s",
        (doc_id, through),
    )
    if existing:
        if not compaction.same(gzip.decompress(bytes(existing[0][0])), result.state, roots):
            raise compaction.CompactionFailed("checkpoint_mismatch")
        return
    frappe.db.sql(
        f"""INSERT INTO `{table(adapter, "checkpoint")}`
        (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
        VALUES (%s, %s, UNHEX(%s), UNHEX(%s), %s, UNHEX(%s), %s, %s, %s, %s)""",
        (
            doc_id,
            through,
            chain.hex(),
            hashlib.sha256(result.state).hexdigest(),
            len(result.state),
            gzip.compress(result.state).hex(),
            int(result.integrated),
            compaction.KERNEL,
            json.dumps(report),
            now_datetime(),
        ),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def install(
    adapter: str, doc_id: str, lineage: str, through: int, chain: bytes, result, report: dict
) -> None:
    """T3b: point the control row at the checkpoint, unless a newer compaction or another lineage got there first."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    frappe.db.sql(f"SELECT `id` FROM `{table(adapter, 'doc')}` WHERE `id` = %s FOR UPDATE", doc_id)
    paced = len(result.state) >= PACED_FROM
    pause = timedelta(seconds=max(60, 10 * report["ms"] / 1000))
    updates = table(adapter, "update")
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET
            `checkpoint_rev` = %(through)s,
            `checkpoint_chain` = UNHEX(%(chain)s),
            `integrated_rev` = IF(%(integrated)s, %(through)s, `integrated_rev`),
            `kernel_schema` = %(kernel)s,
            `state_bytes` = %(state_bytes)s,
            `tail_rows` = (SELECT COUNT(*) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(through)s),
            `tail_bytes` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(through)s),
            `tail_bound` = (SELECT COALESCE(SUM(LENGTH(`payload`)), 0) FROM `{updates}` WHERE `doc_id` = %(doc)s AND `rev` > %(through)s),
            `compaction_failures` = 0,
            `last_compaction_ms` = %(ms)s,
            `last_compaction_error` = NULL,
            `next_compaction_at` = %(next)s
        WHERE `id` = %(doc)s AND `lineage` = %(lineage)s AND `checkpoint_rev` < %(through)s""",
        {
            "doc": doc_id,
            "lineage": lineage,
            "through": through,
            "chain": chain.hex(),
            "integrated": int(result.integrated),
            "kernel": compaction.KERNEL,
            "state_bytes": len(result.state),
            "ms": report["ms"],
            "next": now_datetime() + pause if paced else None,
        },
    )
    installed = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
    # Superseded checkpoints go, except the newest integrated one
    frappe.db.sql(
        f"""DELETE `c` FROM `{table(adapter, "checkpoint")}` `c` JOIN `{table(adapter, "doc")}` `d` ON `d`.`id` = `c`.`doc_id`
        WHERE `c`.`doc_id` = %s AND `c`.`through_rev` < `d`.`checkpoint_rev` AND `c`.`through_rev` != `d`.`integrated_rev`""",
        doc_id,
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if installed and not result.integrated:
        alert(adapter, doc_id, "fallback", "The compaction kept the merged rows as an open base only")


def count_attempt(adapter: str, doc_id: str) -> None:
    """Count the attempt as a failure, with its backoff, before pycrdt runs; an install resets it."""
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `compaction_failures` = `compaction_failures` + 1,
        `next_compaction_at` = %s WHERE `id` = %s""",
        (backoff(failures(adapter, doc_id) + 1), doc_id),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def failed(adapter: str, doc_id: str, through: int | None, reason: str, error: Exception) -> None:
    """The attempt was already counted; record why, and drop its checkpoint row if it was never installed."""
    frappe.db.sql(
        f"UPDATE `{table(adapter, 'doc')}` SET `last_compaction_error` = %s WHERE `id` = %s",
        (reason[:140], doc_id),
    )
    if through is not None:
        frappe.db.sql(
            f"""DELETE `c` FROM `{table(adapter, "checkpoint")}` `c` JOIN `{table(adapter, "doc")}` `d` ON `d`.`id` = `c`.`doc_id`
            WHERE `c`.`doc_id` = %s AND `c`.`through_rev` = %s AND `c`.`through_rev` > `d`.`checkpoint_rev`""",
            (doc_id, through),
        )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    count = failures(adapter, doc_id)
    if count >= ALERT_AT or reason in ("kernel_version", "chain_break", "checkpoint_mismatch"):
        alert(adapter, doc_id, reason, f"Compaction failed {count} times in a row: {reason}", error)


def settle(adapter: str, doc_id: str) -> None:
    """Nothing to compact: clear the attempt this job counted."""
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `compaction_failures` = 0, `next_compaction_at` = NULL
        WHERE `id` = %s AND `checkpoint_rev` = `head_rev`""",
        doc_id,
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def failures(adapter: str, doc_id: str) -> int:
    found = frappe.db.sql(
        f"SELECT `compaction_failures` FROM `{table(adapter, 'doc')}` WHERE `id` = %s", doc_id
    )
    return int(found[0][0]) if found else 0


def backoff(count: int):
    return now_datetime() + timedelta(seconds=min(2**count * 60, 6 * 3600))


def defer(adapter: str, doc_id: str, seconds: int) -> None:
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `next_compaction_at` = %(at)s
        WHERE `id` = %(doc)s AND (`next_compaction_at` IS NULL OR `next_compaction_at` < %(at)s)""",
        {"at": now_datetime() + timedelta(seconds=seconds), "doc": doc_id},
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def alert(adapter: str, doc_id: str, reason: str, message: str, error: Exception | None = None) -> None:
    frappe.log_error(
        title=f"Collab compaction: {reason}",
        message=f"{message}\n{adapter} document {doc_id}\n{error!r}"
        if error
        else f"{message}\n{adapter} document {doc_id}",
        reference_doctype="Suite Collab Settings",
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


# Bench-wide places, held in RQ's Redis; a lease outlives the job timeout, so a killed horse frees its place
def take_place(adapter: str, doc_id: str) -> list[str] | None:
    """One place of `PLACES`, and the document's own key so two jobs never compact it at once."""
    redis = get_redis_conn()
    holder = f"{frappe.local.site}:{adapter}:{doc_id}"
    own = f"suite:collab:compacting:{holder}"
    if not redis.set(own, holder, nx=True, ex=LEASE):
        return None
    for index in range(PLACES):
        key = f"suite:collab:compaction:{index}"
        if redis.set(key, holder, nx=True, ex=LEASE):
            return [key, own]
    redis.delete(own)
    return None


def free_place(held: list[str]) -> None:
    redis = get_redis_conn()
    holder = (redis.get(held[1]) or b"").decode()
    for key in held:
        if (redis.get(key) or b"").decode() == holder:
            redis.delete(key)


def enough_memory() -> bool:
    """With every place compacting, 20% of the container must stay free. True where the cgroup can't be read."""
    try:
        with open("/sys/fs/cgroup/memory.max") as limit_file:
            limit = limit_file.read().strip()
        with open("/sys/fs/cgroup/memory.stat") as stat_file:
            anon = next(int(line.split()[1]) for line in stat_file if line.startswith("anon "))
    except (OSError, StopIteration, ValueError):
        return True
    if limit == "max":
        return True
    limit = int(limit)
    return limit - anon - PLACES * PER_COMPACTION >= limit // 5


def limit_memory() -> None:
    """Cap this work horse's address space, on Linux and only in a forked horse."""
    if sbool(os.environ.get("FRAPPE_BACKGROUND_WORKERS_NOFORK")):
        return
    try:
        with open("/proc/self/status") as status:
            size = next(int(line.split()[1]) * 1024 for line in status if line.startswith("VmSize:"))
        resource.setrlimit(resource.RLIMIT_AS, (size + PER_COMPACTION, resource.RLIM_INFINITY))
    except (OSError, StopIteration, ValueError):
        pass
