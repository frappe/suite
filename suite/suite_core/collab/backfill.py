"""Fills what logs made before a column was kept need, from the rows they already hold. Runs on migrate."""

import json
from collections.abc import Callable

import frappe

from suite.suite_core.collab import ingest, quarantine
from suite.suite_core.collab.log import ChainBroken, read
from suite.suite_core.collab.tables import table


def backfill_clocks(adapter: str, owner_of: Callable[[str], str | None]) -> None:
    """Read each writer's next clock from the log for logs made before clocks were kept, after quarantining
    the rows that can't be read. Safe to run again."""
    for (doc_id,) in frappe.db.sql(
        f"SELECT `id` FROM `{table(adapter, 'doc')}` WHERE `start_clocks` IS NULL AND `mode` != 'purged'"
    ):
        try:
            log = read(adapter, doc_id)
            unreadable = {rev for rev, payload in log["rows"] if quarantine.readable(payload) is None}
            if unreadable:
                quarantine.quarantine(adapter, doc_id, unreadable, "malformed_row", owner_of)
                log = read(adapter, doc_id)
            clocks = ingest.next_clocks(
                ([log["checkpoint"]] if log["checkpoint"] else [])
                + [payload for _rev, payload in log["rows"]]
            )
        except (ChainBroken, ValueError, RuntimeError):
            frappe.log_error(f"Collab clocks not read for {adapter} log {doc_id}")
            continue
        sessions = {
            int(client)
            for (client,) in frappe.db.sql(
                f"SELECT `client_id` FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s", doc_id
            )
        }
        for client in sessions:
            frappe.db.sql(
                f"""UPDATE `{table(adapter, "session")}` SET `next_clock` = %s
                WHERE `doc_id` = %s AND `client_id` = %s AND `next_clock` IS NULL""",
                (clocks.get(client, 0), doc_id, client),
            )
        start = {client: clock for client, clock in clocks.items() if client not in sessions}
        frappe.db.sql(
            f"UPDATE `{table(adapter, 'doc')}` SET `start_clocks` = %s WHERE `id` = %s",
            (json.dumps(start), doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
