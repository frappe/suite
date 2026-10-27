"""Run a product's Node converter, which turns an old document into a collaborative one.

The child runs through the checker's `ask` (suite.content.checker), with its empty environment, heap
limit and timeout, and it can't read files other than its bundle, write files or start processes.

Unlike the checker, the converter bundles jsdom, so the child can load Node's network modules. It
drops fetch, WebSocket, EventSource and XMLHttpRequest before it reads its input, and the editor
parses old HTML into a document that loads nothing, which test_converter checks against the built
bundle with a listening socket. This guards against network use by mistake, not against a
compromised child.

A bundle is used only when it holds the version the server expects, so one built before a version
bump is refused.

A conversion either converts or is refused with a reason: the converter's own (check, too_large,
unreadable-yjs), or the child's failure (child_crash, child_timeout, bad_answer). `dropped` holds
document text, the words of a pending edit or a comment's copy, so it goes only to the conversion's
record, never to a log or report.

`pending_page` loads the pages `run_pending` (suite.content.conversions) converts: the app's documents
that have no log, newest first, past any this converter refused unless the row changed after the refused
attempt began or since the `modified` a later run last found its body unchanged at.

Without Node, or with the scheduler off, nothing converts. `check_before_migrate` prints each cause on
every migrate, and System Managers get one notification per cause until it is fixed.
"""

import base64
import contextlib
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeGuard

import frappe
from frappe.desk.doctype.notification_log.notification_log import make_notification_logs
from frappe.utils.scheduler import is_scheduler_disabled
from frappe.utils.user import get_system_managers

from suite import drive
from suite.content import capacity, checker, log
from suite.content.editors import Conversion, editors, spec_of
from suite.content.tables import KINDS, table

# The oldest Node the converter runs on, the first whose --permission is stable; CI runs it there
NODE_MIN = (22, 13)
CONVERTER_REASONS = frozenset({"check", "too_large", "unreadable-yjs"})
PAGE = 25
# No new child starts after this; with the child's 120 s cap a run ends well inside the queue's 1500 s
RUN_FOR = 600
TIMEOUT = 1500
# What stops every conversion, by cause; System Managers are told the cause, never any document's data
BLOCKS = {"node": "Node 22.13 or newer is missing", "scheduler": "the scheduler is off"}


class ConverterChanged(Exception):
    """The bundle holds another converter version than the run expects, so the run stops."""


@dataclass(frozen=True)
class Converted:
    state: bytes = field(repr=False)
    # "yjs" or "html", the part of the old body the state was made from
    source: str
    dropped: list[dict] = field(repr=False)
    anchors: dict[str, str] = field(repr=False)
    threads: list[dict] = field(repr=False)
    # The readable copy a live tab writes for `state`
    html: str = field(repr=False)


@dataclass(frozen=True)
class Refused:
    reason: str


def may_convert(app: str, *, lock: bool = False) -> bool:
    """Whether the app is on and unpaused; lock=True takes a current read that locks its row until the next commit."""
    row = {"parent": "Suite Collab Settings", "parentfield": "apps", "app": app}
    if not lock:
        return log.enabled(app) and not frappe.db.get_value("Suite Collab App", row, "conversion_paused")

    # A lock by filter would hold every app's row and the gaps between them
    name = frappe.db.get_value("Suite Collab App", row)
    fields = ["mode", "conversion_paused"]
    switch = name and frappe.db.get_value("Suite Collab App", name, fields, as_dict=True, for_update=True)
    return bool(switch) and switch.mode == "on" and not switch.conversion_paused


def converter_ready(app: str, conversion: Conversion) -> bool:
    """Whether Node and the converter bundle of this version are here; logs why not."""
    if checker.usable_node(NODE_MIN) is None:
        report_block("node")
        log_reason(app, BLOCKS["node"])
        return False

    clear_block("node")
    try:
        ready = bundle_ready(conversion.build, conversion.version)
    except checker.CheckerFailed:
        ready = False

    if not ready:
        log_reason(app, "no converter bundle of this version")

    return ready


def missing_prerequisite(app: str) -> str | None:
    """Name the first thing the site lacks to convert the app's documents: MariaDB or a content table, or None."""
    if frappe.db.db_type != "mariadb":
        return "the database isn't MariaDB"

    present = set(frappe.db.get_tables(cached=False))
    for kind in KINDS:
        name = table(app, kind)
        if name not in present:
            return f"content table {name} is missing"

    return None


def pending_page(app: str, version: str, after: frappe._dict | None) -> list[frappe._dict]:
    """Load the next page of the app's untrashed documents with no live log or refusal, newest first, after `after`."""
    doctype = spec_of(app).doctype
    node_field = drive.node_field(doctype)
    doc_table = table(app, "doc")
    conversion_table = table(app, "conversion")
    since = ""
    values: tuple = (version,)
    if after is not None:
        since = "AND (`row`.`modified` < %s OR (`row`.`modified` = %s AND `row`.`name` < %s))"
        values = (version, after.modified, after.modified, after.name)

    return frappe.db.sql(
        f"""SELECT `row`.`name`, `row`.`modified`, `row`.`{node_field}` AS `node`
        FROM `tab{doctype}` `row`
        JOIN `tabDrive Node` `node` ON `node`.`name` = `row`.`{node_field}` AND `node`.`state` = 'Active'
        LEFT JOIN `{doc_table}` `doc` ON `doc`.`node` = `row`.`{node_field}` AND `doc`.`mode` != 'purged'
        WHERE `row`.`{node_field}` IS NOT NULL AND `doc`.`id` IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM `{conversion_table}` `record` WHERE `record`.`node` = `row`.`{node_field}`
            AND `record`.`converter_version` = %s AND `record`.`outcome` IS NOT NULL
            AND (`record`.`checked` >= `row`.`modified` OR `record`.`started` > `row`.`modified`)
        ) {since}
        ORDER BY `row`.`modified` DESC, `row`.`name` DESC
        LIMIT {PAGE}""",
        values,
        as_dict=True,
    )


def log_reason(app: str, reason: str) -> None:
    """Log why the app's conversion didn't run, once an hour for each reason."""
    key = f"suite-convert-{app}-{reason}"
    if frappe.cache.get_value(key):
        return

    frappe.cache.set_value(key, 1, expires_in_sec=3600)
    frappe.log_error(
        title=f"Collab conversion: {app} did not run",
        message=reason,
        reference_doctype="Suite Collab Settings",
    )


def check_before_migrate() -> None:
    """Print what stops documents waiting to convert, and tell System Managers once; quiet when it can't check yet."""
    with contextlib.suppress(Exception):
        tell_blocks()


def check_after_migrate() -> None:
    """Check as before_migrate does unless it already told this migrate, as on a first upgrade; never raises."""
    if frappe.flags.suite_collab_blocks_checked:
        return

    try:
        tell_blocks()
    except Exception as error:
        print(f"Couldn't check whether collaborative documents can be upgraded: {type(error).__name__}")


def tell_blocks() -> None:
    """Print each cause stopping documents that wait to convert, telling System Managers once; forget fixed ones."""
    if not any_waiting():
        return

    causes = {
        "node": checker.usable_node(NODE_MIN) is None,
        "scheduler": is_scheduler_disabled(verbose=False),
    }
    for cause, is_blocked in causes.items():
        if not is_blocked:
            clear_block(cause)
            continue

        print(f"Collaborative documents can't be upgraded: {BLOCKS[cause]}")
        report_block(cause)

    frappe.flags.suite_collab_blocks_checked = True


def any_waiting() -> bool:
    """Whether an app with collaboration on has a document waiting to convert."""
    for app, spec in editors().items():
        if spec.conversion and may_convert(app) and pending_page(app, spec.conversion.version, None):
            return True

    return False


def blocked_cause() -> str | None:
    """Return the first cause stopping every conversion, as System Managers were told it, or None."""
    return next((cause for cause in BLOCKS if frappe.db.get_global(block_key(cause))), None)


def report_block(cause: str) -> None:
    """Tell System Managers `cause` stops conversions, once until it is cleared."""
    if frappe.db.get_global(block_key(cause)):
        return

    notice = {
        "type": "Alert",
        "document_type": "Suite Collab Settings",
        "document_name": "Suite Collab Settings",
        "subject": f"Collaborative documents can't be upgraded: {BLOCKS[cause]}",
    }
    make_notification_logs(notice, get_system_managers(only_name=True))
    frappe.db.set_global(block_key(cause), 1)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def clear_block(cause: str) -> None:
    """Forget `cause` once it is fixed, so it is told again if it comes back."""
    if frappe.db.get_global(block_key(cause)):
        frappe.db.set_global(block_key(cause), None)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit


def block_key(cause: str) -> str:
    """Name the global default that holds whether System Managers were told `cause`."""
    return f"suite_collab_blocked_{cause}"


def bundle_ready(bundle: Path, version: str) -> bool:
    """Whether `bundle` holds converter `version`; False without Node or it, CheckerFailed if it fails."""
    answer = checker.ask(bundle, {}, minimum=NODE_MIN)
    return answer is not None and answer.get("version") == version


def convert(
    bundle: Path, version: str, legacy: dict, max_state: int = capacity.STATE_MAX
) -> Converted | Refused | None:
    """Convert the old body `legacy`; None without Node or the bundle, ConverterChanged on a new version."""
    request = {"legacy": {**legacy, "collab": legacy["collab"] or 0}, "maxState": max_state}
    try:
        answer = checker.ask(bundle, request, minimum=NODE_MIN)
    except checker.CheckerBusy:
        raise
    except checker.CheckerFailed as error:
        return Refused(failure_reason(error.__cause__))

    if answer is None:
        return None

    answered = answer.get("version")
    if answered != version:
        shown = checker.plain_reason(str(answered))
        raise ConverterChanged(f"the bundle answered version {shown}, not {version}")

    return read_answer(answer, max_state)


def failure_reason(error: BaseException | None) -> str:
    """Name what the child did, from the error checker.ask failed with."""
    if isinstance(error, subprocess.TimeoutExpired):
        return "child_timeout"

    if isinstance(error, ValueError):
        return "bad_answer"

    return "child_crash"


def read_answer(answer: dict, max_state: int) -> Converted | Refused:
    """Read the converter's answer, refusing as bad_answer one of another shape."""
    if answer.get("kind") == "failed" and answer.get("reason") in CONVERTER_REASONS:
        return Refused(answer["reason"])

    try:
        state = base64.b64decode(answer["state"], validate=True)
    except (KeyError, TypeError, ValueError):
        return Refused("bad_answer")

    if answer.get("kind") != "converted" or not 0 < len(state) <= max_state or not is_well_formed(answer):
        return Refused("bad_answer")

    return Converted(
        state, answer["from"], answer["dropped"], answer["anchors"], answer["threads"], answer["html"]
    )


def is_well_formed(answer: dict) -> bool:
    """Whether each part of the converter's `answer` has the type the converter writes."""
    dropped = answer.get("dropped")
    threads = answer.get("threads")
    anchors = answer.get("anchors")
    return (
        answer.get("from") in {"yjs", "html"}
        and is_list_of_objects(dropped)
        and all(isinstance(drop.get("kind"), str) for drop in dropped)
        and is_list_of_objects(threads)
        and all(is_thread(thread) for thread in threads)
        and isinstance(answer.get("html"), str)
        and isinstance(anchors, dict)
        and all(isinstance(key, str) and isinstance(value, str) for key, value in anchors.items())
    )


def is_thread(thread: dict) -> bool:
    """Whether `thread` is a 2023 thread with its key, anchor and comments as the converter writes them."""
    comments = thread.get("comments")
    return (
        isinstance(thread.get("key"), str)
        and isinstance(thread.get("anchor"), str)
        and is_list_of_objects(comments)
        and all(is_comment(comment) for comment in comments)
    )


def is_comment(comment: dict) -> bool:
    """Whether `comment` has its text, author's name and time as the converter writes them."""
    time = comment.get("time")
    return (
        isinstance(comment.get("content"), str)
        and isinstance(comment.get("authorName"), str)
        and isinstance(time, int | float)
        and not isinstance(time, bool)
    )


def is_list_of_objects(value: object) -> TypeGuard[list[dict]]:
    """Whether `value` is a list of JSON objects."""
    return isinstance(value, list) and all(isinstance(item, dict) for item in value)
