"""A readable copy kept as several rows, held as JSON in the note's `html` field."""

import json
from collections.abc import Mapping

import frappe


class MultiCopy:
    """Keeps each row of the copy under its key, and records the rows each write was given in `writes`."""

    def __init__(self) -> None:
        self.writes: list[dict[str, str | None]] = []

    def is_html_complete(self, state: bytes, html: str, text: str) -> bool:
        return True

    def read(self, doctype: str, docname: str) -> Mapping[str, str]:
        found = frappe.db.sql(f"SELECT `html` FROM `tab{doctype}` WHERE `name` = %s", docname)
        return json.loads(found[0][0] or "{}")

    def write(self, doctype: str, docname: str, changed: Mapping[str, str | None]) -> None:
        self.writes.append(dict(changed))
        rows = {**self.read(doctype, docname), **changed}
        kept = {key: value for key, value in rows.items() if value is not None}
        frappe.db.sql(
            f"UPDATE `tab{doctype}` SET `html` = %s WHERE `name` = %s", (self.serialized(kept), docname)
        )

    def serialized(self, rows: Mapping[str, str]) -> str:
        return json.dumps(rows, sort_keys=True, separators=(",", ":"))

    def rows(self, html: str) -> Mapping[str, str]:
        return json.loads(html)

    def html(self, rows: Mapping[str, str]) -> str:
        return "".join(rows[key] for key in sorted(rows))


class LossyCopy(MultiCopy):
    """Drops row `b` from every write, so what it reads back is neither the old copy nor the new one."""

    def write(self, doctype: str, docname: str, changed: Mapping[str, str | None]) -> None:
        super().write(doctype, docname, {**changed, "b": None})
