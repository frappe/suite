"""An app's conversion records, one per old body and converter version, in the app's own table.

`run_pending` is the scheduled job's loop: it pages through the app's documents that have no log, newest
first, and hands each to `convert_document`, which converts one document. It passes over a document this
converter refused unless the row changed after the refused attempt began.

`convert_document` runs the app's converter on the old body the app's `read_old` answers, and installs
the answer in one transaction under the row's lock: the app's `check` refuses before the first write,
"Before collaboration" is kept, the log starts from the answer, the app's `fix_up` runs and the readable
copy is written last. A refusal rolls back and writes only its record.

A record with no outcome is an attempt in progress, committed before the converter runs, so a worker
that dies on a body leaves it, and a later run records that body `crashed`.
A run that fails on a body counts the failure on its record, so a body fails FAILURES times under each
converter version before it is recorded with an outcome. Only `retry_over_quota` clears a refusal, an
over_quota one, once space is freed. The record keeps `dropped`, which holds document text, so it goes
nowhere else.
"""

import json
import time
from datetime import datetime, timedelta
from typing import NotRequired, TypedDict

import frappe
from frappe import _
from frappe.query_builder import Table
from frappe.utils import now_datetime
from pypika.terms import Criterion, Values

from suite import drive
from suite.content import checker, convert, copies, live, log, selftest
from suite.content.checkpoints import replace_start
from suite.content.db import changed_rows, insert_into
from suite.content.editors import CheckedBody, Conversion, OldBody, spec_of
from suite.content.tables import table

# How many runs fail on a body under one converter version before it is recorded `crashed`
FAILURES = 3
# How many times a row that changes under the converter is read again before the next run takes it
ATTEMPTS = 3
# An attempt this old with no outcome is one whose worker died on it, past the job's 1500 s timeout
STALE_ATTEMPT = timedelta(seconds=1500)
# Child failures that can clear up by themselves, so they count as failures rather than end the attempt
PASSING = frozenset({"child_timeout", "child_crash"})
CHANGED = "changed"
LOGGED = "logged"


def open_attempt(conversion: Table, node: str, fingerprint: str, version: str) -> Criterion:
    """Match this body's record under this converter while it has no outcome."""
    return (
        (conversion.node == node)
        & (conversion.fingerprint == fingerprint)
        & (conversion.converter_version == version)
        & conversion.outcome.isnull()
    )


class ConversionStatus(TypedDict):
    state: str
    reason: NotRequired[str]
    rooms: NotRequired[live.Rooms]


class ConversionRefused(Exception):
    def __init__(self, outcome: str, reason: str | None = None) -> None:
        super().__init__(outcome)
        self.outcome = outcome
        self.reason = reason


def conversion_of(app: str) -> Conversion:
    """Return the app's conversion; only an app with old documents to convert gets here."""
    conversion = spec_of(app).conversion
    assert conversion is not None
    return conversion


def run_pending(app: str, conversion: Conversion) -> None:
    """Convert the app's documents that have no log, page by page, until none is left or time runs out."""
    convert.clear_block("scheduler")
    deadline = time.monotonic() + convert.RUN_FOR
    missing = convert.missing_prerequisite(app)
    if missing:
        convert.log_reason(app, missing)
        return

    page = convert.pending_page(app, conversion.version, None)
    if not page:
        return

    fault = selftest.self_test_fault()
    if fault:
        convert.log_reason(app, f"the collaboration self-test fails: {fault}")
        return

    if not convert.converter_ready(app, conversion):
        return

    while page and convert_page(app, page, deadline):
        page = convert.pending_page(app, conversion.version, page[-1])


def convert_page(app: str, page: list[frappe._dict], deadline: float) -> bool:
    """Convert each document on `page`; False once time runs out, the app pauses or the converter changes."""
    for row in page:
        # Locks the app row before read_old's document row; run_converter's or mark_checked's commit releases it
        if time.monotonic() > deadline or not convert.may_convert(app, lock=True):
            return False

        try:
            convert_document(app, row.node)
        except convert.ConverterChanged as changed:
            convert.log_reason(app, str(changed))
            return False
        except Exception as error:
            frappe.db.rollback()
            convert.log_reason(app, f"{row.node}: {type(error).__name__}")

    return True


def convert_document(app: str, node: str) -> str | None:
    """Convert `node`'s old body, reading it again if it changes; the outcome, or None to leave it to the next run."""
    conversion = conversion_of(app)
    started = now_datetime()
    for _attempt in range(ATTEMPTS):
        old = conversion.read_old(node)
        if old is None:
            return None

        held = held_attempt(app, node, old.fingerprint)
        if held is not None and not has_failed(held):
            if held.outcome is not None:
                mark_checked(app, node, old.fingerprint, old.modified)

            return crashed_outcome(app, node, old.fingerprint, held, started)

        converted = run_converter(app, node, old, started, retry=held is not None)
        if converted is None:
            return None

        if isinstance(converted, convert.Refused):
            return refused_outcome(app, node, old.fingerprint, converted.reason, started)

        outcome = install_conversion(app, node, old, converted, started)
        if outcome != CHANGED:
            return outcome

        # drop_attempt's commit let go of the app row, so an off-save may have landed since
        if not convert.may_convert(app, lock=True):
            return None

    return None


def refused_outcome(app: str, node: str, fingerprint: str, reason: str, started: datetime) -> str | None:
    """Count a child failure that can clear up by itself; record any other refusal and tell the rooms."""
    if reason in PASSING:
        return count_failure(app, node, fingerprint, reason)

    record(app, node, fingerprint, started, reason)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_conversion(app, node, "refused")
    return reason


def crashed_outcome(app: str, node: str, fingerprint: str, held: frappe._dict, now: datetime) -> str | None:
    """Record a held attempt with no outcome that is past its job's timeout as `crashed`; skip any other."""
    if held.outcome is not None or now - held.started <= STALE_ATTEMPT:
        return None

    record(app, node, fingerprint, held.started, "crashed")
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_conversion(app, node, "refused")
    return "crashed"


def has_failed(held: frappe._dict) -> bool:
    """Whether a run failed on this attempt and ended it with no outcome, so the next run tries again."""
    return held.outcome is None and held.finished is not None


def run_converter(
    app: str, node: str, old: OldBody, started: datetime, retry: bool
) -> convert.Converted | convert.Refused | None:
    """Run the converter on `old` after committing its attempt, which goes again when it answers nothing."""
    conversion = conversion_of(app)
    start_attempt(app, node, old.fingerprint, started, retry)
    try:
        converted = convert.convert(conversion.build, conversion.version, old.legacy)
    except convert.ConverterChanged:
        drop_attempt(app, node, old.fingerprint)
        raise
    except checker.CheckerBusy:
        drop_attempt(app, node, old.fingerprint)
        return None
    except Exception:
        count_failure(app, node, old.fingerprint, "crashed")
        raise

    if converted is None:
        drop_attempt(app, node, old.fingerprint)

    return converted


def install_conversion(
    app: str, node: str, old: OldBody, converted: convert.Converted, started: datetime
) -> str:
    """Install `converted` whole or not at all: converted, a refusal, logged, or changed; the last two let the attempt go."""
    try:
        dropped = write_conversion(app, node, old, converted)
    except ConversionRefused as refused:
        frappe.db.rollback()
        record(app, node, old.fingerprint, started, refused.outcome, refused.reason)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        live.publish_conversion(app, node, "refused")
        return refused.outcome
    except Exception:
        frappe.db.rollback()
        count_failure(app, node, old.fingerprint, "crashed")
        raise

    if dropped is None:
        frappe.db.rollback()
        outcome = CHANGED if log.find(app, node) is None else LOGGED
        drop_attempt(app, node, old.fingerprint)
        return outcome

    record(app, node, old.fingerprint, started, "converted", dropped=dropped)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_conversion(app, node, "converted")
    return "converted"


def write_conversion(app: str, node: str, old: OldBody, converted: convert.Converted) -> list[dict] | None:
    """Check, then write, `converted` in the caller's transaction; what it dropped, or None if it can't start."""
    spec = spec_of(app)
    conversion = conversion_of(app)
    # an app with old documents to convert keeps a readable copy of them
    assert spec.readable_copy is not None
    if conversion.read_old(node, lock=True) != old or log.find(app, node):
        return None

    checked: CheckedBody = conversion.check(node, old, converted)
    keep_old_version(node)
    doc_id = log.create(app, node)
    replace_start(app, doc_id, converted.state, spec.schema.version)
    conversion.fix_up(node, old, checked)
    try:
        replaced = copies.replace_copy(app, doc_id, 1, checked.html, spec.readable_copy)
    except copies.CopyMismatch:
        raise ConversionRefused("check", "copy") from None

    if replaced is None:
        raise ConversionRefused("check", "copy")

    return [*converted.dropped, *checked.dropped]


def keep_old_version(node: str) -> None:
    """Keep the old body as a version before anything writes it."""
    try:
        drive.take_version(node, kind="milestone", label=_("Before collaboration"))
    except drive.DriveOverQuota:
        raise ConversionRefused("over_quota") from None


def conversion_status(app: str, node: str) -> ConversionStatus:
    """Answer whether the next run converts `node`'s body, with the rooms told its outcome, or this converter refused it; the reason for System Managers."""
    held = held_attempt(app, node, conversion_of(app).read_fingerprint(node))
    if held is None or held.outcome in {None, "converted"}:
        pending: ConversionStatus = {
            "state": "pending",
            "rooms": live.conversion_rooms(app, node),
        }
        cause = convert.blocked_cause()
        if cause and "System Manager" in frappe.get_roles():
            pending["reason"] = cause

        return pending

    status: ConversionStatus = {"state": "refused"}
    if "System Manager" in frappe.get_roles():
        status["reason"] = held.outcome
        if held.reason:
            status["reason"] = f"{held.outcome}: {held.reason}"

    return status


def conversion_started(app: str) -> bool:
    """Whether the app has a conversion record, refused or open; false again once purges delete them all."""
    conversion_table = table(app, "conversion")
    if conversion_table not in frappe.db.get_tables(cached=False):
        return False

    # Raw SQL: qb has no LOCK IN SHARE MODE
    return bool(frappe.db.sql(f"SELECT 1 FROM `{conversion_table}` LIMIT 1 LOCK IN SHARE MODE"))


def held_attempt(app: str, node: str, fingerprint: str) -> frappe._dict | None:
    """Load this body's record under this converter, when a run has already started on it."""
    conversion = Table(table(app, "conversion"))
    rows = (
        frappe.qb.from_(conversion)
        .select(conversion.started, conversion.finished, conversion.outcome, conversion.reason)
        .where(conversion.node == node)
        .where(conversion.fingerprint == fingerprint)
        .where(conversion.converter_version == conversion_of(app).version)
        .run(as_dict=True)
    )
    if not rows:
        return None

    return rows[0]


def start_attempt(app: str, node: str, fingerprint: str, started: datetime, retry: bool) -> None:
    """Commit a record with no outcome before the converter runs, so a worker that dies on it leaves a trace."""
    conversion = Table(table(app, "conversion"))
    version = conversion_of(app).version
    if retry:
        (
            frappe.qb.update(conversion)
            .set(conversion.started, started)
            .set(conversion.finished, None)
            .where(open_attempt(conversion, node, fingerprint, version))
            .run()
        )
    else:
        row = {"node": node, "fingerprint": fingerprint, "converter_version": version, "started": started}
        insert_into(table(app, "conversion"), row).run()

    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def count_failure(app: str, node: str, fingerprint: str, outcome: str) -> str | None:
    """Count a run's failure on this body's attempt; at FAILURES under this converter, record and answer `outcome`."""
    conversion = Table(table(app, "conversion"))
    key = (node, fingerprint, conversion_of(app).version)
    (
        frappe.qb.update(conversion)
        .set(conversion.failures, conversion.failures + 1)
        .set(conversion.finished, now_datetime())
        .where(open_attempt(conversion, *key))
        .run()
    )
    (
        frappe.qb.update(conversion)
        .set(conversion.outcome, outcome)
        .where(open_attempt(conversion, *key))
        .where(conversion.failures >= FAILURES)
        .run()
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    held = held_attempt(app, node, fingerprint)
    if held and held.outcome:
        live.publish_conversion(app, node, "refused")

    return held and held.outcome


def drop_attempt(app: str, node: str, fingerprint: str) -> None:
    """Let go of an attempt with no outcome: delete it, or keep the failures it counted for the next run."""
    conversion = Table(table(app, "conversion"))
    key = (node, fingerprint, conversion_of(app).version)
    frappe.qb.from_(conversion).delete().where(open_attempt(conversion, *key)).where(
        conversion.failures == 0
    ).run()
    frappe.qb.update(conversion).set(conversion.finished, now_datetime()).where(
        open_attempt(conversion, *key)
    ).run()
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def mark_checked(app: str, node: str, fingerprint: str, checked: datetime) -> None:
    """Keep the node's newest `modified` a run last found this body unchanged at, so the pager skips it until a row moves."""
    conversion = Table(table(app, "conversion"))
    (
        frappe.qb.update(conversion)
        .set(conversion.checked, checked)
        .where(conversion.node == node)
        .where(conversion.fingerprint == fingerprint)
        .where(conversion.converter_version == conversion_of(app).version)
        .run()
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def retry_over_quota(app: str) -> int:
    """Clear this converter's over_quota records, so the next run tries them again once space is freed."""
    conversion = Table(table(app, "conversion"))
    cleared = changed_rows(
        frappe.qb.from_(conversion)
        .delete()
        .where(conversion.outcome == "over_quota")
        .where(conversion.converter_version == conversion_of(app).version)
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return cleared


def record(
    app: str,
    node: str,
    fingerprint: str,
    started: datetime,
    outcome: str,
    reason: str | None = None,
    dropped: list[dict] | None = None,
) -> None:
    """Keep the outcome of converting this body with this converter, in the caller's transaction."""
    dropped_json = None
    if dropped is not None:
        dropped_json = json.dumps(dropped)

    query = insert_into(
        table(app, "conversion"),
        {
            "node": node,
            "fingerprint": fingerprint,
            "converter_version": conversion_of(app).version,
            "started": started,
            "finished": now_datetime(),
            "outcome": outcome,
            "reason": reason,
            "dropped": dropped_json,
        },
    )
    for column in ("started", "finished", "outcome", "reason", "dropped"):
        query = query.on_duplicate_key_update(column, Values(column))

    query.run()
