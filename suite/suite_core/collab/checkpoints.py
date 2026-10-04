"""Compaction jobs: read a snapshot, compact it off-lock, then install the checkpoint in short steps.

The job runs in RQ's forked work horse. pycrdt cannot be interrupted from
Python, so its timeout is the worker killing the horse, and an attempt counts
as a failure, with its backoff, until it installs. A killed horse therefore
leaves every row and a retry time, never a loop. At most `PLACES` compactions
run at once on a bench, because RQ's Redis is shared by every site on it.
"""

import gzip
import hashlib
import json
import os
import resource
import secrets
import time
from datetime import timedelta

import frappe
from frappe.utils import now_datetime, sbool
from frappe.utils.background_jobs import get_redis_conn

from suite.suite_core.collab import compaction
from suite.suite_core.collab.log import ChainBroken, read
from suite.suite_core.collab.tables import table

STATE_MAX = 4 * 2**20
TAIL_MIN = 256 * 2**10
TAIL_ROWS = 2000
AGE = timedelta(minutes=10)
QUIET = timedelta(seconds=30)
SWEEP_AGE = timedelta(minutes=30)
TIMEOUT = 120
PLACES = 2
PER_COMPACTION = 240 * 2**20
LEASE = TIMEOUT + 90
PACED_FROM = 512 * 2**10
ALERT_AT = 3
CGROUP = "/sys/fs/cgroup"


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
        if snapshot is None or snapshot["head_rev"] == snapshot["base"]:
            raise Skipped
        through = snapshot["head_rev"]
        rows = [payload for _rev, payload in snapshot["rows"]]
        result = compaction.compact(snapshot["checkpoint"], rows, roots)
        report = {**result.report, "ms": int((time.monotonic() - started) * 1000)}
        sha = store(adapter, doc_id, through, snapshot["head_chain"], result, report, roots)
        install(adapter, doc_id, snapshot["lineage"], through, snapshot["head_chain"], sha, result, report)
    except Skipped:
        frappe.db.rollback()
        settle(adapter, doc_id)
    except Exception as error:
        frappe.db.rollback()
        reason = (
            error.reason
            if isinstance(error, compaction.CompactionFailed | ChainBroken)
            else type(error).__name__
        )
        failed(adapter, doc_id, through, reason, error)


def consider(adapter: str, doc_id: str, method: str, *, final_from: str | None = None) -> None:
    """Request a compaction if the document is due. `final_from` names a tab's session that is hiding or closing."""
    doc = frappe.db.sql(
        f"""SELECT `d`.`head_rev`, `d`.`checkpoint_rev`, `d`.`state_bytes`, `d`.`tail_rows`, `d`.`tail_bytes`,
        `d`.`tail_bound`, `d`.`next_compaction_at`, `u`.`created` AS `oldest`
        FROM `{table(adapter, "doc")}` `d` LEFT JOIN `{table(adapter, "update")}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`checkpoint_rev` + 1
        WHERE `d`.`id` = %s""",
        doc_id,
        as_dict=True,
    )
    if not doc:
        return
    others_quiet = False
    if final_from:
        others_quiet = not frappe.db.sql(
            f"""SELECT 1 FROM `{table(adapter, "session")}` WHERE `doc_id` = %s AND `sid` != %s
            AND `last_push_at` > %s LIMIT 1""",
            (doc_id, final_from, now_datetime() - QUIET),
        )
    if due(doc[0], now_datetime(), final=others_quiet):
        request(adapter, doc_id, method)


def due(doc, now, *, final: bool = False) -> bool:
    """Whether a document's tail calls for a compaction now.

    The bound threshold is hysteresis: a compaction runs once the tail has used
    half the room left under the cap, so a document near the cap waits for a
    real tail instead of compacting after every push.
    """
    if int(doc.head_rev) == int(doc.checkpoint_rev):
        return False
    if doc.next_compaction_at and doc.next_compaction_at > now:
        return False
    state = int(doc.state_bytes)
    return (
        final
        or int(doc.tail_bytes) >= max(TAIL_MIN, state // 4)
        or int(doc.tail_rows) >= TAIL_ROWS
        or int(doc.tail_bound) >= max(TAIL_MIN, (STATE_MAX - state) // 2)
        or (doc.oldest is not None and doc.oldest <= now - AGE)
    )


def sweep(adapter: str, method: str, limit: int = 100) -> None:
    """Request compactions for documents whose tail has waited too long, whatever their traffic."""
    now = now_datetime()
    for (doc_id,) in frappe.db.sql(
        f"""SELECT `d`.`id` FROM `{table(adapter, "doc")}` `d` JOIN `{table(adapter, "update")}` `u`
        ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`checkpoint_rev` + 1
        WHERE `d`.`head_rev` > `d`.`checkpoint_rev` AND `u`.`created` <= %s
        AND (`d`.`next_compaction_at` IS NULL OR `d`.`next_compaction_at` <= %s)
        ORDER BY `u`.`created` LIMIT %s""",
        (now - SWEEP_AGE, now, limit),
    ):
        request(adapter, doc_id, method)


def request(adapter: str, doc_id: str, method: str) -> None:
    """Enqueue `method(doc_id)` once per document; it runs `run` with the product's roots."""
    queue = "collab" if "collab" in frappe.conf.get("workers", {}) else "default"
    try:
        frappe.enqueue(
            method,
            queue=queue,
            timeout=TIMEOUT,
            job_id=f"suite-collab-compact-{adapter}-{doc_id}",
            deduplicate=True,
            doc_id=doc_id,
        )
    except Exception:
        # A request is only a hint, so the open or push that made it carries on
        frappe.log_error(
            title="Collab compaction: request failed",
            reference_doctype="Suite Collab Settings",
            defer_insert=True,
        )


def store(adapter: str, doc_id: str, through: int, chain: bytes, result, report: dict, roots) -> bytes:
    """T2: the checkpoint row, unreferenced until the install; answers its sha, which names it to the install.

    A row already at this rev was left by an attempt that never installed. It is
    kept only if it holds the same document on the same chain and is as
    integrated as this result; otherwise this result replaces it.
    """
    existing = frappe.db.sql(
        f"""SELECT `gz`, `sha256`, `chain`, `integrated` FROM `{table(adapter, "checkpoint")}`
        WHERE `doc_id` = %s AND `through_rev` = %s""",
        (doc_id, through),
    )
    if existing:
        gz, sha, stored_chain, integrated = existing[0]
        if (
            bytes(stored_chain) == chain
            and int(integrated) == int(result.integrated)
            and compaction.same(gzip.decompress(bytes(gz)), result.state, roots)
        ):
            return bytes(sha)
        frappe.db.sql(
            f"DELETE FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)",
            (doc_id, through, bytes(sha).hex()),
        )
    sha = hashlib.sha256(result.state).digest()
    frappe.db.sql(
        f"""INSERT INTO `{table(adapter, "checkpoint")}`
        (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
        VALUES (%s, %s, UNHEX(%s), UNHEX(%s), %s, '', %s, %s, %s, %s)""",
        (
            doc_id,
            through,
            chain.hex(),
            sha.hex(),
            len(result.state),
            int(result.integrated),
            compaction.KERNEL,
            json.dumps(report),
            now_datetime(),
        ),
    )
    # In parts of a quarter packet, since hex doubles each one; every part rewrites the whole blob
    gz = gzip.compress(result.state)
    part = int(frappe.db.sql("SELECT @@max_allowed_packet")[0][0]) // 4
    for start in range(0, len(gz), part):
        frappe.db.sql(
            f"""UPDATE `{table(adapter, "checkpoint")}` SET `gz` = CONCAT(`gz`, UNHEX(%s))
            WHERE `doc_id` = %s AND `through_rev` = %s AND `sha256` = UNHEX(%s)""",
            (gz[start : start + part].hex(), doc_id, through, sha.hex()),
        )
    # A server not in strict mode empties a CONCAT past max_allowed_packet with only a warning
    stored = frappe.db.sql(
        f"SELECT LENGTH(`gz`) FROM `{table(adapter, 'checkpoint')}` WHERE `doc_id` = %s AND `through_rev` = %s",
        (doc_id, through),
    )[0][0]
    if stored != len(gz):
        raise compaction.CompactionFailed("too_large")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return sha


def install(
    adapter: str, doc_id: str, lineage: str, through: int, chain: bytes, sha: bytes, result, report: dict
) -> None:
    """T3b: point the control row at the checkpoint row `sha` names.

    Nothing changes if a newer compaction or another lineage got there first, or
    if that row is gone. A deadlock or lock wait retries this short step only.
    """
    for attempt in range(3):
        try:
            installed = point_at(adapter, doc_id, lineage, through, chain, sha, result, report)
            break
        except Exception as error:
            frappe.db.rollback()
            if attempt == 2 or not (frappe.db.is_deadlocked(error) or frappe.db.is_timedout(error)):
                raise
    if installed and not result.integrated:
        alert(adapter, doc_id, "fallback", "The compaction kept the merged rows as an open base only")


def point_at(
    adapter: str, doc_id: str, lineage: str, through: int, chain: bytes, sha: bytes, result, report: dict
) -> bool:
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
        WHERE `id` = %(doc)s AND `lineage` = %(lineage)s AND `checkpoint_rev` < %(through)s
        AND EXISTS (SELECT 1 FROM `{table(adapter, "checkpoint")}` WHERE `doc_id` = %(doc)s
            AND `through_rev` = %(through)s AND `sha256` = UNHEX(%(sha)s))""",
        {
            "doc": doc_id,
            "sha": sha.hex(),
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
    return bool(installed)


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
RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"


def take_place(adapter: str, doc_id: str) -> tuple[str, list[str]] | None:
    """One place of `PLACES`, and the document's own key so two jobs never compact it at once.

    Both hold a token of this job's own, so a job that outlived its lease can't
    free a place another job has since taken.
    """
    redis = get_redis_conn()
    token = secrets.token_hex(16)
    own = f"suite:collab:compacting:{frappe.local.site}:{adapter}:{doc_id}"
    if not redis.set(own, token, nx=True, ex=LEASE):
        return None
    for index in range(PLACES):
        key = f"suite:collab:compaction:{index}"
        if redis.set(key, token, nx=True, ex=LEASE):
            return token, [key, own]
    redis.eval(RELEASE, 1, own, token)
    return None


def free_place(held: tuple[str, list[str]]) -> None:
    token, keys = held
    redis = get_redis_conn()
    for key in keys:
        redis.eval(RELEASE, 1, key, token)


def enough_memory() -> bool:
    """With every place compacting, 20% of the container must stay free. True where the cgroup can't be read."""
    try:
        with open(f"{CGROUP}/memory.max") as limit_file:
            limit = limit_file.read().strip()
        with open(f"{CGROUP}/memory.stat") as stat_file:
            anon = next(int(line.split()[1]) for line in stat_file if line.startswith("anon "))
    except (OSError, StopIteration, ValueError):
        return True
    if limit == "max":
        return True
    limit = int(limit)
    return limit - anon - PLACES * PER_COMPACTION >= limit // 5


def limit_memory() -> None:
    """Cap this work horse's address space, on Linux and only in a forked horse."""
    if sbool(os.environ.get("FRAPPE_BACKGROUND_WORKERS_NOFORK", False)):
        return
    try:
        with open("/proc/self/status") as status:
            size = next(int(line.split()[1]) * 1024 for line in status if line.startswith("VmSize:"))
        resource.setrlimit(resource.RLIMIT_AS, (size + PER_COMPACTION, resource.RLIM_INFINITY))
    except (OSError, StopIteration, ValueError):
        pass
