# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Client-side calendar invitation delivery.

When custom event invites are enabled (Mail Settings), the app sends invitation, update,
and cancellation emails itself instead of letting the JMAP server emit iMIP scheduling
mail. Each email carries an .ics (iTIP REQUEST/CANCEL) plus signed HTTP RSVP links.

Entry point: `notify_participants(account, action, ...)`, enqueued from the Calendar Event
API after the event is written to JMAP.
"""

import re
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, get_system_timezone, strip_html_tags

from suite.calendar import jmap_events
from suite.calendar.doctype.calendar_event.ics import build_event_ics
from suite.calendar.doctype.calendar_event.invite_templates import (
    DEFAULT_SUBJECTS,
    DEFAULT_TEMPLATES,
    template_path,
)
from suite.calendar.doctype.calendar_exchange.calendar_exchange import (
    _parse_local_datetime,
    is_conference_link,
)
from suite.mail.doctype.mail_queue.mail_queue import MailQueue
from suite.mail.doctype.user_account.user_account import get_user_for_jmap_account
from suite.mail.jmap import get_account_client, get_participant_identities
from suite.utils import log_error
from suite.utils.dt import get_utc_now

# RSVP links stay valid until this long after the event starts.
RSVP_GRACE_DAYS = 1

# Fallback lifetime (from send time) for events with no usable start, so a link can never live
# forever and replay participation changes on the organizer's calendar.
RSVP_FALLBACK_DAYS = 30

# JSCalendar participationStatus -> (button label, pill state) for the organizer notification email.
RESPONSE_DISPLAY: dict[str, tuple[str, str]] = {
    "accepted": ("Yes", "yes"),
    "tentative": ("Maybe", "maybe"),
    "declined": ("No", "no"),
}

# The invite/update/cancel mails embed the logo as a CID part (built by hand in `_build_mime`).
# The organizer response goes through `frappe.sendmail`, which inlines images referenced by an
# `embed="<name>"` attribute instead — this is that name.
RESPONSE_LOGO_EMBED = "event-logo.png"

# Shared font stack for the event email templates (passed into the render context).
EMAIL_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

# `strip_html_tags` only drops the tags, so the <style> block that carries the templates'
# responsive rules would otherwise land in the text/plain part as raw CSS.
STYLE_BLOCK_PATTERN = re.compile(r"<style\b[^>]*>.*?</style>", re.IGNORECASE | re.DOTALL)


def custom_event_invites_enabled() -> bool:
    """Returns True when Mail Settings is configured to send invites from the client."""

    return bool(frappe.get_cached_doc("Mail Settings").get("custom_event_invites"))


def acting_as_organizer(account: str, organizer: str | None) -> bool:
    """True when the organizer address is one of the acting account's own participant identities.

    Guards against firing invite blasts when an attendee (not the organizer) edits their
    own response on a shared event — that case should fall back to server scheduling.
    """

    if not organizer:
        return True

    organizer = organizer.lower().replace("mailto:", "")
    try:
        return organizer in {i["email"] for i in get_participant_identities(account)}
    except Exception:
        return False


def notify_participants(
    account: str,
    action: str,
    event_id: str | None = None,
    event_snapshot: dict | None = None,
    previous_emails: list[str] | None = None,
    recurrence_id: str | None = None,
) -> None:
    """Sends invite/update/cancel emails for an event's participants.

    `action` is one of "invite", "update", "cancel". Pass `event_id` to fetch the current
    event, or a pre-fetched `event_snapshot` (needed for cancellations after deletion).
    For updates, `previous_emails` enables new -> invite / kept -> update / gone -> cancel;
    omit it to send a plain update to everyone. `recurrence_id` scopes a cancellation to a
    single occurrence of a recurring event.

    Note: the snapshot arg is named `event_snapshot`, not `event` — `event` is a reserved
    kwarg of `frappe.enqueue` and would be swallowed before reaching this function.
    """

    event = event_snapshot
    if event is None:
        events = jmap_events.get_events(get_account_client(account), [event_id])
        if not events:
            return
        event = events[0]

    organizer = (event.get("organizerCalendarAddress") or "").lower().replace("mailto:", "")
    attendees = _attendees(event, organizer)
    plan = _plan(action, set(attendees), previous_emails)
    if not plan:
        return

    user = get_user_for_jmap_account(account, raise_exception=True)
    expires_at = _rsvp_expiry(event)

    for email, kind in plan.items():
        try:
            _send(
                account, user, event, organizer, email, attendees.get(email), kind, expires_at, recurrence_id
            )
        except Exception:
            log_error("Calendar", title=_("Failed to send event {0} email to {1}").format(kind, email))


def notify_organizer_of_response(account: str, event_id: str, participant_email: str, status: str) -> None:
    """Emails the organizer that a guest responded to their invitation.

    Guests RSVP through signed links, so their answer is written straight to the organizer's
    copy over JMAP and no iTIP REPLY ever reaches the organizer — they'd only find out by opening
    the event. This sends that heads-up from the site's default outgoing account (the organizer is
    the recipient, not the sender), with Reply-To pointing at the responding guest.

    Runs as a background job off the unauthenticated RSVP request, so it acts as the account owner
    to read the event over JMAP.
    """

    display = RESPONSE_DISPLAY.get((status or "").lower())
    if not display:
        return

    # The RSVP request is unauthenticated (Guest), so resolve the account owner while ignoring
    # permissions — a plain lookup would reject Guest — then act as them to read the event.
    owner = get_user_for_jmap_account(account, ignore_permissions=True)
    if not owner:
        return

    original_user = frappe.session.user
    frappe.set_user(owner)
    try:
        events = jmap_events.get_events(get_account_client(account), [event_id])
        if not events:
            return
        event = events[0]

        organizer = (event.get("organizerCalendarAddress") or "").lower().replace("mailto:", "")
        if not organizer:
            return

        organizer_name = _organizer_name(account, event, organizer)
        responder = _display_name(event, participant_email) or participant_email
        subject, html = _render_response(
            event, organizer, organizer_name, participant_email, responder, display
        )

        frappe.sendmail(
            recipients=[organizer],
            subject=subject,
            message=html,
            reply_to=participant_email,
            inline_images=_response_inline_images(),
            now=True,
        )
    except Exception:
        log_error("Calendar", title=_("Failed to notify organizer of RSVP for event {0}").format(event_id))
    finally:
        frappe.set_user(original_user)


def notify_organizer_of_reply(account: str, event_id: str, responder_email: str, status: str) -> None:
    """Sends the organizer an attendee's RSVP as a custom-template email carrying an iTIP REPLY.

    The custom-invite counterpart of the server's iMIP scheduling mail: when Mail Settings sends
    invites from the client, an attendee's response goes out the same way — the visible body is
    the event_response template, sent from the attendee's own account, and the embedded
    text/calendar part (METHOD:REPLY, only the responder's ATTENDEE per RFC 5546) lets the
    organizer's calendar server record the response mechanically, wherever they're hosted.
    """

    display = RESPONSE_DISPLAY.get((status or "").lower())
    if not display:
        return

    try:
        events = jmap_events.get_events(get_account_client(account), [event_id])
        if not events:
            return
        event = events[0]

        organizer = (event.get("organizerCalendarAddress") or "").lower().replace("mailto:", "")
        responder_email = responder_email.lower()
        # No organizer to tell, or the organizer responding on their own event.
        if not organizer or organizer == responder_email:
            return

        user = get_user_for_jmap_account(account, raise_exception=True)
        responder_name = _organizer_name(account, event, responder_email)
        subject, html = _render_response(
            event,
            organizer,
            _organizer_name(account, event, organizer),
            responder_email,
            responder_name or responder_email,
            display,
            # Hand-built MIME embeds the logo as a CID part (attached by _build_mime), not
            # frappe.sendmail's `embed=` mechanism.
            logo_src_attr='src="cid:eventlogo"',
        )

        ics = build_event_ics(event, method="REPLY", attendee_email=responder_email)
        message = _build_mime(responder_name, responder_email, organizer, subject, html, ics, "REPLY")

        MailQueue._create(
            user=user,
            account=account,
            from_name=responder_name,
            from_email=responder_email,
            recipients=[{"name": None, "email": organizer, "type": "To"}],
            raw_message=message,
            via_api=True,
            delivery_mode="Enqueue",
        )
    except Exception:
        log_error("Calendar", title=_("Failed to send RSVP reply for event {0}").format(event_id))


def _response_inline_images() -> list[dict]:
    """Returns the Calendar logo for the response email in frappe.sendmail's `embed=` format."""

    logo = _image_bytes("public", "calendar", "images", "logo.png")
    return [{"filename": RESPONSE_LOGO_EMBED, "filecontent": logo}] if logo else []


def _plan(action: str, current: set[str], previous_emails: list[str] | None) -> dict[str, str]:
    """Maps each recipient email to the email kind (invite/update/cancel) to send."""

    if action == "invite":
        return {email: "invite" for email in current}
    if action == "cancel":
        return {email: "cancel" for email in current}

    # action == "update"
    if previous_emails is None:
        return {email: "update" for email in current}

    previous = set(previous_emails)
    plan = {email: ("update" if email in previous else "invite") for email in current}
    for email in previous - current:
        plan[email] = "cancel"
    return plan


def _send(
    account: str,
    user: str,
    event: dict,
    organizer: str,
    email: str,
    participant: dict | None,
    kind: str,
    expires_at: int,
    recurrence_id: str | None = None,
) -> None:
    """Renders and enqueues a single invitation/update/cancellation email."""

    from suite.calendar.api.rsvp import build_rsvp_links

    method = "CANCEL" if kind == "cancel" else "REQUEST"
    ics = build_event_ics(event, method=method, recurrence_id=recurrence_id)

    links = None
    if kind in ("invite", "update") and participant and participant.get("uid"):
        links = build_rsvp_links(account, event["id"], participant["uid"], email, expires_at)

    from_name = _organizer_name(account, event, organizer)
    subject, html = _render(kind, event, organizer, from_name, participant, links)
    message = _build_mime(from_name, organizer, email, subject, html, ics, method)

    MailQueue._create(
        user=user,
        account=account,
        from_name=from_name,
        from_email=organizer,
        recipients=[{"name": (participant or {}).get("name"), "email": email, "type": "To"}],
        raw_message=message,
        via_api=True,
        delivery_mode="Enqueue",
    )


def _render(kind, event, organizer, organizer_name, participant, links) -> tuple[str, str]:
    """Returns (subject, html) from the on-disk template for the given action."""

    context = _context(event, organizer, organizer_name, participant, links)

    subject = frappe.render_template(DEFAULT_SUBJECTS[kind], context, is_path=False)
    html = frappe.render_template(template_path(DEFAULT_TEMPLATES[kind]), context, is_path=True)
    return subject, html


def _render_response(
    event, organizer, organizer_name, responder_email, responder_name, display, logo_src_attr=None
) -> tuple[str, str]:
    """Returns (subject, html) for the organizer's RSVP notification email.

    The default logo reference suits frappe.sendmail (the HTTP RSVP heads-up), which inlines
    images from an `embed=` attribute; the iTIP REPLY path passes its own CID reference.
    """

    label, state = display
    context = _context(event, organizer, organizer_name, None, None)
    context.update(
        {
            "responder_name": responder_name,
            "responder_email": responder_email,
            "response_label": label,
            "response_state": state,
            "logo_src_attr": logo_src_attr or f'embed="{RESPONSE_LOGO_EMBED}"',
        }
    )

    subject = frappe.render_template(DEFAULT_SUBJECTS["response"], context, is_path=False)
    html = frappe.render_template(template_path(DEFAULT_TEMPLATES["response"]), context, is_path=True)
    return subject, html


def _context(event, organizer, organizer_name, participant, links) -> dict:
    """Builds the Jinja render context shared by subject and body templates."""

    locations = [l.get("name") for l in (event.get("locations") or {}).values() if l.get("name")]

    return {
        "font": EMAIL_FONT,
        "title": event.get("title") or "(No title)",
        "when": _format_when(event),
        # Timezone shown on its own line under the date; omitted for all-day events.
        "timezone": "" if event.get("showWithoutTime") else (event.get("timeZone") or ""),
        "location": "; ".join(locations),
        "description": event.get("description") or "",
        "organizer_name": organizer_name or organizer,
        "organizer_display": f"{organizer_name} ({organizer})" if organizer_name else organizer,
        "organizer_email": organizer,
        "attendee_name": (participant or {}).get("name") or "",
        "meet": _meet_link(event),
        "rsvp": links,
        # Invite/update/cancel go out as hand-built MIME with a CID logo part; the response email
        # (frappe.sendmail) overrides this with an `embed=` reference. See `_render_response`.
        "logo_src_attr": 'src="cid:eventlogo"',
    }


def _meet_link(event: dict) -> dict | None:
    """Returns {url, label} for the event's first Frappe Meet link, or None.

    Powers the "Frappe Meet video call" card in the invite/update emails. Uses the same link
    detection as the .ics CONFERENCE property so the card and the calendar entry never disagree.
    """

    for link in (event.get("links") or {}).values():
        href = link.get("href") or ""
        if is_conference_link(href):
            return {"url": href, "label": re.sub(r"^https?://", "", href).rstrip("/")}

    return None


def _build_mime(from_name, organizer, to_email, subject, html, ics, method) -> str:
    """Builds a multipart/mixed iMIP message: HTML body (with inline logo), text/calendar, .ics.

    The logo is embedded as an inline CID image rather than a remote URL, so it renders in
    email clients without the recipient having to load external images (and works even when
    the site isn't publicly reachable).
    """

    root = MIMEMultipart("mixed")
    root["Subject"] = subject
    root["From"] = formataddr((from_name, organizer)) if from_name else organizer
    root["To"] = to_email
    # usegmt keeps the header independent of the container's OS zone.
    root["Date"] = formatdate(usegmt=True)
    root["Message-ID"] = make_msgid()

    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(_plain_text(html), "plain", "utf-8"))
    alternative.attach(MIMEText(html, "html", "utf-8"))

    # Inline calendar part carries the iTIP method so clients can offer native controls.
    inline_calendar = MIMEText(ics, "calendar", "utf-8")
    inline_calendar.set_param("method", method)
    inline_calendar.set_param("component", "VEVENT")
    alternative.attach(inline_calendar)

    # Wrap the body with any inline images the templates reference by CID. The Calendar logo
    # (`cid:eventlogo`) leads every email; the Frappe Meet logo (`cid:meetlogo`) is attached only
    # when the body actually shows the Meet card, so no orphan image rides along otherwise.
    inline_images = []
    if logo := _image_bytes("public", "calendar", "images", "logo.png"):
        inline_images.append(("eventlogo", logo))
    if "cid:meetlogo" in html and (meet_logo := _image_bytes("public", "meet", "images", "meet.png")):
        inline_images.append(("meetlogo", meet_logo))

    if inline_images:
        related = MIMEMultipart("related")
        related.attach(alternative)
        for cid, data in inline_images:
            image = MIMEImage(data, _subtype="png")
            image.add_header("Content-ID", f"<{cid}>")
            image.add_header("Content-Disposition", "inline", filename=f"{cid}.png")
            related.attach(image)
        root.attach(related)
    else:
        root.attach(alternative)

    # A downloadable copy so any calendar app can import the event.
    attachment = MIMEText(ics, "calendar", "utf-8")
    attachment.set_param("method", method)
    attachment.add_header("Content-Disposition", "attachment", filename="invite.ics")
    root.attach(attachment)

    return root.as_string()


def _plain_text(html: str) -> str:
    """Returns the text/plain alternative for a rendered email body."""

    return strip_html_tags(STYLE_BLOCK_PATTERN.sub("", html))


_IMAGE_CACHE: dict[str, bytes] = {}


def _image_bytes(*path_parts: str) -> bytes | None:
    """Returns an app public image's bytes for inline embedding, cached per process."""

    key = "/".join(path_parts)
    if key not in _IMAGE_CACHE:
        try:
            with open(frappe.get_app_path("suite", *path_parts), "rb") as f:
                _IMAGE_CACHE[key] = f.read()
        except OSError:
            log_error("Calendar", title=_("Event invite image not found: {0}").format(key))
            _IMAGE_CACHE[key] = b""

    return _IMAGE_CACHE[key] or None


def _attendees(event: dict, organizer: str) -> dict[str, dict]:
    """Returns {email: {uid, name}} for every participant except the organizer."""

    attendees = {}
    for uid, participant in (event.get("participants") or {}).items():
        email = (participant.get("calendarAddress") or "").lower().replace("mailto:", "")
        email = email or (participant.get("email") or "").lower()
        if email and email != organizer:
            attendees[email] = {"uid": uid, "name": participant.get("name") or email}

    return attendees


def _format_when(event: dict) -> str:
    """Formats the event start for display, e.g. 'Monday, 21 Jul 2025, 10:00 AM'."""

    start = _parse_local_datetime(event.get("start"), event.get("timeZone"))
    if not start:
        return ""

    if event.get("showWithoutTime"):
        return start.strftime("%A, %d %b %Y")

    # The timezone is surfaced separately (context["timezone"]) so the template can put it on
    # its own line under the date, matching the design.
    return start.strftime("%A, %d %b %Y, %I:%M %p")


def _display_name(event: dict, email: str) -> str:
    """Returns the participant display name for an email, if the event lists one."""

    for participant in (event.get("participants") or {}).values():
        address = (participant.get("calendarAddress") or participant.get("email") or "").lower()
        if address.replace("mailto:", "") == email and participant.get("name"):
            return participant["name"]

    return ""


def _organizer_name(account: str, event: dict, organizer: str) -> str | None:
    """Returns the organizer's display name, preferring the matching participant identity's name.

    Falls back to a participant name, then None — never the bare email, so the From header
    doesn't render as "alice@x.com <alice@x.com>".
    """

    try:
        for identity in get_participant_identities(account):
            if identity["email"] == organizer:
                name = (identity.get("_name") or "").strip()
                return name if name and name.lower() != organizer else None
    except Exception:
        pass

    name = _display_name(event, organizer).strip()
    return name if name and name.lower() != organizer else None


def _rsvp_expiry(event: dict) -> int:
    """Returns the RSVP link expiry as a unix timestamp.

    Normally the event start plus a grace period. Events with no usable start (e.g. malformed or
    drafts) fall back to a fixed window from now, so every link expires — a token that never
    expires is a standing replay of participation-status changes on the organizer's calendar.
    """

    # An event with a start but a blank/invalid timeZone would parse naive, and .timestamp()
    # below would resolve it against the OS zone - fall back to the site's zone instead.
    start = _parse_local_datetime(event.get("start"), event.get("timeZone") or get_system_timezone())
    if start and start.tzinfo is None:
        start = start.replace(tzinfo=ZoneInfo(get_system_timezone()))

    expiry = (
        add_to_date(start, days=RSVP_GRACE_DAYS)
        if start
        # get_utc_now() is offset-aware, so the timestamp below is a true UTC epoch - matching the
        # start-derived branch, which is aware too. A naive now_datetime() would be resolved
        # against the OS timezone instead of the site's.
        else add_to_date(get_utc_now(), days=RSVP_FALLBACK_DAYS)
    )

    return int(get_datetime(expiry).timestamp())
