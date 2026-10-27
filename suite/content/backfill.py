"""Fills what logs made before a column was kept need, from the rows they already hold. Runs on migrate."""

import json

import frappe

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
    session_table = table(app, "session")
    doc_table = table(app, "doc")
    session_rows = frappe.db.sql(f"SELECT `client_id` FROM `{session_table}` WHERE `doc_id` = %s", doc_id)
    session_client_ids = {int(client) for (client,) in session_rows}
    for client in session_client_ids:
        frappe.db.sql(
            f"""UPDATE `{session_table}` SET `next_clock` = %s
            WHERE `doc_id` = %s AND `client_id` = %s AND `next_clock` IS NULL""",
            (clocks.get(client, 0), doc_id, client),
        )

    start_clocks = {client: clock for client, clock in clocks.items() if client not in session_client_ids}
    frappe.db.sql(
        f"UPDATE `{doc_table}` SET `start_clocks` = %s WHERE `id` = %s",
        (json.dumps(start_clocks), doc_id),
    )


def backfill_clocks(app: str) -> None:
    """Read each writer's next clock for logs made before clocks were kept; safe to run again."""
    doc_table = table(app, "doc")
    for (doc_id,) in frappe.db.sql(
        f"SELECT `id` FROM `{doc_table}` WHERE `start_clocks` IS NULL AND `mode` != 'purged'"
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
