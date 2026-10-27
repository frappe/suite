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
from frappe.utils import now_datetime

from suite import drive
from suite.content import checker, convert, copies, live, log, selftest
from suite.content.checkpoints import replace_start
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
OPEN_ATTEMPT = "`node` = %s AND `fingerprint` = %s AND `converter_version` = %s AND `outcome` IS NULL"


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

    return bool(frappe.db.sql(f"SELECT 1 FROM `{conversion_table}` LIMIT 1 LOCK IN SHARE MODE"))


def held_attempt(app: str, node: str, fingerprint: str) -> frappe._dict | None:
    """Load this body's record under this converter, when a run has already started on it."""
    conversion_table = table(app, "conversion")
    rows = frappe.db.sql(
        f"""SELECT `started`, `finished`, `outcome`, `reason` FROM `{conversion_table}`
        WHERE `node` = %s AND `fingerprint` = %s AND `converter_version` = %s""",
        (node, fingerprint, conversion_of(app).version),
        as_dict=True,
    )
    if not rows:
        return None

    return rows[0]


def start_attempt(app: str, node: str, fingerprint: str, started: datetime, retry: bool) -> None:
    """Commit a record with no outcome before the converter runs, so a worker that dies on it leaves a trace."""
    conversion_table = table(app, "conversion")
    key = (node, fingerprint, conversion_of(app).version)
    if retry:
        frappe.db.sql(
            f"UPDATE `{conversion_table}` SET `started` = %s, `finished` = NULL WHERE {OPEN_ATTEMPT}",
            (started, *key),
        )
    else:
        frappe.db.sql(
            f"""INSERT INTO `{conversion_table}` (`node`, `fingerprint`, `converter_version`, `started`)
            VALUES (%s, %s, %s, %s)""",
            (*key, started),
        )

    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def count_failure(app: str, node: str, fingerprint: str, outcome: str) -> str | None:
    """Count a run's failure on this body's attempt; at FAILURES under this converter, record and answer `outcome`."""
    conversion_table = table(app, "conversion")
    key = (node, fingerprint, conversion_of(app).version)
    frappe.db.sql(
        f"UPDATE `{conversion_table}` SET `failures` = `failures` + 1, `finished` = %s WHERE {OPEN_ATTEMPT}",
        (now_datetime(), *key),
    )
    frappe.db.sql(
        f"UPDATE `{conversion_table}` SET `outcome` = %s WHERE {OPEN_ATTEMPT} AND `failures` >= %s",
        (outcome, *key, FAILURES),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    held = held_attempt(app, node, fingerprint)
    if held and held.outcome:
        live.publish_conversion(app, node, "refused")

    return held and held.outcome


def drop_attempt(app: str, node: str, fingerprint: str) -> None:
    """Let go of an attempt with no outcome: delete it, or keep the failures it counted for the next run."""
    conversion_table = table(app, "conversion")
    key = (node, fingerprint, conversion_of(app).version)
    frappe.db.sql(f"DELETE FROM `{conversion_table}` WHERE {OPEN_ATTEMPT} AND `failures` = 0", key)
    frappe.db.sql(
        f"UPDATE `{conversion_table}` SET `finished` = %s WHERE {OPEN_ATTEMPT}", (now_datetime(), *key)
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def mark_checked(app: str, node: str, fingerprint: str, checked: datetime) -> None:
    """Keep the node's newest `modified` a run last found this body unchanged at, so the pager skips it until a row moves."""
    conversion_table = table(app, "conversion")
    frappe.db.sql(
        f"""UPDATE `{conversion_table}` SET `checked` = %s
        WHERE `node` = %s AND `fingerprint` = %s AND `converter_version` = %s""",
        (checked, node, fingerprint, conversion_of(app).version),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def retry_over_quota(app: str) -> int:
    """Clear this converter's over_quota records, so the next run tries them again once space is freed."""
    conversion_table = table(app, "conversion")
    frappe.db.sql(
        f"DELETE FROM `{conversion_table}` WHERE `outcome` = 'over_quota' AND `converter_version` = %s",
        (conversion_of(app).version,),
    )
    [[cleared]] = frappe.db.sql("SELECT ROW_COUNT()")
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
    conversion_table = table(app, "conversion")
    dropped_json = None
    if dropped is not None:
        dropped_json = json.dumps(dropped)

    frappe.db.sql(
        f"""INSERT INTO `{conversion_table}`
        (`node`, `fingerprint`, `converter_version`, `started`, `finished`, `outcome`, `reason`, `dropped`)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE `started` = VALUES(`started`), `finished` = VALUES(`finished`),
        `outcome` = VALUES(`outcome`), `reason` = VALUES(`reason`), `dropped` = VALUES(`dropped`)""",
        (
            node,
            fingerprint,
            conversion_of(app).version,
            started,
            now_datetime(),
            outcome,
            reason,
            dropped_json,
        ),
    )
