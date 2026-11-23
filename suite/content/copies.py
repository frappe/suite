"""Readable copies (4i): a tab's render, checked against the document at its rev, then put in the app's row.

The app's copy is written only here and in a media remap, through the app's `ReadableCopy`, under the
projection row's lock, and the projection row keeps the sha of what was written. Anything else found in the
copy is kept as evidence before it is replaced.
An app with no readable copy skips all of it.
"""

import hashlib
import re
from collections.abc import Mapping
from datetime import timedelta
from http import HTTPStatus
from urllib.parse import unquote, urlsplit

import frappe
import nh3
import pycrdt
from bleach_allowlist import bleach_allowlist
from bs4 import BeautifulSoup
from frappe.query_builder import Table
from frappe.query_builder.functions import Coalesce
from frappe.query_builder.terms import ParameterizedValueWrapper
from frappe.utils import now_datetime
from frappe.utils.html_utils import (
    acceptable_attributes,
    acceptable_elements,
    mathml_elements,
    svg_attributes,
    svg_elements,
)
from pypika.terms import Values

from suite.content import compaction, db, stage
from suite.content.app_row import copy_row, forget_cached, locked_app_row, write_copy
from suite.content.editors import ReadableCopy, spec_of
from suite.content.log import Refusal
from suite.content.sessions import load_session
from suite.content.snapshot import Snapshot, read
from suite.content.tables import table

COPY_AGE = timedelta(seconds=60)
# The sandbox the editor gives every embed
IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"


class CopyMismatch(Exception):
    """The app's copy read back other than written; the one argument is the read-back, serialized."""


def submit(app: str, doc_id: str, stage_id: object, user: str) -> tuple[int, dict]:
    """Take a staged render to be checked, replacing older ones; stale when it can't become the copy."""
    if not stage.valid_id(stage_id):
        raise Refusal(400, "malformed")

    if spec_of(app).readable_copy is None:
        stage.drop_stage(app, doc_id, stage_id)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return HTTPStatus.OK, {"render": "stale"}

    try:
        render, _html = stage.assemble_render(app, doc_id, stage_id)
    except stage.Conflict:
        raise Refusal(409, "stage_conflict") from None
    except stage.Incomplete:
        raise Refusal(409, "stage_incomplete") from None

    if load_session(app, doc_id, render.sid, user) is None:
        raise Refusal(409, "session_unknown")

    if not is_current(app, doc_id, render):
        stage.drop_stage(app, doc_id, stage_id)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return HTTPStatus.OK, {"render": "stale"}

    stage.drop_renders_through(app, doc_id, int(render.rev), keep=stage_id)
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    return HTTPStatus.ACCEPTED, {"render": "queued"}


def is_current(app: str, doc_id: str, render: frappe._dict) -> bool:
    """Whether a render is of this log as it stands and newer than the copy."""
    doc_table = Table(table(app, "doc"))
    projection_table = Table(table(app, "projection"))
    found = (
        frappe.qb.from_(doc_table)
        .left_join(projection_table)
        .on(projection_table.doc_id == doc_table.id)
        .select(
            doc_table.lineage,
            doc_table.q_epoch,
            doc_table.head_rev,
            Coalesce(projection_table.projected_rev, 0).as_("projected_rev"),
        )
        .where(doc_table.id == doc_id)
        .where(doc_table.mode != "purged")
        .run(as_dict=True)
    )
    if not found:
        return False

    (doc,) = found
    same_log = (render.lineage, int(render.q_epoch)) == (doc.lineage, int(doc.q_epoch))
    return same_log and int(doc.projected_rev) < int(render.rev) <= int(doc.head_rev)


def wanted_on(app: str, doc: frappe._dict) -> bool:
    """Whether a tab should render: the copy is behind the head and was last written a minute or more ago."""
    if spec_of(app).readable_copy is None or doc.mode == "purged":
        return False

    copied_at = doc.copied_at
    behind = int(doc.projected_rev) < int(doc.head_rev)
    return behind and (copied_at is None or copied_at <= now_datetime() - COPY_AGE)


def check_staged(app: str, doc_id: str) -> str | None:
    """Install the newest whole staged render and drop it with every older one; None when none is whole."""
    html_copy = spec_of(app).readable_copy
    if html_copy is None:
        return None

    for staged in stage.renders(app, doc_id):
        try:
            render, payload = stage.assemble_render(app, doc_id, staged.stage_id)
        except stage.Incomplete:
            continue

        rev = int(render.rev)
        html = payload.decode(errors="replace")
        outcome = install(app, doc_id, rev, render.lineage, int(render.q_epoch), html, html_copy)
        stage.drop_renders_through(app, doc_id, rev)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        return outcome

    return None


def install(
    app: str, doc_id: str, rev: int, lineage: str, q_epoch: int, html: str, html_copy: ReadableCopy
) -> str:
    """Make a render at `rev` the readable copy if it holds the document then: installed, stale or refused."""
    log_read = read(app, doc_id, integrated=True)
    if log_read is None or not renders_log(log_read, rev, lineage, q_epoch):
        return "stale"

    clean, text = cleaned(html)
    if not html_copy.is_html_complete(state_at(app, log_read, rev), clean, text):
        keep_evidence(app, doc_id, "copy_refused", clean, rev)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
        db.alert("Collab readable copy: refused", f"{app} document {doc_id} at rev {rev}")
        return "refused"

    if not write(app, doc_id, rev, clean, html_copy):
        return "stale"

    return "installed"


def cleaned(html: str) -> tuple[str, str]:
    """Sanitize a render as frappe does but keep its safe embeds, and read its text, as the copy check takes them."""
    clean = nh3.clean(
        html,
        tags=acceptable_elements
        | svg_elements
        | mathml_elements
        | {"html", "head", "meta", "link", "body", "o:p", "iframe"},
        attributes={"*": acceptable_attributes, "svg": svg_attributes},
        generic_attribute_prefixes={"data-"},
        strip_comments=False,
        filter_style_properties=set(bleach_allowlist.all_styles) | {"gap", "row-gap"},
        url_schemes=nh3.ALLOWED_URL_SCHEMES | {"cid", "data"},
        attribute_filter=kept_value,
        set_tag_attribute_values={"iframe": {"sandbox": IFRAME_SANDBOX}},
    )
    return clean, BeautifulSoup(clean, "html.parser").get_text()


def kept_value(tag: str, attribute: str, value: str) -> str | None:
    """Keep an off-site https iframe src, and a data: value only as the src of a picture that is not svg."""
    url = re.sub(r"[\t\n\r]|^[\x00-\x20]+|[\x00-\x20]+$", "", value).lower()
    if tag == "iframe" and attribute == "src":
        if url.startswith("https://") and not is_site_url(url):
            return value

        return None

    if not url.startswith("data:"):
        return value

    if tag == "img" and attribute == "src" and re.match(r"data:image/(?![^,;]*svg)", url):
        return value

    return None


def is_site_url(url: str) -> bool:
    """Whether `url` is on or under a site host, or not ASCII; IP literals and sibling sites go unchecked."""
    try:
        host = url_host(url)
        if not host.isascii():
            return True

        host = host.removesuffix(".").encode("idna").decode()
    except (UnicodeError, ValueError):
        return True

    if not host:
        return True

    conf = frappe.local.conf
    domains = conf.get("domains") or []
    names = [frappe.local.site, conf.get("host_name"), conf.get("hostname")]
    names += [entry for entry in domains if isinstance(entry, str)]
    names += [entry.get("domain") for entry in domains if isinstance(entry, dict)]
    for name in filter(None, names):
        try:
            site = url_host(name).removesuffix(".").encode("idna").decode()
        except (UnicodeError, ValueError):
            continue

        if site and (host == site or host.endswith(f".{site}")):
            return True

    return False


def url_host(url: str) -> str:
    """Read the host a browser takes from `url` or a bare host name, percent-decoded and lowercased."""
    url = url.replace("\\", "/")
    if "//" not in url:
        url = f"//{url}"

    return unquote(urlsplit(url).hostname or "").lower()


def renders_log(log_read: Snapshot, rev: int, lineage: str, q_epoch: int) -> bool:
    """Whether a render at `rev` is of this log as it stands, from no earlier than its base."""
    same_log = lineage == log_read.lineage and q_epoch == log_read.q_epoch
    return same_log and log_read.base <= rev <= log_read.head_rev


def state_at(app: str, log_read: Snapshot, rev: int) -> bytes:
    """Return the document at `rev`, from the read's integrated base."""
    rows = [payload for row_rev, payload in log_read.rows if row_rev <= rev]
    if not rows:
        return log_read.checkpoint or pycrdt.Doc().get_update()

    compacted = compaction.compact(log_read.checkpoint, rows, spec_of(app).part_map)
    if not compacted.integrated:
        raise compaction.CompactionFailed("fallback")

    return compacted.state


def write(app: str, doc_id: str, rev: int, html: str, html_copy: ReadableCopy) -> bool:
    """T3a: lock the app's row, then the projection row; replace the copy if `rev` is newer than it."""
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    try:
        replaced = replace_copy(app, doc_id, rev, html, html_copy)
    except CopyMismatch as mismatch:
        frappe.db.rollback()
        if keep_evidence(app, doc_id, "copy_mismatch", mismatch.args[0], rev):
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            db.alert("Collab readable copy: read back differently", f"{app} document {doc_id} at rev {rev}")

        return False

    if replaced is None:
        frappe.db.rollback()
        return False

    docname, is_foreign = replaced
    frappe.db.commit()  # nosemgrep: frappe-manual-commit
    forget_cached(app, docname)
    if is_foreign:
        db.alert("Collab readable copy: written elsewhere", f"{app} document {doc_id}, kept as evidence")

    return True


def replace_copy(
    app: str, doc_id: str, rev: int, html: str, html_copy: ReadableCopy
) -> tuple[str, bool] | None:
    """Replace the copy in the caller's transaction if `rev` is newer; answers the row and whether it was written elsewhere."""
    app_row = locked_app_row(app, doc_id, html_copy)
    if app_row is None:
        return None

    projection = locked_projection(app, doc_id)
    if int(projection.projected_rev) >= rev:
        return None

    is_foreign = keep_unprojected(app, doc_id, app_row.written, projection.projection_hash, html_copy)
    project(app, doc_id, app_row.name, rev, html_copy.rows(html), app_row.written, html_copy)
    keep_copy(app, doc_id, rev, html)
    return app_row.name, is_foreign


def project(
    app: str,
    doc_id: str,
    docname: str,
    rev: int,
    rows: Mapping[str, str],
    written: Mapping[str, str],
    html_copy: ReadableCopy,
) -> None:
    """Write the rows that differ from `written` as the app's copy and record `rows` as the copy at `rev`."""
    projection = Table(table(app, "projection"))
    changed: dict[str, str | None] = {key: value for key, value in rows.items() if written.get(key) != value}
    changed |= {key: None for key in written if key not in rows}
    if changed:
        write_copy(app, docname, changed, html_copy)
        stored = html_copy.serialized(html_copy.read(spec_of(app).doctype, docname))
        if stored != html_copy.serialized(rows):
            raise CopyMismatch(stored)

    (
        frappe.qb.update(projection)
        .set(projection.projected_rev, rev)
        .set(projection.projection_hash, db.Unhex(sha_of(html_copy.serialized(rows))))
        .set(projection.updated, now_datetime())
        .where(projection.doc_id == doc_id)
        .run()
    )


def locked_projection(app: str, doc_id: str) -> frappe._dict:
    """Lock and return the log's projection row, made at rev 0 if it has none."""
    projection_table = Table(table(app, "projection"))
    frappe.qb.into(projection_table).columns(projection_table.doc_id).insert(doc_id).ignore().run()
    (projection,) = (
        frappe.qb.from_(projection_table)
        .select(projection_table.projected_rev, projection_table.projection_hash)
        .where(projection_table.doc_id == doc_id)
        .for_update()
        .run(as_dict=True)
    )
    return projection


def keep_unprojected(
    app: str, doc_id: str, written: Mapping[str, str], projection_hash: bytes | None, html_copy: ReadableCopy
) -> bool:
    """Keep what the copy holds if no copy put it there; answers whether something else wrote over a copy."""
    serialized = html_copy.serialized(written)
    if projection_hash is None:
        # The body from before the log, kept quietly
        if written:
            keep_evidence(app, doc_id, "copy_first", serialized, None)

        return False

    if sha_of(serialized) == bytes(projection_hash).hex():
        return False

    keep_evidence(app, doc_id, "copy_foreign", serialized, None)
    return True


def keep_copy(app: str, doc_id: str, rev: int, html: str) -> None:
    """Keep the copy at `rev` and drop older ones."""
    copy = Table(table(app, "copy"))
    (
        frappe.qb.into(copy)
        .columns(copy.doc_id, copy.rev, copy.html, copy.created)
        .insert(doc_id, rev, html, now_datetime())
        .on_duplicate_key_update(copy.html, Values(copy.html))
        .run()
    )
    frappe.qb.from_(copy).delete().where(copy.doc_id == doc_id).where(copy.rev < rev).run()


def keep_evidence(app: str, doc_id: str, reason: str, html: str, rev: int | None) -> bool:
    """Keep `html` in the recovery table for no writer; the same bytes are kept once, and answer whether they are new."""
    doc = Table(table(app, "doc"))
    recovery = Table(table(app, "recovery"))
    payload = html.encode()
    # Copied from the control row in the same statement, so a missing document keeps nothing
    columns = {
        "id": ParameterizedValueWrapper(frappe.generate_hash(length=20)),
        "doc_id": doc.id,
        "node": doc.node,
        "owner": ParameterizedValueWrapper("system"),
        "reason": ParameterizedValueWrapper(reason),
        "lineage": doc.lineage,
        "sha256": db.Unhex(sha_of(html)),
        "nbytes": len(payload),
        "payload": db.Unhex(payload.hex()),
        "context_rev": rev,
        "created": now_datetime(),
    }
    values = columns.values()
    kept = frappe.qb.into(recovery).columns(*columns).from_(doc).select(*values).where(doc.id == doc_id)
    try:
        kept.run()
    except Exception as error:
        if not frappe.db.is_duplicate_entry(error):
            raise

        return False

    return True


def readable_copy(app: str, doc_id: str) -> str | None:
    """Return the copy when a check wrote it and it covers the head; a value written by anything else is kept."""
    html_copy = spec_of(app).readable_copy
    if html_copy is None:
        return None

    copy = copy_row(app, doc_id, html_copy)
    if copy is None:
        return None

    serialized = html_copy.serialized(copy.written)
    if sha_of(serialized) != bytes(copy.projection_hash).hex():
        if keep_evidence(app, doc_id, "copy_foreign", serialized, None):
            frappe.db.commit()  # nosemgrep: frappe-manual-commit
            db.alert("Collab readable copy: written elsewhere", f"{app} document {doc_id}, kept as evidence")

        return None

    if int(copy.projected_rev) != int(copy.head_rev):
        return None

    return html_copy.html(copy.written)


def sha_of(html: str) -> str:
    """Return the sha256 of `html` as UTF-8, in hex."""
    return hashlib.sha256(html.encode()).hexdigest()
