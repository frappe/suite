"""Fills what logs made before a column was kept need, from the rows they already hold. Runs on migrate."""

import json
from collections.abc import Callable

import frappe

from suite.suite_core.content import ingest, quarantine
from suite.suite_core.content.log import ChainBroken, read
from suite.suite_core.content.tables import table


def backfill_clocks(adapter: str, owner_of: Callable[[str], str | None]) -> None:
    """Read each writer's next clock from the log for logs made before clocks were kept, after quarantining
    the rows that can't be read. Safe to run again."""
    for (doc_id,) in frappe.db.sql(
        f"SELECT `id` FROM `{table(adapter, 'doc')}` WHERE `start_clocks` IS NULL AND `mode` != 'purged'"
    ):
        try:
            log = read(adapter, doc_id)
            if log is None:
                continue

            unreadable = {rev for rev, payload in log["rows"] if quarantine.parse_or_none(payload) is None}
            if unreadable:
                quarantine.quarantine(adapter, doc_id, unreadable, "malformed_row", owner_of)
                log = read(adapter, doc_id)
                if log is None:
                    continue

            checkpoint_payloads = [log["checkpoint"]] if log["checkpoint"] else []
            row_payloads = [payload for _rev, payload in log["rows"]]
            clocks = ingest.next_clocks(checkpoint_payloads + row_payloads)
        except (ChainBroken, ValueError, RuntimeError):
            frappe.log_error(f"Collab clocks not read for {adapter} log {doc_id}")
            continue

        session_rows = frappe.db.sql(
            f"SELECT `client_id` FROM `{table(adapter, 'session')}` WHERE `doc_id` = %s", doc_id
        )
        session_client_ids = {int(client) for (client,) in session_rows}
        for client in session_client_ids:
            frappe.db.sql(
                f"""UPDATE `{table(adapter, "session")}` SET `next_clock` = %s
                WHERE `doc_id` = %s AND `client_id` = %s AND `next_clock` IS NULL""",
                (clocks.get(client, 0), doc_id, client),
            )

        start_clocks = {client: clock for client, clock in clocks.items() if client not in session_client_ids}
        frappe.db.sql(
            f"UPDATE `{table(adapter, 'doc')}` SET `start_clocks` = %s WHERE `id` = %s",
            (json.dumps(start_clocks), doc_id),
        )
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
