# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import base64
import binascii
import secrets
import time

import frappe
import jwt
from frappe import _

from suite.meet import guest_access
from suite.meet.api.recording import get_active_recording_state
from suite.meet.doctype.meet_room.meet_room import MeetRoom
from suite.meet.utils.sfu_config import get_sfu_config
from suite.meet.utils.user import (
    get_user_info,
    validate_guest_name,
)
from suite.utils.rate_limiter import dynamic_rate_limit

_GUEST_PROOF_FIELD = "guest_session_token"
_REDACTED_PROOF = "[REDACTED]"


def _redact_guest_proof_from_request() -> None:
    request = getattr(frappe.local, "request", None)
    if not request:
        return

    if getattr(request, "is_json", False):
        json_body = request.json
        if isinstance(json_body, dict) and _GUEST_PROOF_FIELD in json_body:
            json_body[_GUEST_PROOF_FIELD] = _REDACTED_PROOF

    form = getattr(request, "form", None)
    if form and _GUEST_PROOF_FIELD in form:
        redacted_form = form.copy()
        redacted_form[_GUEST_PROOF_FIELD] = _REDACTED_PROOF
        request.form = redacted_form

    form_dict = getattr(frappe.local, "form_dict", None)
    if form_dict and _GUEST_PROOF_FIELD in form_dict:
        form_dict[_GUEST_PROOF_FIELD] = _REDACTED_PROOF


def _generate_sfu_token(
    user_id: str,
    meeting_id: str,
    scope: str = "full",
    expires_in: int = 3600,
    **extra,
) -> str:
    """Generate a JWT token for SFU authentication."""
    reserved_claims = {"user_id", "meeting_id", "site", "scope", "exp", "iat"}
    if reserved_claims.intersection(extra):
        frappe.throw(_("Reserved SFU token claims cannot be overridden"), frappe.ValidationError)

    sfu_config = get_sfu_config()
    secret = sfu_config.get("sfu_secret")
    if not secret:
        frappe.throw(_("SFU secret not configured"))

    now = int(time.time())
    payload = {
        "user_id": user_id,
        "meeting_id": meeting_id,
        "site": getattr(frappe.local, "site", None),
        "scope": scope,
        "exp": now + expires_in,
        "iat": now,
        **extra,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _get_codec_strategy() -> str:
    return frappe.get_cached_doc("Meet Settings").codec_strategy or "svc"


def _is_e2ee_enabled(meeting_id: str) -> bool:
    return bool(frappe.db.get_value("Meet Room", meeting_id, "e2ee_enabled"))


def _is_valid_e2ee_device_id(device_id: str | None) -> bool:
    """A device id is a short opaque client-chosen string (max 64 chars)."""
    if not device_id or not isinstance(device_id, str):
        return False
    return 1 <= len(device_id) <= 64 and all(c.isalnum() or c in "-_." for c in device_id)


def _user_payload(meeting, user) -> tuple[str, str | None, bool, bool]:
    """Return (fullname, avatar, is_host, is_cohost) for a signed-in user."""
    fullname, avatar = frappe.db.get_value("User", user, ["full_name", "user_image"]) or (
        user,
        None,
    )
    is_host = meeting.owner == user
    is_cohost = meeting.is_host_or_cohost(user) and not is_host
    return fullname, avatar, is_host, is_cohost


def _build_sfu_connection_details(meeting: MeetRoom, user: str) -> dict:
    """SFU JWT + endpoint payload for a signed-in user.

    Callers must enforce membership / join ACL first. Mints a full-scope media
    token from server-side identity only (never client-supplied claims).
    """
    if not user or user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)

    sfu_config = get_sfu_config()
    settings = frappe.get_cached_doc("Meet Settings")
    user_fullname, user_avatar, is_host, is_cohost = _user_payload(meeting, user)
    e2ee_required = bool(getattr(meeting, "e2ee_enabled", False))

    auth_token = _generate_sfu_token(
        user_id=user,
        meeting_id=meeting.name,
        scope="full",
        user_name=user_fullname,
        user_avatar=user_avatar,
        is_host=is_host,
        is_cohost=is_cohost,
        e2ee_required=e2ee_required,
    )

    return {
        "sfu_url": sfu_config["sfu_server_url"],
        "sfu_port": sfu_config["sfu_server_port"],
        "auth_token": auth_token,
        "user_id": user,
        "meeting_id": meeting.name,
        "is_host": is_host,
        "is_cohost": is_cohost,
        "codec_strategy": settings.codec_strategy or "svc",
        "recording_enabled": bool(settings.enable_recording),
        "e2ee_required": e2ee_required,
        "user_data": {
            "name": user_fullname,
            "email": user,
            "avatar": user_avatar,
        },
        "expires_in": 3600,
        "host_only_chat": bool(meeting.host_only_chat),
    }


def _build_guest_connection_details(
    meeting: MeetRoom,
    lease: guest_access.GuestLease,
    guest_session_token: str | None,
) -> dict:
    settings = frappe.get_cached_doc("Meet Settings")
    if not settings.allow_guest or not meeting.allow_guest:
        frappe.throw(_("Guests are not allowed in this meeting"), frappe.PermissionError)

    expires_in = guest_access.remaining_authorization_ttl(lease)
    if expires_in <= 0:
        frappe.throw(_("Guest lease expired"), frappe.PermissionError)
    sfu_config = get_sfu_config()
    e2ee_required = bool(getattr(meeting, "e2ee_enabled", False))
    auth_token = _generate_sfu_token(
        user_id=lease.guest_id,
        meeting_id=meeting.name,
        expires_in=expires_in,
        user_name=lease.guest_name,
        is_host=False,
        is_cohost=False,
        is_guest=True,
        e2ee_required=e2ee_required,
        guest_generation=lease.generation,
    )
    return {
        "status": "joined",
        "meeting_id": meeting.name,
        "guest_id": lease.guest_id,
        "guest_name": lease.guest_name,
        "guest_session_token": guest_session_token,
        "auth_token": auth_token,
        "expires_in": expires_in,
        "sfu_url": sfu_config["sfu_server_url"],
        "sfu_port": sfu_config["sfu_server_port"],
        "codec_strategy": _get_codec_strategy(),
        "host_only_chat": bool(meeting.host_only_chat),
        "e2ee_required": e2ee_required,
        "recording": get_active_recording_state(meeting.name),
        "message": "Successfully joined meeting",
    }


def _publish_waiting_room_updated(meeting: MeetRoom) -> None:
    waiting_count = len(meeting.get_waiting_room()) + len(guest_access.list_pending(meeting.name))
    frappe.publish_realtime(
        "meeting_waiting_room_updated",
        doctype=meeting.doctype,
        docname=meeting.name,
        message={"meeting": meeting.name, "waiting_count": waiting_count},
        after_commit=True,
    )


@frappe.whitelist()
@dynamic_rate_limit()
def create(meeting_type: str = "open", allow_guest: bool = True, title: str | None = None) -> str:
    """Create a new meeting with specified type"""
    global_settings = frappe.get_cached_doc("Meet Settings")
    if not global_settings.allow_guest:
        allow_guest = False

    meeting: MeetRoom = frappe.get_doc(
        {
            "doctype": "Meet Room",
            "title": title,
            "meeting_type": meeting_type,
            "allow_guest": allow_guest,
        }
    ).insert()

    return meeting.name


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def get_public_meeting_preview(meeting_id: str) -> dict:
    """Return title-only data for the meeting preview."""
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)
    settings = frappe.get_cached_doc("Meet Settings")
    is_public = bool(settings.allow_guest and meeting.allow_guest)
    user = frappe.session.user
    is_participant = user != "Guest" and (meeting.is_host_or_cohost(user) or user in meeting.get_members())
    if not is_public and not is_participant:
        frappe.throw(_("Access denied"), frappe.PermissionError)
    return {"title": meeting.title or meeting_id}


@frappe.whitelist()
def get_sfu_connection_details(meeting_id: str) -> dict:
    """
    Get SFU connection details for direct client-to-SFU communication
    """
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)
    user = frappe.session.user

    if meeting.is_user_banned(user):
        frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

    if user not in meeting.get_members():
        frappe.throw(_("Not a meeting member"), frappe.PermissionError)

    if not meeting.can_join(user):
        frappe.throw(_("Access denied"), frappe.PermissionError)

    return _build_sfu_connection_details(meeting, user)


@frappe.whitelist()
@dynamic_rate_limit()
def join_meeting(meeting_id: str) -> dict:
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id, for_update=True)

    if meeting.is_user_banned(frappe.session.user):
        frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

    if meeting.can_join(frappe.session.user):
        result = meeting.join(frappe.session.user)

        if isinstance(result, dict):
            if result.get("status") == "waiting_for_approval":
                sfu_config = get_sfu_config()

                user_fullname, user_avatar = frappe.db.get_value(
                    "User", frappe.session.user, ["full_name", "user_image"]
                ) or (frappe.session.user, None)

                lobby_token = _generate_sfu_token(
                    user_id=frappe.session.user,
                    meeting_id=meeting_id,
                    scope="presence-preview",
                    user_name=user_fullname,
                    user_avatar=user_avatar,
                    is_host=False,
                    is_guest=False,
                )

                return {
                    "status": "waiting_for_approval",
                    "meeting_id": meeting_id,
                    "message": result.get("message", "Waiting for host approval"),
                    "lobby_token": lobby_token,
                    "sfu_url": sfu_config["sfu_server_url"],
                    "sfu_port": sfu_config["sfu_server_port"],
                    "user_data": {
                        "name": user_fullname,
                        "avatar": user_avatar,
                    },
                }
            elif result.get("status") == "joined":
                user = frappe.session.user
                # Full media token only after membership is real (not lobby).
                if user not in meeting.get_members():
                    frappe.throw(_("Not a meeting member"), frappe.PermissionError)
                # Bundle SFU JWT so the client can skip a second
                # get_sfu_connection_details round-trip on the critical path.
                details = _build_sfu_connection_details(meeting, user)
                return {
                    "status": "joined",
                    "message": result.get("message", "Successfully joined meeting"),
                    **details,
                }
    else:
        frappe.throw(_("Access denied"))


@frappe.whitelist(methods=["POST"])
@dynamic_rate_limit()
def approve_join_request(meeting_id: str, user_id: str) -> dict:
    """Approve a user's join request from waiting room"""
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id, for_update=True)
    if not meeting.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only hosts and co-hosts can approve join requests"))
    if user_id.startswith("guest_"):
        lease = guest_access.admit(meeting_id, user_id)
        frappe.publish_realtime(
            "meet:guest_join_approved",
            {
                "meeting_id": meeting_id,
                "guest_id": user_id,
                "guest_name": lease.guest_name,
                "message": "Your join request has been approved",
            },
            room=f"guest:{user_id}",
            after_commit=True,
        )
        _publish_waiting_room_updated(meeting)
    else:
        meeting.approve_user(user_id)

    return {"meeting_id": meeting_id, "user_id": user_id, "message": "User approved successfully"}


@frappe.whitelist(methods=["POST"])
@dynamic_rate_limit()
def approve_all_join_requests(meeting_id: str) -> dict:
    """Approve all users' join requests from waiting room"""
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id, for_update=True)
    if not meeting.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only hosts and co-hosts can approve join requests"))
    meeting.approve_all_users()
    for lease in guest_access.list_pending(meeting_id):
        approve_join_request(meeting_id, lease.guest_id)

    return {"meeting_id": meeting_id, "message": "All users approved successfully"}


@frappe.whitelist(methods=["POST"])
@dynamic_rate_limit()
def reject_join_request(meeting_id: str, user_id: str) -> dict:
    """Reject a user's join request from waiting room"""
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id, for_update=True)
    if user_id.startswith("guest_"):
        if not meeting.is_host_or_cohost(frappe.session.user):
            frappe.throw(_("Only hosts and co-hosts can reject join requests"))
        guest_access.reject(meeting_id, user_id)
        frappe.publish_realtime(
            "meet:guest_join_rejected",
            {"meeting_id": meeting_id, "guest_id": user_id},
            room=f"guest:{user_id}",
            after_commit=True,
        )
        _publish_waiting_room_updated(meeting)
    else:
        meeting.reject_user(user_id)

    return {"meeting_id": meeting_id, "user_id": user_id, "message": "User rejected successfully"}


@frappe.whitelist()
def get_waiting_room(meeting_id: str) -> dict:
    """Get list of users waiting for approval"""
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)

    if not meeting.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Access denied"))

    user_details = []
    for row in meeting.waiting_room or []:
        user = row.user
        user_info = get_user_info(user)
        user_name = row.user_name or (user_info.get("full_name") if user_info else None)
        user_details.append(
            {
                "user_id": user,
                "full_name": user_name or user,
                "user_name": user_name or user,
                "user_image": user_info.get("user_image") if user_info else None,
                "is_guest": user_info.get("is_guest", False) if user_info else user.startswith("guest_"),
            }
        )

    user_details.extend(
        {
            "user_id": lease.guest_id,
            "full_name": lease.guest_name,
            "user_name": lease.guest_name,
            "user_image": None,
            "is_guest": True,
        }
        for lease in guest_access.list_pending(meeting_id)
    )

    return {"meeting_id": meeting_id, "waiting_users": user_details}


@frappe.whitelist()
@dynamic_rate_limit()
def refresh_sfu_token(meeting_id: str) -> dict:
    """
    Refresh SFU authentication token for ongoing meetings
    """
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)

    if meeting.is_user_banned(frappe.session.user):
        frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

    if frappe.session.user not in meeting.get_members():
        frappe.throw(_("Not a meeting member"), frappe.PermissionError)

    if not meeting.can_join(frappe.session.user):
        frappe.throw(_("Access denied"), frappe.PermissionError)

    user_fullname, user_avatar, is_host, is_cohost = _user_payload(meeting, frappe.session.user)
    e2ee_required = bool(getattr(meeting, "e2ee_enabled", False))

    auth_token = _generate_sfu_token(
        user_id=frappe.session.user,
        meeting_id=meeting_id,
        user_name=user_fullname,
        user_avatar=user_avatar,
        is_host=is_host,
        is_cohost=is_cohost,
        e2ee_required=e2ee_required,
    )

    return {
        "auth_token": auth_token,
        "expires_in": 3600,
        "codec_strategy": _get_codec_strategy(),
        "e2ee_required": e2ee_required,
    }


@frappe.whitelist()
def get_sfu_presence_preview_token(meeting_id: str) -> dict:
    """Get a short-lived SFU token scoped for presence preview only.

    This is used by the meeting preview page to fetch live participants
    from the SFU without granting any media capabilities.
    """

    try:
        meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)
    except frappe.DoesNotExistError:
        frappe.throw(_("Meeting not found"))

    if meeting.is_user_banned(frappe.session.user):
        frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

    if not meeting.can_join(frappe.session.user):
        frappe.throw(_("Access denied"), frappe.PermissionError)

    if meeting.meeting_type == "restricted" and not meeting.is_user_approved(frappe.session.user):
        return {"restricted_preview": True}

    sfu_config = get_sfu_config()

    expiry_seconds = 300
    session_id = str(secrets.token_urlsafe(16))
    user_name, user_avatar, is_host, is_cohost = _user_payload(meeting, frappe.session.user)

    auth_token = _generate_sfu_token(
        user_id=frappe.session.user,
        meeting_id=meeting_id,
        scope="presence-preview",
        expires_in=expiry_seconds,
        session_id=session_id,
        user_name=user_name,
        user_avatar=user_avatar,
        is_host=is_host,
        is_cohost=is_cohost,
        is_guest=False,
    )

    return {
        "sfu_url": sfu_config["sfu_server_url"],
        "sfu_port": sfu_config.get("sfu_server_port"),
        "auth_token": auth_token,
        "expires_in": expiry_seconds,
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
@dynamic_rate_limit()
def join_meeting_as_guest(
    meeting_id: str,
    guest_name: str,
    guest_id: str | None = None,
    guest_session_token: str | None = None,
) -> dict:
    """
    Allow guest users to join a meeting without authentication.
    Generates a guest session and JWT token for SFU access.
    """
    _redact_guest_proof_from_request()
    is_valid, error_message = validate_guest_name(guest_name)
    if not is_valid:
        frappe.throw(_(error_message))

    rate_limited = not guest_id or not guest_session_token
    if rate_limited:
        guest_access.enforce_fresh_join_rate_limit(
            str(getattr(frappe.local, "request_ip", None) or "unknown")
        )

    lease = guest_access.resume_for_join(meeting_id, guest_id, guest_session_token)
    if lease is None and not rate_limited:
        guest_access.enforce_fresh_join_rate_limit(
            str(getattr(frappe.local, "request_ip", None) or "unknown")
        )

    if not frappe.db.exists("Meet Room", meeting_id):
        frappe.throw(_("Meeting not found"))

    meeting = frappe.get_doc("Meet Room", meeting_id)

    global_settings = frappe.get_cached_doc("Meet Settings")
    if not global_settings.allow_guest or not meeting.allow_guest:
        frappe.throw(_("Guests are not allowed in this meeting"))
    created = lease is None
    if created:
        lease, guest_session_token = guest_access.create_lease(
            meeting_id,
            guest_name.strip(),
            admitted=meeting.meeting_type != "restricted",
        )

    if lease.status == "pending":
        if created:
            waiting_count = len(meeting.get_waiting_room()) + len(guest_access.list_pending(meeting_id))
            meeting.publish_waiting_room_request(lease.guest_id, waiting_count)
        return {
            "status": "waiting_for_approval",
            "meeting_id": meeting_id,
            "guest_id": lease.guest_id,
            "guest_name": lease.guest_name,
            "guest_session_token": guest_session_token,
            "message": "Waiting for host approval",
            "host_only_chat": bool(meeting.host_only_chat),
        }

    return _build_guest_connection_details(meeting, lease, guest_session_token)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@dynamic_rate_limit()
def get_approved_guest_connection_details(
    meeting_id: str,
    guest_id: str,
    guest_session_token: str | None = None,
) -> dict:
    """
    Get SFU connection details for an approved guest.
    This is called after a guest receives approval notification.
    """
    _redact_guest_proof_from_request()
    if not frappe.db.exists("Meet Room", meeting_id):
        frappe.throw(_("Meeting not found"))

    meeting = frappe.get_doc("Meet Room", meeting_id)
    lease = guest_access.authorize(
        meeting_id,
        guest_id,
        guest_session_token,
        statuses={"admitted"},
    )
    return _build_guest_connection_details(meeting, lease, guest_session_token)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@dynamic_rate_limit()
def refresh_guest_sfu_token(
    meeting_id: str,
    guest_id: str,
    guest_session_token: str | None = None,
) -> dict:
    _redact_guest_proof_from_request()
    if not frappe.db.exists("Meet Room", meeting_id):
        frappe.throw(_("Meeting not found"))
    lease = guest_access.authorize(
        meeting_id,
        guest_id,
        guest_session_token,
        statuses={"admitted"},
    )
    return _build_guest_connection_details(
        frappe.get_doc("Meet Room", meeting_id),
        lease,
        guest_session_token,
    )


@frappe.whitelist(methods=["POST"])
def ban_guest(meeting_id: str, guest_id: str) -> dict:
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)
    if not meeting.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only hosts and co-hosts can ban guests"), frappe.PermissionError)
    guest_access.ban(meeting_id, guest_id)
    return {"meeting_id": meeting_id, "guest_id": guest_id, "status": "banned"}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@dynamic_rate_limit(trusted_socket_bypass=True)
def validate_guest_session(
    meeting_id: str,
    guest_id: str,
    guest_session_token: str | None = None,
) -> dict:
    """Return active validity and any proof-bound lease status."""
    _redact_guest_proof_from_request()
    status = guest_access.get_status(meeting_id, guest_id, guest_session_token)
    result: dict[str, bool | str] = {"valid": status in guest_access.ACTIVE_STATUSES}
    if status is not None:
        result["status"] = status
    return result


@frappe.whitelist()
def promote_to_cohost(meeting_id: str, user_id: str) -> dict:
    """
    Promote a user to co-host during an active meeting (host only)
    """
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id, for_update=True)
    return meeting.promote_to_cohost(frappe.session.user, user_id)


@frappe.whitelist(allow_guest=True)
@dynamic_rate_limit()
def check_meeting_access(meeting_id: str) -> dict:
    """
    Check if a meeting allows guest access without authentication

    Args:
            meeting_id: The meeting ID to check

    Returns:
            dict: Access information for the meeting
    """
    try:
        meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)
    except frappe.DoesNotExistError:
        return {"allow_guest": False}

    settings = frappe.get_cached_doc("Meet Settings")
    if not (settings.allow_guest and meeting.allow_guest):
        return {"allow_guest": False}

    return {"allow_guest": True, "host_only_chat": bool(meeting.host_only_chat)}


@frappe.whitelist()
def get_meeting_e2ee_details(meeting_id: str) -> dict:
    """Return E2EE status for hosts/co-hosts.

    Hosts see the full key proof + host X25519 pubkey so they can recover
    their own identity on a different device only if they still have the
    signing device (per-device ed25519 keys; see ADR 0003).
    """
    meeting: MeetRoom = frappe.get_doc("Meet Room", meeting_id)

    if not meeting.is_host_or_cohost(frappe.session.user):
        frappe.throw(_("Only hosts and co-hosts can view E2EE details"), frappe.PermissionError)

    return {
        "e2ee_enabled": bool(getattr(meeting, "e2ee_enabled", False)),
    }


@frappe.whitelist()
def register_e2ee_device(
    device_id: str,
    ed25519_public_key: str,
) -> dict:
    """Register a per-device ed25519 public key for the current user.

    Used to bind an epoch member key package to a device identity. The client
    generates the keypair locally and uploads only the public key.
    """
    if not _is_valid_e2ee_device_id(device_id):
        frappe.throw(_("device_id must be 1-64 chars of [a-zA-Z0-9._-]"), frappe.ValidationError)

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required"), frappe.AuthenticationError)
    if not isinstance(ed25519_public_key, str):
        frappe.throw(_("ed25519_public_key must be base64"), frappe.ValidationError)

    try:
        raw = base64.b64decode(ed25519_public_key, validate=True)
    except binascii.Error:
        frappe.throw(_("ed25519_public_key must be base64"), frappe.ValidationError)
    if len(raw) != 32 or base64.b64encode(raw).decode("ascii") != ed25519_public_key:
        frappe.throw(_("ed25519_public_key must decode to 32 bytes"), frappe.ValidationError)

    user = frappe.session.user
    # Upsert the (user, device_id) pair into the E2EE Device Key DocType.
    if not _update_e2ee_device_key(user, device_id, ed25519_public_key):
        doc = frappe.new_doc("E2EE Device Key")
        doc.user = user
        doc.device_id = device_id
        doc.ed25519_public_key = ed25519_public_key
        # Users may register only their own public E2EE device key through this validated API.
        try:
            doc.insert(ignore_permissions=True)
        except frappe.DuplicateEntryError:
            # Lost a concurrent insert race after the initial lookup. The DB unique
            # constraint guarantees there is now exactly one row to update.
            if not _update_e2ee_device_key(user, device_id, ed25519_public_key):
                raise

    return {"device_id": device_id, "ed25519_public_key": ed25519_public_key}


def _update_e2ee_device_key(user: str, device_id: str, ed25519_public_key: str) -> bool:
    existing_name = frappe.db.get_value("E2EE Device Key", {"user": user, "device_id": device_id}, "name")
    if not existing_name:
        return False
    frappe.db.set_value(
        "E2EE Device Key",
        existing_name,
        "ed25519_public_key",
        ed25519_public_key,
        update_modified=False,
    )
    return True
