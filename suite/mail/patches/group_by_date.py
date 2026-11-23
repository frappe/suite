import frappe


def execute() -> None:
    """Carry each person's list grouping over from the old choice of None, Day or Month to the
    switch that replaced it: grouped by day or by month is grouped by date, now one grouping that
    runs from today back through the months.

    Model sync has added the new column by now and leaves the old one in place, so it can still be
    read. A site that never had it, or a re-run after it is gone, has nothing to carry.
    """

    if not frappe.db.has_column("User Settings", "group_messages_by"):
        return

    frappe.db.sql(
        """
        UPDATE `tabUser Settings`
        SET group_by_date = 1
        WHERE group_messages_by IN ('Day', 'Month')
        """
    )
