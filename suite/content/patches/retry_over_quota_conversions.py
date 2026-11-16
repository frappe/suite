import frappe

from suite.content import conversions
from suite.content.editors import editors
from suite.content.tables import table


def execute() -> None:
    """Clear the over_quota refusals a full Drive made, now only a full site refuses "Before collaboration"."""
    present = set(frappe.db.get_tables(cached=False))
    for app, spec in editors().items():
        if spec.conversion is not None and table(app, "conversion") in present:
            conversions.retry_over_quota(app)
