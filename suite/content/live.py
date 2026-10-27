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
from typing import TypedDict

import frappe
from frappe.utils.password import get_encryption_key

from suite.content.tables import table

EPOCH_SECONDS = 150
# Larger rows go by reference: tabs pull them
INLINE_MAX = 32 * 1024


class Rooms(TypedDict):
    epoch: int
    keys: list[str]
    epoch_seconds: int
    server_time: float


def rooms(app: str, doc_id: str, lineage: str) -> Rooms:
    """Return the rooms a tab joins now, this epoch's and the next, with the server's clock to time them."""
    now = time.time()
    epoch = int(now // EPOCH_SECONDS)
    this_room = room_key(app, doc_id, lineage, epoch)
    next_room = room_key(app, doc_id, lineage, epoch + 1)
    return {
        "epoch": epoch,
        "keys": [this_room, next_room],
        "epoch_seconds": EPOCH_SECONDS,
        "server_time": now,
    }


# A lineage is a uuid hex, so a conversion room never shares a key with a document's live room
def conversion_rooms(app: str, node: str) -> Rooms:
    """Return the rooms a tab waiting on `node`'s conversion joins to hear its outcome."""
    return rooms(app, node, "conversion")


def publish_conversion(app: str, node: str, state: str) -> None:
    """Tell the tabs waiting on `node` it was converted or refused, once that is committed."""
    publish(app, node, "conversion", "suite_collab_converted", {"state": state})


def room_key(app: str, doc_id: str, lineage: str, epoch: int) -> str:
    """Name the document's room for `epoch`, keyed by the site's secret so no tab can derive it."""
    site_key = get_encryption_key().encode()
    rooms_key = hmac.new(site_key, b"suite-collab-rooms", hashlib.sha256).digest()
    room_label = f"suite-collab-room|1|{app}|{doc_id}|{lineage}|{epoch}".encode()
    digest = hmac.new(rooms_key, room_label, hashlib.sha256).digest()
    digest_text = base64.urlsafe_b64encode(digest).decode()
    return "sc:" + digest_text[:32]


def publish_row(
    app: str, doc_id: str, lineage: str, rev: int, schema: int, payload: bytes, *, restore: bool = False
) -> None:
    """Send a committed row to the live tabs, marked when it is a restore."""
    inline_payload = None
    if len(payload) <= INLINE_MAX:
        inline_payload = base64.b64encode(payload).decode()

    message = {
        "lineage": lineage,
        "rev": rev,
        "schema": schema,
        "u": inline_payload,
    }
    if restore:
        message["restore"] = True

    publish(app, doc_id, lineage, "suite_collab_row", message)


def publish_control(app: str, doc_id: str, lineage: str, **message: str | int) -> None:
    """Send a control message to the live tabs."""
    control_message = {"lineage": lineage, **message}
    publish(app, doc_id, lineage, "suite_collab_ctl", control_message)


def publish_change(app: str, doc_id: str, kind: str) -> None:
    """Tell live tabs of a hold, a release or room a compaction freed, so they pull as a polling tab would."""
    doc_table = table(app, "doc")
    lineage_rows = frappe.db.sql(f"SELECT `lineage` FROM `{doc_table}` WHERE `id` = %s", doc_id)
    if lineage_rows:
        publish_control(app, doc_id, lineage_rows[0][0], kind=kind)


def publish(app: str, doc_id: str, lineage: str, event: str, message: dict) -> None:
    """Send `message` to this epoch's room, best effort."""
    epoch = int(time.time() // EPOCH_SECONDS)
    room_name = room_key(app, doc_id, lineage, epoch)
    try:
        frappe.publish_realtime(event, message, room=room_name)
    except Exception:
        # The change is committed; tabs that miss it pull
        pass


@frappe.whitelist(allow_guest=True, methods=["GET"])
def joinable() -> bool:
    """Whether sockets may join collab rooms, only while some app's collaboration is on."""
    from suite.content.editors import editors
    from suite.content.log import enabled

    return any(enabled(app) for app in editors())
