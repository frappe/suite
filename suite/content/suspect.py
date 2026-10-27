"""Documents a compaction can't take: find the row that breaks them and quarantine it, or hold them.

A compaction that throws, or that stays wrong after its re-compaction, marks the document
suspect, and compactions skip it from then on. A job judges it: the product's Node checker finds
the first row the browsers' Yjs or the editor can't take, and when it finds none, pycrdt is
probed the same way. That row and its dependents are quarantined, each with a recovery copy,
and the document is cleared only if pycrdt then takes what is left. Without a verdict (no Node,
a bad checkpoint, a checker or a judge that fails), when pycrdt still refuses, or when the
compaction fails again after a clean verdict, the document is held: its rows stay, pushes are
refused and an admin reviews it.
A document only a tab's report marked is held only on what its rows show: without a verdict it
is cleared as unjudged, so a report alone never pauses saving.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import frappe
from frappe.utils.background_jobs import get_redis_conn
from redis import Redis

from suite import drive
from suite.content import admission, checker, compaction, db, live, quarantine
from suite.content.log import Refusal
from suite.content.pushes import SUSPECT_RETRY_MS
from suite.content.scheduling import enqueue
from suite.content.snapshot import Snapshot, read
from suite.content.tables import table

# The compaction failures that come from the CRDT library itself, not from the rows' shape or the host
REASONS = frozenset({"unreadable", "content_mismatch", "reencode_mismatch", "not_contained", "fallback"})
REPORT_EVERY_S = 60
NO_NODE_DETAIL = "Node 24 or the product's checker is missing on this host"


@dataclass(frozen=True)
class Judging:
    """One judge run's document and what it judges the rows with."""

    app: str
    doc_id: str
    part_map: Mapping[str, type]
    bundle: Path


def mark_suspect(app: str, doc_id: str, reason: str, method: str) -> None:
    """Mark the document suspect, and when it wasn't already, alert and ask a job to judge it."""
    doc_table = table(app, "doc")
    is_newly_marked = db.claim(
        f"UPDATE `{doc_table}` SET `suspect` = %s WHERE `id` = %s AND `suspect` IS NULL",
        (reason, doc_id),
    )
    if is_newly_marked:
        alert(app, doc_id, f"suspect: {reason}", "The compaction could not take the rows; a job judges them")
        request_judge(app, doc_id, method)


def report_row(app: str, doc_id: str, rev: int, method: str) -> tuple[int, dict]:
    """Answer a tab's report that row `rev` threw when it applied it with the status and body to send."""
    doc_table = table(app, "doc")
    control_rows = frappe.db.sql(
        f"SELECT `head_rev`, `body_rev`, `suspect_held`, `judged` FROM `{doc_table}` WHERE `id` = %s",
        doc_id,
        as_dict=True,
    )
    control_row = control_rows[0]
    if not 0 < rev <= int(control_row.head_rev):
        raise Refusal(400, "malformed")

    if rev <= int(control_row.body_rev):
        return 200, {"verdict": "clean", "judged": int(control_row.judged)}

    if control_row.suspect_held:
        raise Refusal(423, "paused", reason="suspect", retry_ms=SUSPECT_RETRY_MS)

    is_report_heard = db.claim(
        f"""UPDATE `{doc_table}` SET `suspect_reported_at` = NOW(6) WHERE `id` = %s
        AND (`suspect_reported_at` IS NULL OR `suspect_reported_at` <= NOW(6) - INTERVAL %s SECOND)""",
        (doc_id, REPORT_EVERY_S),
    )
    if not is_report_heard:
        raise Refusal(423, "busy", retry_ms=REPORT_EVERY_S * 1000)

    mark_suspect(app, doc_id, "client", method)
    return 202, {"collab": "judging", "judged": int(control_row.judged)}


def request_judge(app: str, doc_id: str, method: str) -> None:
    """Queue a judge job for the document, one per document at a time."""
    enqueue(method, f"suite-collab-judge-{app}-{doc_id}", app=app, doc_id=doc_id)


def judge_until_settled(
    judging: Judging, suspect_reason: str, redis: Redis, rejudge_redis_key: str
) -> str | None:
    """Judge the document, and again for each re-judge an admin asked while the last one ran."""
    redis.delete(rejudge_redis_key)
    verdict = verdict_of(judging, suspect_reason)
    while redis.delete(rejudge_redis_key):
        next_reason = suspect_of(judging.app, judging.doc_id)
        if not next_reason:
            break

        verdict = verdict_of(judging, next_reason)

    return verdict


def judge(app: str, doc_id: str, part_map: Mapping[str, type], bundle: Path) -> str | None:
    """Judge a suspect document in a compaction place, `busy` without one or a free checker, or None when not suspect."""
    suspect_reason = suspect_of(app, doc_id)
    if not suspect_reason:
        return None

    redis = get_redis_conn()
    rejudge_redis_key = rejudge_key(app, doc_id)
    place = admission.take_place(app, doc_id)
    if place is None:
        return "busy"

    judging = Judging(app, doc_id, part_map, bundle)
    try:
        return judge_until_settled(judging, suspect_reason, redis, rejudge_redis_key)
    finally:
        admission.free_place(place)


def verdict_of(judging: Judging, suspect_reason: str) -> str | None:
    """Judge the rows, settling the document as `judge_failed` when the judge itself throws."""
    try:
        return judge_rows(judging, suspect_reason)
    # pycrdt panics derive from BaseException
    except BaseException as error:
        if isinstance(error, KeyboardInterrupt | SystemExit):
            raise

        frappe.db.rollback()
        return unsettled(judging.app, judging.doc_id, suspect_reason, "judge_failed", type(error).__name__)


def rejudge_key(app: str, doc_id: str) -> str:
    """Build the Redis key an admin's re-judge sets while a judge runs."""
    return f"suite:collab:rejudge:{frappe.local.site}:{app}:{doc_id}"


def still_refused(judging: Judging) -> bool:
    """Whether pycrdt still refuses the document's rows after a quarantine."""
    reread = read(judging.app, judging.doc_id, integrated=True)
    if not reread:
        return False

    after_rows = reread.payloads()
    return pycrdt_refuses(reread.checkpoint, after_rows, judging.part_map)


def settle_document(judging: Judging, suspect_reason: str, rev: int | None, reason: str) -> str | None:
    """Quarantine row `rev` when there is one, then clear the document, or hold it where that fails."""
    app = judging.app
    doc_id = judging.doc_id
    if rev is not None:
        try:
            quarantine.quarantine(app, doc_id, {rev}, reason)
        except drive.DriveNotFound as error:
            return hold_document(app, doc_id, "unowned_row", repr(error))

        if still_refused(judging):
            return hold_document(app, doc_id, "still_refused", f"rev {rev} quarantined, pycrdt still refuses")

    nothing_refused = rev is None
    library_failure = suspect_reason in REASONS
    if nothing_refused and library_failure and judged_clean(app, doc_id):
        return hold_document(
            app, doc_id, "unreproduced", "Judged clean before, and the compaction still fails"
        )

    outcome = "clean" if nothing_refused else "quarantined"
    clean_mark = suspect_reason if nothing_refused and library_failure else None
    clear_suspect(app, doc_id, outcome, clean_mark=clean_mark)
    return outcome


def settle_verdict(
    judging: Judging, suspect_reason: str, snapshot: Snapshot, rows: list[bytes], verdict: checker.Verdict
) -> str | None:
    """Find the row the checker or else pycrdt refuses, and settle the document on it."""
    revs = [rev for rev, _payload in snapshot.rows]
    index = verdict.index
    reason = "editor_schema" if verdict.reason.startswith("schema") else "yjs_refused"
    if index is None:
        index = first_refused(snapshot.checkpoint, rows, judging.part_map)
        reason = "pycrdt_refused"

    if index == -1:
        checkpoint_detail = verdict.reason or "pycrdt refuses the checkpoint"
        return hold_document(judging.app, judging.doc_id, "bad_checkpoint", checkpoint_detail)

    rev: int | None = None
    if index is not None:
        rev = revs[index]

    return settle_document(judging, suspect_reason, rev, reason)


def judge_rows(judging: Judging, suspect_reason: str) -> str | None:
    """Run the product's checker on the document's rows and settle the document on its verdict."""
    app = judging.app
    doc_id = judging.doc_id
    snapshot = read(app, doc_id, integrated=True)
    if snapshot is None:
        return None

    rows = snapshot.payloads()
    try:
        verdict = checker.judge(judging.bundle, snapshot.checkpoint, rows)
    except checker.CheckerBusy:
        return "busy"
    except checker.CheckerFailed as error:
        return unsettled(app, doc_id, suspect_reason, "checker_failed", repr(error))

    if verdict is None:
        return unsettled(app, doc_id, suspect_reason, "no_node", NO_NODE_DETAIL)

    return settle_verdict(judging, suspect_reason, snapshot, rows, verdict)


def rejudge(app: str, doc_id: str, method: str) -> bool:
    """Ask for a new verdict for an admin, unholding the document so the judge and the sweep take it."""
    if not suspect_of(app, doc_id):
        return False

    doc_table = table(app, "doc")
    frappe.db.sql(f"UPDATE `{doc_table}` SET `suspect_held` = NULL WHERE `id` = %s", doc_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    live.publish_change(app, doc_id, "released")
    redis = get_redis_conn()
    redis.set(rejudge_key(app, doc_id), 1, ex=admission.LEASE_SECONDS)
    alert(app, doc_id, "suspect re-judged", f"{frappe.session.user} asked for a new verdict")
    request_judge(app, doc_id, method)
    return True


def release(app: str, doc_id: str) -> bool:
    """Clear a suspect document as `unjudged` for an admin: saving and compactions go on, its rows stay."""
    if not suspect_of(app, doc_id):
        return False

    clear_suspect(app, doc_id, "unjudged")
    live.publish_change(app, doc_id, "released")
    alert(app, doc_id, "suspect cleared", f"{frappe.session.user} cleared it without a verdict")
    return True


def first_refused(checkpoint: bytes | None, rows: list[bytes], part_map: Mapping[str, type]) -> int | None:
    """Find the first row a compaction refuses: its index, -1 for the checkpoint, None for neither."""
    if not pycrdt_refuses(checkpoint, rows, part_map):
        return None

    if checkpoint and pycrdt_refuses(checkpoint, [], part_map):
        return -1

    # Every prefix up to `good` rows compacts and the prefix of `bad` rows does not
    good = 0
    bad = len(rows)
    while bad - good > 1:
        middle = (good + bad) // 2
        if pycrdt_refuses(checkpoint, rows[:middle], part_map):
            bad = middle
        else:
            good = middle

    return bad - 1


def pycrdt_refuses(checkpoint: bytes | None, rows: list[bytes], part_map: Mapping[str, type]) -> bool:
    """Whether the compaction refuses these rows for a reason that marks a document suspect."""
    if not checkpoint and not rows:
        return False

    try:
        compacted = compaction.compact(checkpoint, rows, part_map)
        return not compacted.integrated
    except compaction.CompactionFailed as error:
        return error.reason in REASONS


def judged_clean(app: str, doc_id: str) -> bool:
    """Whether a judge found a compaction's suspect clean since the last checkpoint install."""
    doc_table = table(app, "doc")
    judged_row = frappe.db.sql(f"SELECT `suspect_judged_clean` FROM `{doc_table}` WHERE `id` = %s", doc_id)
    return bool(judged_row[0][0])


def fallback_judged_lately(app: str, doc_id: str) -> bool:
    """Whether a judge found a fallback clean in the last day, so another fallback needs no judge."""
    doc_table = table(app, "doc")
    found = frappe.db.sql(
        f"""SELECT 1 FROM `{doc_table}` WHERE `id` = %s
        AND `fallback_judged_clean_at` > NOW(6) - INTERVAL 1 DAY""",
        doc_id,
    )
    return bool(found)


def suspect_of(app: str, doc_id: str) -> str | None:
    """Load the reason the document is suspect, or None when it isn't."""
    doc_table = table(app, "doc")
    found = frappe.db.sql(f"SELECT `suspect` FROM `{doc_table}` WHERE `id` = %s", doc_id)
    if not found:
        return None

    return found[0][0]


def hold_document(app: str, doc_id: str, hold_reason: str, detail: str) -> str | None:
    """Answers None when an admin cleared the document while it was judged."""
    doc_table = table(app, "doc")
    is_held = db.claim(
        f"""UPDATE `{doc_table}` SET `suspect_held` = %s, `verdict` = 'held', `judged` = `judged` + 1
        WHERE `id` = %s AND `suspect` IS NOT NULL""",
        (hold_reason, doc_id),
    )
    if not is_held:
        return None

    live.publish_change(app, doc_id, "held")
    alert(
        app,
        doc_id,
        f"suspect held: {hold_reason}",
        f"Saving is paused until an admin reviews it. {detail}",
    )
    return "held"


def unsettled(app: str, doc_id: str, suspect_reason: str, hold_reason: str, detail: str) -> str | None:
    """Hold a document a judge can't settle only when a compaction marked it, never on a tab's report."""
    if suspect_reason != "client":
        return hold_document(app, doc_id, hold_reason, detail)

    clear_suspect(app, doc_id, "unjudged")
    alert(
        app,
        doc_id,
        f"suspect unjudged: {hold_reason}",
        f"A tab's report was not judged and saving goes on. {detail}",
    )
    return "unjudged"


def clear_suspect(app: str, doc_id: str, verdict: str, *, clean_mark: str | None = None) -> None:
    """Record the verdict and end the compaction's backoff; `clean_mark` is a reason a judge found clean."""
    doc_table = table(app, "doc")
    frappe.db.sql(
        f"""UPDATE `{doc_table}` SET `suspect` = NULL, `suspect_held` = NULL, `verdict` = %s,
        `judged` = `judged` + 1, `suspect_judged_clean` = `suspect_judged_clean` OR %s,
        `fallback_judged_clean_at` = IF(%s, NOW(6), `fallback_judged_clean_at`),
        `next_compaction_at` = IF(%s, NULL, `next_compaction_at`) WHERE `id` = %s""",
        (
            verdict,
            clean_mark is not None,
            clean_mark == "fallback",
            verdict in {"clean", "quarantined"},
            doc_id,
        ),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def alert(app: str, doc_id: str, title: str, message: str) -> None:
    """Log an admin alert about a collab document."""
    db.alert(f"Collab document {title}", f"{message}\n{app} document {doc_id}")
