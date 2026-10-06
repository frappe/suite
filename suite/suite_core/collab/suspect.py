"""Documents a compaction can't take: find the row that breaks them and quarantine it, or hold them.

A compaction that throws, or that stays wrong after its re-compaction, marks the document
suspect, and compactions skip it from then on. A job judges it: the product's Node kernel finds
the first row the browsers' Yjs or the editor can't take, and when it finds none, pycrdt is
probed the same way. That row and its dependents are quarantined, each with a recovery copy,
and the document is cleared only if pycrdt then takes what is left. Without a verdict (no Node,
a bad checkpoint, a kernel or a judge that fails) or when pycrdt still refuses, the document is held:
its rows stay, pushes are refused and an admin reviews it.
A document only a tab's report marked is held only on what its rows show: without a verdict it
is cleared as unjudged, so a report alone never pauses saving.
"""

from pathlib import Path

import frappe

from suite.suite_core.collab import compaction, kernel, quarantine
from suite.suite_core.collab.log import SUSPECT_RETRY_MS, Refusal, read
from suite.suite_core.collab.scheduling import enqueue
from suite.suite_core.collab.tables import table

# The compaction failures that come from the CRDT library itself, not from the rows' shape or the host
REASONS = frozenset({"unreadable", "content_mismatch", "reencode_mismatch", "not_contained", "fallback"})
REPORT_EVERY_S = 60


def mark(adapter: str, doc_id: str, reason: str, method: str) -> None:
    frappe.db.sql(
        f"UPDATE `{table(adapter, 'doc')}` SET `suspect` = %s WHERE `id` = %s AND `suspect` IS NULL",
        (reason, doc_id),
    )
    marked = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if marked:
        alert(
            adapter, doc_id, f"suspect: {reason}", "The compaction could not take the rows; a job judges them"
        )
        request(adapter, doc_id, method)


def report(adapter: str, doc_id: str, rev: int, method: str) -> tuple[int, dict]:
    """A tab's report that row `rev` threw when it applied it; answers the status and body to send.

    Rows the checkpoint integrated already passed the compaction's checks, so the throw was the tab's own
    and the answer is `clean` at once. Otherwise the document is marked suspect and a job judges it;
    the tab reads the verdict on a pull once `judged` passes the number in the answer.
    """
    doc = frappe.db.sql(
        f"SELECT `head_rev`, `integrated_rev`, `suspect_held`, `judged` FROM `{table(adapter, 'doc')}` WHERE `id` = %s",
        doc_id,
        as_dict=True,
    )[0]
    if not 0 < rev <= int(doc.head_rev):
        raise Refusal(400, "malformed")
    if rev <= int(doc.integrated_rev):
        return 200, {"verdict": "clean", "judged": int(doc.judged)}
    if doc.suspect_held:
        raise Refusal(423, "paused", reason="suspect", retry_ms=SUSPECT_RETRY_MS)
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `suspect_reported_at` = NOW(6) WHERE `id` = %s
        AND (`suspect_reported_at` IS NULL OR `suspect_reported_at` <= NOW(6) - INTERVAL %s SECOND)""",
        (doc_id, REPORT_EVERY_S),
    )
    heard = frappe.db.sql("SELECT ROW_COUNT()")[0][0]
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    if not heard:
        raise Refusal(423, "busy", retry_ms=REPORT_EVERY_S * 1000)
    mark(adapter, doc_id, "client", method)
    return 202, {"collab": "judging", "judged": int(doc.judged)}


def request(adapter: str, doc_id: str, method: str) -> None:
    enqueue(method, f"suite-collab-judge-{adapter}-{doc_id}", doc_id=doc_id)


def judge(adapter: str, doc_id: str, roots: dict[str, type], bundle: Path) -> str | None:
    """Judge a suspect document; answers `quarantined`, `clean`, `held` or `unjudged`, or None when it isn't suspect."""
    marked = suspect_of(adapter, doc_id)
    if not marked:
        return None
    try:
        return settle(adapter, doc_id, marked, roots, bundle)
    except Exception as error:
        frappe.db.rollback()
        return unsettled(adapter, doc_id, marked, "judge_failed", type(error).__name__)


def settle(adapter: str, doc_id: str, marked: str, roots: dict[str, type], bundle: Path) -> str | None:
    snapshot = read(adapter, doc_id)
    if snapshot is None:
        return None
    checkpoint, revs = snapshot["checkpoint"], [rev for rev, _payload in snapshot["rows"]]
    rows = [payload for _rev, payload in snapshot["rows"]]
    try:
        verdict = kernel.judge(bundle, checkpoint, rows)
    except kernel.KernelFailed as error:
        return unsettled(adapter, doc_id, marked, "kernel_failed", repr(error))
    if verdict is None:
        return unsettled(
            adapter, doc_id, marked, "no_node", "Node 24 or the product's kernel is missing on this host"
        )
    index, reason = verdict.index, "editor_schema" if verdict.reason.startswith("schema") else "yjs_refused"
    if index is None:
        index, reason = first_refused(checkpoint, rows, roots), "pycrdt_refused"
    if index == -1:
        return hold(adapter, doc_id, "bad_checkpoint", verdict.reason or "pycrdt refuses the checkpoint")
    if index is not None:
        try:
            quarantine.quarantine(adapter, doc_id, {revs[index]}, reason)
        except RuntimeError as error:
            return hold(adapter, doc_id, "unowned_row", repr(error))
        after = read(adapter, doc_id)
        if after and refused(after["checkpoint"], [payload for _rev, payload in after["rows"]], roots):
            return hold(
                adapter, doc_id, "still_refused", f"rev {revs[index]} quarantined, pycrdt still refuses"
            )
    verdict = "clean" if index is None else "quarantined"
    clear(adapter, doc_id, verdict)
    return verdict


def first_refused(checkpoint: bytes | None, rows: list[bytes], roots: dict[str, type]) -> int | None:
    """The index of the first row a compaction refuses, -1 for the checkpoint, None when it takes them all."""
    if not refused(checkpoint, rows, roots):
        return None
    if checkpoint and refused(checkpoint, [], roots):
        return -1
    # Every prefix up to `good` rows compacts and the prefix of `bad` rows does not
    good, bad = 0, len(rows)
    while bad - good > 1:
        middle = (good + bad) // 2
        if refused(checkpoint, rows[:middle], roots):
            bad = middle
        else:
            good = middle
    return bad - 1


def refused(checkpoint: bytes | None, rows: list[bytes], roots: dict[str, type]) -> bool:
    """Whether the compaction refuses these rows for a reason that marks a document suspect."""
    if not checkpoint and not rows:
        return False
    try:
        return not compaction.compact(checkpoint, rows, roots).integrated
    except compaction.CompactionFailed as error:
        return error.reason in REASONS


def suspect_of(adapter: str, doc_id: str) -> str | None:
    found = frappe.db.sql(f"SELECT `suspect` FROM `{table(adapter, 'doc')}` WHERE `id` = %s", doc_id)
    return found[0][0] if found else None


def hold(adapter: str, doc_id: str, why: str, detail: str) -> str:
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `suspect_held` = %s, `verdict` = 'held', `judged` = `judged` + 1
        WHERE `id` = %s AND `suspect` IS NOT NULL""",
        (why, doc_id),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    alert(adapter, doc_id, f"suspect held: {why}", f"Saving is paused until an admin reviews it. {detail}")
    return "held"


def unsettled(adapter: str, doc_id: str, marked: str, why: str, detail: str) -> str:
    """A judge that can't settle a document holds it only when a compaction marked it; a tab's report alone never pauses saving."""
    if marked != "client":
        return hold(adapter, doc_id, why, detail)
    clear(adapter, doc_id, "unjudged")
    alert(
        adapter,
        doc_id,
        f"suspect unjudged: {why}",
        f"A tab's report was not judged and saving goes on. {detail}",
    )
    return "unjudged"


def clear(adapter: str, doc_id: str, verdict: str) -> None:
    frappe.db.sql(
        f"""UPDATE `{table(adapter, "doc")}` SET `suspect` = NULL, `suspect_held` = NULL, `verdict` = %s,
        `judged` = `judged` + 1 WHERE `id` = %s""",
        (verdict, doc_id),
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def alert(adapter: str, doc_id: str, title: str, message: str) -> None:
    frappe.log_error(
        title=f"Collab document {title}",
        message=f"{message}\n{adapter} document {doc_id}",
        reference_doctype="Suite Collab Settings",
    )
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
