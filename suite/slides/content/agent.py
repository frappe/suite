"""Writing and reading a presentation as slide JSON in a request with no tab open, as an agent does.

The slides take the form an old deck's rows held, so they go through the same id repairs and the same converter
an old deck does, and a presentation an agent writes is one the editor could have made. What the converter can't
keep refuses the write.
"""

import functools
import html
import json
import re
from collections.abc import Callable, Iterator
from typing import Literal, NamedTuple, cast

import frappe
import pycrdt
from frappe import _

from suite import content, drive
from suite.content import ChainBroken, checker, compaction, convert, jobs
from suite.slides.content import APP, EDITOR, converter
from suite.slides.content.conversion import SLIDE_COLUMNS, legacy_deck, old_row
from suite.slides.content.files import MEDIA_ID
from suite.slides.doctype.presentation.presentation import readable_templates
from suite.slides.drive import docname_for_node

SLIDES_MAX = 256 * 1024
SLIDE_KEYS = {"id", "elements"} | set(SLIDE_COLUMNS.values())
# A part of the layer's open key, so an id is a key the deck's roots take
ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
# A hex colour alone, since an export binds a background as the CSS shorthand, which can load a URL
COLOUR = re.compile(r"#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})")
PICTURE_KEYS = ("src", "poster")
MEDIA_TYPES = ("image", "video")
# A layout slide names its layout by place, and takes the words and picture to fill it with
LAYOUT_FIELDS = ("layout", "texts", "picture")
# A layout element's id is made again for each slide, and a picture's old File name is dropped as Build drops it
LAYOUT_DROPS = {"id", "attachmentName"}
DEFAULT_TEMPLATE = "Light"
# A layout text's first paragraph, or its first list item when it is a list, is the form each line takes
BLOCKS = {tag: re.compile(rf"<{tag}[\s>].*?</{tag}>", re.S) for tag in ("li", "p")}
TAG = re.compile(r"(<[^>]*>)")
ROOTS = ("slides", "elements")
# deck.ts's order digits, so an order a write gives sorts as a tab's does
ORDER_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
FIRST_ORDER = "V"
# The layer's refusals that pass by themselves: another push holds the deck, a compaction makes room,
# or a restore is landing or landed under the write
PASSING = ("busy", "compacting", "restoring", "restored")
PLAIN_DETAILS = {
    "element_type": "an element's type must be text, shape, table, image or video",
    "elements": "an element is not an object",
    "fault": "the slides hold a value the editor has no place for",
    "html": "a text's HTML holds what the editor can't keep",
    "magic_move": "a table's id is another item's; give it its own or leave it out",
    "setting": "an element or slide holds a field, or a value of one, the editor has no place for",
}
# What the converter refuses in one element, so the refusal can name the element by converting less
ELEMENT_REFUSALS = {
    "element_type": "its type must be text, shape, table, image or video",
    "html": "its HTML holds what the editor can't keep",
    "setting": "it holds a field, or a value of one, the editor has no place for",
}
TABLE_FORM = "Use the table form in the agent guide."
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


class Deck(NamedTuple):
    """The state of a presentation that holds a call's slides, and where the call first names each picture."""

    state: bytes
    pictures: dict[str, str]


Theme = Callable[[], dict | None]


def create(parent: str, title: str, slides: object, template: str | None = None) -> tuple[str, int]:
    """Create a presentation in the folder `parent` on `template`, holding `slides`, and answer its node and rev."""
    # Before the converter runs, so a user who can't add here takes none of its turn
    drive.check(parent, drive.UPLOAD)
    theme = template_named(template)
    deck = deck_state(slides, lambda: theme)
    node = drive.create_document(parent, title, content_doctype=EDITOR.doctype)
    if theme:
        # The template a tab's "Add slide" takes its layouts from, as a presentation made in a tab has
        frappe.db.set_value(
            EDITOR.doctype, docname_for_node(node), "theme", theme["name"], update_modified=False
        )

    return node, push(node, replacing(adopted(node, deck)))


def write(node: str, slides: object, mode: Literal["replace", "append"]) -> int:
    """Replace the presentation's slides with `slides`, or append them, and answer the rev that makes."""
    writable(node)
    theme = functools.partial(theme_of, node)
    if mode == "append":
        held = item_ids(current_doc(node))
        return push(node, appending(adopted(node, deck_state(slides, theme, held))))

    # Before the version, so a refused picture keeps none
    source = adopted(node, deck_state(slides, theme))
    # A presentation with no log refuses the write below, so it keeps no version
    if content.find(APP, node):
        keep_version(node)

    return push(node, replacing(source))


def write_slide(node: str, slide_id: str, slide: object) -> int:
    """Make the presentation's slide `slide_id` hold `slide`'s fields and elements alone, and answer the rev."""
    writable(node)
    if not isinstance(slide, dict):
        raise SlidesRefused(_("slide must be an object"))

    given = slide.get("id")
    if given is not None and given != slide_id:
        raise SlidesRefused(_("The slide's id must be the one the path names, or left out"))

    if "elements" not in slide and "layout" not in slide:
        # A slide sent for its fields alone would lose its elements, and this write keeps no version
        raise SlidesRefused(
            _(
                'Send the whole slide with its elements: the slide keeps only what is sent, and "elements": [] empties it'
            )
        )

    doc = current_doc(node)
    if slide_id not in doc.get("slides", type=pycrdt.Map):
        raise drive.DriveNotFound(_("That slide was not found"))

    # The slide's own elements keep their ids, and one another slide holds gets a new one
    held = item_ids(doc) - {slide_id} - set(elements_on(doc, slide_id))
    deck = deck_state([{**slide, "id": slide_id}], functools.partial(theme_of, node), held, slide_id)
    return push(node, rewriting(slide_id, adopted(node, deck)))


def read(node: str) -> dict:
    """Answer the presentation as slide JSON, made from its log as it stands, in the form a write takes."""
    if drive.check(node, drive.READ) != EDITOR.doctype:
        raise drive.DriveNotFound(_("That presentation was not found"))

    if is_combined(node):
        raise WriteRefused(_("A combined presentation has no slides of its own"))

    checkpoint, rows = logged_parts(node)
    try:
        return converter.deck_json(checkpoint, rows)
    except checker.CheckerFailed:
        # Busy, out of time or crashed: the presentation is not at fault, so the same read works later
        raise WriteBusy(_("The converter gave no answer. Try again in a moment.")) from None


def logged_parts(node: str) -> tuple[bytes | None, list[bytes]]:
    """Answer the presentation's log as it stands, as its checkpoint and the rows after it."""
    log = content.find(APP, node)
    try:
        snapshot = log and content.read(APP, log.id)
    except ChainBroken:
        # A push or a compaction landed between the read's queries, twice; the next read finds the rows whole
        raise WriteBusy(_("The presentation changed during the read. Try again.")) from None

    if not snapshot:
        jobs.request_conversion(APP, node)
        raise WriteBusy(_("This presentation is not converted yet. Try again in a moment."))

    return snapshot.checkpoint, snapshot.payloads()


def current_doc(node: str) -> pycrdt.Doc:
    """Answer the presentation's document as its log stands."""
    checkpoint, rows = logged_parts(node)
    # A quarantined row reads empty
    return compaction.load_doc([part for part in (checkpoint, *rows) if part])


def item_ids(doc: pycrdt.Doc) -> frozenset[str]:
    """Answer the ids of every slide and element `doc` holds."""
    ids: set[str] = set()
    for name in ROOTS:
        ids.update(doc.get(name, type=pycrdt.Map).keys())

    return frozenset(ids)


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


def deck_state(
    slides: object, theme: Theme, held: frozenset[str] = frozenset(), slide_id: str | None = None
) -> Deck:
    """Convert `slides` to the state of a presentation that holds all of them, with no id in `held`."""
    # A refusal names a slide by its place in the call, or by `slide_id` in a one-slide write, and a slide
    # that names a layout takes it from the template `theme` answers
    labels = slide_labels(slides, slide_id)
    layouts = functools.cache(lambda: template_slides(theme()))
    rows, pictures = slide_rows(slides, labels, layouts)
    answer = converted(rows, labels, held)
    if answer.dropped:
        kinds = ", ".join(sorted({drop["kind"] for drop in answer.dropped}))
        raise SlidesRefused(_("A presentation can't keep these slides: {0}").format(kinds))

    return Deck(answer.state, pictures)


def slide_labels(slides: object, slide_id: str | None) -> list[str]:
    """Answer the name each slide's refusal gives it."""
    if slide_id is not None:
        return [_("Slide {0}").format(slide_id)]

    if not isinstance(slides, list):
        return []

    return [_("Slide {0} in this call").format(at) for at in range(1, len(slides) + 1)]


def slide_rows(
    slides: object, labels: list[str], layouts: Callable[[], list[dict]]
) -> tuple[list[frappe._dict], dict[str, str]]:
    """Check `slides` and answer them as the rows an old deck held, and where each picture is first named."""
    if not isinstance(slides, list) or not slides:
        raise SlidesRefused(_("slides must be a list of one or more slides"))

    if len(json.dumps(slides).encode()) > SLIDES_MAX:
        raise SlidesRefused(_("The slides are over 256 KB as JSON"))

    rows: list[frappe._dict] = []
    pictures: dict[str, str] = {}
    for label, slide in zip(labels, slides, strict=True):
        row, named = slide_row(label, slide, layouts)
        rows.append(row)
        pictures = named | pictures

    return rows, pictures


def slide_row(
    label: str, slide: object, layouts: Callable[[], list[dict]]
) -> tuple[frappe._dict, dict[str, str]]:
    """Check the slide `label` names and answer it as the row an old deck held, with the pictures it names."""
    if not isinstance(slide, dict):
        raise SlidesRefused(_("{0} is not an object").format(label))

    if "layout" in slide:
        slide = laid_out(label, slide, layouts())

    unknown = sorted(set(slide) - SLIDE_KEYS)
    if unknown:
        raise SlidesRefused(_("{0} holds a field a slide has no place for: {1}").format(label, unknown[0]))

    elements = slide.get("elements") or []
    if not isinstance(elements, list) or not all(isinstance(element, dict) for element in elements):
        raise SlidesRefused(_("{0}'s elements must be a list of objects").format(label))

    check_ids(label, slide, elements)
    row = frappe._dict(
        client_id=slide.get("id"),
        elements=json.dumps(elements),
        **{column: slide.get(name) for column, name in SLIDE_COLUMNS.items()},
    )
    return row, check_pictures(label, slide, elements)


def laid_out(label: str, slide: dict, layouts: list[dict]) -> dict:
    """Answer the slide a layout slide makes: the layout's elements holding its words and picture, and its fields."""
    number = slide["layout"]
    if "elements" in slide:
        raise SlidesRefused(_("{0} names a layout and elements: send one or the other").format(label))

    if type(number) is not int or not 1 <= number <= len(layouts):
        raise SlidesRefused(
            _("{0}'s layout must be a whole number from 1 to {1}").format(label, len(layouts))
        )

    layout = layouts[number - 1]
    texts = slide.get("texts") or []
    if not isinstance(texts, list) or not all(is_words(entry) for entry in texts):
        raise SlidesRefused(_("{0}'s texts must be a list of words, or of lists of words").format(label))

    holders = sum(element.get("type") == "text" for element in layout["elements"])
    if len(texts) > holders:
        refusal = _("{0}: layout {1} holds {2} texts, and {3} were sent")
        if holders == 1:
            refusal = _("{0}: layout {1} holds {2} text, and {3} were sent")

        raise SlidesRefused(refusal.format(label, number, holders, len(texts)))

    picture = slide.get("picture")
    if picture is not None and not any(is_frame(element) for element in layout["elements"]):
        raise SlidesRefused(_("{0}: layout {1} holds no picture").format(label, number))

    fields = {name: value for name, value in layout.items() if name not in {"id", "elements"}}
    fields.update({name: value for name, value in slide.items() if name not in LAYOUT_FIELDS})
    return {**fields, "elements": filled(layout["elements"], iter(texts), picture)}


def filled(elements: list[dict], texts: Iterator[object], picture: object) -> list[dict]:
    """Answer a layout's elements with new ids, each text holding its words and each frame the picture."""
    made: list[dict] = []
    for element in elements:
        own = filled_element(element, texts, picture)
        if own is not None:
            made.append(own)

    return made


def filled_element(element: dict, texts: Iterator[object], picture: object) -> dict | None:
    """Answer the layout's `element` holding the next of `texts` or the picture, or None when it gets neither."""
    # So no placeholder's words or picture are ever written
    own = {name: value for name, value in element.items() if name not in LAYOUT_DROPS}
    if element.get("type") == "text":
        lines = lines_of(next(texts, None))
        if not lines:
            return None

        own["content"] = with_words(own.get("content") or "", lines)
    elif is_frame(element):
        if not picture:
            return None

        own["src"] = picture

    return own


def lines_of(entry: object) -> list[str]:
    """Answer the lines a text's entry holds, leaving out the empty ones."""
    if isinstance(entry, str):
        entry = [entry]

    return [line for line in entry or [] if line]


def is_words(entry: object) -> bool:
    """Answer whether `entry` is a text's words: left out, a string, or a list of strings."""
    if isinstance(entry, list):
        return all(isinstance(line, str) for line in entry)

    return entry is None or isinstance(entry, str)


def is_frame(element: dict) -> bool:
    """Answer whether a layout's element is a picture's place: an image that holds no Drive file."""
    return element.get("type") == "image" and not is_media_id(element.get("src"))


def with_words(markup: str, lines: list[str]) -> str:
    """Answer the text HTML `markup` holding `lines`, each in a copy of its first paragraph or list item."""
    tag = "li" if "<li" in markup else "p"
    first = BLOCKS[tag].search(markup)
    if first is None:
        return "".join(worded("<p></p>", line) for line in lines)

    # What wraps the blocks, as a list's <ul>, stays, and the blocks after the first go
    closing = f"</{tag}>"
    after = markup.rindex(closing) + len(closing)
    blocks = "".join(worded(first.group(), line) for line in lines)
    return markup[: first.start()] + blocks + markup[after:]


def worded(block: str, words: str) -> str:
    """Answer `block` holding `words` alone, in its innermost tag, its tags and styles kept."""
    parts = TAG.split(block)
    # The split puts the text between tags at the even places, and the words go before the first closing tag
    place = next(at for at, part in enumerate(parts) if part.startswith("</")) - 1
    for at in range(0, len(parts), 2):
        parts[at] = ""

    parts[place] = html.escape(words, quote=False)

    return "".join(parts)


def template_named(title: str | None) -> dict | None:
    """Answer the template called `title` that the user can read, or Light for none; another title refuses."""
    templates = readable_templates()
    named = titled(templates, "title", title or DEFAULT_TEMPLATE)
    if title is not None and named is None:
        titles = ", ".join(template["title"] for template in templates)
        raise SlidesRefused(_("No template you can use is called {0}. These are: {1}").format(title, titles))

    return named


def theme_of(node: str) -> dict | None:
    """Answer the template the presentation takes its layouts from, or Light when that one is gone or kept from the user."""
    theme = frappe.db.get_value(EDITOR.doctype, docname_for_node(node), "theme")
    templates = readable_templates()
    return titled(templates, "name", theme) or titled(templates, "title", DEFAULT_TEMPLATE)


def titled(templates: list[dict], key: str, value: object) -> dict | None:
    """Answer the first template whose `key` is `value`."""
    return next((template for template in templates if template[key] == value), None)


def template_slides(theme: dict | None) -> list[dict]:
    """Answer the template's slides, its layouts, as a read gives them to the user."""
    if theme is None:
        raise SlidesRefused(
            _("There is no template to take a layout from: send the slide's elements instead")
        )

    if not content.find(APP, theme["node"]):
        jobs.request_conversion(APP, theme["node"])
        raise WriteBusy(
            _("The template {0} is not converted yet. Try again in a moment.").format(theme["title"])
        )

    return read(theme["node"])["slides"]


def check_ids(label: str, slide: dict, elements: list[dict]) -> None:
    """Refuse an id the deck can't hold as a key; one left out gets a new one."""
    for item in (slide, *elements):
        given = item.get("id")
        if given is not None and not (isinstance(given, str) and ID.fullmatch(given)):
            raise SlidesRefused(
                _(
                    "{0} holds an id that isn't 1 to 128 letters, digits, - or _. Leave it out to get a new one."
                ).format(label)
            )


def check_pictures(label: str, slide: dict, elements: list[dict]) -> dict[str, str]:
    """Refuse a picture named but by a Drive file's id, and answer each one named and where it first is."""
    background = slide.get("background")
    if background and not (isinstance(background, str) and COLOUR.fullmatch(background)):
        raise SlidesRefused(_("{0}'s background must be a colour like #FFFFFF").format(label))

    pictures: dict[str, str] = {}
    for at, element in enumerate(elements, start=1):
        place = element_place(label, at, element)
        if element.get("type") in MEDIA_TYPES and not element.get("src"):
            raise SlidesRefused(
                _("{0} has no src: give the id an upload answers, or leave the element out").format(place)
            )

        for key in PICTURE_KEYS:
            check_picture(place, element, key)
            pictures.setdefault(element.get(key), place)

    pictures.pop(None, None)
    return pictures


def check_picture(place: str, element: dict, key: str) -> None:
    """Refuse the element's `key` when it names a file but by a Drive file's id."""
    value = element.get(key)
    if value == "":
        raise SlidesRefused(
            _("{0}'s {1} is empty: give the id an upload answers, or leave it out").format(place, key)
        )

    if not is_media_id(value):
        noun = _("picture")
        if key == "src" and element.get("type") == "video":
            noun = _("video")

        raise SlidesRefused(_("{0} names a {1} by a link: give the id an upload answers").format(place, noun))


def element_place(label: str, at: int, element: dict) -> str:
    """Name the `at`th element of the slide `label` names, by its type and its id when it has one."""
    kind = element.get("type")
    if not isinstance(kind, str):
        kind = _("no type")

    given = element.get("id")
    if isinstance(given, str):
        return _("{0}, element {1} ({2}, id {3})").format(label, at, kind, given)

    return _("{0}, element {1} ({2})").format(label, at, kind)


def is_media_id(value: object) -> bool:
    """Answer whether `value` is left out or names a Drive file by its id."""
    return value is None or (isinstance(value, str) and MEDIA_ID.fullmatch(value) is not None)


def adopted(node: str, deck: Deck) -> pycrdt.Doc:
    """Load `deck`, with each picture it names brought under the presentation, as a paste brings one."""
    source = compaction.load_doc([deck.state])
    pictures = pictures_in(source.get("elements", type=pycrdt.Map))
    if not pictures:
        return source

    mapping = adopted_ids(node, deck.pictures)
    for element, key in pictures:
        element[key] = mapping[element[key]]

    return source


def pictures_in(elements: pycrdt.Map) -> list[tuple[pycrdt.Map, str]]:
    """Answer each element and key that names a picture."""
    found: list[tuple[pycrdt.Map, str]] = []
    for element in elements.values():
        found.extend((element, key) for key in PICTURE_KEYS if element.get(key))

    return found


def adopted_ids(node: str, pictures: dict[str, str]) -> dict[str, str]:
    """Bring each of `pictures` under the presentation and answer its id there, or refuse and keep no copy."""
    suffix = frappe.generate_hash(length=12)
    savepoint = f"slides_agent_media_{suffix}"
    frappe.db.savepoint(savepoint)
    mapping: dict[str, str] = {}
    try:
        for picture, place in pictures.items():
            mapping |= adopted_id(node, picture, place)
    except Exception as error:
        drive.rollback_savepoint(savepoint, error)
        raise

    frappe.db.release_savepoint(savepoint)
    return mapping


def adopted_id(node: str, picture: str, place: str) -> dict[str, str]:
    """Bring the file `picture` that `place` names under the presentation, and answer its id there."""
    try:
        mapping = drive.adopt_media(node, [picture])
    except drive.DriveConflict:
        # Drive adopts only a file another presentation or document holds
        raise SlidesRefused(
            _("{0} names {1}, a Drive file no presentation holds: upload it to this presentation").format(
                place, picture
            )
        ) from None

    # Drive leaves out a file the user can't read and one that isn't there alike
    if picture not in mapping:
        raise SlidesRefused(
            _("{0} names {1}, a file that isn't there or that you can't read").format(place, picture)
        )

    return mapping


def converted(rows: list[frappe._dict], labels: list[str], held: frozenset[str]) -> convert.Converted:
    """Run the converter on `rows` as an old deck's, refusing what it refuses by the slide and element at fault."""
    answer = run(rows, held)
    if isinstance(answer, convert.Converted):
        return answer

    if answer is None or answer.reason == "bad_answer":
        raise WriteBusy(_("The converter gave no answer. Try again in a moment."))

    if answer.reason != "check":
        refusal = PLAIN_REASONS.get(answer.reason, answer.reason)
    elif answer.detail in ELEMENT_REFUSALS:
        refusal = located(rows, labels, answer.detail) or PLAIN_DETAILS[answer.detail]
    else:
        refusal = PLAIN_DETAILS.get(answer.detail, answer.reason)

    raise SlidesRefused(_("A presentation can't keep these slides: {0}").format(refusal))


def run(
    rows: list[frappe._dict], held: frozenset[str] = frozenset()
) -> convert.Converted | convert.Refused | None:
    """Convert `rows` as an old deck's, and answer None when the converter gave no answer."""
    try:
        return converter.run({**legacy_deck(frappe.generate_hash(), rows, held), "collab": 0})
    except (checker.CheckerBusy, convert.ConverterChanged):
        # Another child held the site's one turn, or a deploy changed the bundle under the request
        return None


def located(rows: list[frappe._dict], labels: list[str], detail: str) -> str | None:
    """Name the element, or the slide, the converter refuses for `detail`, found by converting less of the call."""
    # A refusal one element alone doesn't make, or a converter that stops answering, finds none

    def refuses(part: list[frappe._dict]) -> bool:
        answer = run(part)
        return isinstance(answer, convert.Refused) and answer.reason == "check" and answer.detail == detail

    slide = least(1, len(rows), lambda count: refuses(rows[:count])) - 1
    row = rows[slide]
    elements = json.loads(row.elements)
    at = least(
        0, len(elements), lambda count: refuses([frappe._dict(row, elements=json.dumps(elements[:count]))])
    )
    if at == 0:
        if detail == "setting" and refuses([frappe._dict(row, elements="[]")]):
            return _("{0} holds a field, or a value of one, the editor has no place for").format(
                labels[slide]
            )

        return None

    element = elements[at - 1]
    if not refuses([frappe._dict(row, elements=json.dumps([element]))]):
        return None

    refusal = _("{0}: {1}").format(element_place(labels[slide], at, element), _(ELEMENT_REFUSALS[detail]))
    if element.get("type") == "table":
        return _("{0}. {1}").format(refusal, _(TABLE_FORM))

    return refusal


def least(lo: int, hi: int, refused: Callable[[int], bool]) -> int:
    """Answer the least count from `lo` to `hi` that `refused` holds for, where it holds for `hi` and every count above one it holds for."""
    while lo < hi:
        middle = (lo + hi) // 2
        if refused(middle):
            hi = middle
        else:
            lo = middle + 1

    return lo


def replacing(source: pycrdt.Doc) -> Callable[[pycrdt.Doc], None]:
    """Answer the change that makes a presentation `source`'s slides alone."""

    def change(state: pycrdt.Doc) -> None:
        for name in ROOTS:
            root = state.get(name, type=pycrdt.Map)
            for key in list(root.keys()):
                del root[key]

        copy_items(state.get("slides", type=pycrdt.Map), source.get("slides", type=pycrdt.Map))
        copy_items(state.get("elements", type=pycrdt.Map), source.get("elements", type=pycrdt.Map))

    return change


def appending(source: pycrdt.Doc) -> Callable[[pycrdt.Doc], None]:
    """Answer the change that adds `source`'s slides after a presentation's last, in their order."""

    def change(state: pycrdt.Doc) -> None:
        slides = state.get("slides", type=pycrdt.Map)
        if not item_ids(source).isdisjoint(item_ids(state)):
            # A tab made an item with an id the slides took after the ids were read
            raise WriteBusy(_("The presentation changed during the write. Try again."))

        order = max((order_of(slide) for slide in slides.values()), default="")
        added = sorted(source.get("slides", type=pycrdt.Map).items(), key=lambda entry: order_of(entry[1]))
        for key, slide in added:
            order = order_past(order)
            slides[key] = pycrdt.Map()
            copy_fields(slides[key], slide)
            slides[key]["order"] = order

        copy_items(state.get("elements", type=pycrdt.Map), source.get("elements", type=pycrdt.Map))

    return change


def rewriting(slide_id: str, source: pycrdt.Doc) -> Callable[[pycrdt.Doc], None]:
    """Answer the change that makes the slide `slide_id` `source`'s one slide, where it stands."""

    def change(state: pycrdt.Doc) -> None:
        slides = state.get("slides", type=pycrdt.Map)
        elements = state.get("elements", type=pycrdt.Map)
        if slide_id not in slides:
            # A tab removed the slide after the ids were read
            raise drive.DriveNotFound(_("That slide was not found"))

        own = elements_on(state, slide_id)
        added = source.get("elements", type=pycrdt.Map)
        if not set(added.keys()).isdisjoint(item_ids(state) - {slide_id} - set(own)):
            raise WriteBusy(_("The presentation changed during the write. Try again."))

        set_fields(slides[slide_id], source.get("slides", type=pycrdt.Map)[slide_id])
        for key in own:
            del elements[key]

        copy_items(elements, added)

    return change


def elements_on(doc: pycrdt.Doc, slide_id: str) -> list[str]:
    """Answer the ids of the elements on the slide `slide_id`."""
    elements = doc.get("elements", type=pycrdt.Map)
    return [key for key, element in elements.items() if element.get("parent") == slide_id]


def set_fields(slide: pycrdt.Map, source: pycrdt.Map) -> None:
    """Make `slide`'s fields `source`'s, keeping its order, so a tab's copy of it stays the same item."""
    for name in list(slide.keys()):
        if name != "order" and name not in source:
            del slide[name]

    for name, value in source.items():
        if name != "order":
            slide[name] = value


def order_of(item: pycrdt.Map) -> str:
    """Answer an item's order, where one with none sorts first, as deck.ts reads it."""
    value = item.get("order")
    return value if isinstance(value, str) else ""


def order_past(lo: str) -> str:
    """Answer the order a tab appending after `lo` writes (deck.ts's orderPast)."""
    if not lo:
        return FIRST_ORDER

    if lo[0] == ORDER_DIGITS[-1]:
        return lo[0] + order_past(lo[1:])

    return ORDER_DIGITS[ORDER_DIGITS.index(lo[0]) + 1]


def push(node: str, change: Callable[[pycrdt.Doc], None]) -> int:
    """Push `change` to the presentation as the request's user, and answer the rev it makes."""
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
