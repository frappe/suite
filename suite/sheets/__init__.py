"""What other Suite modules may ask of Sheets."""

from frappe import _


def fill_new_sheet(node: str, rows: list[list[str | None]], number_formats: dict[str, str]) -> None:
    """Write the first cells of a sheet that was just created, once this transaction commits.

    `rows` are the cell inputs row by row, as a person types them: a formula
    keeps its leading `=`. `number_formats` maps a cell such as `B3` to an
    engine format such as `number`. The Sheets converter, which runs only in
    a background job, writes them a few seconds later. A sheet someone edits
    before then keeps their edits and gets none of these cells.
    """
    from suite.content import scheduling
    from suite.drive import DriveNotFound
    from suite.sheets.drive import docname_for_node, require_sheet, typed_workbook

    docname = docname_for_node(node)
    if not docname:
        raise DriveNotFound(_("That sheet was not found"))
    require_sheet(docname, write=True)
    scheduling.enqueue(
        "suite.sheets.content.conversion.seed",
        f"suite-sheets-seed-{node}",
        node=node,
        workbook=typed_workbook(rows, number_formats),
        enqueue_after_commit=True,
    )
