"""Upgrade an old `presentation/1` version for a restore in the editor (Q6), as Writer's `convert_version` does.

The page asks every 2 s. The first ask reads the version as the caller and queues a job, and the job runs it
through the same Python repairs and converter a deck's conversion does, then through the same state checks.
The page then restores the answer through the room, as it does a version that is Yjs already.
"""

import base64
import contextlib
from typing import NotRequired, TypedDict

import frappe
from frappe import _
from frappe.utils.background_jobs import is_job_enqueued

from suite import content, drive
from suite.content import checker, convert, scheduling
from suite.content.conversions import ConversionRefused
from suite.slides import content as slides_content
from suite.slides.content.conversion import SLIDE_COLUMNS, check_state, legacy_deck, old_row
from suite.slides.drive import _version_payload

CONVERT_TIMEOUT = 300
# How long a version's input waits for its job
CONVERSION_KEPT = 600
# How long an answer waits for the page, which asks every 2 s
ANSWER_KEPT = 60
# Past this a stored version is refused unread; the rows of a deck the layer can hold are far smaller
MAX_VERSION_BYTES = 64 * 1024 * 1024
VERSION_SLOT = "suite-slides-version-slot"
# Refusals where the upgrade never got to the version's content
STOPPED = {"crashed", "unavailable", "converter_changed", "bad_answer", "child_timeout", "child_crash"}


class VersionConversion(TypedDict):
    state: NotRequired[str]
    reason: NotRequired[str]
    pending: NotRequired[bool]


@frappe.whitelist(allow_guest=True, methods=["POST"])
def convert_version(node: str, seq: int) -> VersionConversion:
    """Convert an old `presentation/1` version of a converted deck for a restore, in a job; EDIT only."""
    drive.check(node, drive.EDIT)
    seq = int(seq)
    # A deck on its rows restores through Drive, which writes them
    if not content.find(slides_content.APP, node):
        frappe.throw(_("This presentation doesn't restore in the editor"), frappe.ValidationError)

    answer = frappe.cache.get_value(version_key("answer", node, seq))
    if answer is None:
        return queue_conversion(node, seq)

    if "state" in answer:
        return {"state": answer["state"]}

    return refusal_for(answer["reason"])


def refusal_for(reason: str) -> VersionConversion:
    """Refuse with a reason anyone can read; a System Manager also gets the code behind it."""
    code, _colon, _detail = reason.partition(":")
    if code == "combined":
        readable = _("it was saved while this was a combined presentation, which has no slides of its own")
    elif code in STOPPED:
        readable = _("the upgrade stopped before it finished")
    else:
        readable = _("some of its content can't be upgraded")

    if "System Manager" in frappe.get_roles():
        return {"reason": f"{readable} ({reason})"}

    return {"reason": readable}


def queue_conversion(node: str, seq: int) -> VersionConversion:
    """Read version `seq` as the caller into the cache, once, and queue its job; pending either way."""
    if not free_version_slot(node, seq):
        return {"pending": True}

    if frappe.cache.get_value(version_key("input", node, seq)) is None:
        legacy = version_input(node, seq)
        if legacy is None:
            return refusal_for("combined")

        frappe.cache.set_value(version_key("input", node, seq), legacy, expires_in_sec=CONVERSION_KEPT)
        frappe.cache.set_value(VERSION_SLOT, (node, seq), user=True, expires_in_sec=CONVERSION_KEPT)

    scheduling.enqueue(
        "suite.slides.api.versions.run_version_conversion",
        version_job(node, seq),
        timeout=CONVERT_TIMEOUT,
        node=node,
        seq=seq,
    )
    return {"pending": True}


def version_input(node: str, seq: int) -> dict | None:
    """Read version `seq` as the converter's input, repaired as the deck's conversion was; None for a combined one."""
    with contextlib.closing(drive.read_version(node, seq)) as stream:
        raw = stream.read(MAX_VERSION_BYTES + 1)

    if len(raw) > MAX_VERSION_BYTES:
        frappe.throw(_("This version is too large to restore"), frappe.ValidationError)

    # Refuses anything but a presentation/1 envelope
    payload = _version_payload(raw)
    # A combined deck has no slides of its own, so its version has nothing to restore
    if payload["is_composite"]:
        return None

    row = old_row(node)
    if row is None:
        frappe.throw(_("This presentation can't be found"), frappe.DoesNotExistError)

    rows = [version_row(slide) for slide in payload["slides"]]
    # Seeded by the deck's row as its conversion was, so "Before collaboration" gets back the ids it converted to
    return {**legacy_deck(row.name, rows), "collab": 0}


def version_row(slide: dict) -> frappe._dict:
    """Read one stored slide as the Slide row the repairs take, with every column they read."""
    elements = slide.get("elements")
    if elements is not None and not isinstance(elements, str):
        frappe.throw(_("This version cannot be read"), frappe.ValidationError)

    columns = {column: slide.get(column) for column in SLIDE_COLUMNS}
    return frappe._dict(client_id=slide.get("client_id"), elements=elements, **columns)


def free_version_slot(node: str, seq: int) -> bool:
    """Free this user's one stored input for `seq`, deleting another version's once its job is gone; else False."""
    held = frappe.cache.get_value(VERSION_SLOT, user=True)
    if held is None or held == (node, seq):
        return True

    if is_job_enqueued(version_job(*held)):
        return False

    frappe.cache.delete_value(version_key("input", *held))
    return True


def run_version_conversion(node: str, seq: int) -> None:
    """Convert the version `convert_version` read, and keep the answer for its next ask."""
    try:
        if not keep_conversion(node, seq):
            return
    except Exception as error:
        crashed = type(error).__name__
    else:
        frappe.cache.delete_value(version_key("input", node, seq))
        return

    # Outside the except, so no frame or chained error left to log holds the presentation's text
    frappe.log_error(title="Slides: version conversion crashed", message=f"{node} v{seq}: {crashed}")
    frappe.cache.set_value(
        version_key("answer", node, seq), {"reason": "crashed"}, expires_in_sec=ANSWER_KEPT
    )
    frappe.cache.delete_value(version_key("input", node, seq))


def keep_conversion(node: str, seq: int) -> bool:
    """Convert the cached version and cache its answer; False once its input has expired or the site's child stayed busy."""
    legacy = frappe.cache.get_value(version_key("input", node, seq))
    if legacy is None:
        return False

    try:
        converted = convert.convert(slides_content.CONVERTER_BUILD, slides_content.CONVERTER_VERSION, legacy)
    except convert.ConverterChanged:
        converted = convert.Refused("converter_changed")
    except checker.CheckerBusy:
        return False

    frappe.cache.set_value(
        version_key("answer", node, seq), answer_for(converted), expires_in_sec=ANSWER_KEPT
    )
    return True


def answer_for(converted: convert.Converted | convert.Refused | None) -> dict:
    """Answer the page with the state once it passes the checks a deck's conversion runs, else why not."""
    if converted is None:
        return {"reason": "unavailable"}

    if isinstance(converted, convert.Refused):
        return {"reason": reason_of(converted.reason, converted.detail)}

    try:
        check_state(converted.state)
    except ConversionRefused as refused:
        return {"reason": reason_of(refused.outcome, refused.reason)}

    return {"state": base64.b64encode(converted.state).decode()}


def reason_of(code: str, detail: str | None) -> str:
    """Name a refusal as a deck's conversion status does: `code`, or `code: detail`."""
    if detail:
        return f"{code}: {detail}"

    return code


def version_key(kind: str, node: str, seq: int) -> str:
    """Name the cache key for version `seq`'s conversion input or answer under this converter."""
    return f"suite-slides-version-{kind}-{node}-{seq}-{slides_content.CONVERTER_VERSION}"


def version_job(node: str, seq: int) -> str:
    """Name the job that converts version `seq`."""
    return f"suite-slides-convert-version-{node}-{seq}"
