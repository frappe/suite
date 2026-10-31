import pycrdt
from frappe.tests import UnitTestCase

from suite.sheets.content.readable_copy import is_html_complete


def sheet_state(name: str, cells: dict[tuple[str, str], str], rows=("r1", "r2"), cols=("c1", "c2")) -> bytes:
    """A state as the glue writes it: one sheet `s1` with its id lists and inputs by `(row, col)` id."""
    doc: pycrdt.Doc = pycrdt.Doc()
    doc.get("sheets", type=pycrdt.Array).append("s1")
    doc.get("sheetMeta", type=pycrdt.Map)["s1"] = {"name": name}
    doc.get("rows", type=pycrdt.Map)["s1"] = pycrdt.Array(list(rows))
    doc.get("cols", type=pycrdt.Map)["s1"] = pycrdt.Array(list(cols))
    inputs = doc.get("inputs", type=pycrdt.Map)
    for (row, col), value in cells.items():
        inputs[f"s1:{row}:{col}"] = value

    return doc.get_update()


class TestReadableCopy(UnitTestCase):
    def test_a_copy_with_every_input_and_sheet_name_is_complete(self):
        state = sheet_state("Budget", {("r1", "c1"): "Rent", ("r2", "c2"): "=SUM(A1:A2)"})
        text = "Budget A B 1 Rent 2 =SUM(A1:A2)"

        self.assertTrue(is_html_complete(state, "<table></table>", text))

    def test_a_copy_missing_an_input_is_not(self):
        state = sheet_state("Budget", {("r1", "c1"): "Rent", ("r2", "c2"): "Food"})

        self.assertFalse(is_html_complete(state, "", "Budget Rent"))

    def test_a_copy_missing_the_sheet_name_is_not(self):
        state = sheet_state("Budget", {("r1", "c1"): "Rent"})

        self.assertFalse(is_html_complete(state, "", "Rent"))

    def test_a_cell_whose_row_is_no_longer_listed_need_not_be_shown(self):
        state = sheet_state("S", {("r1", "c1"): "kept", ("gone", "c1"): "deleted row"})

        self.assertTrue(is_html_complete(state, "", "S kept"))

    def test_a_number_typed_as_a_number_counts_as_its_digits(self):
        state = sheet_state("S", {("r1", "c1"): 500})

        self.assertTrue(is_html_complete(state, "", "S 500"))
        self.assertFalse(is_html_complete(state, "", "S 50"))

    def test_a_sheet_listed_twice_is_shown_once(self):
        # Two tabs moving the same sheet at once list its id twice; docToHtml shows it once
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(sheet_state("Budget", {("r1", "c1"): "Rent"}))
        doc.get("sheets", type=pycrdt.Array).append("s1")

        self.assertTrue(is_html_complete(doc.get_update(), "", "Budget Rent"))

    def test_a_sheet_without_its_row_and_column_lists_is_not_shown(self):
        doc: pycrdt.Doc = pycrdt.Doc()
        doc.apply_update(sheet_state("Budget", {("r1", "c1"): "Rent"}))
        doc.get("sheets", type=pycrdt.Array).append("s2")
        doc.get("sheetMeta", type=pycrdt.Map)["s2"] = {"name": "Half made"}

        self.assertTrue(is_html_complete(doc.get_update(), "", "Budget Rent"))

    def test_a_character_the_sanitizer_drops_need_not_be_shown(self):
        state = sheet_state("S", {("r1", "c1"): "a" + chr(0) + "b"})

        self.assertTrue(is_html_complete(state, "", "S ab"))

    def test_numbers_are_shown_as_the_browser_writes_them(self):
        for number, shown in (
            (0.00001, "0.00001"),
            (1e-7, "1e-7"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (-2.5, "-2.5"),
            (1.5e300, "1.5e+300"),
        ):
            with self.subTest(number):
                state = sheet_state("S", {("r1", "c1"): number})
                self.assertTrue(is_html_complete(state, "", f"S {shown}"))
                self.assertFalse(is_html_complete(state, "", f"S {shown[:-1]}"))

    def test_a_sheet_whose_name_is_missing_or_not_an_object_is_not_shown(self):
        for meta in ({"title": "x"}, "x"):
            with self.subTest(meta):
                doc: pycrdt.Doc = pycrdt.Doc()
                doc.apply_update(sheet_state("Budget", {("r1", "c1"): "Rent"}))
                doc.get("sheets", type=pycrdt.Array).append("s2")
                doc.get("sheetMeta", type=pycrdt.Map)["s2"] = meta
                doc.get("rows", type=pycrdt.Map)["s2"] = pycrdt.Array(["r1"])
                doc.get("cols", type=pycrdt.Map)["s2"] = pycrdt.Array(["c1"])
                doc.get("inputs", type=pycrdt.Map)["s2:r1:c1"] = "Hidden"

                self.assertTrue(is_html_complete(doc.get_update(), "", "Budget Rent"))

    def test_booleans_and_null_are_shown_as_the_browser_writes_them(self):
        state = sheet_state("S", {("r1", "c1"): True, ("r2", "c2"): None})

        self.assertTrue(is_html_complete(state, "", "S true null"))
        self.assertFalse(is_html_complete(state, "", "S True None"))

    def test_an_empty_doc_needs_no_copy(self):
        self.assertTrue(is_html_complete(pycrdt.Doc().get_update(), "", ""))
