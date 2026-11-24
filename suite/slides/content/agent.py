"""Writing and reading a presentation as slide JSON in a request with no tab open, as an agent does.

The slides take the form an old deck's rows held, so they go through the same id repairs and the same converter
an old deck does, and a presentation an agent writes is one the editor could have made. What the converter can't
keep refuses the write.
"""

import json
import re
from typing import Literal, cast

import frappe
import pycrdt
from frappe import _

from suite import content, drive
from suite.content import ChainBroken, checker, compaction, convert, jobs
from suite.slides.content import APP, EDITOR, converter
from suite.slides.content.conversion import SLIDE_COLUMNS, legacy_deck, old_row

SLIDES_MAX = 256 * 1024
SLIDE_KEYS = {"id", "elements"} | set(SLIDE_COLUMNS.values())
# A part of the layer's open key, so an id is a key the deck's roots take
ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
PICTURE_TYPES = {"image", "video"}
PICTURE_KEYS = ("src", "poster")
ROOTS = ("slides", "elements")
# The layer's refusals that pass by themselves: another push holds the deck, a compaction makes room,
# or a restore is landing or landed under the write
PASSING = ("busy", "compacting", "restoring", "restored")
PLAIN_DETAILS = {
    "element_type": "an element's type must be text, shape or table",
    "elements": "an element is not an object",
    "fault": "the slides hold a value the editor has no place for",
    "html": "a text's HTML holds what the editor can't keep",
    "magic_move": "a table's id is another item's; give it its own or leave it out",
    "setting": "an element or slide holds a field, or a value of one, the editor has no place for",
}
PLAIN_REASONS = {
    "too_large": "the presentation is too large",
    "child_timeout": "the converter ran out of time on it",
    "child_crash": "the converter failed on it",
}


class SlidesRefused(frappe.ValidationError):
    """The slides hold what a presentation can't keep."""

    http_status_code = 422


class WriteRefused(frappe.ValidationError):
    """The presentation refuses the write, for the reason a tab's edit gets."""

    http_status_code = 409


class WriteBusy(frappe.ValidationError):
    """The presentation or the converter is busy; the same call works later."""

    http_status_code = 429

    def __init__(self, *args: object, retry_ms: int | None = None) -> None:
        super().__init__(*args)
        self.retry_ms = retry_ms


def create(parent: str, title: str, slides: object) -> tuple[str, int]:
    """Create a presentation in the folder `parent` holding `slides`, and answer its node and rev."""
    # Before the converter runs, so a user who can't add here takes none of its turn
    drive.check(parent, drive.UPLOAD)
    deck = deck_state(slides)
    node = drive.create_document(parent, title, content_doctype=EDITOR.doctype)
    return node, write_deck(node, deck)


def write(node: str, slides: object, mode: Literal["replace"]) -> int:
    """Replace the presentation's slides with `slides`, and answer the rev that makes."""
    writable(node)
    deck = deck_state(slides)
    # A presentation with no log refuses the write below, so it keeps no version
    if mode == "replace" and content.find(APP, node):
        keep_version(node)

    return write_deck(node, deck)


def read(node: str) -> dict:
    """Answer the presentation as slide JSON, made from its log as it stands, in the form a write takes."""
    if drive.check(node, drive.READ) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That presentation was not found"))

    if is_combined(node):
        raise WriteRefused(_("A combined presentation has no slides of its own"))

    log = content.find(APP, node)
    try:
        snapshot = log and content.read(APP, log.id)
    except ChainBroken:
        # A push or a compaction landed between the read's queries, twice; the next read finds the rows whole
        raise WriteBusy(_("The presentation changed during the read. Try again.")) from None

    if not snapshot:
        jobs.request_conversion(APP, node)
        raise WriteBusy(_("This presentation is not converted yet. Try again in a moment."))

    try:
        return converter.deck_json(snapshot.checkpoint, snapshot.payloads())
    except checker.CheckerFailed:
        # Busy, out of time or crashed: the presentation is not at fault, so the same read works later
        raise WriteBusy(_("The converter gave no answer. Try again in a moment.")) from None


def writable(node: str) -> None:
    """Refuse a write to what isn't a presentation the user can edit, or to a combined one."""
    if drive.check(node, drive.EDIT) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That presentation was not found"))

    if is_combined(node):
        raise WriteRefused(
            _("A combined presentation shows other presentations' slides, so it takes no writes")
        )


def is_combined(node: str) -> bool:
    """Answer whether the presentation is a combined one, which draws other presentations' slides."""
    row = old_row(node)
    return bool(row and row.is_composite)


def keep_version(node: str) -> None:
    """Nothing is replaced without a version of the head first, as nothing is restored without one."""
    try:
        # A milestone, as a restore's: an automatic version thins with age, and a named one is a person's
        drive.take_version(node, kind="milestone", label=_("Before a replace from JSON"))
    except drive.DriveConflict as away:
        # The versions are away while the log changes or waits to be compacted, so the same call works later
        raise WriteBusy(_("No version could be kept before the replace: {0}").format(away)) from None
    except drive.DriveError as error:
        raise WriteRefused(_("No version could be kept before the replace: {0}").format(error)) from None

    # The write reads in a transaction of its own, so the version is saved before the slides go
    frappe.db.commit()  # nosemgrep: frappe-manual-commit


def deck_state(slides: object) -> bytes:
    """Convert `slides` to the state of a presentation that holds all of them."""
    rows = slide_rows(slides)
    answer = converted({**legacy_deck(frappe.generate_hash(), rows), "collab": 0})
    if answer.dropped:
        kinds = ", ".join(sorted({drop["kind"] for drop in answer.dropped}))
        raise SlidesRefused(_("A presentation can't keep these slides: {0}").format(kinds))

    return answer.state


def slide_rows(slides: object) -> list[frappe._dict]:
    """Check `slides` and answer them as the rows an old deck held, as a version's slides are read."""
    if not isinstance(slides, list) or not slides:
        raise SlidesRefused(_("slides must be a list of one or more slides"))

    if len(json.dumps(slides).encode()) > SLIDES_MAX:
        raise SlidesRefused(_("The slides are over 256 KB as JSON"))

    return [slide_row(at, slide) for at, slide in enumerate(slides, start=1)]


def slide_row(at: int, slide: object) -> frappe._dict:
    """Check the `at`th slide and answer it as the row an old deck held."""
    if not isinstance(slide, dict):
        raise SlidesRefused(_("Slide {0} is not an object").format(at))

    unknown = sorted(set(slide) - SLIDE_KEYS)
    if unknown:
        raise SlidesRefused(_("Slide {0} holds a field a slide has no place for: {1}").format(at, unknown[0]))

    elements = slide.get("elements") or []
    if not isinstance(elements, list) or not all(isinstance(element, dict) for element in elements):
        raise SlidesRefused(_("Slide {0}'s elements must be a list of objects").format(at))

    check_ids(at, slide, elements)
    check_no_pictures(at, slide, elements)
    return frappe._dict(
        client_id=slide.get("id"),
        elements=json.dumps(elements),
        **{column: slide.get(name) for column, name in SLIDE_COLUMNS.items()},
    )


def check_ids(at: int, slide: dict, elements: list[dict]) -> None:
    """Refuse an id the deck can't hold as a key; one left out gets a new one."""
    for item in (slide, *elements):
        given = item.get("id")
        if given is not None and not (isinstance(given, str) and ID.fullmatch(given)):
            raise SlidesRefused(
                _(
                    "Slide {0} holds an id that isn't 1 to 128 letters, digits, - or _. Leave it out to get a new one."
                ).format(at)
            )


def check_no_pictures(at: int, slide: dict, elements: list[dict]) -> None:
    """Refuse pictures and videos, which a write can't take yet."""
    background = slide.get("background")
    if background and not (isinstance(background, str) and background.startswith("#")):
        raise SlidesRefused(
            _("Slide {0}'s background must be a colour like #FFFFFF. Pictures come later.").format(at)
        )

    for element in elements:
        if element.get("type") in PICTURE_TYPES or any(element.get(key) for key in PICTURE_KEYS):
            raise SlidesRefused(_("Slide {0} holds a picture or video. Pictures come later.").format(at))


def converted(legacy: dict) -> convert.Converted:
    """Run the converter on `legacy` as an old deck, refusing what it refuses."""
    try:
        answer = converter.run(legacy)
    except (checker.CheckerBusy, convert.ConverterChanged):
        # Another child held the site's one turn, or a deploy changed the bundle under the request
        answer = None

    if isinstance(answer, convert.Converted):
        return answer

    if answer is None or answer.reason == "bad_answer":
        raise WriteBusy(_("The converter gave no answer. Try again in a moment."))

    if answer.reason == "check" and answer.detail in PLAIN_DETAILS:
        refusal = PLAIN_DETAILS[answer.detail]
    else:
        refusal = PLAIN_REASONS.get(answer.reason, answer.reason)

    raise SlidesRefused(_("A presentation can't keep these slides: {0}").format(refusal))


def write_deck(node: str, deck: bytes) -> int:
    """Push `deck` as the whole presentation, as the request's user, and answer the rev it makes."""
    source = compaction.load_doc([deck])

    def change(state: pycrdt.Doc) -> None:
        for name in ROOTS:
            root = state.get(name, type=pycrdt.Map)
            for key in list(root.keys()):
                del root[key]

        copy_items(state.get("slides", type=pycrdt.Map), source.get("slides", type=pycrdt.Map))
        copy_items(state.get("elements", type=pycrdt.Map), source.get("elements", type=pycrdt.Map))

    try:
        return content.write(APP, node, change)
    except content.Refusal as refusal:
        reason = refusal.body["collab"]
        if reason == "not_found":
            # The presentation went away after the access check
            raise drive.DriveNotFound(_("That presentation was not found")) from None

        if reason == "paused" and refusal.body.get("reason") == "restoring":
            reason = "restoring"

        if reason in PASSING:
            raise WriteBusy(reason, retry_ms=cast("int | None", refusal.body.get("retry_ms"))) from None

        if reason == "unconverted":
            jobs.request_conversion(APP, node)

        raise WriteRefused(reason) from None


def copy_items(root: pycrdt.Map, source: pycrdt.Map) -> None:
    """Write `source`'s items again under `root`, so they are the writing session's own."""
    for key, item in source.items():
        root[key] = pycrdt.Map()
        copy_fields(root[key], item)


def copy_fields(own: pycrdt.Map, item: pycrdt.Map) -> None:
    """Write `item`'s fields again into `own`, a text with its children."""
    for name, value in item.items():
        if not isinstance(value, pycrdt.XmlFragment):
            own[name] = value
            continue

        own[name] = pycrdt.XmlFragment()
        copy_children(own[name], value)


def copy_children(
    parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: pycrdt.XmlFragment | pycrdt.XmlElement
) -> None:
    """Write `source`'s children again under `parent`, with their attributes and marks."""
    for child in source.children:
        if isinstance(child, pycrdt.XmlText):
            copy_text(parent.children.append(pycrdt.XmlText()), child)
        elif isinstance(child, pycrdt.XmlElement):
            element = parent.children.append(pycrdt.XmlElement(child.tag))
            copy_attributes(element, child)
            copy_children(element, child)


def copy_text(text: pycrdt.XmlText, source: pycrdt.XmlText) -> None:
    """Write `source`'s runs again into `text`, each with its marks."""
    for run, marks in source.diff():
        text.insert(len(text), run, marks or {})


def copy_attributes(element: pycrdt.XmlElement, source: pycrdt.XmlElement) -> None:
    """Set `source`'s attributes on `element`."""
    for name, value in compaction.attributes_of(source).items():
        element.attributes[name] = value
