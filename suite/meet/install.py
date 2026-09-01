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

    room_method = "suite.meet.doctype.meet_room.meet_room.MeetRoom"
    rate_limits = [
        {"method_path": "suite.meet.api.meeting.create", "limit": 10, "seconds": 60 * 60},
        {"method_path": "suite.meet.api.meeting.get_public_meeting_preview", "limit": 10, "seconds": 60},
        {"method_path": "suite.meet.api.meeting.join_meeting_as_guest", "limit": 10, "seconds": 60 * 60},
        {
            "method_path": "suite.meet.api.meeting.get_approved_guest_connection_details",
            "limit": 10,
            "seconds": 60 * 60,
        },
        {"method_path": "suite.meet.api.meeting.check_meeting_access", "limit": 10, "seconds": 5 * 60},
        {"method_path": "suite.meet.api.meeting.join_meeting", "limit": 60, "seconds": 60},
        {
            "method_path": "suite.meet.api.meeting.refresh_guest_sfu_token",
            "limit": 30,
            "seconds": 60,
        },
        {"method_path": f"{room_method}.approve_join_request", "limit": 60, "seconds": 60},
        {"method_path": f"{room_method}.approve_all_join_requests", "limit": 10, "seconds": 60},
        {"method_path": f"{room_method}.reject_join_request", "limit": 60, "seconds": 60},
    ]

    old_paths = [
        "suite.meet.api.meeting.approve_join_request",
        "suite.meet.api.meeting.approve_all_join_requests",
        "suite.meet.api.meeting.reject_join_request",
    ]
    frappe.db.delete(
        "Rate Limit",
        {"method_path": ["in", old_paths + [rl["method_path"] for rl in rate_limits]]},
    )

    for rl in rate_limits:
        if not rl["method_path"].startswith(room_method):
            create_rate_limit(**rl)
            continue

        # Rate Limit validation resolves module functions only, while document methods
        # are addressed by their class-qualified path at runtime.
        frappe.get_doc(
            {
                "doctype": "Rate Limit",
                "enabled": 1,
                "ignore_in_developer_mode": 1,
                "methods": "ALL",
                "ip_based": 1,
                **rl,
            }
        ).db_insert()
        frappe.cache.hdel("rate_limits", rl["method_path"])
