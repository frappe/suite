import hashlib
import json
import secrets
import time
from dataclasses import asdict, dataclass

import frappe

PENDING_TTL = 30 * 60
LEASE_TTL = 24 * 60 * 60
GUEST_TOKEN_TTL = 5 * 60
TERMINAL_TTL = 5 * 60
ROOM_INDEX_TTL = LEASE_TTL + TERMINAL_TTL
FRESH_JOIN_RATE_LIMIT = 10
FRESH_JOIN_RATE_WINDOW = 60 * 60

ACTIVE_STATUSES = {"pending", "admitted"}
TERMINAL_STATUSES = {"expired", "rejected", "banned"}

_COMPARE_AND_REPLACE = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
if ARGV[4] == '1' then
    redis.call('ZADD', KEYS[2], ARGV[5], ARGV[6])
else
    redis.call('ZREM', KEYS[2], ARGV[6])
end
if redis.call('EXISTS', KEYS[2]) == 1 then
    redis.call('EXPIRE', KEYS[2], ARGV[7])
end
return 1
"""

_COMPARE_AND_DELETE = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
return 1
"""

_INCREMENT_WITH_EXPIRY = """
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


class GuestAccessDenied(frappe.PermissionError):
    pass


class GuestLeaseExpired(GuestAccessDenied):
    pass


@dataclass(frozen=True)
class GuestLease:
    guest_id: str
    proof_digest: str
    room_id: str
    guest_name: str
    status: str
    created_at: int
    expires_at: int
    absolute_expires_at: int
    generation: int


def create_lease(room_id: str, guest_name: str, *, admitted: bool) -> tuple[GuestLease, str]:
    now = int(time.time())
    guest_id = f"guest_{secrets.token_urlsafe(24)}"
    session_token = secrets.token_urlsafe(24)
    absolute_expires_at = now + LEASE_TTL
    lease = GuestLease(
        guest_id=guest_id,
        proof_digest=_digest(session_token),
        room_id=room_id,
        guest_name=guest_name,
        status="admitted" if admitted else "pending",
        created_at=now,
        expires_at=absolute_expires_at if admitted else now + PENDING_TTL,
        absolute_expires_at=absolute_expires_at,
        generation=1,
    )
    _write_new(lease)
    return lease, session_token


def enforce_fresh_join_rate_limit(ip_address: str) -> None:
    count = frappe.cache.eval(
        _INCREMENT_WITH_EXPIRY,
        1,
        _fresh_join_rate_key(ip_address),
        FRESH_JOIN_RATE_WINDOW,
    )
    if count > FRESH_JOIN_RATE_LIMIT:
        frappe.throw(
            "Too many guest join attempts. Please try again later.",
            frappe.RateLimitExceededError,
        )


def resume_for_join(
    room_id: str,
    guest_id: str | None,
    session_token: str | None,
) -> GuestLease | None:
    if not guest_id or not session_token:
        return None
    lease = _read(guest_id)
    if not lease:
        return None
    if not secrets.compare_digest(lease.proof_digest, _digest(session_token)):
        return None
    if lease.room_id != room_id:
        raise GuestAccessDenied("Guest lease belongs to another room")
    lease = _require_live(lease)
    if lease.status in TERMINAL_STATUSES:
        raise GuestAccessDenied(f"Guest lease is {lease.status}")
    if lease.status not in ACTIVE_STATUSES:
        return None
    return lease


def authorize(
    room_id: str,
    guest_id: str,
    session_token: str | None,
    *,
    statuses: set[str] | None = None,
) -> GuestLease:
    if not session_token:
        raise GuestAccessDenied("Guest session proof required")
    lease = _read(guest_id)
    if not lease or not secrets.compare_digest(lease.proof_digest, _digest(session_token)):
        raise GuestAccessDenied("Invalid guest session")
    if lease.room_id != room_id:
        raise GuestAccessDenied("Guest lease belongs to another room")
    lease = _require_live(lease)
    if statuses is not None and lease.status not in statuses:
        raise GuestAccessDenied("Guest access denied")
    return lease


def validate(room_id: str, guest_id: str, session_token: str | None) -> bool:
    return get_status(room_id, guest_id, session_token) in ACTIVE_STATUSES


def get_status(room_id: str, guest_id: str, session_token: str | None) -> str | None:
    try:
        lease = authorize(room_id, guest_id, session_token)
    except GuestAccessDenied:
        return None
    return lease.status


def get_guest(guest_id: str) -> GuestLease | None:
    lease = _read(guest_id)
    if not lease:
        return None
    try:
        lease = _require_live(lease)
    except GuestLeaseExpired:
        return None
    return lease if lease.status in ACTIVE_STATUSES else None


def list_pending(room_id: str) -> list[GuestLease]:
    return _list_room(room_id, "pending")


def list_admitted(room_id: str) -> list[GuestLease]:
    return _list_room(room_id, "admitted")


def _list_room(room_id: str, status: str) -> list[GuestLease]:
    now = int(time.time())
    index_key = _room_key(room_id)
    guest_ids = frappe.cache.zrangebyscore(index_key, now + 1, "+inf")
    matches = []
    for raw_guest_id in guest_ids:
        guest_id = _text(raw_guest_id)
        lease = _read(guest_id)
        if not lease or lease.room_id != room_id:
            frappe.cache.zrem(index_key, guest_id)
            continue
        if lease.expires_at <= now:
            continue
        if lease.status == status:
            matches.append(lease)
    frappe.cache.zremrangebyscore(index_key, "-inf", now)
    return matches


def admit(room_id: str, guest_id: str) -> GuestLease:
    return _transition(room_id, guest_id, {"pending", "admitted"}, "admitted")


def reject(room_id: str, guest_id: str) -> GuestLease:
    return _transition(room_id, guest_id, {"pending"}, "rejected")


def ban(room_id: str, guest_id: str) -> GuestLease:
    return _transition(room_id, guest_id, {"pending", "admitted"}, "banned")


def remaining_authorization_ttl(lease: GuestLease) -> int:
    return min(GUEST_TOKEN_TTL, max(0, lease.expires_at - int(time.time())))


def _transition(
    room_id: str,
    guest_id: str,
    allowed_statuses: set[str],
    status: str,
) -> GuestLease:
    lock = frappe.cache.lock(_lock_key(room_id), timeout=15)
    if not lock.acquire(blocking=True, blocking_timeout=5):
        raise RuntimeError("Guest access is busy")
    try:
        lease = _read(guest_id)
        if not lease or lease.room_id != room_id:
            raise GuestAccessDenied("Guest lease not found")
        lease = _require_live(lease)
        if lease.status == status:
            return lease
        if lease.status not in allowed_statuses:
            raise GuestAccessDenied("Guest transition denied")
        expires_at = lease.absolute_expires_at if status == "admitted" else int(time.time()) + TERMINAL_TTL
        updated = GuestLease(
            **{
                **asdict(lease),
                "status": status,
                "expires_at": expires_at,
                "generation": lease.generation + 1,
            }
        )
        if not _write(updated, expected=lease):
            raise GuestAccessDenied("Guest lease changed during transition")
        return updated
    finally:
        lock.release()


def _require_live(lease: GuestLease) -> GuestLease:
    now = int(time.time())
    if lease.expires_at > now:
        return lease

    if lease.status in ACTIVE_STATUSES:
        expired = GuestLease(
            **{
                **asdict(lease),
                "status": "expired",
                "expires_at": now + TERMINAL_TTL,
                "generation": lease.generation + 1,
            }
        )
        if _write(expired, expected=lease, indexed=False):
            return expired
    else:
        _delete(lease)

    current = _read(lease.guest_id)
    if current and current != lease:
        return _require_live(current)
    raise GuestLeaseExpired("Guest lease expired")


def _read(guest_id: str) -> GuestLease | None:
    raw = frappe.cache.get(_guest_key(guest_id))
    if raw is None:
        return None
    try:
        value = json.loads(_text(raw))
        return GuestLease(**value)
    except (TypeError, ValueError, KeyError):
        return None


def _write_new(lease: GuestLease) -> None:
    ttl = _retention_ttl(lease)
    pipeline = frappe.cache.pipeline(transaction=True)
    pipeline.set(_guest_key(lease.guest_id), _serialize(lease), ex=ttl, nx=True)
    pipeline.zadd(_room_key(lease.room_id), {lease.guest_id: lease.expires_at})
    pipeline.expire(_room_key(lease.room_id), ROOM_INDEX_TTL)
    result = pipeline.execute()
    if len(result) != 3 or result[0] is not True or result[2] is not True:
        raise RuntimeError("Failed to create guest lease")


def _write(lease: GuestLease, *, expected: GuestLease, indexed: bool = True) -> bool:
    return bool(
        frappe.cache.eval(
            _COMPARE_AND_REPLACE,
            2,
            _guest_key(lease.guest_id),
            _room_key(lease.room_id),
            _serialize(expected),
            _serialize(lease),
            _retention_ttl(lease),
            int(indexed),
            lease.expires_at,
            lease.guest_id,
            ROOM_INDEX_TTL,
        )
    )


def _delete(lease: GuestLease) -> bool:
    return bool(
        frappe.cache.eval(
            _COMPARE_AND_DELETE,
            2,
            _guest_key(lease.guest_id),
            _room_key(lease.room_id),
            _serialize(lease),
            lease.guest_id,
        )
    )


def _retention_ttl(lease: GuestLease) -> int:
    ttl = lease.expires_at - int(time.time())
    if lease.status in ACTIVE_STATUSES:
        ttl += TERMINAL_TTL
    return max(1, ttl)


def _serialize(lease: GuestLease) -> str:
    return json.dumps(asdict(lease))


def _digest(session_token: str) -> str:
    return hashlib.sha256(session_token.encode()).hexdigest()


def _site() -> str:
    return str(frappe.local.site)


def _guest_key(guest_id: str) -> str:
    return f"meet:guest-lease:{_site()}:{guest_id}"


def _room_key(room_id: str) -> str:
    return f"meet:guest-room:{_site()}:{room_id}"


def _lock_key(room_id: str) -> str:
    return f"meet:guest-lock:{_site()}:{room_id}"


def _fresh_join_rate_key(ip_address: str) -> bytes:
    return frappe.cache.make_key(
        f"rl:suite.meet.api.meeting.join_meeting_as_guest:fresh:{_digest(ip_address)}"
    )


def _text(value: str | bytes) -> str:
    return value.decode() if isinstance(value, bytes) else value
