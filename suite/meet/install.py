import frappe

from suite.suite_core.doctype.rate_limit.rate_limit import create_rate_limit


def after_install() -> None:
    add_rate_limits()


def after_migrate() -> None:
    pass


def add_rate_limits() -> None:
    """Add default dynamic rate limits for public-facing Meet endpoints.

    The previously hardcoded limits are preserved. The newly protected guest-facing
    and approval endpoints get per-minute abuse backstops sized so normal meeting
    usage never reaches them, but spamming/DoS attempts are blocked.
    """

    rate_limits = [
        {"method_path": "suite.meet.api.meeting.create", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.meet.api.meeting.get_public_meeting_preview", "limit": 10, "seconds": 60},
        {"method_path": "suite.meet.api.meeting.join_meeting_as_guest", "limit": 10, "seconds": 60 * 60},
        {
            "method_path": "suite.meet.api.meeting.get_approved_guest_connection_details",
            "limit": 10,
            "seconds": 60 * 60,
        },
        {"method_path": "suite.meet.api.meeting.validate_guest_session", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.meet.api.meeting.check_meeting_access", "limit": 10, "seconds": 5 * 60},
        {"method_path": "suite.meet.api.meeting.join_meeting", "limit": 30, "seconds": 60},
        {
            "method_path": "suite.meet.api.meeting.get_guest_sfu_connection_details",
            "limit": 30,
            "seconds": 60,
        },
        {"method_path": "suite.meet.api.meeting.approve_join_request", "limit": 60, "seconds": 60},
        {"method_path": "suite.meet.api.meeting.approve_all_join_requests", "limit": 10, "seconds": 60},
        {"method_path": "suite.meet.api.meeting.reject_join_request", "limit": 60, "seconds": 60},
    ]

    for rl in rate_limits:
        create_rate_limit(**rl)
