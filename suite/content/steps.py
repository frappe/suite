"""What each content route does once the caller has checked access to the node: a frame answers as bytes,
anything else as a status and a JSON body, and a refusal raises `Refusal`."""

import json
from collections.abc import Callable
from http import HTTPStatus

import frappe
from frappe import _

from suite.content import copies, jobs, live, log, restores, scheduling, sessions, stage, suspect, touches
from suite.content.pushes import push, put_piece
from suite.content.snapshot import read, rows_after, with_tombstones
from suite.content.tables import table
from suite.content.wire import (
    PROTOCOL_VERSION,
    encode_frame,
    limits,
    open_header,
    parse_piece,
    parse_push,
)


def open_document(app: str, node: str, *, can_write: bool) -> bytes:
    """Open the document as one frame: its base and every row after it, or the state it is in."""
    if not log.enabled(app):
        return state_frame("disabled")

    doc = log.find(app, node)
    if doc is None:
        return state_frame("unconverted")

    try:
        snapshot = read(app, doc.id)
    except log.ChainBroken:
        frappe.log_error(title="Collab open: chain_break", message=f"{app} document {doc.id}")
        raise log.Refusal(503, "chain_break") from None

    if snapshot is None:
        return state_frame("unconverted")

    scheduling.request_if_due(app, doc.id, jobs.COMPACT)
    header = {**open_header(snapshot, can_write=can_write), **live_fields(app, doc)}
    return encode_frame(header, with_tombstones(snapshot), snapshot.checkpoint)


def parsed_cursor(since_rev: str | None, q_epoch: str | None) -> tuple[int, int | None]:
    """Parse a pull's rev and quarantine epoch, refusing either when it is not a number."""
    seen_epoch = None
    try:
        after_rev = int(since_rev or 0)
        if q_epoch is not None:
            seen_epoch = int(q_epoch)
    except ValueError:
        raise log.Refusal(400, "malformed") from None

    return after_rev, seen_epoch


def pull_header(app: str, doc: frappe._dict, epoch: int) -> dict:
    """Build a pull frame's header from the document's epoch, judgement, schema and live fields."""
    schema_steps = json.loads(doc.schema_steps)
    header = {
        "state": "live",
        "proto": PROTOCOL_VERSION,
        "q_epoch": epoch,
        "judged": int(doc.judged),
        "schema": schema_steps[-1][1],
        **live_fields(app, doc),
    }
    if doc.verdict:
        header["verdict"] = doc.verdict

    if doc.suspect_held:
        # Readers learn only whether one change or the document is in question; the cause is for admins
        header["held"] = "bad_checkpoint" if doc.suspect_held == "bad_checkpoint" else "change"

    return header


def pull_rows(app: str, node: str, since_rev: str | None, q_epoch: str | None) -> bytes:
    """Answer the rows after `since_rev`, or a rebuild frame when the tab's copy can't continue."""
    # The epoch is read before the rows, so a quarantine between them shows on the next pull
    doc = logged_doc(app, node)
    after_rev, seen_epoch = parsed_cursor(since_rev, q_epoch)
    epoch = int(doc.q_epoch)
    if seen_epoch is not None and seen_epoch < epoch:
        # The tab may hold a row now quarantined
        return state_frame("rebuild", q_epoch=epoch)

    if after_rev < int(doc.trimmed_rev):
        # Rows the tab still needs are gone; the body holds them
        return state_frame("rebuild", q_epoch=epoch)

    rows = rows_after(app, doc.id, max(after_rev, 0))
    scheduling.request_if_due(app, doc.id, jobs.COMPACT)
    return encode_frame(pull_header(app, doc, epoch), rows)


def push_rows(node: str, body: bytes, authorize: Callable[[object], str]) -> tuple[int, dict]:
    """`authorize` checks the user the push names may edit `node`, and answers its app."""
    header, payload = parse_push(body)
    app = authorize(header.expected_user)
    doc = logged_doc(app, node)
    try:
        answer = push(app, doc.id, doc.head_rev, header, payload, frappe.session.user)
    except log.Refusal as refusal:
        if refusal.body["collab"] == "compacting":
            scheduling.request_if_due(app, doc.id, jobs.COMPACT, refused=True)

        raise

    pushed = due_after_push(app, doc.id)
    answer["copy"] = bool(pushed) and copies.wanted_on(app, pushed)
    if not pushed:
        return 200, answer

    for follower in (touches.TOUCH, touches.VERSION):
        if touches.due(pushed, follower):
            touches.follow(app, doc.id, follower)

    final_from = None
    if header.is_final:
        final_from = header.sid

    scheduling.request_on(app, doc.id, pushed, jobs.COMPACT, final_from=final_from)
    return 200, answer


def due_after_push(app: str, doc_id: str) -> frappe._dict | None:
    """Read in one query what a push checks after it commits: followers, the copy and compaction."""
    doc_with_base = scheduling.docs_with_base(app, where="`doc`.`id` = %s")
    update_table = table(app, "update")
    projection_table = table(app, "projection")
    found = frappe.db.sql(
        f"""SELECT `d`.`mode`, `d`.`head_rev`, `d`.`base`, `d`.`state_bytes`, `d`.`tail_rows`, `d`.`tail_bytes`,
        `d`.`tail_bound`, `d`.`next_compaction_at`, `d`.`suspect`, `u`.`created` AS `oldest`,
        `d`.`touched_at`, `d`.`touched_rev`, `d`.`versioned_at`, `d`.`versioned_rev`,
        COALESCE(`p`.`projected_rev`, 0) AS `projected_rev`, `p`.`updated` AS `copied_at`
        FROM {doc_with_base} `d`
        LEFT JOIN `{update_table}` `u` ON `u`.`doc_id` = `d`.`id` AND `u`.`rev` = `d`.`base` + 1
        LEFT JOIN `{projection_table}` `p` ON `p`.`doc_id` = `d`.`id`""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return None

    return found[0]


def stage_piece(app: str, node: str, stage_id: str, piece_index: str, body: bytes) -> tuple[int, dict]:
    """Stage one piece of a change too big for one push."""
    log.require_enabled(app)
    piece = parse_piece(app, body, stage_id, piece_index)
    doc = require_log(app, node)
    return 200, put_piece(app, doc.id, stage_id, piece, frappe.session.user)


def report_suspect(app: str, node: str, body: dict) -> tuple[int, dict]:
    """Record that a tab's row threw when it applied it; anyone who can read the document may say so."""
    doc = logged_doc(app, node)
    rev = body.get("rev")
    if type(rev) is not int:
        raise log.Refusal(400, "malformed")

    return suspect.report_row(app, doc.id, rev, jobs.JUDGE)


def submit_render(app: str, node: str, body: dict) -> tuple[int, dict]:
    """Take an editing tab's staged render of the document at a rev, to be checked as its readable copy."""
    doc = logged_doc(app, node)
    status, answer = copies.submit(app, doc.id, body.get("stage_id"), frappe.session.user)
    if status == HTTPStatus.ACCEPTED:
        jobs.request_render_check(app, doc.id)

    return status, answer


def begin_restore(app: str, node: str, body: dict) -> tuple[int, dict]:
    """Fence the document for a restore of version `version`, after a version of what it holds now."""
    doc = logged_doc(app, node)
    seen_rev = body.get("seen_rev")
    version = body.get("version")
    if type(seen_rev) is not int or type(version) is not int:
        raise log.Refusal(400, "malformed")

    fence = restores.begin(app, doc.id, seen_rev)
    if not fence["has_milestone"]:
        take_milestone(app, doc.id, node, version, fence)

    return 200, {"token": fence["token"], "base_rev": fence["base_rev"], "fence_ms": fence["fence_ms"]}


def take_milestone(app: str, doc_id: str, node: str, version: int, fence: dict) -> None:
    """Nothing is restored without a version of the head first; a refused one lifts the fence."""
    label = _("Before restoring version {0}").format(version)
    try:
        touches.version_body(node, "milestone", label)
        restores.milestone_taken(app, doc_id, fence["head_chain"])
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except Exception:
        frappe.db.rollback()
        restores.cancel(app, doc_id, fence["token"])
        raise


def cancel_restore(app: str, node: str, body: dict) -> tuple[int, dict]:
    """Lift the fence the restoring tab set, when it gives up before sending the restore."""
    doc = logged_doc(app, node)
    token = body.get("token")
    if not isinstance(token, str):
        raise log.Refusal(400, "malformed")

    restores.cancel(app, doc.id, token)
    return 200, {"cancelled": 1}


def start_session(app: str, node: str, body: dict) -> tuple[int, dict]:
    """Issue the tab a session for its `sid`, or answer its `claim` on one."""
    doc = logged_doc(app, node)
    sid = body.get("sid")
    claim = body.get("claim")
    if not isinstance(sid, str) or len(sid) != stage.ID_LENGTH or not sid.isalnum():
        raise log.Refusal(400, "malformed")

    if claim is not None:
        claimed = sessions.claim_session(app, doc, sid, claim, frappe.session.user)
        return 200, {"claim": claimed}

    client_id = sessions.issue_session(app, doc.id, sid, frappe.session.user)
    return 200, {"client_id": client_id}


def live_fields(app: str, doc: frappe._dict) -> dict:
    """Answer what an open and a pull both tell the tab about the document now."""
    return {
        "limits": limits(app, doc),
        "rooms": live.rooms(app, doc.id, doc.lineage),
        **restores.header_fields(app, doc.id),
    }


def require_log(app: str, node: str) -> frappe._dict:
    """Load the node's log, refused as unconverted when it has none."""
    doc = log.find(app, node)
    if doc is None:
        raise log.Refusal(409, "unconverted")

    return doc


def logged_doc(app: str, node: str) -> frappe._dict:
    """Load the node's log, refused in order: collaboration off, no log."""
    log.require_enabled(app)
    return require_log(app, node)


def state_frame(state: str, **extra: int) -> bytes:
    """Build a frame with no rows that tells the tab what state the document is in."""
    return encode_frame({"state": state, "proto": PROTOCOL_VERSION, **extra})
