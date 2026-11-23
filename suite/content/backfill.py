"""Fills what logs made before a column was kept need, from the rows they already hold. Runs on migrate."""

import json

import frappe
from frappe.query_builder import Table

from suite import drive
from suite.content import ingest, quarantine
from suite.content.log import ChainBroken
from suite.content.snapshot import read
from suite.content.tables import table


def readable_clocks(app: str, doc_id: str) -> dict[int, int] | None:
    """Read each writer's next clock from the log, after quarantining the rows that can't be read."""
    log = read(app, doc_id)
    if log is None:
        return None

    unreadable = {rev for rev, payload in log.rows if quarantine.parse_or_none(payload) is None}
    if unreadable:
        quarantine.quarantine(app, doc_id, unreadable, "malformed_row")
        log = read(app, doc_id)
        if log is None:
            return None

    checkpoint_payloads: list[bytes] = []
    if log.checkpoint:
        checkpoint_payloads = [log.checkpoint]

    row_payloads = log.payloads()
    return ingest.next_clocks(checkpoint_payloads + row_payloads)


def store_clocks(app: str, doc_id: str, clocks: dict[int, int]) -> None:
    """Fill the sessions' missing next clocks, and the log's start clocks for writers without a session."""
    session = Table(table(app, "session"))
    doc = Table(table(app, "doc"))
    session_rows = frappe.qb.from_(session).select(session.client_id).where(session.doc_id == doc_id).run()
    session_client_ids = {int(client) for (client,) in session_rows}
    for client in session_client_ids:
        (
            frappe.qb.update(session)
            .set(session.next_clock, clocks.get(client, 0))
            .where(session.doc_id == doc_id)
            .where(session.client_id == client)
            .where(session.next_clock.isnull())
            .run()
        )

    start_clocks = {client: clock for client, clock in clocks.items() if client not in session_client_ids}
    frappe.qb.update(doc).set(doc.start_clocks, json.dumps(start_clocks)).where(doc.id == doc_id).run()


def backfill_clocks(app: str) -> None:
    """Read each writer's next clock for logs made before clocks were kept; safe to run again."""
    doc = Table(table(app, "doc"))
    for (doc_id,) in (
        frappe.qb.from_(doc).select(doc.id).where(doc.start_clocks.isnull()).where(doc.mode != "purged").run()
    ):
        try:
            clocks = readable_clocks(app, doc_id)
        except (ChainBroken, ValueError, drive.DriveNotFound):
            frappe.log_error(f"Collab clocks not read for {app} log {doc_id}")
            continue

        if clocks is None:
            continue

        store_clocks(app, doc_id, clocks)
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
