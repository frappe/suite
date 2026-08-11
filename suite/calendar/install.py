from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def after_install() -> None:
    add_rate_limits()


def add_rate_limits() -> None:
    """Add rate limits.

    Every limit here is per client IP and is an abuse backstop, not a quota: the numbers are
    sized so normal use never reaches them. Unlike the mail APIs, these endpoints are all
    interactive and everyone in an office can share one address, so they use per-minute
    windows - a runaway script trips them in seconds, while a floor of people working a
    calendar never gets close. Event creation carries an hourly ceiling on top, since that is
    the endpoint that fans invitation mail out to arbitrary addresses.
    """

    rate_limits = [
        # suite.calendar.api — invite attachments in the mail thread view
        {"method_path": "suite.calendar.api.invites.get_invite_details", "limit": 120, "seconds": 60},
        {"method_path": "suite.calendar.api.invites.add_invite_to_calendar", "limit": 60, "seconds": 60},
        {"method_path": "suite.calendar.api.invites.rsvp_to_invite", "limit": 60, "seconds": 60},
        # suite.calendar.api — each RSVP writes the response and emails the organizer
        {"method_path": "suite.calendar.api.rsvp_calendar_event", "limit": 60, "seconds": 60},
        # Delegates to update_calendar_event, so an edit spends from that limit as well.
        {"method_path": "suite.calendar.api.edit_calendar_event", "limit": 120, "seconds": 60},
        # suite.calendar.doctype.calendar_event
        # Creating an event mails an invitation to every participant, and a mailing list
        # participant expands to many - hence the hourly ceiling alongside the burst one.
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event",
            "limit": 60,
            "seconds": 60,
        },
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event",
            "limit": 600,
            "seconds": 60 * 60,
        },
        # Edits are the most frequent write (dragging an event reschedules it) and each one can
        # send an update to every participant.
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event",
            "limit": 120,
            "seconds": 60,
        },
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance",
            "limit": 120,
            "seconds": 60,
        },
        # Deleting sends a cancellation to every participant.
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events",
            "limit": 60,
            "seconds": 60,
        },
        {
            "method_path": "suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_event_instance",
            "limit": 60,
            "seconds": 60,
        },
        # suite.calendar.doctype.calendar — calendars are created once and then lived in
        {"method_path": "suite.calendar.doctype.calendar.calendar.add_calendar", "limit": 20, "seconds": 60},
        {
            "method_path": "suite.calendar.doctype.calendar.calendar.update_calendar",
            "limit": 60,
            "seconds": 60,
        },
        {
            "method_path": "suite.calendar.doctype.calendar.calendar.delete_calendars",
            "limit": 20,
            "seconds": 60,
        },
    ]

    for rl in rate_limits:
        create_rate_limit(**rl)
