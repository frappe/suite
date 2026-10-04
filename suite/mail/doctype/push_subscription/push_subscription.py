# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
import json
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from uuid import uuid7

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today
from frappe.utils.file_lock import LockTimeoutError
from frappe.utils.synchronization import filelock
from jmap import MethodError
from jmap.models.push import CalendarAlert, PushVerification, StateChange
from jmap.push import PushKeyPair, PushPayloadError, read_push

from suite.mail.jmap import (
    MailServerUnavailableError,
    SetResult,
    chunked_set,
    format_method_error,
    format_set_error,
    get_jmap_client,
    never_applied,
)
from suite.mail.utils import generate_uuid_style_hash, log_mail_error
from suite.mail.utils.dt import normalize_utc_z
from suite.mail.utils.user import get_jmap_configured_users, is_jmap_configured
from suite.utils import enqueue_job, parse_filters
from suite.utils.dt import get_utc_now, parse_iso_datetime
from suite.utils.user import is_system_manager
from suite.utils.validation import JSONList

# Renew push subscriptions that expire within this many days of the scheduled run.
RENEW_THRESHOLD_DAYS = 3


class PushSubscription(Document):
    @property
    def _types(self) -> list[str]:
        """Returns the types of push subscriptions as a list."""

        types = []
        if self.types:
            types = json.loads(self.types)

        return types

    def db_insert(self, *args, **kwargs) -> None:
        self.id = _add_push_subscription(
            self.user,
            self.device_client_id,
            self.url,
            self._types,
            ignore_permissions=bool(self.flags.ignore_permissions),
        )
        self.name = f"{self.user}|{self.id}"

    def load_from_db(self) -> PushSubscription:
        user, id = self.name.split("|")
        subscription = get_push_subscription(user, id)
        return super(Document, self).__init__(subscription)

    def db_update(self) -> None:
        raise NotImplementedError

    def delete(self) -> None:
        user, id = self.name.split("|")
        delete_push_subscriptions(user, [id])

    @staticmethod
    def get_list(filters=None, page_length=20, **kwargs) -> list:
        filters = parse_filters(filters)
        id = filters.get("id")
        user = filters.get("user")

        if not user:
            frappe.msgprint(_("Please select a user to view push subscriptions."), alert=True)
            return []

        subscriptions = []
        if id:
            if subscription := get_push_subscription(user, id, raise_exception=False):
                subscriptions.append(subscription)
        else:
            subscriptions = fetch_push_subscriptions(user, limit=page_length)

        if not subscriptions:
            frappe.msgprint(_("No push subscriptions found."), alert=True)

        return subscriptions

    @staticmethod
    def get_count(filters=None, **kwargs) -> int:
        filters = parse_filters(filters)
        user = filters.get("user")

        if user and has_permission_for_user(user, raise_exception=False):
            return cint(frappe.cache.get_value(_get_total_cache_key(user)))

        return 0

    @staticmethod
    def get_stats(**kwargs) -> dict:
        return {}

    def validate(self) -> None:
        self.validate_url()

    def validate_url(self) -> None:
        """Validates the URL to ensure it starts with 'https://'."""

        if self.url and not self.url.startswith("https://"):
            frappe.throw(_("The URL must start with 'https://'."))

    @frappe.whitelist()
    def renew(self) -> None:
        """Renews the push subscription subscription."""

        renew_push_subscription(self.user, self.id)


def _get_total_cache_key(user: str) -> str:
    """Returns a cache key for total push subscriptions count for the given user."""

    return f"{user}:push_subscriptions:total"


def _fetch_subscriptions(
    user: str,
    ids: list[str] | None = None,
    ignore_permissions: bool = False,
    allow_disabled: bool = False,
) -> list[dict]:
    """Returns raw PushSubscription objects for the user, all of them when `ids` is None.

    PushSubscription is user-scoped, not account-scoped — requests carry no accountId, so the
    user client is used directly (never an account view).
    """

    client = get_jmap_client(user, ignore_permissions=ignore_permissions, allow_disabled=allow_disabled)
    with client.batch() as b:
        h = b.core.push_subscription.get(ids=ids) if ids is not None else b.core.push_subscription.get()

    return [s.to_wire() for s in h.result.items]


def _set_subscriptions(
    user: str,
    *,
    create: dict | None = None,
    update: dict | None = None,
    destroy: list[str] | None = None,
    ignore_permissions: bool = False,
    allow_disabled: bool = False,
) -> SetResult:
    """Runs a PushSubscription/set for the user, chunked by the server's set limit."""

    client = get_jmap_client(user, ignore_permissions=ignore_permissions, allow_disabled=allow_disabled)

    if create is not None:
        return chunked_set(client, lambda b, chunk: b.core.push_subscription.set(create=chunk), create)
    if update is not None:
        return chunked_set(client, lambda b, chunk: b.core.push_subscription.set(update=chunk), update)
    return chunked_set(client, lambda b, chunk: b.core.push_subscription.set(destroy=chunk), destroy or [])


def is_push_subscription_disabled(user: str, raise_exception: bool = False) -> bool:
    """Returns True if push subscriptions are disabled for the given user in their User Settings."""

    disabled = bool(frappe.db.get_value("User Settings", {"user": user}, "disable_push_subscriptions"))

    if disabled and raise_exception:
        frappe.throw(
            _("Push subscriptions are disabled for user {0} in their User Settings.").format(
                frappe.bold(user)
            ),
            title=_("Push Subscriptions Disabled"),
        )

    return disabled


@frappe.whitelist()
def bulk_delete(names: JSONList[str]) -> None:
    """Deletes multiple push subscriptions given their names."""

    user_ids_map = {}
    for name in names:
        user, id = name.split("|")
        user_ids_map.setdefault(user, []).append(id)

    for user, ids in user_ids_map.items():
        delete_push_subscriptions(user, ids)

    frappe.msgprint(_("Push Subscriptions deleted successfully."), alert=True)


def get_site_device_client_id(user: str) -> str:
    """Returns this site's deterministic device client id for the user.

    Deterministic so the site's own subscription on the mail server can be recognized
    (and healed) without storing anything locally.
    """

    return generate_uuid_style_hash(f"frappe-{frappe.local.site.replace('.', '-')}-{user}")


def ensure_push_subscription(user: str) -> None:
    """Creates this site's push subscription for the user if the mail server holds none.

    A subscription lost to a failed creation, an unrenewed expiry or a server-side delete
    silently ends the user's webhooks — and with them both realtime events and mailbox-count
    cache invalidation. The device client id is deterministic per site+user, so presence is
    a plain lookup. A per-user lock serializes overlapping runs (login healing vs. the daily
    renewal job) so they cannot both observe the subscription as missing and create it twice;
    a run that cannot get the lock skips, since the holder is doing the same work.
    """

    if not frappe.utils.get_url().startswith("https://"):
        return
    if is_push_subscription_disabled(user):
        return

    try:
        with filelock(f"ensure_push_subscription_{user}"):
            _heal_push_subscription(user, _fetch_subscriptions(user, ignore_permissions=True))
    except LockTimeoutError:
        return


def _heal_push_subscription(user: str, subscriptions: list[dict]) -> list[str]:
    """Healing core over an already-fetched subscription list; call under the per-user lock.

    Deletes this site's expired subscriptions and, when duplicates exist, every live one
    but the longest-lived (deletion is best-effort: dead weight the server purges eventually
    anyway, so a failure must not block the replacement). Creates a fresh subscription
    unless a live one remains. Returns the ids it deleted so a caller reusing
    ``subscriptions`` can drop them.

    Subscriptions created before device ids were kept exclusive may wear the site id
    over a custom URL. The server exposes nothing to tell them apart (url is never
    returned on get, and Stalwart normalizes a null types filter to the full type
    list), so pruning may remove such a legacy subscription once; recreating it
    assigns a unique id, taking it permanently out of healing's reach.
    """

    device_client_id = get_site_device_client_id(user)
    now = get_utc_now()

    live = []
    expired_ids = []
    for subscription in subscriptions:
        if subscription.get("deviceClientId") != device_client_id:
            continue
        expires = subscription.get("expires")
        if not expires or parse_iso_datetime(expires, as_str=False) > now:
            live.append(subscription)
        else:
            expired_ids.append(subscription["id"])

    # Converge on one live subscription: a duplicate (say a manual creation landing next
    # to a healing run's) would otherwise ride the daily renewal forever.
    surplus_ids = []
    if len(live) > 1:
        live.sort(key=_subscription_longevity, reverse=True)
        surplus_ids = [subscription["id"] for subscription in live[1:]]

    if delete_ids := expired_ids + surplus_ids:
        with suppress(Exception):
            _set_subscriptions(user, destroy=delete_ids, ignore_permissions=True)

    if not live:
        _create_push_subscription(user, ignore_permissions=True)

    return delete_ids


def _subscription_longevity(subscription: dict) -> datetime:
    """Sort key: when the subscription dies; no expiry means never."""

    expires = subscription.get("expires")
    return parse_iso_datetime(expires, as_str=False) if expires else datetime.max.replace(tzinfo=UTC)


def on_login(login_manager) -> None:
    """Login hook: heal the user's push subscription in the background.

    Enqueued so the JMAP round trips never sit in the login path, and deduplicated
    per user so a burst of logins queues one job.
    """

    user = login_manager.user
    if user in ("Guest", "Administrator") or not is_jmap_configured(user):
        return

    enqueue_job(
        ensure_push_subscription,
        user=user,
        queue="short",
        job_id=f"ensure_push_subscription:{user}",
        deduplicate=True,
        enqueue_after_commit=True,
    )


@frappe.whitelist()
def add_push_subscription(
    user: str,
    device_client_id: str | None = None,
    url: str | None = None,
    types: list[str] | None = None,
) -> str:
    """Adds a push subscription subscription for the given user and returns the subscription ID."""

    return _add_push_subscription(user, device_client_id, url, types)


def _add_push_subscription(
    user: str,
    device_client_id: str | None = None,
    url: str | None = None,
    types: list[str] | None = None,
    ignore_permissions: bool = False,
) -> str:
    """Internal worker for :func:`add_push_subscription`.

    ``ignore_permissions`` is deliberately kept off the whitelisted wrapper: frappe binds request
    parameters onto a whitelisted function's named arguments, so exposing it would let any caller
    turn off the ownership check and register an attacker-controlled callback URL against another
    user's account.

    Serialized under the same per-user lock healing uses, so a manual creation cannot
    interleave with a healing run's check-then-create. A default creation (no explicit
    device client id, url or types) is idempotent: when a live site subscription already
    exists, perhaps created by a healing run while this request waited on the lock, its
    id is returned instead of creating a duplicate. A custom creation without an explicit
    device client id gets a unique one, keeping the site's deterministic id exclusive to
    the site subscription so healing never prunes a custom webhook as its duplicate;
    explicitly claiming the site id for a custom creation is rejected.
    """

    if not ignore_permissions:
        has_permission_for_user(user, raise_exception=True)

    is_push_subscription_disabled(user, raise_exception=True)

    site_device_client_id = get_site_device_client_id(user)
    is_site_default = (
        not url and not types and (device_client_id or site_device_client_id) == site_device_client_id
    )

    try:
        # A healing run holds the lock for a couple of JMAP round trips; 10 seconds is
        # generous. On timeout, surface a retryable message instead of the raw lock error
        # (which advises deleting the lock file) after a 30 second modal hang.
        with filelock(f"ensure_push_subscription_{user}", timeout=10):
            # Healing may have created the site's subscription while this request waited
            # on the lock, or one may simply already exist: the default creation is
            # idempotent and returns the live subscription instead of adding a duplicate.
            if is_site_default and (existing_id := _live_site_subscription_id(user, ignore_permissions)):
                return existing_id

            return _create_push_subscription(user, device_client_id, url, types, ignore_permissions)
    except LockTimeoutError:
        frappe.throw(
            _(
                "Push subscriptions for {0} are currently being updated. Please try again in a few moments."
            ).format(frappe.bold(user)),
            title=_("Push Subscription Creation Error"),
        )


def _create_push_subscription(
    user: str,
    device_client_id: str | None = None,
    url: str | None = None,
    types: list[str] | None = None,
    ignore_permissions: bool = False,
) -> str:
    """Unlocked creation core for :func:`_add_push_subscription` and the healing path,
    which already holds the per-user lock."""

    site_device_client_id = get_site_device_client_id(user)
    if not device_client_id:
        # The deterministic site id marks the site's own subscription for healing; a custom
        # creation must not wear it, or healing would prune one of the two as a duplicate.
        device_client_id = site_device_client_id if not url and not types else str(uuid7())
    elif device_client_id == site_device_client_id and (url or types):
        frappe.throw(
            _(
                "The device client id {0} is reserved for this site's own subscription and cannot be"
                " used with a custom URL or types. Leave it empty to have a unique id assigned."
            ).format(frappe.bold(device_client_id)),
            title=_("Push Subscription Creation Error"),
        )
    if url:
        if not url.startswith("https://"):
            frappe.throw(_("The URL must start with 'https://'."))
    else:
        site_url = frappe.utils.get_url()
        if not site_url.startswith("https://"):
            frappe.throw(
                _(
                    "Cannot use the site URL {0} as the push endpoint because the site is not served over HTTPS."
                ).format(frappe.bold(site_url))
            )
        url = f"{site_url}/api/method/suite.mail.api.jmap.push_notification?user={user}"

    types = types or None

    title = _("Push Subscription Creation Error")
    creation_id = str(uuid7())
    creation = {
        "deviceClientId": device_client_id,
        "url": url,
        # None values go out as null: null keys means no encryption, null types means all types.
        "keys": get_push_subscription_keys(),
        "types": types,
    }

    try:
        result = _set_subscriptions(
            user, create={creation_id: creation}, ignore_permissions=ignore_permissions
        )
    except MethodError as e:
        frappe.throw(format_method_error(e), title=title)

    if created := result.created.get(creation_id):
        return created.id

    frappe.throw(_(format_set_error(result.not_created.get(creation_id))), title=title)


def _live_site_subscription_id(user: str, ignore_permissions: bool = False) -> str | None:
    """Returns the id of the longest-lived live subscription bearing this site's device
    client id (the one healing's pruning would keep), or None when none is live."""

    device_client_id = get_site_device_client_id(user)
    now = get_utc_now()

    live = []
    for subscription in _fetch_subscriptions(user, ignore_permissions=ignore_permissions):
        if subscription.get("deviceClientId") != device_client_id:
            continue
        expires = subscription.get("expires")
        if not expires or parse_iso_datetime(expires, as_str=False) > now:
            live.append(subscription)

    if live:
        return max(live, key=_subscription_longevity)["id"]


@frappe.whitelist()
def get_push_subscription(user: str, id: str, raise_exception: bool = True) -> dict | None:
    """Returns push subscription details for the given name in the format 'user|id'."""

    has_permission_for_user(user, raise_exception=raise_exception)

    if subscriptions := _fetch_subscriptions(user, [id]):
        return format_push_subscription(user, subscriptions[0])

    if raise_exception:
        frappe.throw(
            _("Push Subscription with ID {0} not found for user {1}.").format(
                frappe.bold(id), frappe.bold(user)
            ),
            title=_("Push Subscription Not Found"),
        )


def verify_push_subscription(user: str, id: str, verification_code: str) -> None:
    """Verifies a push subscription for the given user, subscription ID, and verification code."""

    if not frappe.db.exists("User", {"name": user, "enabled": 1}):
        frappe.throw(_("User does not exist or is disabled."))

    is_jmap_configured(user, raise_exception=True)

    title = _("Push Subscription Renewal Error")
    try:
        result = _set_subscriptions(
            user, update={id: {"verificationCode": verification_code}}, ignore_permissions=True
        )
    except MethodError as e:
        frappe.throw(format_method_error(e), title=title)

    if id not in result.updated:
        frappe.throw(_(format_set_error(result.not_updated.get(id))), title=title)


@frappe.whitelist()
def renew_push_subscription(user: str, id: str) -> None:
    """Renews a push subscription subscription for the given user and subscription ID."""

    has_permission_for_user(user, raise_exception=True)

    is_push_subscription_disabled(user, raise_exception=True)

    title = _("Push Subscription Renewal Error")
    try:
        # A bare {"expires": null} renewal makes the server bump the subscription to its
        # maximum lifetime.
        result = _set_subscriptions(user, update={id: {"expires": None}})
    except MethodError as e:
        frappe.throw(format_method_error(e), title=title)

    if id not in result.updated:
        frappe.throw(_(format_set_error(result.not_updated.get(id))), title=title)


def renew_expiring_push_subscriptions() -> None:
    """Renews soon-to-expire push subscriptions for all JMAP configured users.

    Scheduled to run daily. A subscription is renewed when its expiry is still ahead
    but within ``RENEW_THRESHOLD_DAYS`` of the run; subscriptions without an expiry or
    expiring later are left untouched, and already-expired ones are skipped (renewal
    cannot revive them, and the server purges them). Users who disabled push
    subscriptions in their User
    Settings are skipped. Users missing this site's subscription on the mail server get
    one created (self-healing — see ensure_push_subscription); healing and the expiry
    scan share a single fetch, and subscriptions healing deleted are not renewed.
    """

    if not frappe.utils.get_url().startswith("https://"):
        return

    now = get_utc_now()
    cutoff = now + timedelta(days=RENEW_THRESHOLD_DAYS)

    for user in get_jmap_configured_users():
        if is_push_subscription_disabled(user):
            continue

        try:
            with filelock(f"ensure_push_subscription_{user}"):
                subscriptions = _fetch_subscriptions(user, ignore_permissions=True)
                deleted_ids = _heal_push_subscription(user, subscriptions)

            expiring_ids = []
            for subscription in subscriptions:
                if subscription["id"] in deleted_ids:
                    continue
                expires = subscription.get("expires")
                if expires and now < parse_iso_datetime(expires, as_str=False) <= cutoff:
                    expiring_ids.append(subscription["id"])

            if not expiring_ids:
                continue

            result = _set_subscriptions(
                user, update={id: {"expires": None} for id in expiring_ids}, ignore_permissions=True
            )
            if not_updated := result.not_updated:
                errors = "<br>".join(f"{id}: {format_set_error(error)}" for id, error in not_updated.items())
                log_mail_error(
                    _("Push Subscription Renewal Failed"),
                    _("Failed to renew push subscriptions for user {0}:<br>{1}").format(user, errors),
                )
        except LockTimeoutError:
            # Another process is healing this user right now; today's renewal scan can
            # wait for tomorrow's run, the threshold leaves days of headroom.
            continue
        except Exception as e:
            log_mail_error(
                _("Push Subscription Renewal Failed"),
                _("Failed to renew push subscriptions for user {0}: {1}").format(user, str(e)),
            )


@frappe.whitelist()
def delete_push_subscriptions(user: str, ids: list[str]) -> None:
    """Deletes push subscriptions for the given user and list of subscription IDs."""

    has_permission_for_user(user, raise_exception=True)

    try:
        result = _set_subscriptions(user, destroy=ids)
    except MethodError as e:
        # The chunks before the refused one are applied: say what was deleted, not only what failed.
        applied = getattr(e, "applied", None) or SetResult()
        messages = [format_method_error(e), *_not_destroyed_messages(applied)]
        if applied.destroyed:
            messages.insert(
                0,
                _(
                    "{0} of {1} push subscription(s) were deleted before the mail server refused the rest:"
                ).format(len(applied.destroyed), len(ids)),
            )
        frappe.throw("<br>".join(messages), title=_("Push Subscription Deletion Error"))
    except MailServerUnavailableError as e:
        # An outage is the frontend's to report, which it does by this exception's type - unless
        # chunks before it were applied: only a message of ours can say that, and whether the
        # chunk the outage met may have been applied too.
        applied = getattr(e, "applied", None) or SetResult()
        if not (applied.destroyed or applied.not_destroyed):
            raise
        if never_applied(e):
            deleted = _(
                "{0} of {1} push subscription(s) were deleted before the mail server became "
                "unavailable. The rest were not deleted: try again in a moment."
            )
        else:
            deleted = _(
                "{0} of {1} push subscription(s) were deleted before the mail server became "
                "unavailable. Some of the rest may have been deleted as well: reload the list "
                "before trying again."
            )
        messages = [deleted.format(len(applied.destroyed), len(ids)), *_not_destroyed_messages(applied)]
        frappe.throw("<br>".join(messages), title=_("Push Subscription Deletion Error"))

    _raise_for_not_destroyed(result)


def delete_site_push_subscriptions(user: str) -> None:
    """Deletes every subscription on the mail server that wears this site's device client id.

    Used when the user is disabled: the subscriptions would otherwise keep webhooks flowing
    for an account the site no longer serves, and the server only purges them at expiry.
    Custom subscriptions carry their own device client id and are left alone. Login healing
    recreates the site's subscription once the user is enabled again. The user is already
    disabled when this runs, so the client is opened with that allowed explicitly.
    """

    device_client_id = get_site_device_client_id(user)

    ids = [
        subscription["id"]
        for subscription in _fetch_subscriptions(user, ignore_permissions=True, allow_disabled=True)
        if subscription.get("deviceClientId") == device_client_id
    ]
    if ids:
        _raise_for_not_destroyed(
            _set_subscriptions(user, destroy=ids, ignore_permissions=True, allow_disabled=True)
        )


def _raise_for_not_destroyed(result: SetResult) -> None:
    """Surfaces the server's per-id errors from a destroy, if any."""

    if not result.not_destroyed:
        return

    frappe.throw(
        _("Push Subscription Deletion Error(s):<br>{0}").format("<br>".join(_not_destroyed_messages(result))),
        title=_("Push Subscription Deletion Error"),
    )


def _not_destroyed_messages(result: SetResult) -> list[str]:
    """One line per id the server refused to destroy, with its reason."""

    return [f"{id}: {format_set_error(error)}" for id, error in result.not_destroyed.items()]


@frappe.whitelist()
def fetch_push_subscriptions(user: str, page: int = 1, limit: int = 10) -> list:
    """Fetches push subscriptions for the given user with pagination."""

    has_permission_for_user(user, raise_exception=True)

    subscriptions = _fetch_subscriptions(user)
    formatted_subscriptions = [format_push_subscription(user, sub) for sub in subscriptions]
    frappe.cache.set_value(_get_total_cache_key(user), len(subscriptions), expires_in_sec=600)

    start = (page - 1) * limit
    end = start + limit

    return formatted_subscriptions[start:end]


def format_push_subscription(user: str, push_subscription: dict) -> dict:
    """Formats push subscription data for display."""

    expires = normalize_utc_z(push_subscription.get("expires"))
    types = push_subscription.get("types") or []
    return {
        "user": user,
        "id": push_subscription["id"],
        "name": f"{user}|{push_subscription['id']}",
        "device_client_id": push_subscription["deviceClientId"],
        "expires": expires,
        "types": json.dumps(types, indent=4),
        "creation": today(),
        "modified": today(),
    }


def get_push_subscription_keys() -> dict | None:
    """Returns the JMAP push subscription encryption keys from Mail Settings, or None if encryption is disabled or the keys are not configured."""

    settings = frappe.get_cached_doc("Mail Settings")
    if not settings.get("enable_jmap_push_encryption"):
        return None

    p256dh = (settings.get("jmap_push_p256dh") or "").strip()
    auth = (settings.get_password("jmap_push_auth") if settings.get("jmap_push_auth") else "").strip()

    if p256dh and auth:
        return {"p256dh": p256dh, "auth": auth}


def _decode_encrypted_push_body(raw_body: bytes) -> bytes:
    """Returns the raw aes128gcm ciphertext from a push request body."""

    _B64URL_BYTES = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=")

    stripped = raw_body.strip()
    if not stripped or any(byte not in _B64URL_BYTES for byte in stripped):
        return raw_body

    try:
        return base64.urlsafe_b64decode(stripped + b"=" * (-len(stripped) % 4))
    except Exception:
        return raw_body


def read_jmap_push(body: bytes, encrypted: bool) -> StateChange | PushVerification | CalendarAlert:
    """The object one POST to the push endpoint carries - a StateChange, the PushVerification of
    a new subscription or a CalendarAlert - decrypted with the site's keys from Mail Settings when
    the server encrypted it (RFC 8291 aes128gcm)."""

    keys = None
    if encrypted:
        keys = _site_push_key_pair()
        body = _decode_encrypted_push_body(body)

    try:
        return read_push(body, keys)
    except PushPayloadError as e:
        frappe.throw(_("Invalid push notification: {0}").format(e))


def _site_push_key_pair() -> PushKeyPair:
    settings = frappe.get_cached_doc("Mail Settings")
    private_key = (
        settings.get_password("jmap_push_private_key") if settings.get("jmap_push_private_key") else ""
    ).strip()
    auth = (settings.get_password("jmap_push_auth") if settings.get("jmap_push_auth") else "").strip()

    if not private_key or not auth:
        frappe.throw(_("JMAP Push Subscription decryption keys are not configured in Mail Settings."))

    try:
        return PushKeyPair(private_key, auth)
    except ValueError as e:
        frappe.throw(_("Invalid JMAP Push Subscription keys: {0}").format(e))


def freeze_jmap_push_notifications(user: str) -> None:
    """Freezes JMAP push notifications for the given user."""

    frappe.cache.hset("frozen_jmap_push_notifications", user, True)


def unfreeze_jmap_push_notifications(user: str) -> None:
    """Unfreezes JMAP push notifications for the given user."""

    frappe.cache.hdel("frozen_jmap_push_notifications", user)


def is_jmap_push_notifications_frozen(user: str) -> bool:
    """Returns True if JMAP push notifications are frozen for the given user."""

    return frappe.cache.hget("frozen_jmap_push_notifications", user) is True


def has_permission(doc: Document, ptype: str, user: str | None = None) -> bool:
    if doc.doctype != "Push Subscription":
        return False

    return has_permission_for_user(doc.user, raise_exception=False)


def has_permission_for_user(user: str, raise_exception: bool = True) -> bool:
    """Checks if the current session user has permission to manage push subscriptions for the given user."""

    if user != frappe.session.user and not is_system_manager(frappe.session.user):
        if raise_exception:
            frappe.throw(
                _("You do not have permission to add a push subscription for user {0}.").format(
                    frappe.bold(user)
                ),
                frappe.PermissionError,
            )

        return False

    return True
