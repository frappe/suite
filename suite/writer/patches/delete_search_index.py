"""Delete the Writer-only full-text index.

Writer kept its own SQLite index of document bodies (`writer_search.db` in the
site folder). Nothing reads it any more, and it would keep the text of
documents after Drive purges them, so the file goes with the code.
"""

import os

import frappe


def execute() -> None:
    for name in ("writer_search.db", "writer_search.temp.db"):
        path = frappe.get_site_path(name)
        if os.path.exists(path):
            os.remove(path)
