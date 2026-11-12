"""A person's first run in Suite: the welcome steps and the starter files in their Drive.

The first Admin walks the site wizard (`/suite/setup`) and finishes it with
`suite.api.account.mark_onboarded`. On Suite Cloud the first Admin is invited
like anyone else, and goes from their new account straight to the wizard.
Everyone who joins after that, by invitation, direct creation or a self-hosted
invite, walks the shorter welcome (`/suite/welcome`) once: the command menu and
a summary.

Starter files give an empty workspace something to open. The first Admin gets
one of each kind, and a daily stand-up and a sample event in their calendar.
People who join later get the welcome document and a place in that stand-up, so
their Home has a team meeting on it from the first day. A starter file or event
that cannot be made is logged and skipped: it never blocks onboarding.

These facts, and whether a person hid Home's Get started list, are user
defaults. So no DocType changes, and a user who predates this code is neither
asked to walk the welcome nor given files.
"""

import json
from datetime import datetime, time, timedelta
from html import escape
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import get_system_timezone

from suite import drive

NEEDS_WELCOME = "suite_needs_welcome"
HAS_STARTER_FILES = "suite_has_starter_files"
GET_STARTED_HIDDEN = "suite_get_started_hidden"
# A site default: the first Admin's stand-up, as {"organizer": user, "event": JMAP id}.
TEAM_STANDUP = "suite_team_standup"


def mark_new_person(user: str) -> None:
    """Ask a person added after onboarding to walk the welcome once."""
    if user in ("Guest", "Administrator"):
        return
    if not frappe.db.get_single_value("Suite Settings", "is_onboarded"):
        # The site wizard is the first Admin's welcome.
        return
    frappe.defaults.set_user_default(NEEDS_WELCOME, 1, user)


def needs_welcome(user: str) -> bool:
    return bool(frappe.defaults.get_user_default(NEEDS_WELCOME, user))


def complete_welcome(user: str) -> None:
    """End the session user's welcome, give them the welcome document and add them to the stand-up."""
    frappe.defaults.clear_user_default(NEEDS_WELCOME, user)
    give_starter_files(user, admin=False)
    _join_team_standup(user)


def finish_site_setup(user: str) -> None:
    """End the first Admin's site wizard: it was their welcome, so they never walk the shorter one."""
    frappe.defaults.clear_user_default(NEEDS_WELCOME, user)
    give_starter_files(user, admin=True)


def get_started_hidden(user: str) -> bool:
    """Whether `user` hid the Get started list on Home."""
    return bool(frappe.defaults.get_user_default(GET_STARTED_HIDDEN, user))


def hide_get_started(user: str, hidden: bool) -> None:
    if hidden:
        frappe.defaults.set_user_default(GET_STARTED_HIDDEN, 1, user)
    else:
        frappe.defaults.clear_user_default(GET_STARTED_HIDDEN, user)


def give_starter_files(user: str, *, admin: bool) -> None:
    """Put the starter files in `user`'s Drive once, as `user`, and add them to their Recent."""
    if frappe.defaults.get_user_default(HAS_STARTER_FILES, user):
        return
    root = drive.personal_root_for(user)
    if root is None:
        # Administrator and an offboarded user have no Personal root.
        return
    makers = (_welcome_document, _budget, _kickoff, _board) if admin else (_welcome_document,)
    previous = frappe.session.user
    frappe.set_user(user)
    try:
        # Recent lists the newest first, so the welcome document is visited last.
        for make in reversed(makers):
            _make_quietly(make, root)
        if admin:
            _add_starter_events(user)
    finally:
        frappe.set_user(previous)
    frappe.defaults.set_user_default(HAS_STARTER_FILES, 1, user)


def _make_quietly(make, root: str) -> None:
    savepoint = f"starter_{make.__name__.strip('_')}"
    frappe.db.savepoint(savepoint)
    try:
        drive.record_visit(make(root))
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        frappe.log_error(f"Starter file {make.__name__} could not be created", frappe.get_traceback())


def _add_starter_events(user: str) -> None:
    """A weekday stand-up and a team lunch on the next working day, for Calendar and Home's Upcoming.

    They go in the person's own calendar, so a person without a mailbox gets none.
    """
    from suite import calendar

    time_zone = frappe.db.get_value("User", user, "time_zone") or get_system_timezone()
    day = datetime.now(ZoneInfo(time_zone)).date() + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    events = (
        {
            "title": _("Daily stand-up"),
            "start": datetime.combine(day, time(10)),
            "duration": "PT15M",
            "recurrence_rule": {
                "frequency": "weekly",
                "byDay": [{"day": weekday} for weekday in ("mo", "tu", "we", "th", "fr")],
            },
            "description": _("What you did yesterday, what you will do today, and what is in your way."),
        },
        {
            "title": _("Team lunch"),
            "start": datetime.combine(day, time(13)),
            "duration": "PT1H",
            "description": _("A sample event. Open it to change it, or delete it."),
        },
    )
    for event in events:
        frappe.db.savepoint("starter_event")
        try:
            event_id = calendar.add_event(**event, time_zone=time_zone)
        except Exception:
            frappe.db.rollback(save_point="starter_event")
            frappe.log_error(f"Starter event {event['title']} could not be created", frappe.get_traceback())
            continue
        if event_id is None:
            return
        if event.get("recurrence_rule"):
            frappe.db.set_default(TEAM_STANDUP, json.dumps({"organizer": user, "event": event_id}))


def _join_team_standup(user: str) -> None:
    """Add `user` to the first Admin's stand-up, unless it was deleted or one of them has no mailbox."""
    from suite import calendar

    standup = frappe.db.get_default(TEAM_STANDUP)
    if not standup:
        return
    standup = json.loads(standup)
    if standup["organizer"] == user:
        return
    try:
        calendar.add_attendee(standup["organizer"], standup["event"], user)
    except Exception:
        frappe.log_error(f"{user} could not be added to the team stand-up", frappe.get_traceback())


def _welcome_document(root: str) -> str:
    from suite.writer import create_document

    return create_document(root, _("Welcome to Frappe Suite"), _welcome_html())


def _welcome_html() -> str:
    paragraphs = [
        ("h1", _("Welcome to Frappe Suite")),
        ("p", _("Files, documents, mail and meetings for your whole team, in one place.")),
        ("h2", _("Find anything")),
        ("p", _("Press Ctrl K (⌘ K on a Mac) to open an app, create a file or find a person.")),
        ("h2", _("The apps")),
        ("p", _("Drive keeps your files. Writer, Sheets and Slides make documents, spreadsheets and decks.")),
        ("p", _("Mail and Calendar run on your business address. Meet starts a video call from any event.")),
        ("h2", _("This document")),
        ("p", _("It lives in your Drive. Edit it, share it, or delete it when you are done.")),
    ]
    return "".join(f"<{tag}>{escape(text)}</{tag}>" for tag, text in paragraphs)


def _budget(root: str) -> str:
    from suite.sheets import fill_new_sheet

    node = drive.create_document(root, _("Team budget"), content_doctype="Sheet")
    rows: list[list[str | None]] = [
        [_("Category"), _("January"), _("February"), _("March"), _("Quarter")],
        [_("People"), "42000", "42000", "44000", "=SUM(B2:D2)"],
        [_("Software"), "1800", "1800", "2100", "=SUM(B3:D3)"],
        [_("Equipment"), "2400", "600", "900", "=SUM(B4:D4)"],
        [_("Travel"), "1200", "800", "1500", "=SUM(B5:D5)"],
        [_("Marketing"), "2500", "3000", "2000", "=SUM(B6:D6)"],
        [_("Total"), "=SUM(B2:B6)", "=SUM(C2:C6)", "=SUM(D2:D6)", "=SUM(E2:E6)"],
    ]
    amounts = {f"{column}{row}": "number" for column in "BCDE" for row in range(2, len(rows) + 1)}
    fill_new_sheet(node, rows, amounts)
    return node


def _board(root: str) -> str:
    from suite.draw import get_drawing, save_drawing

    node = drive.create_document(root, _("Brainstorm board"), content_doctype="Drawing")
    save_drawing(node, json.dumps(_board_scene()), get_drawing(node)["modified"])
    return node


# Draw's own Blue, Green and Red object colors, as its toolbar offers them.
_COLUMNS = (
    ("ideas", "#0070cc", "#e6f4ff"),
    ("questions", "#278f5e", "#e4faeb"),
    ("next", "#b52a2a", "#ffe7e7"),
)


def _board_scene() -> dict:
    """Three columns of notes: what a team might put on its first board, centred where Draw opens."""
    left, top = -420, -150
    notes = {
        "ideas": (_("Ideas"), (_("Weekly demo day"), _("Shared reading list"), _("Customer call notes"))),
        "questions": (_("Questions"), (_("Who owns onboarding?"), _("Which tools can we retire?"))),
        "next": (_("Next steps"), (_("Invite the team"), _("Move files into Drive"))),
    }
    rectangles: list[dict] = [
        {
            "id": "title",
            "kind": "text",
            "text": _("Brainstorm"),
            "x": left,
            "y": top - 70,
            "width": 400,
            "height": 48,
            "rotation": 0,
            "cornerRadius": 0,
            "fill": "#171717",
            "fontSize": 32,
            "fontFamily": "shantell",
            "fontWeight": 600,
            "wrap": False,
            "order": 0,
        }
    ]
    lines: list[dict] = []
    order = 1
    for column, (key, border, fill) in enumerate(_COLUMNS):
        heading, items = notes[key]
        x = left + column * 300
        rectangles.append(
            {
                "id": f"{key}-heading",
                "kind": "text",
                "text": heading,
                "x": x,
                "y": top,
                "width": 240,
                "height": 28,
                "rotation": 0,
                "cornerRadius": 0,
                "fill": border,
                "fontSize": 20,
                "fontFamily": "shantell",
                "fontWeight": 600,
                "wrap": False,
                "order": order,
            }
        )
        order += 1
        for row, label in enumerate(items):
            rectangles.append(
                {
                    "id": f"{key}-{row}",
                    "x": x,
                    "y": top + 40 + row * 110,
                    "width": 240,
                    "height": 88,
                    "rotation": 0,
                    "cornerRadius": 12,
                    "label": label,
                    "labelFontSize": 16,
                    "labelFontFamily": "shantell",
                    "labelFill": "#171717",
                    "stroke": border,
                    "fill": fill,
                    "strokeWidth": 2,
                    "strokeStyle": "solid",
                    "opacity": 1,
                    "order": order,
                }
            )
            order += 1
    for start, end in (("ideas-0", "questions-0"), ("questions-1", "next-0")):
        source = next(shape for shape in rectangles if shape["id"] == start)
        target = next(shape for shape in rectangles if shape["id"] == end)
        lines.append(
            {
                "id": f"{start}-to-{end}",
                "kind": "arrow",
                "start": {"x": source["x"] + 248, "y": source["y"] + 44},
                "end": {"x": target["x"] - 8, "y": target["y"] + 44},
                "stroke": "#7c7c7c",
                "strokeWidth": 2,
                "strokeStyle": "solid",
                "opacity": 1,
                "order": order,
            }
        )
        order += 1
    return {"rectangles": rectangles, "lines": lines}


def _kickoff(root: str) -> str:
    from suite.slides import create_deck

    story = (
        (_("Company kickoff"), _("Where we are and where we are going")),
        (_("This quarter"), _("Three outcomes we commit to")),
        (_("Next steps"), _("Owners and dates")),
    )
    return create_deck(
        root,
        _("Company kickoff"),
        [
            [
                _text(f"heading-{number}", heading, top=180, size=48, color="#171717FF"),
                _text(f"body-{number}", body, top=280, size=24, color="#7C7C7CFF"),
            ]
            for number, (heading, body) in enumerate(story, 1)
        ],
    )


def _text(identifier: str, text: str, *, top: int, size: int, color: str) -> dict:
    return {
        "id": identifier,
        "type": "text",
        "left": 80,
        "top": top,
        "width": 800,
        "content": (
            f'<p><span style="font-family: Inter; font-size: {size}px; color: {color};">'
            f"{escape(text)}</span></p>"
        ),
        "opacity": 100,
        "rotation": 0,
        "editorMetadata": {"lineHeight": 1.3},
    }
