"""Every writer of a Writer Document row, so a new one can't skip the logged-document refusal.

A document with a log keeps its body, comments and collab flag through the log. Generic
saves go through `WriterDocument.validate`, which refuses them. The scan lists each
function that writes the row directly; a new one fails until it is listed here with why it
can't write over a logged document.

The scan reads one file at a time, so it misses a doctype passed in a variable (Build's
`write_writer_template`, through `_bulk`), and a qb table held in anything but a plain name
assigned in the same file (annotated, tuple or attribute assigns), or built off a receiver
not named qb.
"""

import ast
import re
import unittest
from pathlib import Path

SUITE_ROOT = Path(__file__).resolve().parents[2]
ROW_CALLS = frozenset({"set_value", "new_doc", "delete_doc", "delete", "bulk_insert", "bulk_update"})
ROW_SQL = re.compile(
    r"(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+`tab(Writer Document|\{spec\.doctype\}|\{doctype\})`",
    re.IGNORECASE,
)
WRITER = "suite/writer/"
WRITER_DOCUMENT = "suite/writer/doctype/writer_document/"

NEW_ROW = "a new row has no log yet"
REFUSES = "the content layer refuses a logged document first"
THE_LOG = "the log writes its own body"
KNOWN_WRITERS = {
    "suite/writer/doctype/writer_document/writer_document.py:WriterDocument.update_settings": "writes only settings",
    "suite/writer/drive.py:create_empty": NEW_ROW,
    "suite/writer/drive.py:duplicate": NEW_ROW,
    "suite/writer/drive.py:restore_version": REFUSES,
    "suite/writer/drive.py:on_purge": "deletes the row with its log",
    "suite/writer/drive.py:remap_media": "writes the body only without a log; a log is remapped instead",
    "suite/content/app_row.py:write_body": THE_LOG,
    "suite/content/editors.py:HtmlCopy.write": "the log writes its own readable copy",
    "suite/writer/patches/move_bodies_into_rows.py:move_checkpoint": THE_LOG,
    "suite/writer/patches/move_bodies_into_rows.py:empty_row": THE_LOG,
    "suite/drive/patches/build/ports.py:SiteContentTarget.update_writer_body": "migration build, run before any log",
    "suite/writer/content/e2e_api.py:enable_collab": "a test hook",
    "suite/writer/content/e2e_api.py:make_old": "a test hook",
    "suite/writer/content/conversion.py:clear_ycomments": "clears the old comments once Drive holds them",
}


def call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Attribute):
        return call.func.attr

    return getattr(call.func, "id", "")


def sql_text(node: ast.AST) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value

    if isinstance(node, ast.FormattedValue):
        return "{" + ast.unparse(node.value) + "}"

    return "".join(sql_text(child) for child in ast.iter_child_nodes(node))


def is_row(node: ast.expr, path: str) -> bool:
    if isinstance(node, ast.Constant):
        return node.value == "Writer Document"

    return isinstance(node, ast.Name) and node.id == "DOCTYPE" and path.startswith(WRITER)


def names_row(call: ast.Call, path: str) -> bool:
    return bool(call.args) and is_row(call.args[0], path)


def is_row_table(node: ast.expr | None, path: str, tables: set[str]) -> bool:
    if isinstance(node, ast.Name) and node.id in tables:
        return True

    if not isinstance(node, ast.Call) or not node.args:
        return False

    if call_name(node) == "Table":
        first = node.args[0]
        return isinstance(first, ast.Constant) and first.value == "tabWriter Document"

    return call_name(node) == "DocType" and is_row(node.args[0], path)


def on_qb(call: ast.Call) -> bool:
    receiver = getattr(call.func, "value", None)
    return getattr(receiver, "attr", getattr(receiver, "id", None)) == "qb"


def qb_table(node: ast.AST, method: str) -> ast.expr | None:
    if isinstance(node, ast.Call) and node.args and call_name(node) == method and on_qb(node):
        return node.args[0]

    return None


def qb_writes_row(call: ast.Call, path: str, tables: set[str]) -> bool:
    name = call_name(call)
    if name in {"update", "into"}:
        return is_row_table(qb_table(call, name), path, tables)

    if name != "delete" or not isinstance(call.func, ast.Attribute):
        return False

    return any(is_row_table(qb_table(node, "from_"), path, tables) for node in ast.walk(call.func.value))


def writes_row(call: ast.Call, path: str, tables: set[str]) -> bool:
    name = call_name(call)
    if name == "db_set":
        return path.startswith(WRITER_DOCUMENT)

    if name in ROW_CALLS and names_row(call, path):
        return True

    if name == "sql" and call.args:
        return bool(ROW_SQL.search(sql_text(call.args[0])))

    return qb_writes_row(call, path, tables)


class RowWriters(ast.NodeVisitor):
    """Name each write by the function, and class, it sits in."""

    def __init__(self, path: str):
        self.path = path
        self.scope: list[str] = []
        self.found: set[str] = set()
        self.tables: set[str] = set()

    def visit_scope(self, node):
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    visit_ClassDef = visit_scope
    visit_FunctionDef = visit_scope

    def visit_Assign(self, node: ast.Assign):
        if is_row_table(node.value, self.path, self.tables):
            self.tables |= {target.id for target in node.targets if isinstance(target, ast.Name)}

        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        if writes_row(node, self.path, self.tables):
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

def by_lowercase_sql(name):
    frappe.db.sql("update `tabWriter Document` set ycomments = null where name = %s", name)

def by_lowercase_delete(name):
    frappe.db.sql("delete from `tabWriter Document` where name = %s", name)

def by_multiline_sql(name):
    frappe.db.sql('''
        UPDATE
            `tabWriter Document` SET html = ''
        WHERE name = %s''', name)

def by_db_delete(name):
    frappe.db.delete("Writer Document", {"name": name})

def by_bulk_insert(name):
    frappe.db.bulk_insert("Writer Document", ["name"], [(name,)])

def by_qb_update(name):
    table = frappe.qb.DocType("Writer Document")
    frappe.qb.update(table).set(table.ycomments, None).where(table.name == name).run()

def by_qb_delete(name):
    frappe.qb.from_(Table("tabWriter Document")).delete().run()

def by_qb_insert(name):
    frappe.qb.into(frappe.qb.DocType(DOCTYPE)).insert(name).run()

def reads_by_qb(name):
    frappe.qb.from_(frappe.qb.DocType("Writer Document")).select("*").run()

def by_doctype(name):
    frappe.db.set_value(DOCTYPE, name, "collab", 0)

def elsewhere(name):
    frappe.db.set_value("Writer Settings", name, "theme", "")
    frappe.qb.update(frappe.qb.DocType("Writer Settings")).set("theme", "").run()
"""

# The SYNTHETIC writers that name the row outright, so they count in any app's file
NAMED_ROW_WRITERS = (
    "Shadow.by_value",
    "by_sql",
    "by_lowercase_sql",
    "by_lowercase_delete",
    "by_multiline_sql",
    "by_db_delete",
    "by_bulk_insert",
    "by_qb_update",
    "by_qb_delete",
)


def synthetic_writers(path: str) -> set[str]:
    writers = RowWriters(path)
    writers.visit(ast.parse(SYNTHETIC))
    return writers.found


class TestGuardedWrites(unittest.TestCase):
    def test_every_writer_of_a_writer_document_row_is_known(self):
        self.assertEqual(sorted(row_writers()), sorted(KNOWN_WRITERS))

    def test_direct_writes_to_the_row_are_detected(self):
        path = "suite/writer/shadow.py"
        names = (*NAMED_ROW_WRITERS, "by_qb_insert", "by_doctype")
        self.assertEqual(synthetic_writers(path), {f"{path}:{name}" for name in names})

    def test_another_app_s_doctype_constant_is_not_the_row(self):
        path = "suite/sheets/shadow.py"
        self.assertEqual(synthetic_writers(path), {f"{path}:{name}" for name in NAMED_ROW_WRITERS})
