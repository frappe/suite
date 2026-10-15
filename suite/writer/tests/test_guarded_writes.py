"""Every writer of a Writer Document row, so a new one can't skip the logged-document refusal.

A document with a log keeps its body, comments and collab flag through the log, and
`WriterDocument.refuse_if_logged` refuses anything else that would write them. Generic
saves go through `validate`, which refuses too. The scan lists each function that writes
the row directly; a new one fails until it is listed here with why it can't write over a
logged document.
"""

import ast
import re
import unittest
from pathlib import Path

SUITE_ROOT = Path(__file__).resolve().parents[2]
ROW_CALLS = frozenset({"set_value", "new_doc", "delete_doc"})
ROW_UPDATE = re.compile(r"UPDATE\s+`tab(Writer Document|\{spec\.content_type\})`")
WRITER = "suite/writer/"
WRITER_DOCUMENT = "suite/writer/doctype/writer_document/"

NEW_ROW = "a new row has no log yet"
REFUSES = "refuses a logged document first"
THE_LOG = "the log writes its own body"
KNOWN_WRITERS = {
    "suite/writer/doctype/writer_document/writer_document.py:WriterDocument.save_doc": REFUSES,
    "suite/writer/doctype/writer_document/writer_document.py:WriterDocument.save_html": REFUSES,
    "suite/writer/doctype/writer_document/writer_document.py:WriterDocument.update_settings": "writes only settings",
    "suite/writer/api/docs.py:save_comments": REFUSES,
    "suite/writer/drive.py:create_empty": NEW_ROW,
    "suite/writer/drive.py:duplicate": NEW_ROW,
    "suite/writer/drive.py:restore_version": REFUSES,
    "suite/writer/drive.py:on_purge": "deletes the row with its log",
    "suite/writer/drive.py:remap_media": "writes the body only without a log; a log is remapped instead",
    "suite/suite_core/content/checkpoints.py:Compaction.install_body": THE_LOG,
    "suite/suite_core/content/checkpoints.py:replace_start": THE_LOG,
    "suite/writer/patches/move_bodies_into_rows.py:move_body": THE_LOG,
    "suite/drive/patches/build/ports.py:SiteContentTarget.update_writer_body": "migration build, run before any log",
    "suite/drive/patches/cleanup/ports.py:SiteContentRows.clear_writer_ycomments": "migration cleanup of comments Drive took over",
    "suite/writer/content/e2e_api.py:enable_collab": "a test hook",
    "suite/writer/content/e2e_api.py:make_legacy": "a test hook",
}


def call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Attribute):
        return call.func.attr

    return getattr(call.func, "id", "")


def names_row(call: ast.Call, path: str) -> bool:
    if not call.args:
        return False

    first = call.args[0]
    if isinstance(first, ast.Constant):
        return first.value == "Writer Document"

    return isinstance(first, ast.Name) and first.id == "DOCTYPE" and path.startswith(WRITER)


def writes_row(call: ast.Call, path: str) -> bool:
    name = call_name(call)
    if name == "db_set":
        return path.startswith(WRITER_DOCUMENT)

    if name in ROW_CALLS:
        return names_row(call, path)

    if name == "sql" and call.args:
        return bool(ROW_UPDATE.search(ast.unparse(call.args[0])))

    return False


class RowWriters(ast.NodeVisitor):
    """Name each write by the function, and class, it sits in."""

    def __init__(self, path: str):
        self.path = path
        self.scope: list[str] = []
        self.found: set[str] = set()

    def visit_scope(self, node):
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    visit_ClassDef = visit_scope
    visit_FunctionDef = visit_scope

    def visit_Call(self, node: ast.Call):
        if writes_row(node, self.path):
            where = ".".join(self.scope)
            self.found.add(f"{self.path}:{where}")

        self.generic_visit(node)


def row_writers() -> set[str]:
    found: set[str] = set()
    for source in SUITE_ROOT.rglob("*.py"):
        is_test = "tests" in source.parts or source.name.startswith("test_")
        if is_test:
            continue

        writers = RowWriters(source.relative_to(SUITE_ROOT.parent).as_posix())
        writers.visit(ast.parse(source.read_text()))
        found |= writers.found

    return found


SYNTHETIC = """
DOCTYPE = "Writer Document"

class Shadow:
    def by_value(self, name):
        frappe.db.set_value("Writer Document", name, "content", "")

def by_sql(name):
    frappe.db.sql("UPDATE `tabWriter Document` SET html = '' WHERE name = %s", name)

def by_doctype(name):
    frappe.db.set_value(DOCTYPE, name, "collab", 0)

def elsewhere(name):
    frappe.db.set_value("Writer Settings", name, "theme", "")
"""


def synthetic_writers(path: str) -> set[str]:
    writers = RowWriters(path)
    writers.visit(ast.parse(SYNTHETIC))
    return writers.found


class TestGuardedWrites(unittest.TestCase):
    def test_every_writer_of_a_writer_document_row_is_known(self):
        self.assertEqual(sorted(row_writers()), sorted(KNOWN_WRITERS))

    def test_direct_writes_to_the_row_are_detected(self):
        path = "suite/writer/shadow.py"
        self.assertEqual(
            synthetic_writers(path),
            {f"{path}:Shadow.by_value", f"{path}:by_sql", f"{path}:by_doctype"},
        )

    def test_another_app_s_doctype_constant_is_not_the_row(self):
        path = "suite/sheets/shadow.py"
        self.assertEqual(synthetic_writers(path), {f"{path}:Shadow.by_value", f"{path}:by_sql"})
