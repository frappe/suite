"""Whether a readable copy a browser rendered holds what a Sheets state does.

The copy is frontend/src/apps/sheets/collab/html.ts `docToHtml`: one table per sheet with every typed
input. A cell counts when its sheet, row and column are still listed, as the copy leaves the others out.
"""

from collections import Counter
from decimal import Decimal

import pycrdt

# Characters the copy's sanitizer (copies.cleaned, html5ever) drops from text
DROPPED = {chr(0)}


def listed(doc: pycrdt.Doc, root: str, sheet_id: str) -> set[str]:
    """The row or column ids one sheet lists, or none when it has no list."""
    lists = doc.get(root, type=pycrdt.Map)
    found = lists.get(sheet_id)
    return set(found.to_py() or ()) if isinstance(found, pycrdt.Array) else set()


def js_number(value: float) -> str:
    """`value` as JavaScript's String(value) writes it (Number::toString), which docToHtml uses."""
    if value != value:
        return "NaN"

    if value in (float("inf"), float("-inf")):
        return "Infinity" if value > 0 else "-Infinity"

    if value == 0:
        return "0"

    sign = "-" if value < 0 else ""
    # repr gives the shortest digits that read back as the same float, as JavaScript picks them
    _, digits_tuple, exponent = Decimal(repr(abs(value))).normalize().as_tuple()
    digits = "".join(map(str, digits_tuple))
    k = len(digits)
    n = k + int(exponent)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)

    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]

    if -6 < n <= 0:
        return sign + "0." + "0" * -n + digits

    shown_exponent = f"{'+' if n - 1 >= 0 else '-'}{abs(n - 1)}"
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{sign}{mantissa}e{shown_exponent}"


def shown_value(value: object) -> str:
    """A value as the copy shows it, as JavaScript's String(value); pycrdt reads every JSON number as a float."""
    if isinstance(value, bool):
        return "true" if value else "false"

    if value is None:
        return "null"

    if isinstance(value, float | int):
        return js_number(float(value))

    return str(value)


def shown_text(doc: pycrdt.Doc) -> list[str]:
    """Every sheet name and live cell input the copy shows."""
    sheet_meta = doc.get("sheetMeta", type=pycrdt.Map).to_py()
    row_lists = doc.get("rows", type=pycrdt.Map)
    col_lists = doc.get("cols", type=pycrdt.Map)
    # As stores.ts docSheets: an id listed twice counts once, and a sheet needs its name and both lists
    order = dict.fromkeys(
        sheet for sheet in doc.get("sheets", type=pycrdt.Array).to_py() or [] if isinstance(sheet, str)
    )
    sheets = [
        sheet
        for sheet in order
        if isinstance(sheet_meta.get(sheet), dict)
        and sheet_meta[sheet].get("name") is not None
        and row_lists.get(sheet) is not None
        and col_lists.get(sheet) is not None
    ]
    rows = {sheet: listed(doc, "rows", sheet) for sheet in sheets}
    cols = {sheet: listed(doc, "cols", sheet) for sheet in sheets}
    shown = [shown_value(sheet_meta[sheet]["name"]) for sheet in sheets]
    for key, value in doc.get("inputs", type=pycrdt.Map).to_py().items():
        sheet, _, rest = key.partition(":")
        row, _, col = rest.partition(":")
        if row in rows.get(sheet, ()) and col in cols.get(sheet, ()):
            shown.append(shown_value(value))

    return shown


def is_html_complete(state: bytes, html: str, text: str) -> bool:
    """Check that `text` holds every visible character of the state's sheet names and inputs, or more."""
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.apply_update(state)
    characters = Counter(
        char for shown in shown_text(doc) for char in shown if not char.isspace() and char not in DROPPED
    )
    copied = Counter(char for char in text if not char.isspace())
    return not characters - copied
