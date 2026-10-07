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

EPOCH_SECONDS = 150
# Larger rows go by reference: tabs pull them
INLINE_MAX = 32 * 1024


def rooms(adapter: str, doc_id: str, lineage: str) -> dict:
    """The rooms a tab joins now: this epoch's and the next, with the server's clock to time them by."""
    now = time.time()
    epoch = int(now // EPOCH_SECONDS)
    return {
        "epoch": epoch,
        "keys": [room(adapter, doc_id, lineage, epoch), room(adapter, doc_id, lineage, epoch + 1)],
        "epoch_seconds": EPOCH_SECONDS,
        "server_time": now,
    }


def room(adapter: str, doc_id: str, lineage: str, epoch: int) -> str:
    key = hmac.new(get_encryption_key().encode(), b"suite-collab-rooms", hashlib.sha256).digest()
    name = f"suite-collab-room|1|{adapter}|{doc_id}|{lineage}|{epoch}".encode()
    digest = hmac.new(key, name, hashlib.sha256).digest()
    return "sc:" + base64.urlsafe_b64encode(digest).decode()[:32]


def publish_row(adapter: str, doc_id: str, lineage: str, rev: int, schema: int, payload: bytes) -> None:
    inline = base64.b64encode(payload).decode() if len(payload) <= INLINE_MAX else None
    message = {"lineage": lineage, "rev": rev, "schema": schema, "u": inline}
    publish(adapter, doc_id, lineage, "suite_collab_row", message)


def publish_ctl(adapter: str, doc_id: str, lineage: str, **message) -> None:
    publish(adapter, doc_id, lineage, "suite_collab_ctl", {"lineage": lineage, **message})


def publish(adapter: str, doc_id: str, lineage: str, event: str, message: dict) -> None:
    epoch = int(time.time() // EPOCH_SECONDS)
    try:
        frappe.publish_realtime(event, message, room=room(adapter, doc_id, lineage, epoch))
    except Exception:
        # The change is committed; tabs that miss it pull
        pass


@frappe.whitelist(allow_guest=True, methods=["POST"])
def joinable() -> bool:
    """Whether the realtime service may let sockets into collab rooms: only while collaboration is on."""
    from suite.suite_core.collab.log import enabled

    return enabled()
