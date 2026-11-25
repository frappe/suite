"""What each content route does once the caller has checked access to the node: a frame answers as bytes,
anything else as a status and a JSON body, and a refusal raises `Refusal`."""

import hashlib
import json
import uuid
from collections.abc import Callable
from http import HTTPStatus

import frappe
import pycrdt
from frappe import _
from frappe.query_builder import Table
from frappe.query_builder.functions import Coalesce

from suite.content import (
    copies,
    jobs,
    live,
    log,
    restore_notice,
    restores,
    scheduling,
    sessions,
    stage,
    suspect,
    touches,
)
from suite.content.editors import spec_of
from suite.content.pushes import push, put_piece
from suite.content.snapshot import Snapshot, read, rows_after, with_tombstones
from suite.content.tables import table
from suite.content.wire import (
    PROTOCOL_VERSION,
    PushHeader,
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
        jobs.request_conversion(app, node)
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
    notice = restore_notice.for_reader(app, doc.id, node)
    return encode_frame({**pull_header(app, doc, epoch), **notice}, rows)


def push_rows(node: str, body: bytes, authorize: Callable[[object], str]) -> tuple[int, dict]:
    """`authorize` checks the user the push names may edit `node`, and answers its app."""
    header, payload = parse_push(body)
    app = authorize(header.expected_user)
    return 200, push_and_follow(app, logged_doc(app, node), header, payload)


def write(app: str, node: str, change: Callable[[pycrdt.Doc], None]) -> int:
    """Push what `change` does to the document as the request's user, as a tab would, and answer its rev."""
    # The caller has checked access
    doc = logged_doc(app, node)
    log_read = read(app, doc.id)
    if log_read is None:
        raise log.Refusal(404, "not_found")

    sid = uuid.uuid4().hex
    client_id = sessions.issue_session(app, doc.id, sid, frappe.session.user)
    payload = own_update(log_read, client_id, change)
    header = PushHeader(
        lineage=log_read.lineage,
        sid=sid,
        seq_from=1,
        seq_to=1,
        client_id=client_id,
        seen_rev=log_read.head_rev,
        schema=spec_of(app).schema.version,
        shas=[hashlib.sha256(payload).digest()],
        stage_id=None,
        # The session's only push, so it waits its turn and compaction can close the session
        is_final=True,
        restore=None,
        expected_user=None,
    )
    answer = push_and_follow(app, doc, header, payload)
    rev = int(answer["rev"])
    copies.follow_write(app, doc.id, rev, log_read.lineage, log_read.q_epoch, is_wanted=answer["copy"])
    return rev


def own_update(log_read: Snapshot, client_id: int, change: Callable[[pycrdt.Doc], None]) -> bytes:
    """Answer the one update `change` makes to the read's document, as the writer `client_id`."""
    state: pycrdt.Doc = pycrdt.Doc(client_id=client_id)
    if log_read.checkpoint:
        state.apply_update(log_read.checkpoint)

    for payload in log_read.payloads():
        state.apply_update(payload)

    updates: list[bytes] = []
    state.observe(lambda event: updates.append(event.update))
    with state.transaction():
        change(state)

    if len(updates) != 1:
        # A change that does nothing makes no update
        raise log.Refusal(400, "malformed")

    return updates[0]


def push_and_follow(app: str, doc: frappe._dict, header: PushHeader, payload: bytes) -> dict:
    """Push the rows, then do what is due after them: followers and compaction."""
    try:
        answer = push(app, doc.id, doc.head_rev, header, payload, frappe.session.user)
    except log.Refusal as refusal:
        if refusal.body["collab"] == "compacting":
            scheduling.request_if_due(app, doc.id, jobs.COMPACT, refused=True)

        raise

    pushed = due_after_push(app, doc.id)
    answer["copy"] = bool(pushed) and copies.wanted_on(app, pushed)
    if not pushed:
        return answer

    for follower in (touches.TOUCH, touches.VERSION):
        if touches.due(pushed, follower):
            touches.follow(app, doc.id, follower)

    final_from = None
    if header.is_final:
        final_from = header.sid

    scheduling.request_on(app, doc.id, pushed, jobs.COMPACT, final_from=final_from)
    return answer


def due_after_push(app: str, doc_id: str) -> frappe._dict | None:
    """Read in one query what a push checks after it commits: followers, the copy and compaction."""
    based = scheduling.docs_with_base(app, lambda doc: doc.id == doc_id)
    docs = based.docs
    due_columns = based.due_columns()
    projection = Table(table(app, "projection")).as_("p")
    found = (
        based.query.left_join(projection)  # type: ignore[operator]  # the chain's .run(): frappe adds run() at runtime
        .on(projection.doc_id == docs.id)
        .select(
            *due_columns,
            docs.mode,
            docs.touched_at,
            docs.touched_rev,
            docs.versioned_at,
            docs.versioned_rev,
            Coalesce(projection.projected_rev, 0).as_("projected_rev"),
            projection.updated.as_("copied_at"),
        )
        .run(as_dict=True)
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
    if type(seen_rev) is not int or type(version) is not int or version < 1:
        raise log.Refusal(400, "malformed")

    restored = restore_notice.restored_version(node, version)
    fence = restores.begin(app, doc.id, seen_rev)
    restore_notice.hold(app, doc.id, fence["token"], restored)
    if not fence["has_milestone"]:
        label = restore_notice.before_restoring_label(restored, version)
        take_milestone(app, doc.id, node, label, fence)

    return 200, {"token": fence["token"], "base_rev": fence["base_rev"], "fence_ms": fence["fence_ms"]}


def take_milestone(app: str, doc_id: str, node: str, label: str, fence: dict) -> None:
    """Nothing is restored without a version of the head first; a refused one lifts the fence."""
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
