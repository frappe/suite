"""Readable copies (4i): a tab's render, checked against the document at its rev, then put in the app's row.

The app's copy field is written only here, under the projection row's lock, and the projection row keeps
the sha of what was written. Anything else found in the field is kept as evidence before it is replaced.
"""

import hashlib
from datetime import timedelta
from http import HTTPStatus

import frappe
import pycrdt
from bs4 import BeautifulSoup
from frappe.utils import now_datetime
from frappe.utils.html_utils import sanitize_html

from suite.suite_core.content import compaction, db, stage
from suite.suite_core.content.adapters import spec_of
from suite.suite_core.content.log import Refusal
from suite.suite_core.content.sessions import load_session
from suite.suite_core.content.snapshot import Snapshot, read
from suite.suite_core.content.tables import table

COPY_AGE = timedelta(seconds=60)


def submit(adapter: str, doc_id: str, stage_id: str, principal: str) -> tuple[int, dict]:
    """Take a staged render to be checked, replacing older ones; stale when it can't become the copy."""
    if not stage.valid_id(stage_id):
        raise Refusal(400, "malformed")

    try:
        render, _html = stage.assemble_render(adapter, doc_id, stage_id)
    except stage.Conflict:
        raise Refusal(409, "stage_conflict") from None
    except stage.Incomplete:
        raise Refusal(409, "stage_incomplete") from None

    if load_session(adapter, doc_id, render.sid, principal) is None:
        raise Refusal(409, "session_unknown")

    if not is_current(adapter, doc_id, render):
        stage.drop_stage(adapter, doc_id, stage_id)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return HTTPStatus.OK, {"render": "stale"}

    stage.drop_renders_through(adapter, doc_id, int(render.rev), keep=stage_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return HTTPStatus.ACCEPTED, {"render": "queued"}


def is_current(adapter: str, doc_id: str, render: frappe._dict) -> bool:
    """Whether a render is of this log as it stands and newer than the copy."""
    doc_table = table(adapter, "doc")
    projection_table = table(adapter, "projection")
    found = frappe.db.sql(
        f"""SELECT `doc`.`lineage`, `doc`.`q_epoch`, `doc`.`head_rev`,
        COALESCE(`projection`.`projected_rev`, 0) AS `projected_rev`
        FROM `{doc_table}` `doc`
        LEFT JOIN `{projection_table}` `projection` ON `projection`.`doc_id` = `doc`.`id`
        WHERE `doc`.`id` = %s AND `doc`.`mode` != 'purged'""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return False

    (doc,) = found
    same_log = (render.lineage, int(render.q_epoch)) == (doc.lineage, int(doc.q_epoch))
    return same_log and int(doc.projected_rev) < int(render.rev) <= int(doc.head_rev)


def wanted(adapter: str, doc_id: str) -> bool:
    """Whether a tab should render: the copy is behind the head and was last written a minute or more ago."""
    doc_table = table(adapter, "doc")
    projection_table = table(adapter, "projection")
    found = frappe.db.sql(
        f"""SELECT 1 FROM `{doc_table}` `doc`
        LEFT JOIN `{projection_table}` `projection` ON `projection`.`doc_id` = `doc`.`id`
        WHERE `doc`.`id` = %s AND `doc`.`mode` != 'purged'
        AND COALESCE(`projection`.`projected_rev`, 0) < `doc`.`head_rev`
        AND (`projection`.`updated` IS NULL OR `projection`.`updated` <= %s)""",
        (doc_id, now_datetime() - COPY_AGE),
    )
    return bool(found)


def check_staged(adapter: str, doc_id: str) -> str | None:
    """Install the newest whole staged render and drop it with every older one; None when none is whole."""
    for staged in stage.renders(adapter, doc_id):
        try:
            render, payload = stage.assemble_render(adapter, doc_id, staged.stage_id)
        except stage.Incomplete:
            continue

        rev = int(render.rev)
        html = payload.decode(errors="replace")
        outcome = install(adapter, doc_id, rev, render.lineage, int(render.q_epoch), html)
        stage.drop_renders_through(adapter, doc_id, rev)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return outcome

    return None


def install(adapter: str, doc_id: str, rev: int, lineage: str, q_epoch: int, html: str) -> str:
    """Make a render at `rev` the readable copy if it holds the document then: installed, stale or refused."""
    log_read = read(adapter, doc_id, integrated=True)
    if log_read is None or not renders_log(log_read, rev, lineage, q_epoch):
        return "stale"

    clean = sanitize_html(html)
    text = BeautifulSoup(clean, "html.parser").get_text()
    if not spec_of(adapter).check_copy(state_at(adapter, log_read, rev), clean, text):
        keep_evidence(adapter, doc_id, "copy_refused", clean, rev)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        db.alert("Collab readable copy: refused", f"{adapter} document {doc_id} at rev {rev}")
        return "refused"

    if not write(adapter, doc_id, rev, clean):
        return "stale"

    return "installed"


def renders_log(log_read: Snapshot, rev: int, lineage: str, q_epoch: int) -> bool:
    """Whether a render at `rev` is of this log as it stands, from no earlier than its base."""
    same_log = lineage == log_read.lineage and q_epoch == log_read.q_epoch
    return same_log and log_read.base <= rev <= log_read.head_rev


def state_at(adapter: str, log_read: Snapshot, rev: int) -> bytes:
    """Return the document at `rev`, from the read's integrated base."""
    rows = [payload for row_rev, payload in log_read.rows if row_rev <= rev]
    if not rows:
        return log_read.checkpoint or pycrdt.Doc().get_update()

    compacted = compaction.compact(log_read.checkpoint, rows, spec_of(adapter).roots)
    if not compacted.integrated:
        raise compaction.CompactionFailed("fallback")

    return compacted.state


def write(adapter: str, doc_id: str, rev: int, html: str) -> bool:
    """T3a: lock the app's row, then the projection row; replace the copy if `rev` is newer than it."""
    spec = spec_of(adapter)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    app_row = locked_app_row(adapter, doc_id)
    if app_row is None:
        frappe.db.rollback()
        return False

    projection = locked_projection(adapter, doc_id)
    if int(projection.projected_rev) >= rev:
        frappe.db.rollback()
        return False

    is_foreign = keep_unprojected(adapter, doc_id, app_row.written or "", projection.projection_hash)
    project(adapter, doc_id, app_row.name, rev, html)
    keep_copy(adapter, doc_id, rev, html)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    frappe.clear_document_cache(spec.content_type, app_row.name)
    if is_foreign:
        db.alert("Collab readable copy: written elsewhere", f"{adapter} document {doc_id}, kept as evidence")

    return True


def project(adapter: str, doc_id: str, docname: str, rev: int, html: str) -> None:
    """Write `html` to the app's copy field and record it as the copy at `rev`."""
    spec = spec_of(adapter)
    projection_table = table(adapter, "projection")
    frappe.db.sql(
        f"UPDATE `tab{spec.content_type}` SET `{spec.copy_field}` = %s WHERE `name` = %s", (html, docname)
    )
    frappe.db.sql(
        f"""UPDATE `{projection_table}` SET `projected_rev` = %s, `projection_hash` = UNHEX(%s),
        `updated` = %s WHERE `doc_id` = %s""",
        (rev, sha_of(html), now_datetime(), doc_id),
    )


def locked_app_row(adapter: str, doc_id: str) -> frappe._dict | None:
    """Lock and return the app's row of a log that isn't purged, its copy field as `written`."""
    spec = spec_of(adapter)
    doc_table = table(adapter, "doc")
    found = frappe.db.sql(
        f"""SELECT `app`.`name`, `app`.`{spec.copy_field}` AS `written` FROM `tab{spec.content_type}` `app`
        JOIN `{doc_table}` `doc` ON `app`.`{spec.node_field}` = `doc`.`node`
        WHERE `doc`.`id` = %s AND `doc`.`mode` != 'purged' ORDER BY `app`.`name` LIMIT 1 FOR UPDATE""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return None

    return found[0]


def locked_projection(adapter: str, doc_id: str) -> frappe._dict:
    """Lock and return the log's projection row, made at rev 0 if it has none."""
    projection_table = table(adapter, "projection")
    frappe.db.sql(f"INSERT IGNORE INTO `{projection_table}` (`doc_id`) VALUES (%s)", doc_id)
    (projection,) = frappe.db.sql(
        f"SELECT `projected_rev`, `projection_hash` FROM `{projection_table}` WHERE `doc_id` = %s FOR UPDATE",
        doc_id,
        as_dict=True,
    )
    return projection


def keep_unprojected(adapter: str, doc_id: str, written: str, projection_hash: bytes | None) -> bool:
    """Keep what the field holds if no copy put it there; answers whether something else wrote over a copy."""
    if projection_hash is None:
        # The body from before the log, kept quietly
        if written:
            keep_evidence(adapter, doc_id, "copy_first", written, None)

        return False

    if sha_of(written) == bytes(projection_hash).hex():
        return False

    keep_evidence(adapter, doc_id, "copy_foreign", written, None)
    return True


def keep_copy(adapter: str, doc_id: str, rev: int, html: str) -> None:
    """Keep the copy at `rev` and drop older ones."""
    copy_table = table(adapter, "copy")
    frappe.db.sql(
        f"""INSERT INTO `{copy_table}` (`doc_id`, `rev`, `html`, `created`) VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE `html` = VALUES(`html`)""",
        (doc_id, rev, html, now_datetime()),
    )
    frappe.db.sql(
        f"DELETE FROM `{copy_table}` WHERE `doc_id` = %s AND `rev` < %s",
        (doc_id, rev),
    )


def keep_evidence(adapter: str, doc_id: str, reason: str, html: str, rev: int | None) -> bool:
    """Keep `html` in the recovery table for no writer; the same bytes are kept once, and answer whether they are new."""
    doc_table = table(adapter, "doc")
    recovery_table = table(adapter, "recovery")
    payload = html.encode()
    try:
        frappe.db.sql(
            f"""INSERT INTO `{recovery_table}`
            (`id`, `doc_id`, `node`, `owner`, `reason`, `lineage`, `sha256`, `nbytes`, `payload`, `context_rev`, `created`)
            SELECT %s, `id`, `node`, 'system', %s, `lineage`, UNHEX(%s), %s, UNHEX(%s), %s, %s
            FROM `{doc_table}` WHERE `id` = %s""",
            (
                frappe.generate_hash(length=20),
                reason,
                sha_of(html),
                len(payload),
                payload.hex(),
                rev,
                now_datetime(),
                doc_id,
            ),
        )
    except Exception as error:
        if not frappe.db.is_duplicate_entry(error):
            raise

        return False

    return True


def readable_copy(adapter: str, doc_id: str) -> str | None:
    """Return the copy when a check wrote it and it covers the head; a value written by anything else is kept."""
    spec = spec_of(adapter)
    doc_table = table(adapter, "doc")
    projection_table = table(adapter, "projection")
    found = frappe.db.sql(
        f"""SELECT `app`.`{spec.copy_field}` AS `written`, `doc`.`head_rev`, `projection`.`projected_rev`,
        `projection`.`projection_hash`
        FROM `{doc_table}` `doc`
        JOIN `{projection_table}` `projection` ON `projection`.`doc_id` = `doc`.`id`
        JOIN `tab{spec.content_type}` `app` ON `app`.`{spec.node_field}` = `doc`.`node`
        WHERE `doc`.`id` = %s AND `doc`.`mode` != 'purged' ORDER BY `app`.`name` LIMIT 1""",
        doc_id,
        as_dict=True,
    )
    if not found:
        return None

    (copy,) = found
    written = copy.written or ""
    if sha_of(written) != bytes(copy.projection_hash).hex():
        if keep_evidence(adapter, doc_id, "copy_foreign", written, None):
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            db.alert(
                "Collab readable copy: written elsewhere", f"{adapter} document {doc_id}, kept as evidence"
            )

        return None

    if int(copy.projected_rev) != int(copy.head_rev):
        return None

    return written


def sha_of(html: str) -> str:
    """Return the sha256 of `html` as UTF-8, in hex."""
    return hashlib.sha256(html.encode()).hexdigest()
