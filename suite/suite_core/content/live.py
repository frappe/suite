"""Live updates: the realtime room each document's changes are published to.

A room's name is a keyed hash of the document, its lineage and a 150 s epoch,
so only a tab that opened or pulled lately can name it, and a reader whose
access ends drops out within two epochs. Publishing is best effort: a tab that
misses a row finds the hole and pulls, and one that hears nothing polls.
"""

import base64
import hashlib
import hmac
import time

import frappe
from frappe.utils.password import get_encryption_key

from suite.suite_core.content.tables import table

EPOCH_SECONDS = 150
# Larger rows go by reference: tabs pull them
INLINE_MAX = 32 * 1024


def rooms(adapter: str, doc_id: str, lineage: str) -> dict:
    """The rooms a tab joins now: this epoch's and the next, with the server's clock to time them by."""
    now = time.time()
    epoch = int(now // EPOCH_SECONDS)
    this_room = room(adapter, doc_id, lineage, epoch)
    next_room = room(adapter, doc_id, lineage, epoch + 1)
    return {
        "epoch": epoch,
        "keys": [this_room, next_room],
        "epoch_seconds": EPOCH_SECONDS,
        "server_time": now,
    }


def room(adapter: str, doc_id: str, lineage: str, epoch: int) -> str:
    site_key = get_encryption_key().encode()
    key = hmac.new(site_key, b"suite-collab-rooms", hashlib.sha256).digest()
    name = f"suite-collab-room|1|{adapter}|{doc_id}|{lineage}|{epoch}".encode()
    digest = hmac.new(key, name, hashlib.sha256).digest()
    digest_text = base64.urlsafe_b64encode(digest).decode()
    return "sc:" + digest_text[:32]


def publish_row(adapter: str, doc_id: str, lineage: str, rev: int, schema: int, payload: bytes) -> None:
    inline = base64.b64encode(payload).decode() if len(payload) <= INLINE_MAX else None
    message = {
        "lineage": lineage,
        "rev": rev,
        "schema": schema,
        "u": inline,
    }
    publish(adapter, doc_id, lineage, "suite_collab_row", message)


def publish_ctl(adapter: str, doc_id: str, lineage: str, **message) -> None:
    ctl_message = {"lineage": lineage, **message}
    publish(adapter, doc_id, lineage, "suite_collab_ctl", ctl_message)


def publish_change(adapter: str, doc_id: str, kind: str) -> None:
    """A hold, a release or room freed by a compaction: live tabs pull, as a polling tab would have."""
    found = frappe.db.sql(f"SELECT `lineage` FROM `{table(adapter, 'doc')}` WHERE `id` = %s", doc_id)
    if found:
        publish_ctl(adapter, doc_id, found[0][0], kind=kind)


def publish(adapter: str, doc_id: str, lineage: str, event: str, message: dict) -> None:
    epoch = int(time.time() // EPOCH_SECONDS)
    room_name = room(adapter, doc_id, lineage, epoch)
    try:
        frappe.publish_realtime(event, message, room=room_name)
    except Exception:
        # The change is committed; tabs that miss it pull
        pass


@frappe.whitelist(allow_guest=True, methods=["POST"])
def joinable() -> bool:
    """Whether the realtime service may let sockets into collab rooms: only while collaboration is on."""
    from suite.suite_core.content.log import enabled

    return enabled()
